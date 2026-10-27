export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Category = 'Sensitive data' | 'Risky code' | 'Repository hygiene' | 'Duplication';

export interface Rule {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  why: string;
  action: string;
}

export const RULES: Rule[] = [
  { id: 'SEC-001', title: 'Recognizable credential', category: 'Sensitive data', severity: 'critical', why: 'A token or private key format is present in tracked content.', action: 'Revoke the credential, replace it outside Git, and review its history.' },
  { id: 'SEC-002', title: 'Possible hardcoded secret', category: 'Sensitive data', severity: 'high', why: 'A secret-like variable has a literal value. Pattern matching cannot prove it is live.', action: 'Check the value locally; move real secrets to a secret store or environment variable.' },
  { id: 'SEC-003', title: 'Sensitive file tracked', category: 'Sensitive data', severity: 'high', why: 'A file usually used for local credentials is tracked.', action: 'Inspect the file and remove private material from current files and Git history if needed.' },
  { id: 'SAFE-001', title: 'TLS verification disabled', category: 'Risky code', severity: 'high', why: 'A command or setting appears to bypass certificate validation.', action: 'Use a trusted certificate or configured CA instead of disabling verification.' },
  { id: 'SAFE-002', title: 'Download piped to a shell', category: 'Risky code', severity: 'medium', why: 'Remote code appears to be executed without reviewing or pinning it.', action: 'Download a pinned version, verify it, then run the reviewed file.' },
  { id: 'SAFE-003', title: 'Dangerous shell operation', category: 'Risky code', severity: 'medium', why: 'A broad delete or permission command deserves human review.', action: 'Constrain the target path and permissions; add safeguards for destructive steps.' },
  { id: 'NOISE-001', title: 'Generated or cache content tracked', category: 'Repository hygiene', severity: 'low', why: 'A common cache or build output path is committed.', action: 'Confirm whether the output is intentional; otherwise ignore and remove it from Git.' },
  { id: 'NOISE-002', title: 'Transient file tracked', category: 'Repository hygiene', severity: 'low', why: 'A log, backup, or operating system file is committed.', action: 'Ignore transient files unless they are deliberate fixtures.' },
  { id: 'SIZE-001', title: 'Large tracked file', category: 'Repository hygiene', severity: 'low', why: 'A tracked file exceeds 10 MiB and may slow clones or backups.', action: 'Check whether it belongs in Git, Git LFS, or external asset storage.' },
  { id: 'DUP-001', title: 'Exact duplicate content', category: 'Duplication', severity: 'low', why: 'Multiple tracked paths contain identical content of at least 128 bytes.', action: 'Check whether one shared source can replace the copies.' },
];

export interface Finding {
  ruleId: string;
  severity: Severity;
  category: Category;
  title: string;
  path: string;
  line: number | null;
  relatedPaths?: string[];
}

const byId = new Map(RULES.map((rule) => [rule.id, rule]));
export function redactKnownCredentials(value: string): string {
  return value.replace(/(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|ngt_[a-f0-9]{20,}|sk-proj-[A-Za-z0-9_-]{20,})/g, '[redacted credential]');
}
export function finding(id: string, path: string, line: number | null = null, relatedPaths?: string[]): Finding {
  const rule = byId.get(id);
  if (!rule) throw new Error(`Unknown audit rule ${id}`);
  return { ruleId: id, severity: rule.severity, category: rule.category, title: rule.title, path: redactKnownCredentials(path), line,
    ...(relatedPaths ? { relatedPaths: relatedPaths.map(redactKnownCredentials) } : {}) };
}

const recognizable: RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|ngt_[a-f0-9]{20,}|sk-proj-[A-Za-z0-9_-]{20,})\b/,
];
const secretAssignment = /\b(?:api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token)\b\s*[=:]\s*["'`]?([A-Za-z0-9_+/.=-]{12,})/i;
const placeholder = /^(?:example|sample|placeholder|changeme|your[_-]|dummy|test|fake|redacted|xxxxxxxx|\$|\{|<)/i;
const tlsBypass = /(?:NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|rejectUnauthorized\s*:\s*false|verify\s*=\s*False)/i;
const pipeShell = /\b(?:curl|wget)\b[^\n|]{0,300}\|\s*(?:sudo\s+)?(?:ba)?sh\b/i;
const unsafePermissions = /\bchmod\s+(?:-R\s+)?777\b/i;

function disablesTls(line: string): boolean {
  if (tlsBypass.test(line)) return true;
  // Inspect each suffix once, rather than backtracking from every repeated
  // command word through the remainder of an attacker-controlled line.
  const curl = /\bcurl\s+/i.exec(line);
  if (curl && /(?:^|\s)-k(?:\s|$)/.test(line.slice(curl.index + curl[0].length))) return true;
  const wget = /\bwget\s+/i.exec(line);
  return Boolean(wget && /--no-check-certificate/i.test(line.slice(wget.index + wget[0].length)));
}

function deletesRoot(line: string): boolean {
  // Parse the option token once. Overlapping [a-z]* groups around r/f caused
  // catastrophic backtracking on long flag strings with no terminating space.
  for (const match of line.matchAll(/\brm\s+-([a-z]+)\s+\/(?:\s|$)/gi)) {
    const flags = match[1].toLowerCase();
    if (flags.includes('r') && flags.includes('f')) return true;
  }
  return false;
}

export function pathRules(path: string, bytes: number): Finding[] {
  const result: Finding[] = [];
  const base = path.split('/').at(-1) ?? path;
  if (/^(?:\.env(?:\..+)?|id_(?:rsa|dsa|ecdsa|ed25519)|credentials(?:\.json)?|.*\.(?:p12|pfx|key))$/i.test(base)
      && !/^(?:\.env\.example|\.env\.sample|credentials\.example\.json)$/i.test(base)) result.push(finding('SEC-003', path));
  if (/(?:^|\/)(?:node_modules|__pycache__|\.cache|Library|Temp|obj|coverage|\.next|\.svelte-kit)(?:\/|$)/i.test(path)
      || /(?:^|\/)(?:dist|build)\//i.test(path)) result.push(finding('NOISE-001', path));
  if (/(?:^|\/)(?:\.DS_Store|Thumbs\.db|.*\.(?:log|tmp|swp|bak|pyc))$/i.test(path)) result.push(finding('NOISE-002', path));
  if (bytes > 10 * 1024 * 1024) result.push(finding('SIZE-001', path));
  return result;
}

export function contentRules(path: string, text: string): Finding[] {
  const result: Finding[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.length > 20_000) continue;
    const number = index + 1;
    if (recognizable.some((pattern) => pattern.test(line))) result.push(finding('SEC-001', path, number));
    const assignment = line.match(secretAssignment);
    if (assignment && !placeholder.test(assignment[1]) && !/^\d+$/.test(assignment[1]) && !/example|fixture|sample|test/i.test(path)) result.push(finding('SEC-002', path, number));
    if (disablesTls(line)) result.push(finding('SAFE-001', path, number));
    if (pipeShell.test(line)) result.push(finding('SAFE-002', path, number));
    if (deletesRoot(line) || unsafePermissions.test(line)) result.push(finding('SAFE-003', path, number));
  }
  return result;
}

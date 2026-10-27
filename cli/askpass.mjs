#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

try {
  const cfg = JSON.parse(readFileSync(join(homedir(), '.config', 'nashgit', 'config.json'), 'utf8'));
  if (!cfg.token) process.exit(1);
  // Git's prompt includes the destination. Never disclose a token to another
  // remote, a redirect target, or a proxy asking for credentials.
  const prompt = process.argv[2] || '';
  const match = /^(Username|Password) for '(https?:\/\/[^']+)':\s*$/.exec(prompt);
  if (!match) process.exit(1);
  const destination = new URL(match[2]);
  const server = new URL(cfg.server);
  if (destination.origin !== server.origin || !destination.pathname.startsWith('/git/')) process.exit(1);
  process.stdout.write(match[1] === 'Username' ? 'x' : cfg.token);
} catch {
  process.exit(1);
}

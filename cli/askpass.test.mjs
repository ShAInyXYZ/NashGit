import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'nashgit-askpass-'));
const configDir = join(dir, '.config', 'nashgit');
mkdirSync(configDir, { recursive: true });
const token = 'test-deploy-token';
writeFileSync(join(configDir, 'config.json'), JSON.stringify({ server: 'https://nas.example:8443', token }));
after(() => rmSync(dir, { recursive: true, force: true }));

function ask(prompt) {
  return spawnSync(process.execPath, [fileURLToPath(new URL('./askpass.mjs', import.meta.url)), prompt], {
    encoding: 'utf8', env: { ...process.env, HOME: dir },
  });
}

test('askpass supplies credentials only for the configured Git endpoint', () => {
  assert.equal(ask("Username for 'https://nas.example:8443/git/project.git': ").stdout, 'x');
  const result = ask("Password for 'https://x@nas.example:8443/git/project.git': ");
  assert.equal(result.status, 0);
  assert.equal(result.stdout, token);
});

test('askpass rejects unrelated hosts, ports, paths, downgrades and malformed prompts', () => {
  for (const url of [
    'https://attacker.example/git/project.git',
    'https://nas.example/git/project.git',
    'http://nas.example:8443/git/project.git',
    'https://nas.example:8443/private',
    'https://nas.example:8443@git.attacker.example/git/project.git',
    'https://nas.example:8443/git/../private',
  ]) {
    const result = ask(`Password for '${url}': `);
    assert.notEqual(result.status, 0, url);
    assert.equal(result.stdout, '', url);
  }
  assert.equal(ask('Proxy password:').stdout, '');
});

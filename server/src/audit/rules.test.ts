import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { contentRules, pathRules } from './rules.js';

test('secret findings include locations but never matched values', () => {
  const secret = 'ghp_abcdefghijklmnopqrstuvwxyz123456';
  const result = contentRules('config.ts', `const token = "${secret}";`);
  assert.ok(result.some((item) => item.ruleId === 'SEC-001' && item.line === 1));
  assert.ok(!JSON.stringify(result).includes(secret));
  const pathResult = pathRules(`private/${secret}/.env`, 20);
  assert.equal(pathResult.length, 1);
  assert.ok(!JSON.stringify(pathResult).includes(secret));
});

test('placeholder examples are not reported as hardcoded secrets', () => {
  assert.equal(contentRules('config.ts', 'password = "placeholder_value_123"').length, 0);
  assert.equal(pathRules('.env.example', 20).length, 0);
});

test('specific risky commands and tracked noise are categorized', () => {
  assert.ok(contentRules('setup.sh', 'curl https://example.invalid/install.sh | bash').some((item) => item.ruleId === 'SAFE-002'));
  assert.ok(pathRules('src/__pycache__/module.pyc', 100).some((item) => item.ruleId === 'NOISE-001'));
});

test('shell checks retain findings without backtracking on hostile flag strings', () => {
  for (const line of ['rm -rf /', 'rm -fr /', 'chmod -R 777 folder']) {
    assert.ok(contentRules('setup.sh', line).some(item => item.ruleId === 'SAFE-003'), line);
  }
  for (const line of ['curl -k https://example.invalid', 'curl https://example.invalid -k', 'wget --no-check-certificate https://example.invalid']) {
    assert.ok(contentRules('setup.sh', line).some(item => item.ruleId === 'SAFE-001'), line);
  }
  // Run in a killable subprocess: a regression must fail instead of hanging CI.
  const script = `
    const { contentRules } = await import(${JSON.stringify(new URL('./rules.ts', import.meta.url).href)});
    for (let i = 0; i < 25; i++) {
      contentRules('setup.sh', 'rm -' + 'rf'.repeat(9000) + '!');
      contentRules('setup.sh', 'curl '.repeat(3500));
    }
  `;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { timeout: 5000, encoding: 'utf8' });
  assert.equal(result.error, undefined, 'hostile input must finish within the subprocess deadline');
  assert.equal(result.status, 0, result.stderr);
});

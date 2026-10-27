import { test } from 'node:test';
import assert from 'node:assert/strict';
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

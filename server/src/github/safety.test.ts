import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syncState } from './safety.js';

test('GitHub sync allows an empty branch or a proven fast-forward', () => {
  assert.equal(syncState('local', null, false).state, 'new-branch');
  assert.equal(syncState('local', 'older', true).state, 'ready');
  assert.equal(syncState('local', 'local', false).state, 'current');
});

test('GitHub sync blocks a divergent or unknown remote branch', () => {
  assert.equal(syncState('local', 'remote', false).state, 'blocked');
});

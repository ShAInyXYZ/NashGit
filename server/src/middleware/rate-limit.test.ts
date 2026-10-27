import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { loginLimiter } from './rate-limit.js';

test('login limits IPv6 address rotation within one client subnet', async () => {
  const app = express();
  // Model a trusted loopback proxy supplying the original client address.
  app.set('trust proxy', 'loopback');
  app.use(loginLimiter);
  app.use((_req, res) => res.status(401).end());
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/login`;
  try {
    for (let i = 1; i <= 11; i++) {
      const res = await fetch(url, { method: 'POST', headers: { 'X-Forwarded-For': `2001:db8:1234:5600::${i.toString(16)}` } });
      await res.text();
      assert.equal(res.status, i <= 10 ? 401 : 429);
    }
    const other = await fetch(url, { method: 'POST', headers: { 'X-Forwarded-For': '2001:db8:9999::1' } });
    assert.equal(other.status, 401, 'another subnet must have its own quota');
    for (const ip of ['::ffff:192.0.2.1', '::ffff:192.0.2.2']) {
      for (let i = 1; i <= 11; i++) {
        const res = await fetch(url, { method: 'POST', headers: { 'X-Forwarded-For': ip } });
        await res.text();
        assert.equal(res.status, i <= 10 ? 401 : 429, 'mapped IPv4 clients need distinct quotas');
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

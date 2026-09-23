import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Store } from '../server/store.js';

test('API protege o painel, valida preferências e rejeita destinos push arbitrários', { timeout: 20_000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-http-test-'));
  const store = new Store(directory);
  store.state.settings.enabled = false;
  store.save();
  const password = 'test-only-password-more-than-24-characters';
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(), env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: directory, MONITOR_TOKEN: password, APP_ORIGIN: 'https://radar.example.test' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  try {
    const port = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('Servidor de teste não iniciou.')), 8000);
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.stdout.on('data', data => { output += data.toString(); const match = output.match(/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
      child.stderr.on('data', () => {});
    });
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/status`)).status, 401);
    const headers = { 'Content-Type': 'application/json', Origin: 'https://radar.example.test' };
    const wrong = await fetch(`${base}/api/login`, { method: 'POST', headers, body: JSON.stringify({ password: 'wrong' }) });
    assert.equal(wrong.status, 401);
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers, body: JSON.stringify({ password }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/);
    headers.Cookie = cookie.split(';')[0];
    const state = await (await fetch(`${base}/api/status`, { headers })).json();
    assert.equal(state.settings.enabled, false);
    assert.equal('subscriptions' in state, false);
    const malformed = await fetch(`${base}/api/settings`, { method: 'PUT', headers, body: JSON.stringify({ interval: 1 }) });
    assert.equal(malformed.status, 400);
    const settings = { interval: 120, enabled: false, workdays: 'even', notifyChanges: true };
    const saved = await fetch(`${base}/api/settings`, { method: 'PUT', headers, body: JSON.stringify(settings) });
    assert.equal(saved.status, 200);
    assert.deepEqual((await saved.json()).settings, settings);
    const crossSite = await fetch(`${base}/api/settings`, { method: 'PUT', headers: { ...headers, Origin: 'https://untrusted.example' }, body: JSON.stringify(settings) });
    assert.equal(crossSite.status, 403);
    const invalidPush = await fetch(`${base}/api/push/subscribe`, { method: 'POST', headers, body: JSON.stringify({ endpoint: 'https://localhost/private', keys: { auth: 'x', p256dh: 'x' } }) });
    assert.equal(invalidPush.status, 400);
    const persisted = new Store(directory);
    assert.deepEqual(persisted.state.settings, settings);
    const key = await (await fetch(`${base}/api/push/key`, { headers })).json();
    assert.ok(key.publicKey); assert.equal(Object.keys(key).length, 1);
  } finally {
    const exited = once(child, 'exit'); child.kill(); await exited;
    // Only remove the unique temporary directory created by this test.
    if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('ras-http-test-')) fs.rmSync(directory, { recursive: true, force: true });
  }
});

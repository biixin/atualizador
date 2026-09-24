import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import webpush from 'web-push';
import { createVercelApp } from '../server/vercel-app.js';
import { RedisRepository, SAVE_SCRIPT, UNLOCK_SCRIPT } from '../server/redis-store.js';

const NOW = Date.parse('2026-09-23T18:00:01Z');
const PASSWORD = 'test-panel-password-more-than-24';
const SECRET = 'test-cron-secret-more-than-24-chars';
const ENV = { UPSTASH_REDIS_REST_URL: 'https://redis.example.test', UPSTASH_REDIS_REST_TOKEN: 'test-only', MONITOR_TOKEN: PASSWORD, CRON_SECRET: SECRET, APP_ORIGIN: 'https://radar.example.test' };
const raw = (patch = {}) => ({ id: 50, data: '2026-09-25', local: 'COTEM', horario_inicio: '17:00:00', horario_termino: '05:00:00', observacoes: '', vagas: 4, vagas_ocupadas: 4, vagas_restantes: 0, candidatura_ate: '2026-09-24T15:00:00Z', ...patch });
const sub = () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: webpush.generateVAPIDKeys().publicKey, auth: Buffer.alloc(16, 7).toString('base64url') } });

function fakeRedis(now) {
  const values = new Map();
  const read = key => { const item = values.get(key); if (item?.expires && item.expires <= now()) { values.delete(key); return null; } return item?.value ?? null; };
  const write = (key, value, expires = null) => values.set(key, { value, expires });
  const command = async (cmd, ...args) => {
    if (cmd === 'GET') return read(args[0]);
    if (cmd === 'DEL') return values.delete(args[0]) ? 1 : 0;
    if (cmd === 'SET') {
      const [key, value, nx, px, ttl] = args;
      if (nx === 'NX' && read(key) !== null) return null;
      write(key, value, px === 'PX' ? now() + ttl : null); return 'OK';
    }
    if (cmd === 'EVAL') {
      const [script, count, ...rest] = args;
      const keys = rest.slice(0, count); const parameters = rest.slice(count);
      if (script === SAVE_SCRIPT) { if (read(keys[0]) !== parameters[0]) return 0; write(keys[1], parameters[1]); return 1; }
      if (script === UNLOCK_SCRIPT) { if (read(keys[0]) !== parameters[0]) return 0; return values.delete(keys[0]) ? 1 : 0; }
      if (script.includes("redis.call('INCR'")) { const count = Number(read(keys[0]) || 0) + 1; write(keys[0], String(count), values.get(keys[0])?.expires || now() + 900_000); return count; }
    }
    throw new Error(`Unsupported test Redis command: ${cmd}`);
  };
  return { command, read };
}
async function serve(t, options) {
  const server = createVercelApp(options).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (path, { method = 'GET', body, cookie, bearer, origin } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    if (origin) headers.Origin = origin;
    const response = await fetch(base + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
}
async function login(request) {
  const result = await request('/api/login', { method: 'POST', body: { password: PASSWORD } });
  assert.equal(result.status, 200); return result.cookie;
}

test('Vercel sem variáveis expõe a consulta via API, sem fingir persistência ou push', async t => {
  let calls = 0;
  const request = await serve(t, { env: {}, now: () => NOW, fetcher: async () => { calls++; return { ok: true, json: async () => [raw()] }; } });
  assert.equal((await request('/api/health')).data.mode, 'read-only');
  assert.equal((await request('/api/auth')).data.authenticated, true);
  const status = await request('/api/status');
  assert.equal(status.status, 200); assert.equal(status.data.rows.length, 1);
  assert.equal(status.data.capabilities.push, false); assert.equal(status.data.capabilities.background, false);
  assert.equal(status.data.capabilities.persistent, false); assert.deepEqual(status.data.events, []);
  const rewrite = await request('/api/index?route=status');
  assert.equal(rewrite.status, 200); assert.equal(calls, 1);
  assert.equal((await request('/api/index?route=auth')).data.authenticated, true);
  assert.equal((await request('/api/push/key')).status, 503);
  assert.equal((await request('/api/cron')).status, 401);
});

test('Redis sem senha de painel mantém modo de consulta e não aceita assinaturas', async t => {
  const request = await serve(t, { env: { ...ENV, MONITOR_TOKEN: '' }, command: () => { throw new Error('Must not use storage without access control'); }, fetcher: async () => ({ ok: true, json: async () => [] }) });
  const result = await request('/api/status');
  assert.equal(result.status, 200); assert.equal(result.data.capabilities.setup.password, false);
  assert.equal((await request('/api/push/subscribe', { method: 'POST', body: sub() })).status, 503);
});

test('reinícios na Vercel preservam chaves, preferências e dispositivos; cron notifica com painel fechado', async t => {
  let clock = NOW; let payload = [raw()]; let calls = 0;
  const memory = fakeRedis(() => clock); const sent = [];
  const options = { env: ENV, command: memory.command, now: () => clock, fetcher: async () => { calls++; return { ok: true, json: async () => payload }; }, push: async (...args) => sent.push(args) };
  const first = await serve(t, options);
  assert.equal((await first('/api/status')).status, 401);
  assert.equal((await first('/api/login', { method: 'POST', body: { password: 'wrong' } })).status, 401);
  const cookie = await login(first);
  const initial = await first('/api/status', { cookie });
  assert.equal(initial.data.capabilities.background, false);
  const key = await first('/api/push/key', { cookie });
  assert.deepEqual(Object.keys(key.data), ['publicKey']);
  assert.equal((await first('/api/push/subscribe', { method: 'POST', cookie, body: sub() })).status, 200);
  const second = await serve(t, options);
  assert.equal((await second('/api/push/key', { cookie })).data.publicKey, key.data.publicKey);
  assert.equal((await second('/api/status', { cookie })).data.devices, 1);
  assert.equal(sent.length, 0);
  clock += 60_000; payload = [raw({ vagas_ocupadas: 3, vagas_restantes: 1 })];
  assert.equal((await second('/api/cron', { bearer: 'wrong-secret' })).status, 401);
  // No browser/status request is needed for this notification.
  const cron = await second('/api/cron', { bearer: SECRET });
  assert.equal(cron.status, 200); assert.equal(sent.length, 1); assert.equal(calls, 2);
  assert.equal((await second('/api/cron', { bearer: SECRET })).status, 200);
  assert.equal(sent.length, 1); assert.equal(calls, 2);
  const third = await serve(t, options);
  const state = await third('/api/status', { cookie });
  assert.equal(state.data.capabilities.background, true); assert.equal(state.data.events[0].kind, 'opened');
  assert.equal('vapid' in state.data, false); assert.equal('subscriptions' in state.data, false);
  const settings = { interval: 120, enabled: false, workdays: 'even', notifyChanges: true };
  assert.equal((await third('/api/settings', { method: 'PUT', cookie, body: settings })).status, 200);
  assert.deepEqual((await second('/api/status', { cookie })).data.settings, settings);
  clock += 180_000;
  await second('/api/cron', { bearer: SECRET }); assert.equal(calls, 2);
});

test('instâncias concorrentes compartilham uma trava e fazem apenas uma consulta', async t => {
  const memory = fakeRedis(() => NOW); let release; let calls = 0;
  const options = { env: ENV, command: memory.command, now: () => NOW, fetcher: async () => { calls++; return new Promise(resolve => { release = resolve; }); } };
  const first = await serve(t, options); const second = await serve(t, options); const cookie = await login(first);
  const pending = first('/api/status', { cookie });
  while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  const concurrent = await second('/api/status', { cookie });
  assert.equal(concurrent.data.checking, true); assert.equal(calls, 1);
  release({ ok: true, json: async () => [raw()] });
  assert.equal((await pending).data.initialized, true);
});

test('fila de push sobrevive à falha e a uma nova instância', async t => {
  let clock = NOW; let payload = [raw()]; let attempts = 0;
  const memory = fakeRedis(() => clock);
  const options = { env: ENV, command: memory.command, now: () => clock, fetcher: async () => ({ ok: true, json: async () => payload }), push: async () => { if (++attempts === 1) throw new Error('network'); } };
  const first = await serve(t, options); const cookie = await login(first);
  await first('/api/status', { cookie });
  await first('/api/push/subscribe', { method: 'POST', cookie, body: sub() });
  clock += 60_000; payload = [raw({ vagas_ocupadas: 3, vagas_restantes: 1 })];
  const failure = await first('/api/cron', { bearer: SECRET });
  assert.equal(failure.data.pendingNotifications, 1);
  const second = await serve(t, options); clock += 120_000;
  const recovery = await second('/api/cron', { bearer: SECRET });
  assert.equal(recovery.data.pendingNotifications, 0); assert.equal(attempts, 2);
});

test('trava expirada não permite que uma função antiga sobrescreva o estado', async () => {
  let clock = NOW; const memory = fakeRedis(() => clock); const repository = new RedisRepository(memory.command, 'lock-test');
  await assert.rejects(repository.locked(async store => {
    clock += 91_000;
    await memory.command('SET', 'lock-test:lock', 'new-owner', 'NX', 'PX', 90_000);
    await store.save();
  }), /tempo de execução/);
  assert.equal(memory.read('lock-test:lock'), 'new-owner'); assert.equal(memory.read('lock-test:state'), null);
});

test('configurações inválidas, CSRF e destinos push privados são recusados na Vercel', async t => {
  const memory = fakeRedis(() => NOW);
  const request = await serve(t, { env: ENV, command: memory.command, now: () => NOW });
  const cookie = await login(request);
  const settings = { interval: 30, enabled: true, workdays: 'all', notifyChanges: false };
  assert.equal((await request('/api/settings', { method: 'PUT', cookie, body: settings })).status, 400);
  assert.equal((await request('/api/settings', { method: 'PUT', cookie, origin: 'https://untrusted.example', body: { ...settings, interval: 60 } })).status, 403);
  assert.equal((await request('/api/push/subscribe', { method: 'POST', cookie, body: { ...sub(), endpoint: 'https://localhost/private' } })).status, 400);
});

test('admin na Vercel exige login próprio e envia mensagens sem inscrição no PC', async t => {
  let clock = NOW;
  const memory = fakeRedis(() => clock); const sent = [];
  const env = { ...ENV, ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'test-admin-password-only' };
  const options = { env, command: memory.command, now: () => clock, fetcher: async () => ({ ok: true, json: async () => [] }), push: async (...args) => sent.push(args) };
  const request = await serve(t, options);
  assert.equal((await request('/api/admin/session')).data.configured, true);
  assert.equal((await request('/api/admin/notifications')).status, 401);
  const panelCookie = await login(request);
  assert.equal((await request('/api/admin/notifications', { cookie: panelCookie })).status, 401);
  assert.equal((await request('/api/admin/login', { method: 'POST', body: { username: 'other', password: env.ADMIN_PASSWORD } })).status, 401);
  const loginResult = await request('/api/admin/login', { method: 'POST', body: { username: 'admin', password: env.ADMIN_PASSWORD } });
  assert.equal(loginResult.status, 200);
  const cookie = loginResult.cookie;
  assert.equal((await request('/api/auth', { cookie })).data.authenticated, true);
  assert.equal((await request('/api/auth', { cookie })).data.adminAuthenticated, true);
  await request('/api/push/key', { cookie });
  await request('/api/push/subscribe', { method: 'POST', cookie: panelCookie, body: { ...sub(), deviceName: 'Meu iPhone', deviceType: 'mobile' } });
  const devices = await request('/api/admin/notifications', { cookie });
  assert.equal(devices.data.devices.length, 1); assert.equal(devices.data.devices[0].name, 'Meu iPhone');
  assert.equal('endpoint' in devices.data.devices[0], false); assert.equal('keys' in devices.data.devices[0], false);
  const body = { title: 'Mensagem do PC', message: 'Você recebeu o teste?', target: 'all' };
  assert.equal((await request('/api/admin/notifications/test', { method: 'POST', cookie: panelCookie, body })).status, 401);
  assert.equal((await request('/api/admin/notifications/test', { method: 'POST', cookie, origin: 'https://untrusted.example', body })).status, 403);
  const result = await request('/api/admin/notifications/test', { method: 'POST', cookie, body });
  assert.equal(result.status, 200); assert.equal(result.data.report.sent, 1); assert.equal(sent[0][1].body, body.message);
  const second = await serve(t, options);
  assert.equal((await second('/api/admin/notifications', { cookie })).data.history.length, 1);
  assert.equal((await second('/api/admin/notifications/test', { method: 'POST', cookie, body })).status, 429);
  const publicStatus = await second('/api/status', { cookie: panelCookie });
  assert.equal('adminTests' in publicStatus.data, false);
  const logout = await request('/api/admin/logout', { method: 'POST', cookie, body: {} });
  assert.equal(logout.status, 200); assert.equal(logout.cookie, 'ras_admin_session=');
  clock += 8 * 60 * 60 * 1000 + 1;
  assert.equal((await second('/api/admin/notifications', { cookie })).status, 401);
});

test('admin sem armazenamento entra, mas não promete enviar notificações', async t => {
  const env = { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'test-admin-password-only' };
  const request = await serve(t, { env });
  const result = await request('/api/admin/login', { method: 'POST', body: { username: 'admin', password: env.ADMIN_PASSWORD } });
  assert.equal(result.status, 200);
  assert.equal((await request('/api/admin/notifications', { cookie: result.cookie })).data.available, false);
  assert.equal((await request('/api/admin/notifications/test', { method: 'POST', cookie: result.cookie, body: { message: 'Teste' } })).status, 503);
});

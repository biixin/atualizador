import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminAuth, broadcastTest, deviceId, deviceMetadata, validateTestMessage } from '../server/admin.js';
import { initialState } from '../server/store.js';

const NOW = Date.parse('2026-09-24T01:00:00Z');
const ENV = { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'test-only-admin-password' };
const subscription = (name, type = 'mobile') => ({ endpoint: `https://fcm.googleapis.com/send/${name}`, keys: {}, deviceName: name, deviceType: type });
function store(subscriptions) { return { state: { ...initialState(), subscriptions }, save() {} }; }

test('sessão de admin exige usuário e senha, expira e é invalidada pela troca da senha', () => {
  let clock = NOW;
  const auth = adminAuth(ENV, { now: () => clock, secure: true });
  assert.equal(auth.validCredentials({ username: 'other', password: ENV.ADMIN_PASSWORD }), false);
  assert.equal(auth.validCredentials({ username: 'admin', password: 'wrong' }), false);
  assert.equal(auth.validCredentials({ username: 'admin', password: ENV.ADMIN_PASSWORD }), true);
  let cookie;
  auth.login({ cookie(name, value, options) { cookie = `${name}=${value}`; assert.equal(options.httpOnly, true); assert.equal(options.secure, true); assert.equal(options.sameSite, 'strict'); } });
  assert.equal(auth.authenticated({ headers: { cookie } }), true);
  assert.equal(auth.authenticated({ headers: { cookie: `${cookie}x` } }), false);
  assert.equal(adminAuth({ ...ENV, ADMIN_PASSWORD: 'another-admin-password' }, { now: () => clock }).authenticated({ headers: { cookie } }), false);
  clock += 8 * 60 * 60 * 1000 + 1;
  assert.equal(auth.authenticated({ headers: { cookie } }), false);
  assert.equal(adminAuth({}).authenticated({ headers: { cookie } }), false);
});

test('validação rejeita mensagens vazias, grandes e destinatários arbitrários', () => {
  for (const body of [{}, { message: '  ' }, { message: 12 }, { message: 'x'.repeat(501) }, { message: 'teste', title: 'x'.repeat(81) }, { message: 'teste', target: 'https://private.local' }]) assert.throws(() => validateTestMessage(body));
  assert.deepEqual(validateTestMessage({ message: ' Olá! ', title: ' ', target: 'all' }), { title: 'Teste RAS Radar', message: 'Olá!', target: 'all' });
});

test('PC sem inscrição própria envia texto personalizado para os celulares selecionados', async () => {
  const a = subscription('iPhone'); const b = subscription('Android'); const pc = subscription('PC', 'desktop');
  const state = store([a, b, pc]); const sends = [];
  const report = await broadcastTest(state, { title: 'Teste pessoal', message: 'Recebeu no celular?', target: 'mobile' }, async (device, payload) => sends.push({ device, payload }), () => NOW);
  assert.equal(report.total, 2); assert.equal(report.sent, 2); assert.equal(sends.length, 2);
  assert.equal(sends.some(item => item.device === pc), false);
  assert.equal(sends[0].payload.body, 'Recebeu no celular?'); assert.equal(sends[0].payload.title, 'Teste pessoal');
  assert.equal(state.state.adminTests[0].id, report.id);
});

test('seleção individual não envia para outros dispositivos', async () => {
  const a = subscription('A'); const b = subscription('B'); const sent = [];
  const report = await broadcastTest(store([a, b]), { message: 'Só A', target: deviceId(a) }, async device => sent.push(device), () => NOW);
  assert.equal(report.total, 1); assert.deepEqual(sent, [a]);
});

test('resultado parcial diferencia aceitos, falhas e inscrições revogadas', async () => {
  const a = subscription('ok'); const b = subscription('expired'); const c = subscription('offline');
  const state = store([a, b, c]);
  state.state.outbox.push({ endpoint: b.endpoint });
  const report = await broadcastTest(state, { message: 'Teste parcial' }, async device => {
    if (device === b) throw Object.assign(new Error('gone'), { statusCode: 410 });
    if (device === c) throw new Error('temporary');
  }, () => NOW);
  assert.equal(report.sent, 1); assert.equal(report.expired, 1); assert.equal(report.failed, 1);
  assert.equal(state.state.subscriptions.length, 2); assert.equal(state.state.outbox.length, 0);
  assert.equal(JSON.stringify(report).includes('fcm.googleapis.com'), false);
});

test('limite entre testes e ausência de aparelhos impedem envios extras', async () => {
  const state = store([subscription('phone')]); let calls = 0;
  const send = async () => calls++;
  await broadcastTest(state, { message: 'Primeiro' }, send, () => NOW);
  await assert.rejects(broadcastTest(state, { message: 'Segundo' }, send, () => NOW + 1000), /30 segundos/);
  await assert.rejects(broadcastTest(store([]), { message: 'Sem aparelho' }, send, () => NOW), /Nenhum dispositivo/);
  assert.equal(calls, 1);
});

test('falha na persistência impede disparo antes de registrar a tentativa', async () => {
  const state = store([subscription('phone')]); state.save = async () => { throw new Error('storage unavailable'); };
  let sent = false;
  await assert.rejects(broadcastTest(state, { message: 'Teste' }, async () => { sent = true; }, () => NOW), /storage unavailable/);
  assert.equal(sent, false);
});

test('cadastro conserva a data original e não guarda um user agent completo', () => {
  const metadata = deviceMetadata({ deviceName: ' Android ', deviceType: 'mobile', userAgent: 'not-stored' }, { registeredAt: '2026-01-01' }, NOW);
  assert.deepEqual(metadata, { deviceName: 'Android', deviceType: 'mobile', registeredAt: '2026-01-01' });
});

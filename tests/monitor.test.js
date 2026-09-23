import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.js';
import { Monitor } from '../server/monitor.js';
import { decorate, detectChanges, matchesWorkdays, normalizeRows, statusOf, validateSettings } from '../server/domain.js';

const NOW = Date.parse('2026-09-23T18:00:00Z');
const raw = (patch = {}) => ({ id: 50, data: '2026-09-25', local: 'COTEM', horario_inicio: '17:00:00', horario_termino: '05:00:00', observacoes: 'VALOR R$270', vagas: 4, vagas_ocupadas: 3, vagas_restantes: 1, candidatura_ate: '2026-09-24T15:00:00Z', ...patch });
const row = patch => normalizeRows([raw(patch)])[0];
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: {} };
function memoryStore() {
  return { state: { settings: { interval: 60, enabled: true, workdays: 'all', notifyChanges: false }, snapshot: null, events: [], subscriptions: [], outbox: [], checks: 0 }, save() {} };
}
function setup(payload = [raw()], push = async () => {}) {
  const store = memoryStore();
  let clock = NOW;
  let response = payload;
  const monitor = new Monitor(store, { now: () => clock, fetcher: async () => { if (response instanceof Error) throw response; return { ok: true, json: async () => response }; }, push });
  return { store, monitor, setResponse(value) { response = value; }, setNow(value) { clock = value; } };
}

test('vagas restantes não tornam um RAS com prazo encerrado aberto', () => {
  assert.equal(statusOf(row({ candidatura_ate: '2026-09-23T15:00:00Z' }), NOW), 'closed');
  assert.equal(statusOf(row(), NOW), 'open');
  assert.equal(statusOf(row({ vagas_ocupadas: 4, vagas_restantes: 0 }), NOW), 'full');
});
test('prazo exato é encerrado; dias passados usam horário de Brasília', () => {
  assert.equal(statusOf(row(), Date.parse('2026-09-24T15:00:00Z')), 'closed');
  assert.equal(statusOf(row({ data: '2026-09-22', candidatura_ate: null }), NOW), 'closed');
  assert.equal(statusOf(row({ data: '2026-09-23', candidatura_ate: null }), Date.parse('2026-09-24T01:00:00Z')), 'open');
});
test('trabalho par monitora folga ímpar, e vice-versa', () => {
  assert.equal(matchesWorkdays(row(), 'even'), true);
  assert.equal(matchesWorkdays(row(), 'odd'), false);
  assert.equal(matchesWorkdays(row({ data: '2026-09-26' }), 'odd'), true);
});
test('dados malformados e identificadores duplicados são recusados', () => {
  assert.throws(() => normalizeRows({ error: 'offline' }));
  assert.throws(() => normalizeRows([raw({ vagas: '4' })]));
  assert.throws(() => normalizeRows([raw(), raw()]));
  assert.throws(() => normalizeRows([raw({ candidatura_ate: 'inválido' })]));
});
test('reabertura, aumento, remoção e alteração são distinguidos', () => {
  const full = decorate(row({ vagas_ocupadas: 4, vagas_restantes: 0 }), NOW);
  assert.equal(detectChanges([full], [row()], NOW)[0].kind, 'opened');
  assert.equal(detectChanges([decorate(row(), NOW)], [row({ vagas_ocupadas: 2, vagas_restantes: 2 })], NOW)[0].kind, 'opened');
  assert.equal(detectChanges([decorate(row(), NOW)], [row({ horario_inicio: '18:00:00' })], NOW)[0].kind, 'updated');
  assert.equal(detectChanges([full], [], NOW)[0].kind, 'removed');
  assert.equal(detectChanges(null, [row()], NOW).length, 0);
});
test('primeira consulta cria referência; consultas idênticas não repetem alertas', async () => {
  const sent = [];
  const s = setup([raw()], async (...args) => sent.push(args));
  s.store.state.subscriptions.push(subscription);
  await s.monitor.check(); await s.monitor.check(); s.monitor.stop();
  assert.equal(s.store.state.events.length, 1);
  assert.equal(s.store.state.checks, 2); assert.equal(sent.length, 0);
});
test('falha preserva snapshot e recuperação detecta uma única nova vaga', async () => {
  const sent = [];
  const s = setup([raw({ vagas_ocupadas: 4, vagas_restantes: 0 })], async (...args) => sent.push(args));
  s.store.state.subscriptions.push(subscription);
  await s.monitor.check();
  const previous = s.store.state.snapshot;
  s.setResponse(new Error('fetch failed')); await s.monitor.check();
  assert.equal(s.store.state.snapshot, previous); assert.match(s.store.state.error, /conexão/);
  s.setResponse([raw()]); await s.monitor.check(); await s.monitor.check(); s.monitor.stop();
  assert.equal(sent.length, 1); assert.equal(s.store.state.error, null);
  assert.equal(s.store.state.events[0].kind, 'opened');
});
test('escala excluída mantém histórico sem enviar push', async () => {
  const sent = [];
  const s = setup([], async (...args) => sent.push(args));
  s.store.state.settings.workdays = 'odd'; s.store.state.subscriptions.push(subscription);
  await s.monitor.check(); s.setResponse([raw()]); await s.monitor.check(); s.monitor.stop();
  assert.equal(s.store.state.events[0].kind, 'opened'); assert.equal(sent.length, 0);
});
test('falha temporária de push permanece na fila e é entregue depois', async () => {
  let attempts = 0;
  const s = setup([], async () => { if (++attempts === 1) throw new Error('temporário'); });
  s.store.state.subscriptions.push(subscription);
  await s.monitor.check(); s.setResponse([raw()]); await s.monitor.check();
  assert.equal(s.store.state.outbox.length, 1);
  s.setNow(NOW + 61_000); await s.monitor.deliver(); s.monitor.stop();
  assert.equal(attempts, 2); assert.equal(s.store.state.outbox.length, 0);
});
test('assinaturas revogadas são removidas', async () => {
  const s = setup([], async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }); });
  s.store.state.subscriptions.push(subscription);
  await s.monitor.check(); s.setResponse([raw()]); await s.monitor.check(); s.monitor.stop();
  assert.equal(s.store.state.subscriptions.length, 0); assert.equal(s.store.state.outbox.length, 0);
});
test('aviso pendente de vaga que encerrou não é enviado', async () => {
  let calls = 0;
  const s = setup([], async () => { calls++; throw new Error('offline'); });
  s.store.state.subscriptions.push(subscription);
  await s.monitor.check(); s.setResponse([raw({ candidatura_ate: '2026-09-23T18:00:30Z' })]); await s.monitor.check();
  s.setNow(NOW + 61_000); await s.monitor.deliver(); s.monitor.stop();
  assert.equal(calls, 1); assert.equal(s.store.state.outbox.length, 0);
});
test('consulta simultânea é compartilhada, sem sobrecarregar a API', async () => {
  const store = memoryStore(); let release; let calls = 0;
  const monitor = new Monitor(store, { now: () => NOW, fetcher: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  const first = monitor.check(); const second = monitor.check();
  assert.equal(first, second); assert.equal(calls, 1);
  release({ ok: true, json: async () => [] }); await first; monitor.stop();
});
test('reinício preserva referência e não notifica novamente vagas já vistas', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-radar-test-'));
  try {
    const store = new Store(directory);
    store.state.snapshot = [decorate(row(), NOW)]; store.save();
    const restored = new Store(directory);
    const monitor = new Monitor(restored, { now: () => NOW, fetcher: async () => ({ ok: true, json: async () => [raw()] }) });
    await monitor.check(); monitor.stop(); assert.equal(restored.state.events.length, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('intervalos arbitrários e preferências incompletas são recusados', () => {
  assert.throws(() => validateSettings({ interval: 1 }));
  assert.throws(() => validateSettings({ interval: 60, enabled: true, workdays: 'other', notifyChanges: false }));
});

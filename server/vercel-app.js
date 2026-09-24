import express from 'express';
import webpush from 'web-push';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { initialState } from './store.js';
import { Monitor } from './monitor.js';
import { validateSettings } from './domain.js';
import { RedisRepository, createRedisCommand, redisEnvironment } from './redis-store.js';
import { pushSender, validSubscription } from './push.js';
import { adminAuth, createAdminRouter, deviceMetadata } from './admin.js';

const same = (a, b) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
const fail = (status, message) => Object.assign(new Error(message), { status });

export function createVercelApp({ env = process.env, command, fetcher, push, now = () => Date.now() } = {}) {
  const app = express();
  const admin = adminAuth(env, { now, secure: true });
  const redis = redisEnvironment(env);
  const hasRedis = !!(redis.url && redis.token);
  const password = env.MONITOR_TOKEN || '';
  const protectedPanel = password.length >= 24;
  const durable = hasRedis && protectedPanel;
  const cronSecret = env.CRON_SECRET || '';
  const cadence = Math.max(60, Number(env.SCHEDULER_INTERVAL_SECONDS) || 60);
  let repository;
  // Lazy initialization keeps /health and /auth available even if storage is
  // misconfigured, and lets a basic deployment show public SCORA data.
  const repo = () => repository ||= new RedisRepository(command || createRedisCommand(redis), redis.prefix);
  const temporary = { state: initialState(), save() {} };
  const publicMonitor = new Monitor(temporary, { continuous: false, requestTimeout: 20_000, fetcher, now });
  const localAttempts = { count: 0, expires: 0 };
  const monitorFor = store => {
    store.state.vapid ||= webpush.generateVAPIDKeys();
    return new Monitor(store, { continuous: false, requestTimeout: 20_000, deliveryBudget: 12_000, now, fetcher, push: push || pushSender(store.state.vapid, env.VAPID_SUBJECT) });
  };
  function capabilities(state) {
    const schedulerActive = durable && !!state.lastCronAt && now() - Date.parse(state.lastCronAt) < Math.max(180, cadence * 3) * 1000;
    return {
      runtime: 'vercel', persistent: durable, preferences: durable, push: durable,
      background: schedulerActive,
      schedulerConfigured: cronSecret.length >= 24,
      schedulerInterval: cadence,
      setup: { storage: hasRedis, password: protectedPanel, cronSecret: cronSecret.length >= 24, scheduler: schedulerActive },
      notice: !durable
        ? 'As vagas estão disponíveis para consulta. Para salvar preferências, preservar o histórico e receber avisos com o site fechado, conclua a configuração da hospedagem.'
        : !schedulerActive ? 'As vagas são atualizadas enquanto você usa o painel. O agendamento com o site fechado ainda não foi confirmado; os alertas automáticos dependem dele.' : null,
    };
  }
  function view(store, monitor = new Monitor(store, { continuous: false, now })) {
    return { ...monitor.view(), ...(durable ? {} : { events: [], lastChange: null }), capabilities: capabilities(store.state), lastCronAt: store.state.lastCronAt || null };
  }
  function authenticated(req) {
    if (admin.authenticated(req)) return true;
    if (!protectedPanel) return true;
    const value = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('ras_session='))?.slice(12) || '';
    const [expires, signature] = value.split('.');
    return Number(expires) > now() && !!signature && same(signature, createHmac('sha256', password).update(expires).digest('hex'));
  }
  const due = state => state.settings.enabled && (!state.nextCheck || state.nextCheck <= now());
  function requireStorage() {
    if (!durable) throw fail(503, 'Conecte o Redis e defina MONITOR_TOKEN com pelo menos 24 caracteres na Vercel para ativar preferências e notificações.');
  }
  async function update(res, callback) {
    requireStorage();
    const operation = await repo().locked(callback);
    if (operation.busy) return res.status(409).json({ error: 'Uma consulta está em andamento. Aguarde alguns segundos e tente novamente.' });
    return res.json(operation.result);
  }

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    // Works both with the original path and with Vercel's rewritten function URL.
    const url = new URL(req.url, 'https://radar.local');
    if (['/api', '/api/', '/api/index'].includes(url.pathname) && url.searchParams.has('route')) req.url = `/api/${url.searchParams.get('route')}`;
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    next();
  });
  app.use(express.json({ limit: '12kb' }));
  app.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const allowed = env.APP_ORIGIN || `https://${req.headers.host}`;
      if ((req.headers.origin && req.headers.origin !== allowed) || req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Origem não permitida.' });
      if (!req.is('application/json')) return res.status(415).json({ error: 'Envie application/json.' });
    }
    next();
  });
  app.get('/api/health', (req, res) => res.json({ ok: true, runtime: 'vercel', version: '2', mode: durable ? 'persistent' : 'read-only' }));
  app.get('/api/auth', (req, res) => res.json({ authenticated: authenticated(req), required: protectedPanel, adminAuthenticated: admin.authenticated(req), adminConfigured: admin.configured }));
  app.use('/api/admin', createAdminRouter({
    auth: admin, now, available: () => durable,
    readStore: async () => ({ state: await repo().read() }),
    mutateStore: async callback => {
      const operation = await repo().locked(callback);
      if (operation.busy) throw fail(409, 'Uma consulta está em andamento. Aguarde alguns segundos e tente novamente.');
      return operation.result;
    },
    sendForStore: store => push || pushSender(store.state.vapid, env.VAPID_SUBJECT),
    loginAllowed: durable ? () => repo().loginAllowed('admin') : undefined,
    resetAttempts: durable ? () => repo().resetLoginAttempts('admin') : undefined,
  }));
  app.post('/api/login', async (req, res) => {
    let allowed;
    if (durable) allowed = await repo().loginAllowed();
    else {
      if (localAttempts.expires <= now()) { localAttempts.count = 0; localAttempts.expires = now() + 900_000; }
      allowed = ++localAttempts.count <= 10;
    }
    if (!allowed) return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em 15 minutos.' });
    if (!protectedPanel || typeof req.body?.password !== 'string' || !same(req.body.password, password)) return res.status(401).json({ error: 'Senha de acesso incorreta.' });
    if (durable) await repo().resetLoginAttempts();
    const expires = String(now() + 30 * 86400_000);
    const signature = createHmac('sha256', password).update(expires).digest('hex');
    res.cookie('ras_session', `${expires}.${signature}`, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 30 * 86400_000, path: '/' });
    res.json({ ok: true });
  });
  // The scheduler authenticates independently from the browser session.
  app.get('/api/cron', async (req, res) => {
    if (cronSecret.length < 24 || !same(req.headers.authorization || '', `Bearer ${cronSecret}`)) return res.status(401).json({ error: 'Agendamento não autorizado.' });
    requireStorage();
    const operation = await repo().locked(async store => {
      store.state.lastCronAt = new Date(now()).toISOString();
      const monitor = monitorFor(store);
      if (due(store.state)) await monitor.check();
      else { await monitor.deliver(); await store.save(); }
      return { ok: !store.state.error, checkedAt: store.state.lastCheck, paused: !store.state.settings.enabled, pendingNotifications: store.state.outbox.length };
    });
    if (operation.busy) return res.status(202).json({ ok: true, skipped: 'another-check-in-progress' });
    res.status(operation.result.ok ? 200 : 502).json(operation.result);
  });
  app.use('/api', (req, res, next) => authenticated(req) ? next() : res.status(401).json({ error: 'Entre com a senha do seu painel.' }));
  app.get('/api/status', async (req, res) => {
    if (!durable) {
      if (due(temporary.state)) await publicMonitor.check();
      return res.json(view(temporary, publicMonitor));
    }
    const state = await repo().read();
    if (!due(state)) return res.json(view({ state }));
    const operation = await repo().locked(async store => {
      const monitor = monitorFor(store);
      if (due(store.state)) await monitor.check();
      return view(store, monitor);
    });
    if (operation.busy) return res.json({ ...view({ state }), checking: true });
    res.json(operation.result);
  });
  app.post('/api/check', async (req, res) => {
    if (!durable) {
      if (temporary.state.lastManualCheck && now() - temporary.state.lastManualCheck < 10_000) return res.status(429).json({ error: 'Aguarde 10 segundos entre verificações manuais.' });
      temporary.state.lastManualCheck = now();
      await publicMonitor.check();
      return res.json(view(temporary, publicMonitor));
    }
    return update(res, async store => {
      if (store.state.lastManualCheck && now() - store.state.lastManualCheck < 10_000) throw fail(429, 'Aguarde 10 segundos entre verificações manuais.');
      store.state.lastManualCheck = now();
      const monitor = monitorFor(store);
      await monitor.check();
      return view(store, monitor);
    });
  });
  app.put('/api/settings', async (req, res) => {
    let settings;
    try { settings = validateSettings(req.body); } catch (error) { throw fail(400, error.message); }
    if (settings.interval < 60) throw fail(400, 'Na Vercel, use um intervalo de pelo menos 1 minuto.');
    return update(res, async store => {
      store.state.settings = settings;
      store.state.nextCheck = settings.enabled ? now() : null;
      await store.save();
      return view(store);
    });
  });
  app.get('/api/push/key', async (req, res) => update(res, async store => {
    store.state.vapid ||= webpush.generateVAPIDKeys();
    await store.save();
    return { publicKey: store.state.vapid.publicKey };
  }));
  app.post('/api/push/status', async (req, res) => {
    if (!durable) return res.json({ registered: false });
    const state = await repo().read();
    res.json({ registered: state.subscriptions.some(item => item.endpoint === req.body?.endpoint) });
  });
  app.post('/api/push/subscribe', async (req, res) => {
    if (!validSubscription(req.body)) throw fail(400, 'Assinatura de notificações inválida ou serviço não suportado.');
    return update(res, async store => {
      if (!store.state.vapid) throw fail(409, 'Carregue as chaves de notificações antes de cadastrar o aparelho.');
      const subscription = { endpoint: req.body.endpoint, keys: { auth: req.body.keys.auth, p256dh: req.body.keys.p256dh } };
      const previous = store.state.subscriptions.find(item => item.endpoint === subscription.endpoint);
      Object.assign(subscription, deviceMetadata(req.body, previous, now()));
      if (!previous && store.state.subscriptions.length >= 20) throw fail(400, 'Limite de 20 dispositivos atingido.');
      store.state.subscriptions = store.state.subscriptions.filter(item => item.endpoint !== subscription.endpoint);
      store.state.subscriptions.push(subscription); await store.save();
      return { ok: true };
    });
  });
  app.post('/api/push/unsubscribe', async (req, res) => update(res, async store => {
    store.state.subscriptions = store.state.subscriptions.filter(item => item.endpoint !== req.body?.endpoint);
    store.state.outbox = store.state.outbox.filter(item => item.endpoint !== req.body?.endpoint);
    await store.save(); return { ok: true };
  }));
  app.post('/api/push/test', async (req, res) => update(res, async store => {
    if (store.state.lastPushTest && now() - store.state.lastPushTest < 10_000) throw fail(429, 'Aguarde alguns segundos para testar novamente.');
    const subscription = store.state.subscriptions.find(item => item.endpoint === req.body?.endpoint);
    if (!subscription) throw fail(400, 'Ative os alertas neste dispositivo primeiro.');
    store.state.lastPushTest = now(); await store.save();
    try {
      await (push || pushSender(store.state.vapid, env.VAPID_SUBJECT))(subscription, { title: 'Seu RAS está no radar!', body: 'Este aparelho pode receber os avisos. Confira no painel se o agendamento automático também está ativo.', tag: 'ras-test' });
      return { ok: true };
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) {
        store.state.subscriptions = store.state.subscriptions.filter(item => item.endpoint !== subscription.endpoint);
        store.state.outbox = store.state.outbox.filter(item => item.endpoint !== subscription.endpoint);
        await store.save();
      }
      throw fail(502, 'O serviço de notificações não aceitou o teste. Reative os alertas e tente novamente.');
    }
  }));
  app.use((req, res) => res.status(404).json({ error: 'Rota da API não encontrada.' }));
  app.use((error, req, res, next) => {
    const status = error.status || 503;
    res.status(status).json({ error: status >= 500 ? 'Não foi possível concluir a operação no servidor. Confira a conexão e as variáveis da hospedagem.' : error.message });
  });
  return app;
}

import { Router } from 'express';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const COOKIE = 'ras_admin_session';
const SESSION_MS = 8 * 60 * 60 * 1000;
const COOLDOWN_MS = 30_000;
const error = (status, message) => Object.assign(new Error(message), { status });
const equals = (a, b) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
export const deviceId = subscription => createHash('sha256').update(subscription.endpoint).digest('hex').slice(0, 24);

export function deviceMetadata(body, previous, now = Date.now()) {
  return {
    deviceName: typeof body.deviceName === 'string' && body.deviceName.trim() ? body.deviceName.trim().slice(0, 60) : previous?.deviceName || 'Dispositivo cadastrado',
    deviceType: ['mobile', 'desktop'].includes(body.deviceType) ? body.deviceType : previous?.deviceType || 'unknown',
    registeredAt: previous?.registeredAt || new Date(now).toISOString(),
  };
}

export function adminAuth(env, { now = () => Date.now(), secure = false } = {}) {
  const username = (env.ADMIN_USERNAME || 'admin').trim();
  const password = env.ADMIN_PASSWORD || '';
  const configured = !!username && password.length >= 12;
  const key = createHash('sha256').update(`ras-admin-v1\0${username}\0${password}`).digest();
  const sign = value => createHmac('sha256', key).update(value).digest('hex');
  const options = { httpOnly: true, secure, sameSite: 'strict', path: '/' };
  return {
    configured, username,
    authenticated(req) {
      if (!configured) return false;
      const cookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
      const [expires, nonce, signature] = cookie.split('.');
      return !!nonce && !!signature && Number(expires) > now() && equals(signature, sign(`${expires}.${nonce}`));
    },
    validCredentials(body) {
      if (!configured || typeof body?.username !== 'string' || typeof body?.password !== 'string') return false;
      const userMatches = equals(body.username.trim(), username);
      const passwordMatches = equals(body.password, password);
      return userMatches && passwordMatches;
    },
    login(res) {
      const value = `${now() + SESSION_MS}.${randomUUID()}`;
      res.cookie(COOKIE, `${value}.${sign(value)}`, { ...options, maxAge: SESSION_MS });
    },
    logout(res) { res.clearCookie(COOKIE, options); },
  };
}

function devices(state) {
  return state.subscriptions.map((subscription, index) => ({
    id: deviceId(subscription), name: subscription.deviceName || `Dispositivo ${index + 1}`,
    type: subscription.deviceType || 'unknown', registeredAt: subscription.registeredAt || null,
  }));
}

export function validateTestMessage(body) {
  if (typeof body?.message !== 'string' || !body.message.trim() || body.message.trim().length > 500) throw error(400, 'Escreva uma mensagem de 1 a 500 caracteres.');
  if (body.title !== undefined && typeof body.title !== 'string') throw error(400, 'O título precisa ser um texto.');
  const title = body.title?.trim() || 'Teste RAS Radar';
  if (title.length > 80) throw error(400, 'Use até 80 caracteres no título.');
  const target = body.target || 'all';
  if (typeof target !== 'string' || !/^(all|mobile|[a-f0-9]{24})$/.test(target)) throw error(400, 'Selecione um destinatário válido.');
  const message = body.message.trim();
  if (Buffer.byteLength(JSON.stringify({ title, body: message }), 'utf8') > 3000) throw error(400, 'A mensagem é muito grande para uma notificação.');
  return { title, message, target };
}

export async function broadcastTest(store, input, send, now = () => Date.now()) {
  const { title, message, target } = validateTestMessage(input);
  const state = store.state;
  if (state.lastAdminTestAt && now() - state.lastAdminTestAt < COOLDOWN_MS) throw error(429, 'Aguarde 30 segundos entre os testes.');
  const recipients = state.subscriptions.filter(subscription => target === 'all' || (target === 'mobile' ? subscription.deviceType === 'mobile' : deviceId(subscription) === target));
  if (!recipients.length) throw error(400, 'Nenhum dispositivo nesta seleção. Ative os alertas no celular primeiro.');
  const report = {
    id: randomUUID(), at: new Date(now()).toISOString(), title, message, target,
    status: 'sending', total: recipients.length, sent: 0, failed: 0, expired: 0, results: [],
  };
  state.lastAdminTestAt = now();
  state.adminTests = [report, ...(state.adminTests || [])].slice(0, 20);
  await store.save();
  // At most four concurrent sends; 20 devices with a 4s push timeout fit within
  // a Vercel invocation. Nothing relies on work after the response is returned.
  let cursor = 0;
  const results = new Array(recipients.length);
  await Promise.all(Array.from({ length: Math.min(4, recipients.length) }, async () => {
    while (cursor < recipients.length) {
      const index = cursor++;
      const subscription = recipients[index];
      const result = { id: deviceId(subscription), name: subscription.deviceName || `Dispositivo ${index + 1}` };
      try {
        await send(subscription, { title, body: message, tag: `admin-test-${report.id}` });
        results[index] = { ...result, status: 'sent', detail: 'Aceita pelo serviço de push.' };
      } catch (failure) {
        const expired = [404, 410].includes(failure.statusCode);
        results[index] = { ...result, status: expired ? 'expired' : 'failed', detail: expired ? 'Inscrição expirada. Ative os avisos novamente neste aparelho.' : 'O serviço não aceitou o envio. Você pode tentar novamente.' };
        if (expired) {
          state.subscriptions = state.subscriptions.filter(item => item.endpoint !== subscription.endpoint);
          state.outbox = state.outbox.filter(item => item.endpoint !== subscription.endpoint);
        }
      }
    }
  }));
  Object.assign(report, {
    status: 'complete', results,
    sent: results.filter(item => item.status === 'sent').length,
    failed: results.filter(item => item.status === 'failed').length,
    expired: results.filter(item => item.status === 'expired').length,
  });
  await store.save();
  return report;
}

export function createAdminRouter({ auth, readStore, mutateStore, sendForStore, available = () => true, loginAllowed, resetAttempts, now = () => Date.now() }) {
  const router = Router();
  let attempts = 0; let until = 0; let sending = false;
  router.get('/session', (req, res) => res.json({ configured: auth.configured, authenticated: auth.authenticated(req), username: auth.authenticated(req) ? auth.username : null }));
  router.post('/login', async (req, res) => {
    if (!auth.configured) throw error(503, 'Configure ADMIN_USERNAME e ADMIN_PASSWORD no servidor. A senha deve ter pelo menos 12 caracteres.');
    let allowed;
    if (loginAllowed) allowed = await loginAllowed();
    else { if (until <= now()) { attempts = 0; until = now() + 900_000; } allowed = ++attempts <= 10; }
    if (!allowed) throw error(429, 'Muitas tentativas. Aguarde 15 minutos antes de entrar novamente.');
    if (!auth.validCredentials(req.body)) throw error(401, 'Login ou senha de administrador incorretos.');
    if (resetAttempts) await resetAttempts();
    attempts = 0;
    auth.login(res); res.json({ authenticated: true, username: auth.username });
  });
  router.post('/logout', (req, res) => { auth.logout(res); res.json({ ok: true }); });
  router.use((req, res, next) => auth.authenticated(req) ? next() : res.status(401).json({ error: 'Entre como administrador para acessar esta área.' }));
  router.get('/notifications', async (req, res) => {
    if (!available()) return res.json({ available: false, devices: [], history: [], nextAllowedAt: null });
    const store = await readStore();
    res.json({ available: true, devices: devices(store.state), history: store.state.adminTests || [], nextAllowedAt: store.state.lastAdminTestAt ? store.state.lastAdminTestAt + COOLDOWN_MS : null });
  });
  router.post('/notifications/test', async (req, res) => {
    if (!available()) throw error(503, 'Conclua a conexão do Redis e a proteção do painel na Vercel para cadastrar os celulares e enviar testes.');
    validateTestMessage(req.body);
    if (sending) throw error(409, 'Já existe um teste em andamento. Aguarde o resultado.');
    sending = true;
    try {
      const report = await mutateStore(store => broadcastTest(store, req.body, sendForStore(store), now));
      res.json({ report, nextAllowedAt: Date.parse(report.at) + COOLDOWN_MS });
    } finally { sending = false; }
  });
  router.use((req, res) => res.status(404).json({ error: 'Rota de administração não encontrada.' }));
  router.use((failure, req, res, next) => res.status(failure.status || 503).json({ error: failure.status ? failure.message : 'Não foi possível concluir a operação. Confira o armazenamento e tente novamente.' }));
  return router;
}

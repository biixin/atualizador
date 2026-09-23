import 'dotenv/config';
import express from 'express';
import webpush from 'web-push';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Store } from './store.js';
import { Monitor } from './monitor.js';
import { validateSettings } from './domain.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3001);
const token = process.env.MONITOR_TOKEN || '';
const origin = process.env.APP_ORIGIN || '';
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && (token.length < 24 || !origin.startsWith('https://'))) {
  throw new Error('Para acesso externo, configure MONITOR_TOKEN com pelo menos 24 caracteres e APP_ORIGIN com seu endereço HTTPS.');
}
const store = new Store(path.resolve(process.env.DATA_DIR || path.join(root, 'data')));
const keyFile = path.join(path.dirname(store.file), 'push-keys.json');
const keys = fs.existsSync(keyFile) ? JSON.parse(fs.readFileSync(keyFile, 'utf8')) : webpush.generateVAPIDKeys();
if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, JSON.stringify(keys), { mode: 0o600 });
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', keys.publicKey, keys.privateKey);
const sendPush = (subscription, payload) => webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 3600, urgency: 'high', timeout: 12_000 });
const monitor = new Monitor(store, { push: sendPush });
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '12kb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
  if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const allowed = origin ? [origin] : ['http://localhost:5173', 'http://127.0.0.1:5173', `http://localhost:${port}`, `http://127.0.0.1:${port}`];
    if ((req.headers.origin && !allowed.includes(req.headers.origin)) || req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Origem não permitida.' });
    if (!req.is('application/json')) return res.status(415).json({ error: 'Envie application/json.' });
  }
  next();
});
const equal = (a, b) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
function authenticated(req) {
  if (!token) return true;
  const cookie = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('ras_session='))?.slice(12) || '';
  const [expires, signature] = cookie.split('.');
  return Number(expires) > Date.now() && !!signature && equal(signature, createHmac('sha256', token).update(expires).digest('hex'));
}
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/auth', (req, res) => res.json({ authenticated: authenticated(req), required: !!token }));
const loginAttempts = new Map();
app.post('/api/login', (req, res) => {
  const ip = req.socket.remoteAddress;
  const attempt = loginAttempts.get(ip) || { count: 0, until: Date.now() + 900_000 };
  if (attempt.until <= Date.now()) { attempt.count = 0; attempt.until = Date.now() + 900_000; }
  if (attempt.count >= 10) return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em 15 minutos.' });
  if (typeof req.body?.password !== 'string' || !token || !equal(req.body.password, token)) {
    attempt.count += 1; loginAttempts.set(ip, attempt);
    return res.status(401).json({ error: 'Senha de acesso incorreta.' });
  }
  loginAttempts.delete(ip);
  const expires = String(Date.now() + 30 * 86400_000);
  const signature = createHmac('sha256', token).update(expires).digest('hex');
  res.cookie('ras_session', `${expires}.${signature}`, { httpOnly: true, secure: origin.startsWith('https://'), sameSite: 'strict', maxAge: 30 * 86400_000, path: '/' });
  res.json({ ok: true });
});
app.use('/api', (req, res, next) => authenticated(req) ? next() : res.status(401).json({ error: 'Entre com a senha do seu painel.' }));
app.get('/api/status', (req, res) => res.json(monitor.view()));
let lastManualCheck = 0;
app.post('/api/check', (req, res) => {
  if (Date.now() - lastManualCheck < 10_000) return res.status(429).json({ error: 'Aguarde 10 segundos entre verificações manuais.' });
  lastManualCheck = Date.now();
  void monitor.check();
  res.status(202).json(monitor.view());
});
app.put('/api/settings', (req, res) => {
  try { store.state.settings = validateSettings(req.body); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  store.save(); monitor.schedule();
  res.json(monitor.view());
});
app.get('/api/push/key', (req, res) => res.json({ publicKey: keys.publicKey }));
function validSubscription(subscription) {
  try {
    const url = new URL(subscription.endpoint);
    const allowedHost = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname);
    return allowedHost && url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && subscription.endpoint.length < 2048 && Buffer.from(subscription.keys.p256dh, 'base64url').length === 65 && Buffer.from(subscription.keys.auth, 'base64url').length === 16;
  } catch { return false; }
}
app.post('/api/push/subscribe', (req, res) => {
  if (!validSubscription(req.body)) return res.status(400).json({ error: 'Assinatura de notificações inválida ou serviço de push não suportado.' });
  const subscription = { endpoint: req.body.endpoint, keys: { auth: req.body.keys.auth, p256dh: req.body.keys.p256dh } };
  const previous = store.state.subscriptions.find(x => x.endpoint === subscription.endpoint);
  if (!previous && store.state.subscriptions.length >= 20) return res.status(400).json({ error: 'Limite de 20 dispositivos atingido.' });
  store.state.subscriptions = store.state.subscriptions.filter(x => x.endpoint !== subscription.endpoint);
  store.state.subscriptions.push(subscription); store.save(); res.json({ ok: true });
});
app.post('/api/push/status', (req, res) => res.json({ registered: store.state.subscriptions.some(x => x.endpoint === req.body?.endpoint) }));
app.post('/api/push/unsubscribe', (req, res) => {
  store.state.subscriptions = store.state.subscriptions.filter(x => x.endpoint !== req.body?.endpoint);
  store.state.outbox = store.state.outbox.filter(x => x.endpoint !== req.body?.endpoint);
  store.save(); res.json({ ok: true });
});
let lastPushTest = 0;
app.post('/api/push/test', async (req, res) => {
  if (Date.now() - lastPushTest < 10_000) return res.status(429).json({ error: 'Aguarde alguns segundos para testar novamente.' });
  const subscription = store.state.subscriptions.find(x => x.endpoint === req.body?.endpoint);
  if (!subscription) return res.status(400).json({ error: 'Ative os alertas neste dispositivo primeiro.' });
  lastPushTest = Date.now();
  try { await sendPush(subscription, { title: 'Seu RAS está no radar!', body: 'Os avisos de novas vagas chegarão por aqui, mesmo com o painel fechado.', tag: 'ras-test' }); res.json({ ok: true }); }
  catch (error) {
    if ([404, 410].includes(error.statusCode)) {
      store.state.subscriptions = store.state.subscriptions.filter(x => x.endpoint !== subscription.endpoint); store.save();
    }
    res.status(502).json({ error: 'O serviço de notificações não aceitou o teste. Reative os alertas e tente novamente.' });
  }
});
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.use(express.static(path.join(root, 'dist'), { setHeaders: (res, file) => { if (file.endsWith('sw.js') || file.endsWith('index.html')) res.set('Cache-Control', 'no-cache'); } }));
app.get('/{*path}', (req, res) => {
  if (fs.existsSync(path.join(root, 'dist/index.html'))) res.sendFile(path.join(root, 'dist/index.html'));
  else res.status(200).send('RAS Radar: execute npm run dev e acesse http://localhost:5173, ou npm run build para servir o painel nesta porta.');
});
app.use((error, req, res, next) => { console.error(error.message); res.status(error.status || 500).json({ error: 'Não foi possível concluir a operação.' }); });
const server = app.listen(port, host, () => {
  console.log(`RAS Radar disponível em http://${host}:${server.address().port}`);
  if (store.state.settings.enabled) void monitor.check();
});
const retryTimer = setInterval(() => { monitor.deliver().catch(console.error); }, 30_000);
retryTimer.unref();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { monitor.stop(); clearInterval(retryTimer); server.close(() => process.exit(0)); });

import { chromium } from 'playwright';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { adminAuth, createAdminRouter } from '../server/admin.js';
import { initialState } from '../server/store.js';
import { Monitor } from '../server/monitor.js';

// Use the real admin router with isolated data and a fake push provider.
// This test never reads .env, contacts SCORA, or notifies real devices.
const password = 'browser-test-password-only';
const auth = adminAuth({ ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password });
const store = { state: initialState(), save: async () => {} };
store.state.snapshot = [];
store.state.lastCheck = new Date().toISOString();
store.state.subscriptions = [
  { endpoint: 'https://example.invalid/iphone', deviceName: 'iPhone de teste', deviceType: 'mobile' },
  { endpoint: 'https://example.invalid/android', deviceName: 'Android de teste', deviceType: 'mobile' },
  { endpoint: 'https://example.invalid/desktop', deviceName: 'Computador de teste', deviceType: 'desktop' },
];
const calls = [];
const monitor = new Monitor(store, { continuous: false });
const app = express();
app.use(express.json());
app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.get('/api/auth', (req, res) => res.json({ required: true, authenticated: auth.authenticated(req), adminConfigured: true }));
app.use('/api/admin', createAdminRouter({
  auth, readStore: async () => store, mutateStore: work => work(store),
  sendForStore: () => async (subscription, payload) => {
    calls.push({ endpoint: subscription.endpoint, payload });
    if (subscription.endpoint.endsWith('/android')) throw Object.assign(new Error('Expired test device'), { statusCode: 410 });
  },
}));
app.get('/api/status', (req, res) => auth.authenticated(req) ? res.json(monitor.view()) : res.status(401).json({ error: 'Entre no painel.' }));
app.use(express.static(path.resolve('dist')));
const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
const base = `http://127.0.0.1:${server.address().port}`;
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.setDefaultTimeout(15_000);
  await page.route('https://**', route => route.abort());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  fs.mkdirSync('.artifacts', { recursive: true });
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.getByRole('button', { name: 'Entrar como administrador', exact: true }).click();
  await page.getByRole('heading', { name: 'Entre como administrador' }).waitFor();
  await page.getByLabel('Senha de administrador').fill('incorrect');
  await page.getByRole('button', { name: 'Entrar como administrador', exact: true }).click();
  await page.getByRole('alert').getByText('Login ou senha de administrador incorretos.').waitFor();
  assert.equal((await page.request.get(`${base}/api/admin/notifications`)).status(), 401);
  await page.getByLabel('Senha de administrador').fill(password);
  await page.getByRole('button', { name: 'Entrar como administrador', exact: true }).click();
  await page.getByText('Administrador conectado', { exact: true }).waitFor();
  await page.getByRole('option', { name: 'Todos os dispositivos (3)', exact: true }).waitFor({ state: 'attached' });
  assert.equal((await page.request.get(`${base}/api/status`)).status(), 200);
  const sendButton = page.getByRole('button', { name: 'Enviar notificação de teste', exact: true });
  assert.equal(await sendButton.isDisabled(), true);
  await page.getByRole('combobox', { name: /^Enviar para/ }).selectOption('mobile');
  await page.getByLabel(/^Título/).fill('Seu radar está conectado');
  const message = 'Olá! Este é um teste enviado pelo computador para os celulares.';
  await page.getByLabel(/^Mensagem/).fill(message);
  assert.equal(await page.locator('.phone-notification p').innerText(), message);
  await page.screenshot({ path: '.artifacts/admin-desktop.png', fullPage: true });
  await sendButton.click();
  await page.getByRole('heading', { name: 'Resultado do teste', exact: true }).waitFor();
  assert.equal(calls.length, 2, 'Only selected mobile subscriptions should receive the test');
  assert.ok(calls.every(call => call.payload.body === message && call.payload.title === 'Seu radar está conectado'));
  await page.locator('.admin-result-counts').getByText('1 aceito(s)', { exact: true }).waitFor();
  await page.locator('.admin-result-counts').getByText('1 inscrição(ões) expirada(s)', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^Novo teste em/ }).isDisabled(), true);
  await page.getByRole('button', { name: 'Atualizar dispositivos', exact: true }).click();
  await page.getByRole('option', { name: 'Todos os dispositivos (2)', exact: true }).waitFor({ state: 'attached' });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Admin overflow at ${width}px`);
    if (width === 390) await page.screenshot({ path: '.artifacts/admin-mobile.png', fullPage: true });
  }
  await page.getByRole('button', { name: 'Sair do admin', exact: true }).click();
  await page.getByRole('heading', { name: 'Entre como administrador' }).waitFor();
  assert.equal((await page.request.get(`${base}/api/admin/notifications`)).status(), 401);
  assert.equal((await page.request.get(`${base}/api/status`)).status(), 401);
  await page.goto(`${base}/#admin`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.getByRole('heading', { name: 'Entre como administrador' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Admin login overflow');
  assert.deepEqual(errors, []);
  console.log('Admin browser checks passed: login, denied access, custom mobile broadcast, partial results, cooldown, logout and responsive layout. No real push sent.');
} catch (error) {
  console.error(error.message);
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

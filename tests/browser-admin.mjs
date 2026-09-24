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
const auth = adminAuth({ ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: '1234' });
let available = true;
let capabilities;
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
app.get('/api/auth', (req, res) => res.json({ required: true, authenticated: auth.authenticated(req), adminConfigured: auth.configured }));
app.use('/api/admin', createAdminRouter({
  auth, available: () => available, readStore: async () => store, mutateStore: work => work(store),
  sendForStore: () => async (subscription, payload) => {
    calls.push({ endpoint: subscription.endpoint, payload });
    if (subscription.endpoint.endsWith('/android')) throw Object.assign(new Error('Expired test device'), { statusCode: 410 });
  },
}));
app.get('/api/status', (req, res) => auth.authenticated(req) ? res.json({ ...monitor.view(), capabilities }) : res.status(401).json({ error: 'Entre no painel.' }));
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
  // Missing server configuration must still accept clicks and Enter and explain the failure.
  const loginButton = page.locator('.admin-login button[type="submit"]');
  assert.equal(await loginButton.isEnabled(), true);
  assert.equal(await loginButton.evaluate(button => getComputedStyle(button).cursor), 'pointer');
  await page.getByLabel('Senha de administrador').fill('1234');
  const clickFailure = page.waitForResponse(response => response.url().endsWith('/api/admin/login'));
  await loginButton.click();
  assert.equal((await clickFailure).status(), 503);
  await page.getByRole('alert').getByText(/Configure ADMIN_USERNAME/).waitFor();
  const enterFailure = page.waitForResponse(response => response.url().endsWith('/api/admin/login'));
  await page.getByLabel('Senha de administrador').press('Enter');
  assert.equal((await enterFailure).status(), 503);
  await page.getByRole('button', { name: 'Entrar como administrador', exact: true }).waitFor();
  assert.equal(await loginButton.isEnabled(), true);
  assert.equal(await loginButton.evaluate(button => getComputedStyle(button).cursor), 'pointer');
  // Fixing the server credentials works even when the open form has an older session response.
  Object.assign(auth, adminAuth({ ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password }));
  await page.getByLabel('Senha de administrador').fill('incorrect');
  await page.getByRole('button', { name: 'Entrar como administrador', exact: true }).click();
  await page.getByRole('alert').getByText('Login ou senha de administrador incorretos.').waitFor();
  assert.equal((await page.request.get(`${base}/api/admin/notifications`)).status(), 401);
  let releaseLogin;
  const loginGate = new Promise(resolve => { releaseLogin = resolve; });
  await page.route('**/api/admin/login', async route => { await loginGate; await route.continue(); });
  await page.getByLabel('Senha de administrador').fill(password);
  await page.getByLabel('Senha de administrador').press('Enter');
  await page.getByRole('button', { name: 'Entrando…', exact: true }).waitFor();
  assert.equal(await loginButton.isDisabled(), true);
  assert.equal(await loginButton.evaluate(button => getComputedStyle(button).cursor), 'wait');
  releaseLogin();
  await page.getByText('Administrador conectado', { exact: true }).waitFor();
  await page.unroute('**/api/admin/login');
  await page.getByRole('option', { name: 'Todos os dispositivos (3)', exact: true }).waitFor({ state: 'attached' });
  assert.equal((await page.request.get(`${base}/api/status`)).status(), 200);
  const sendButton = page.getByRole('button', { name: 'Enviar notificação de teste', exact: true });
  assert.equal(await sendButton.isEnabled(), true);
  await sendButton.click();
  assert.equal(await page.getByLabel(/^Mensagem/).evaluate(input => input.validity.valueMissing), true);
  assert.equal(calls.length, 0, 'Empty messages must not be sent');
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
  assert.equal(await page.getByRole('button', { name: /^Novo teste em/ }).evaluate(button => getComputedStyle(button).cursor), 'not-allowed');
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

  // In read-only hosting, actions open setup instead of silently disabling buttons.
  available = false;
  capabilities = { runtime: 'vercel', preferences: false, persistent: false, push: false, background: false };
  await page.getByLabel('Senha de administrador').fill(password);
  await page.getByRole('button', { name: 'Entrar como administrador', exact: true }).click();
  await page.getByText('Os dispositivos ainda precisam de armazenamento', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Enviar notificação de teste', exact: true }).click();
  await page.getByRole('heading', { name: 'Configurar a Vercel' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  await page.locator('#interval').selectOption('120');
  await page.getByRole('heading', { name: 'Configurar a Vercel' }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(store.state.settings.interval, 60, 'Unavailable settings must not be saved');
  await page.getByRole('button', { name: 'Pausar monitoramento', exact: true }).click();
  await page.getByRole('heading', { name: 'Configurar a Vercel' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('switch', { name: 'Monitoramento automático', exact: true }).click();
  await page.getByRole('heading', { name: 'Configurar a Vercel' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Configurar notificações', exact: true }).first().click();
  await page.getByRole('button', { name: 'Ativar notificações neste aparelho', exact: true }).click();
  await page.getByRole('heading', { name: 'Configurar a Vercel' }).waitFor();
  await page.keyboard.press('Escape');
  available = true;
  store.state.subscriptions = [];
  delete store.state.lastAdminTestAt;
  await page.getByRole('button', { name: 'Admin', exact: true }).click();
  await page.getByRole('heading', { name: 'Enviar notificação de teste', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Atualizar dispositivos', exact: true }).click();
  await page.getByRole('button', { name: 'Enviar notificação de teste', exact: true }).click();
  await page.getByRole('alert').getByText(/Nenhum aparelho nesta seleção/).waitFor();
  assert.equal(calls.length, 2, 'Unavailable actions must not send additional pushes');
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: click/Enter with invalid configuration, loading and recovery, admin login, mobile broadcast, cooldown cursor, missing devices, read-only settings/push guidance, logout and responsive layout. No real push sent.');
} catch (error) {
  console.error(error.message);
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

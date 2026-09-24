import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}) });
fs.mkdirSync('.artifacts', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:3002', { waitUntil: 'networkidle', timeout: 60_000 });
  const response = await page.request.get('http://127.0.0.1:3002/api/status');
  assert.equal(response.status(), 200);
  const status = await response.json();
  assert.equal(status.initialized, true, status.error || 'A API real não respondeu.');
  assert.equal(status.capabilities.runtime, 'vercel');
  assert.equal(status.capabilities.push, false);
  await page.getByText('Complete os avisos no celular', { exact: true }).waitFor();
  assert.equal(await page.locator('#interval').isDisabled(), true);
  await page.screenshot({ path: '.artifacts/vercel-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Ver configuração' }).click();
  await page.getByRole('heading', { name: 'Configurar a Vercel' }).waitFor();
  await page.getByText('Agendamento automático confirmado', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Configurar notificações', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Ativar notificações neste aparelho' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Configurar', exact: true }).click();
  await page.getByRole('heading', { name: 'Configurar a Vercel' }).waitFor();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.artifacts/vercel-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Vercel adapter connected to real SCORA:', { rows: status.rows.length, lastCheck: status.lastCheck });
  console.log('Hosted UI passed: clear setup status, no false push activation, working configuration guide, responsive layout.');
} finally { await browser.close(); }

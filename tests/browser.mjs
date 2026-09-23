import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}) });
fs.mkdirSync('.artifacts', { recursive: true });
try {
  // Rasterize the project's own vector icon for installable-app icons.
  const icon = await browser.newPage();
  const svg = fs.readFileSync('public/icon.svg', 'utf8');
  for (const size of [192, 512]) {
    await icon.setViewportSize({ width: size, height: size });
    await icon.setContent(`<style>body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    await icon.screenshot({ path: `public/icon-${size}.png`, omitBackground: true });
  }
  await icon.close();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Suas oportunidades, no radar.' }).waitFor();
  await page.screenshot({ path: '.artifacts/desktop.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'desktop overflow');
  const status = await (await page.request.get('http://127.0.0.1:5173/api/status')).json();
  console.log('Live connection:', { initialized: status.initialized, rows: status.rows?.length, error: status.error });
  await page.getByRole('tab', { name: /^Abertos/ }).click();
  if (!status.rows?.some(row => row.status === 'open')) await page.getByRole('heading', { name: 'Nenhuma vaga aberta por enquanto' }).waitFor({ timeout: 5000 }).catch(() => {});
  await page.getByRole('tab', { name: 'Todos os RAS' }).click();
  if (status.initialized) {
    assert.equal(await page.locator('tbody tr').count(), Math.min(6, status.rows.length));
    if (status.rows.length > 6) {
      await page.getByRole('button', { name: 'Próxima página', exact: true }).click();
      assert.ok((await page.locator('.table-footer').innerText()).includes('7–'));
      await page.getByRole('button', { name: 'Página anterior', exact: true }).click();
    }
    await page.getByRole('textbox', { name: 'Buscar por local' }).fill('nenhum-local-xyz');
    await page.getByRole('heading', { name: 'Nenhum RAS nesta seleção' }).waitFor();
    await page.getByRole('textbox', { name: 'Buscar por local' }).fill('');
  }
  await page.getByRole('button', { name: 'Histórico', exact: true }).click();
  await page.getByRole('heading', { name: 'Histórico de atualizações' }).waitFor();
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('heading', { name: 'Configurações', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Configurar notificações', exact: true }).last().click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('heading', { name: 'Leve seu radar no bolso' }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.artifacts/mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile overflow');
  assert.equal((await page.request.get('http://127.0.0.1:5173/icon-192.png')).status(), 200);
  const manifest = await (await page.request.get('http://127.0.0.1:5173/manifest.webmanifest')).json();
  assert.equal(manifest.display, 'standalone');
  await page.getByRole('button', { name: 'Configurar notificações', exact: true }).click();
  await page.screenshot({ path: '.artifacts/mobile-notifications.png', fullPage: false });
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${width}px`);
  }
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: desktop, mobile, search, navigation, tabs, notification dialog; no page errors.');
} finally { await browser.close(); }

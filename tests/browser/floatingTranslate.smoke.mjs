import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';

const server = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<title>Floating translation fixture</title><style>body{margin:0;background:#1d1b27;color:white;font:22px system-ui;height:2200px}button{background:transparent!important;color:transparent!important;opacity:0!important}</style><h1>一般網頁</h1><p>右側圓形按鈕可選取範圍翻譯。</p>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
mkdirSync('.tmp', { recursive: true });
const extension = resolve('apps/extension/dist-chromium');
const context = await chromium.launchPersistentContext(mkdtempSync(resolve('.tmp/floating-smoke-')), {
  headless: true, channel: 'chromium', viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const service = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const button = page.getByRole('button', { name: '選取範圍翻譯', exact: true });
  await expect(button).toBeVisible({ timeout: 15000 });
  const before = await button.boundingBox();
  expect(before.width).toBe(48);
  expect(before.x + before.width).toBeGreaterThan(1240);
  expect(await button.evaluate(node => getComputedStyle(node).opacity)).toBe('1');
  expect(await button.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(121, 84, 206)');
  await page.evaluate(() => scrollTo(0, 700));
  expect((await button.boundingBox()).y).toBe(before.y);
  await page.screenshot({ path: 'artifacts/floating-translate-button.png' });
  await button.click();
  await expect(page.locator('#anderson-translator-launcher')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator('#anderson-translator-launcher')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(button).toBeVisible();
  console.log('PASS opaque fixed launcher opens screenshot selection, hides during capture and restores after cancel');
  await page.goto(`chrome-extension://${new URL(service.url()).host}/pdf.html`);
  await expect(page.locator('#anderson-translator-launcher')).toHaveCount(0);
  console.log('PASS PDF reader keeps its toolbar without a floating launcher');
} finally { await context.close(); await new Promise(resolve => server.close(resolve)); }

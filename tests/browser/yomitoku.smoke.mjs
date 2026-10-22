import { chromium, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const image = 'data:image/png;base64,' + readFileSync('artifacts/yomitoku-generated-test.png').toString('base64');
mkdirSync('.tmp', { recursive: true });
const extension = resolve('apps/extension/dist-chromium');
const context = await chromium.launchPersistentContext(mkdtempSync(resolve('.tmp/yomitoku-smoke-')), { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const page = await context.newPage(); await page.goto(`chrome-extension://${new URL(worker.url()).host}/pdf.html`);
  const result = await page.evaluate(async image => {
    const response = await fetch('http://127.0.0.1:8766/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ regions: [{ id: 'browser-test', imageDataUrl: image }] }) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }, image);
  expect(result.regions[0].text).toContain('こんにちは');
  console.log('PASS Chrome extension can call real local CPU YomiToku with extension-origin CORS');
} finally { await context.close(); }

import { chromium, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPdfFixture } from './pdfFixture.mjs';
mkdirSync('.tmp', { recursive: true });
const extension = resolve('apps/extension/dist-chromium');
const context = await chromium.launchPersistentContext(mkdtempSync(resolve('.tmp/pdf-fit-')), {
  headless: true, channel: 'chromium',
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/pdf.html`);
  await page.locator('#file').setInputFiles({ name: 'fit.pdf', mimeType: 'application/pdf', buffer: createPdfFixture() });
  await expect(page.locator('#pdf-page')).toBeVisible();
  await expect(page.locator('#fit-mode')).toHaveValue('height');
  await expect(page.locator('#parallel-pages')).toHaveValue('2');
  await page.locator('#parallel-pages').selectOption('1');
  await expect(page.locator('#parallel-pages')).toHaveValue('1');
  await page.locator('#parallel-pages').selectOption('2');
  const asset = readdirSync(resolve(extension, 'assets')).find(name => /^pipeline\.worker-.*\.js$/.test(name));
  for (const enabled of [true, false]) {
    const negotiated = await page.evaluate(({ asset, enabled }) => new Promise((resolve, reject) => {
      const worker = new Worker(new URL(`assets/${asset}`, location.href), { type: 'module' });
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Worker negotiation timed out')); }, 15000);
      worker.onmessage = ({ data }) => {
        if (data.kind !== 'port') return;
        if (data.payload.type === 'host-ready') worker.postMessage({ kind: 'port', payload: {
          type: 'prepare', jobId: 'regression',
          structuredCloneProbe: new Blob([new Uint8Array([83])], { type: 'application/x-shinobu-structured-clone' }),
        } });
        if (data.payload.type === 'ready') { clearTimeout(timer); worker.terminate(); resolve(data.payload.structuredClone); }
      };
      worker.postMessage({ kind: 'init', baseUrl: new URL('.', location.href).href, version: 'test', structuredClone: enabled });
    }), { asset, enabled });
    expect(negotiated).toBe(enabled);
  }
  console.log('PASS built pipeline Worker binary transport negotiation and legacy fallback');
  for (const size of [{ width: 1920, height: 920 }, { width: 1280, height: 720 }, { width: 800, height: 900 }]) {
    await page.setViewportSize(size);
    await expect.poll(async () => page.evaluate(() => {
      const rect = document.querySelector('#pdf-page').getBoundingClientRect();
      return document.body.scrollWidth <= innerWidth && document.body.scrollHeight <= innerHeight
        && Math.abs(rect.bottom - innerHeight) < 2 && rect.right <= innerWidth;
    })).toBe(true);
    console.log('PASS whole PDF fits without scrollbars', size);
  }
  await page.screenshot({ path: 'artifacts/pdf-fit.png' });
  await page.locator('#fit-mode').selectOption('height');
  await expect.poll(async () => page.locator('#pdf-page').evaluate(image => {
    const rect = image.getBoundingClientRect();
    return Math.abs(rect.bottom - innerHeight) < 2;
  })).toBe(true);
  console.log('PASS fit height uses the available vertical space');
  const button = page.getByRole('button', { name: '翻译当前页', exact: true });
  await expect(button).toBeVisible();
  expect(await button.evaluate(element => !!element.closest('#toolbar'))).toBe(true);
  expect(await page.locator('#translation-mode').evaluate(element => !!element.closest('#toolbar'))).toBe(true);
  await expect(page.locator('#batch-panel')).toBeHidden();
  const toolbar = await page.locator('#toolbar').boundingBox();
  const controls = await button.boundingBox();
  const pdf = await page.locator('#pdf-page').boundingBox();
  expect(controls.y + controls.height).toBeLessThanOrEqual(toolbar.y + toolbar.height);
  expect(pdf.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
  await page.locator('#translation-mode').selectOption('batch');
  await expect(page.locator('#batch-panel')).toBeVisible();
  await page.locator('#translation-mode').selectOption('instant');
  await expect(page.locator('#batch-panel')).toBeHidden();
  console.log('PASS PDF translation actions and mode selector live in toolbar without covering PDF');
  const surface = await button.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, opacity: style.opacity, color: style.color };
  });
  expect(surface).toEqual({ background: 'rgb(249, 247, 255)', opacity: '1', color: 'rgb(48, 40, 63)' });
  await button.hover();
  expect(await button.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(249, 247, 255)');
  await page.screenshot({ path: 'artifacts/pdf-fit-height-solid-buttons.png' });
  console.log('PASS translation buttons remain opaque with readable text and on hover');
  await button.click();
  await expect(page.locator('#reading-anchor [role="status"]')).toContainText('PaddleOCR 本機 OCR', { timeout: 20000 });
  await expect(page.locator('#reading-anchor [role="status"]')).toContainText('Google 文字翻譯');
  await expect(page.locator('#reading-anchor [role="status"]')).toContainText('最多 2 頁並行');
  await page.locator('#stop').click();
  await expect.poll(async () => page.locator('#pdf-page').evaluate(image => Math.abs(image.getBoundingClientRect().bottom - innerHeight) < 2)).toBe(true);
  await page.screenshot({ path: 'artifacts/pdf-translation-method.png' });
  console.log('PASS clicking translation discloses actual OCR, translator and page concurrency in toolbar');
} finally { await context.close(); }

import { chromium, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPdfFixture } from './pdfFixture.mjs';
const extension = resolve('apps/extension/dist-chromium'); mkdirSync('.tmp', { recursive: true });
const context = await chromium.launchPersistentContext(mkdtempSync(resolve('.tmp/batch-jobs-smoke-')), { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], viewport: { width: 1280, height: 1000 } });
try {
 const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
 const root = `chrome-extension://${new URL(worker.url()).host}`;
 await worker.evaluate(() => {
   const original = globalThis.fetch;
   globalThis.__jobInputs = {}; globalThis.__remoteJobs = []; globalThis.__firstReady = false;
   globalThis.fetch = async (input, init) => {
     const url = String(input);
     if (!url.startsWith('https://api.openai.com/v1')) return original(input, init);
     if (url.endsWith('/files')) {
       const id = `file-${Object.keys(globalThis.__jobInputs).length + 1}`;
       globalThis.__jobInputs[id] = (await init.body.get('file').text()).trim().split('\n').map(JSON.parse);
       return Response.json({ id });
     }
     if (url.endsWith('/batches')) {
       const body = JSON.parse(init.body), number = globalThis.__remoteJobs.length + 1;
       const job = { id: `batch-${number}`, number, input: body.input_file_id, metadata: body.metadata, status: 'in_progress' };
       globalThis.__remoteJobs.push(job); return Response.json(job);
     }
     const match = /\/batches\/(batch-\d+)(\/cancel)?$/.exec(url);
     if (match) {
       const job = globalThis.__remoteJobs.find(j => j.id === match[1]);
       if (match[2]) job.status = 'cancelled';
       if (job.number === 1 && globalThis.__firstReady || job.number >= 3) job.status = 'completed';
       return Response.json({ ...job, output_file_id: job.status === 'completed' ? `output-${job.number}` : null, request_counts: { total: globalThis.__jobInputs[job.input].length, completed: job.status === 'completed' ? globalThis.__jobInputs[job.input].length : 1, failed: 0 } });
     }
     const output = /\/files\/output-(\d+)\/content$/.exec(url);
     if (output) {
       const job = globalThis.__remoteJobs[Number(output[1]) - 1];
       return new Response(globalThis.__jobInputs[job.input].map(line => {
         if (job.number === 1 && line.custom_id === 'page-2') return JSON.stringify({ custom_id: line.custom_id, response: { status_code: 400 }, error: { code: 'test_page_failed' } });
         return JSON.stringify({ custom_id: line.custom_id, response: { status_code: 200, body: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ regions: [{ x: .08, y: .1, width: .8, height: .2, source: 'TEST', translation: '測試翻譯完成' }] }) } }] } } });
       }).reverse().join('\n'));
     }
     throw new Error(`Unexpected API ${url}`);
   };
 });
 let page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
 const popup = await context.newPage(); await popup.goto(`${root}/popup.html`);
 await expect(popup.getByRole('link', { name: 'Batch 工作清單', exact: true })).toHaveAttribute('href', `${root}/pdf.html#jobs=1`);
 await popup.evaluate(async () => {
   const response = await globalThis.chrome.runtime.sendMessage({ type: 'mt:extension-control', command: { kind: 'replace-api-key', provider: 'openai', apiKey: 'synthetic-only' } });
   if (!response.ok) throw new Error(JSON.stringify(response));
 }); await popup.close();
 const firstPdf = createPdfFixture(['FIRST PDF PAGE ONE', 'FIRST PDF PAGE TWO']);
 const secondPdf = createPdfFixture(['SECOND PDF PAGE ONE', 'SECOND PDF PAGE TWO']);
 await page.goto(`${root}/pdf.html`);
 const start = async (name, buffer) => {
   await page.locator('#file').setInputFiles({ name, mimeType: 'application/pdf', buffer });
   await expect(page.locator('#pdf-page')).toBeVisible({ timeout: 30000 });
   await page.locator('#translation-mode').selectOption('batch'); await page.locator('#batch-start').click();
   await expect(page.locator('#batch-status')).toContainText('背景處理中', { timeout: 30000 });
 };
 await start('Report <unsafe>.pdf', firstPdf);
 await start('Second.pdf', secondPdf);
 await page.locator('#batch-jobs-open').click(); await expect(page.locator('.batch-job')).toHaveCount(2);
 const firstCard = page.locator('.batch-job').filter({ has: page.getByRole('heading', { name: 'Report <unsafe>.pdf', exact: true }) });
 const firstId = await firstCard.getAttribute('data-job-id');
 await expect(firstCard).toContainText('OpenAI 已處理 1/2 頁');
 expect(await firstCard.locator('img').count()).toBe(0);
 const secondCard = page.locator('.batch-job').filter({ has: page.getByRole('heading', { name: 'Second.pdf', exact: true }) });
 await secondCard.getByRole('button', { name: '取消工作', exact: true }).click();
 await expect(secondCard.locator('.batch-job-badge')).toHaveText('已取消', { timeout: 30000 });
 console.log('PASS list multiple named PDFs, server progress and cross-document cancellation');
 await page.close();
 await worker.evaluate(() => { globalThis.__firstReady = true; globalThis.chrome.alarms.create('anderson-pdf-batch-poll', { when: Date.now() + 100 }); });
 page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); await page.goto(`${root}/pdf.html#jobs=1`);
 await expect(page.locator('#batch-jobs')).toBeVisible();
 const parent = page.locator(`[data-job-id="${firstId}"]`);
 await expect(parent.locator('.batch-job-badge')).toHaveText('部分完成', { timeout: 30000 });
 await parent.locator('summary').click(); await expect(parent).toContainText('第 2 頁：');
 await expect(parent).toContainText('完成 ');
 await page.locator('#batch-jobs-search').fill('Second.pdf'); await expect(page.locator('.batch-job')).toHaveCount(1);
 await page.locator('#batch-jobs-search').fill('');
 await parent.getByRole('button', { name: '重試失敗頁面', exact: true }).click();
 await expect(page.locator('.batch-job')).toHaveCount(3, { timeout: 30000 });
 const retry = page.locator('.batch-job').filter({ hasText: '重試 1 頁（原 PDF 2 頁）' });
 await expect(retry.locator('.batch-job-badge')).toHaveText('已完成', { timeout: 30000 });
 await expect(retry).toContainText('已快取 1 頁');
 const remote = await worker.evaluate(() => ({ jobs: globalThis.__remoteJobs, inputs: globalThis.__jobInputs }));
 expect(remote.jobs).toHaveLength(3); expect(remote.inputs[remote.jobs[2].input].map(line => line.custom_id)).toEqual(['page-2']);
 await expect(parent.locator('.batch-job-badge')).toHaveText('部分完成');
 console.log('PASS persisted completion and failed-page details; retry without an open PDF submits only page 2 and preserves history');
 await page.locator('#batch-jobs-filter').selectOption('completed'); await expect(page.locator('.batch-job')).toHaveCount(1);
 await page.locator('#batch-jobs-filter').selectOption('attention'); await expect(page.locator('.batch-job')).toHaveCount(2);
 await page.locator('#batch-jobs-filter').selectOption('all');
 await parent.getByRole('button', { name: '查看重試工作', exact: true }).click(); await expect(page.locator('.batch-job')).toHaveCount(1);
 await page.locator('#batch-jobs-search').fill(''); await expect(page.locator('.batch-job')).toHaveCount(3);
 await page.screenshot({ path: 'artifacts/pdf-batch-job-list.png' });
 console.log('PASS search, state filters and retry navigation without duplicate paid submissions');
 await page.locator('#batch-jobs-close').click();
 await page.locator('#file').setInputFiles({ name: 'Report <unsafe>.pdf', mimeType: 'application/pdf', buffer: firstPdf });
 await expect(page.locator('#cache-state')).toContainText('第 1 頁已載入快取譯文');
 await page.locator('#next').click(); await expect(page.locator('#cache-state')).toContainText('第 2 頁已載入快取譯文');
 expect(errors).toEqual([]); console.log('PASS original and retried translated pages load from persistent cache');
} catch (error) { for (const page of context.pages()) console.log(await page.locator('body').innerText({ timeout: 1000 }).catch(() => '')); throw error; }
finally { await context.close(); }

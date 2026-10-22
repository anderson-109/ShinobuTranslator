import { chromium, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
mkdirSync('.tmp', { recursive: true });
const extension = resolve('apps/extension/dist-chromium');
const context = await chromium.launchPersistentContext(mkdtempSync(resolve('.tmp/pool-smoke-')), {
  headless: true, channel: 'chromium',
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const service = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(service.url()).host}/pdf.html`);
  const results = await page.evaluate(async () => {
    const prepared = await chrome.runtime.sendMessage({ type: 'mt:extension-control', command: { kind: 'prepare-execution' } });
    if (!prepared.ok || !prepared.result?.snapshot?.pipelineConfig) throw new Error('Execution settings unavailable');
    const actualConfig = prepared.result.snapshot.pipelineConfig;
    const port = chrome.runtime.connect({ name: 'mt:local-pipeline-client' });
    const ready = new Map(), finished = new Map(), outputs = new Map();
    port.onMessage.addListener(message => {
      if (message.type === 'ready') ready.get(message.jobId)?.(message);
      if (message.type === 'result-meta') outputs.set(message.jobId, message.resultBlob instanceof Blob && message.resultBlob.size > 0 || message.result.totalChars > 0);
      if (message.type === 'complete') finished.get(message.jobId)?.resolve(outputs.get(message.jobId));
      if (message.type === 'error') finished.get(message.jobId)?.reject(new Error(JSON.stringify(message.error)));
    });
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
    canvas.getContext('2d').fillRect(0, 0, 2, 2);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const ids = ['pool-one', 'pool-two', 'pool-three'];
    const completions = ids.map(id => new Promise((resolve, reject) => finished.set(id, { resolve, reject })));
    const capabilities = await Promise.all(ids.map(id => new Promise(resolve => {
      ready.set(id, resolve);
      port.postMessage({ type: 'prepare', jobId: id, structuredCloneProbe: new Blob([new Uint8Array([83])], { type: 'application/x-shinobu-structured-clone' }) });
    })));
    const base64 = canvas.toDataURL('image/png').split(',')[1];
    for (const [index, id] of ids.entries()) {
      const binary = capabilities[index].structuredClone === true;
      port.postMessage({ type: 'start', jobId: id,
        file: { name: `${id}.png`, size: blob.size, type: blob.type, lastModified: 0 }, ...(binary ? { binaryFile: blob } : {}),
        config: { ...actualConfig, localTextOnly: index === 1 },
        detection: { width: 2, height: 2, packedMaskBase64: 'AA==', regions: [] }, input: { chunkCount: binary ? 0 : 1, totalChars: binary ? 0 : base64.length },
      });
      if (!binary) port.postMessage({ type: 'input-chunk', jobId: id, index: 0, data: base64 });
      port.postMessage({ type: 'input-complete', jobId: id });
    }
    try { return await Promise.race([Promise.all(completions), new Promise((_, reject) => setTimeout(() => reject(new Error('Pool timed out')), 30000))]); }
    finally { port.disconnect(); }
  });
  expect(results).toEqual([true, true, true]);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Target.setDiscoverTargets', { discover: true });
  const { targetInfos } = await cdp.send('Target.getTargets');
  // No PDF was loaded in this isolated profile, so only the two pipeline Workers exist.
  expect(targetInfos.filter(target => target.type === 'worker')).toHaveLength(2);
  console.log('PASS actual settings with economy on/off complete through two real pipeline Workers with bounded reuse');
} finally { await context.close(); }

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BatchPage, PdfBatchJob, PdfBatchSummary } from '../../apps/extension/src/shared/pdfBatchStore';
import { defaultExtensionSettings } from '../../apps/extension/src/shared/config';
import { batchPageRequest, parseBatchRegions, renderBatchPage } from '../../apps/extension/src/shared/pdfBatchFormat';
const db = vi.hoisted(() => ({ jobs: new Map<string, PdfBatchJob>(), pages: new Map<string, BatchPage>(), cache: new Map<string, Blob>() }));
vi.mock('../../apps/extension/src/shared/pdfBatchStore', async importOriginal => ({
  ...await importOriginal<object>(),
  listBatchJobs: async () => structuredClone([...db.jobs.values()]),
  getBatchJob: async (id: string) => structuredClone(db.jobs.get(id)),
  getBatchPage: async (id: string, number: number) => structuredClone(db.pages.get(`${id}:${number}`)),
  putBatchJob: async (job: PdfBatchJob) => { db.jobs.set(job.id, structuredClone(job)); },
  putBatchPage: async (page: BatchPage) => { db.pages.set(page.id, structuredClone(page)); },
  releaseBatchImages: async (id: string, keepFailed = false) => { for (const [key, page] of db.pages) if (page.jobId === id && (!keepFailed || page.cached || !page.error)) db.pages.delete(key); },
}));
vi.mock('../../apps/extension/src/pdf/translationCache', () => ({ readCachedPdfPage: async (key: string, number: number) => db.cache.has(`${key}:${number}`) ? { image: db.cache.get(`${key}:${number}`) } : null, saveCachedPdfPage: async (key: string, number: number, image: Blob) => { db.cache.set(`${key}:${number}`, image); } }));
import { createPdfBatchService, registerPdfBatchService } from '../../apps/extension/src/background/pdf/pdfBatchService';
const key = `v2:${'a'.repeat(64)}:${'b'.repeat(64)}`;
const settings = { ...defaultExtensionSettings, targetLang: 'zh-CHT', llmProfiles: { ...defaultExtensionSettings.llmProfiles, openai: { ...defaultExtensionSettings.llmProfiles.openai, apiKey: 'synthetic-key' } } };
const page = (id: string, number: number): BatchPage => ({ id: `${id}:${number}`, jobId: id, number, image: 'data:image/jpeg;base64,AA==', text: 'hello', before: 'before', after: 'after', width: 800, height: 1000 });
const output = (number: number) => JSON.stringify({ custom_id: `page-${number}`, response: { status_code: 200, body: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ regions: [{ x: .1, y: .1, width: .4, height: .2, source: 'hello', translation: '你好 <世界>' }] }) } }] } } });
async function staged(service: ReturnType<typeof createPdfBatchService>, total = 2) {
  const job = await service.command({ action: 'create', documentKey: key, total }) as PdfBatchSummary;
  const local = db.jobs.get(job.id)!; local.prepared = total;
  for (let n = 1; n <= total; n++) db.pages.set(`${job.id}:${n}`, page(job.id, n));
  return job;
}
describe('PDF Batch background translation', () => {
  beforeEach(() => { db.jobs.clear(); db.pages.clear(); db.cache.clear(); });
  it('submits real Batch endpoints, matches unordered results to pages and caches without credentials', async () => {
    let complete = false;
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/files')) { expect((init!.body as FormData).get('purpose')).toBe('batch'); return Response.json({ id: 'file-input' }); }
      if (String(url).endsWith('/batches')) { expect(JSON.parse(String(init!.body))).toMatchObject({ completion_window: '24h', endpoint: '/v1/chat/completions' }); return Response.json({ id: 'batch-1', status: 'validating' }); }
      if (String(url).endsWith('/content')) return new Response(`${output(2)}\n${output(1)}\n`);
      return Response.json({ id: 'batch-1', status: complete ? 'completed' : 'in_progress', output_file_id: complete ? 'file-output' : null });
    });
    const service = createPdfBatchService({ getSettings: async () => settings, fetch });
    const job = await staged(service);
    await service.command({ action: 'seal', id: job.id }); await service.tick();
    expect(db.jobs.get(job.id)!.status).toBe('running');
    complete = true;
    // Reconstructing the service simulates a background worker restart.
    await createPdfBatchService({ getSettings: async () => settings, fetch }).tick();
    expect(db.jobs.get(job.id)).toMatchObject({ status: 'completed', completed: 2, failed: 0 });
    expect(db.cache.size).toBe(2); expect(db.pages.size).toBe(0);
    expect(await db.cache.get(`${key}:1`)!.text()).toContain('你好 &lt;世界&gt;');
    const summary = await service.command({ action: 'list' });
    expect(JSON.stringify(summary)).not.toContain('synthetic-key');
    expect(fetch.mock.calls.filter(([url, init]) => String(url).endsWith('/batches') && init?.method === 'POST')).toHaveLength(1);
  });
  it('preserves successful pages when a batch expires or individual requests fail', async () => {
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/files')) return Response.json({ id: 'file' });
      if (String(url).endsWith('/batches')) return Response.json({ id: 'batch', status: 'validating' });
      if (String(url).endsWith('/content')) return new Response(output(2));
      return Response.json({ id: 'batch', status: 'expired', output_file_id: 'output' });
    });
    const service = createPdfBatchService({ getSettings: async () => settings, fetch });
    const job = await staged(service); await service.command({ action: 'seal', id: job.id }); await service.tick();
    expect(db.jobs.get(job.id)).toMatchObject({ status: 'partial', completed: 1, failed: 1 });
    expect(db.cache.has(`${key}:2`)).toBe(true); expect(db.cache.has(`${key}:1`)).toBe(false);
  });
  it('recovers an interrupted create by metadata instead of creating a second paid batch', async () => {
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).not.toBe('POST');
      if (String(url).includes('/batches?')) return Response.json({ data: [{ id: 'recovered', status: 'completed', metadata: { job: 'saved', chunk: '0' } }] });
      if (String(url).endsWith('/content')) return new Response(output(1));
      return Response.json({ id: 'recovered', status: 'completed', output_file_id: 'result' });
    });
    db.jobs.set('saved', { id: 'saved', documentKey: key, model: 'gpt-5-mini', target: '繁體中文', total: 1, prepared: 1, completed: 0, failed: 0, createdAt: Date.now(), updatedAt: Date.now(), status: 'running', chunks: [{ id: '0', numbers: [1], input: new Blob([]), status: 'creating', fileId: 'file' }] });
    db.pages.set('saved:1', page('saved', 1));
    await createPdfBatchService({ getSettings: async () => settings, fetch }).tick();
    expect(db.jobs.get('saved')).toMatchObject({ status: 'completed', completed: 1 });
  });
  it('keeps polling a cancellation until terminal, importing already completed pages', async () => {
    let cancelled = false;
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/cancel')) { cancelled = true; return Response.json({ id: 'remote', status: 'cancelling' }); }
      return Response.json({ id: 'remote', status: cancelled ? 'cancelled' : 'in_progress' });
    });
    const service = createPdfBatchService({ getSettings: async () => settings, fetch });
    const job = await staged(service, 1);
    Object.assign(db.jobs.get(job.id)!, { status: 'running', chunks: [{ id: '0', numbers: [1], input: new Blob([]), status: 'in_progress', remoteId: 'remote' }] });
    await service.command({ action: 'cancel', id: job.id }); await service.tick();
    expect(db.jobs.get(job.id)).toMatchObject({ status: 'cancelled', failed: 1 });
    expect(db.jobs.get(job.id)!.chunks[0].status).toBe('cancelled');
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/cancel'))).toBe(true);
  });
  it('does not submit cached pages, rejects incomplete preparation and missing credentials', async () => {
    const fetch = vi.fn(); const service = createPdfBatchService({ getSettings: async () => settings, fetch });
    const job = await staged(service, 1); db.jobs.get(job.id)!.prepared = 0;
    await expect(service.command({ action: 'seal', id: job.id })).rejects.toThrow('尚未準備');
    db.jobs.get(job.id)!.prepared = 1; db.pages.get(`${job.id}:1`)!.cached = true;
    await service.command({ action: 'seal', id: job.id }); await service.tick(); expect(fetch).not.toHaveBeenCalled();
    expect(db.jobs.get(job.id)).toMatchObject({ status: 'completed', completed: 1 });
    const noKey = createPdfBatchService({ getSettings: async () => defaultExtensionSettings, fetch });
    await expect(noKey.command({ action: 'create', documentKey: key, total: 1 })).rejects.toThrow('API Key');
  });
  it('bounds layout data and escapes generated image markup', async () => {
    expect(() => parseBatchRegions('{"regions":[{"x":-1}]}')).toThrow();
    expect(() => parseBatchRegions('{"regions":[{"x":0,"y":0,"width":2,"height":1,"source":"","translation":"x"}]}')).toThrow();
    const request = JSON.parse(batchPageRequest(page('job', 1), 'gpt-5-mini', '繁體中文'));
    expect(request.body).toMatchObject({ model: 'gpt-5-mini', reasoning_effort: 'low' });
    expect(request.body.messages[1].content[0].text).toContain('before');
    const image = await renderBatchPage(page('job', 1), [{ x: 0, y: 0, width: 1, height: 1, source: '', translation: '<script>&"' }]).text();
    expect(image).not.toContain('<script>'); expect(image).toContain('&lt;script&gt;');
  });
  it('notifies once after completion and retries failed desktop notifications after restart', async () => {
    db.jobs.set('done', { id: 'done', documentKey: key, model: 'gpt-5-mini', target: '繁體中文', total: 2, prepared: 2, completed: 1, failed: 1, createdAt: Date.now(), updatedAt: Date.now(), status: 'partial', chunks: [] });
    const notify = vi.fn().mockRejectedValueOnce(new Error('OS disabled')).mockResolvedValue(undefined);
    const dependencies = { getSettings: async () => settings, fetch: vi.fn() };
    await createPdfBatchService(dependencies, notify).tick();
    expect(db.jobs.get('done')!.notifiedAt).toBeUndefined();
    expect(db.jobs.get('done')!.notificationError).toContain('通知未送出');
    await createPdfBatchService(dependencies, notify).tick();
    expect(db.jobs.get('done')!.notifiedAt).toBeGreaterThan(0);
    await createPdfBatchService(dependencies, notify).tick();
    expect(notify).toHaveBeenCalledTimes(2);
  });
  it('creates a completion desktop notification and opens the matching job on click', async () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    db.jobs.set(id, { id, documentKey: key, model: 'gpt-5-mini', target: '繁體中文', total: 2, prepared: 2, completed: 2, failed: 0, createdAt: Date.now(), updatedAt: Date.now(), status: 'completed', chunks: [] });
    let click: ((id: string) => void) | undefined;
    const create = vi.fn((_id: string, _options: unknown, callback: (id: string) => void) => callback(_id));
    const tab = vi.fn();
    registerPdfBatchService({ runtime: { getURL: path => `extension://${path}` }, notifications: { create, onClicked: { addListener: listener => { click = listener; } } }, tabs: { create: tab } });
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0][1]).toMatchObject({ title: 'PDF Batch 翻譯完成', message: expect.stringContaining('2/2 頁已快取') });
    click!(`anderson-batch:${id}`);
    expect(tab).toHaveBeenCalledWith({ url: `extension://pdf.html#batch=${id}`, active: true });
  });
  it('reports a definitively rejected upload as a failed job rather than waiting forever', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 401 }));
    const notify = vi.fn(async () => {});
    const service = createPdfBatchService({ getSettings: async () => settings, fetch }, notify);
    const job = await staged(service, 1);
    await service.command({ action: 'seal', id: job.id }); await service.tick();
    expect(db.jobs.get(job.id)).toMatchObject({ status: 'partial', failed: 1 });
    expect(notify).toHaveBeenCalledOnce();
  });
  it('does not repeat a paid create when its response is lost and recovery has not found it yet', async () => {
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/files')) return Response.json({ id: 'input' });
      if (String(url).includes('/batches?')) return Response.json({ data: [], has_more: false });
      throw new TypeError('Connection lost after submission');
    });
    const service = createPdfBatchService({ getSettings: async () => settings, fetch });
    const job = await staged(service, 1);
    await service.command({ action: 'seal', id: job.id }); await service.tick();
    await service.tick(); await service.tick();
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/batches'))).toHaveLength(1);
    expect(db.jobs.get(job.id)!.error).toContain('避免重複扣款');
  });
  it('waits for a remote cancellation before allowing another paid job for the same PDF', async () => {
    const service = createPdfBatchService({ getSettings: async () => settings, fetch: vi.fn() });
    const job = await staged(service, 1);
    Object.assign(db.jobs.get(job.id)!, { status: 'cancelled', chunks: [{ id: '0', status: 'cancelling', remoteId: 'remote', input: new Blob([]), numbers: [1] }] });
    const duplicate = await service.command({ action: 'create', documentKey: key, total: 1 }) as PdfBatchSummary;
    expect(duplicate.id).toBe(job.id); expect(db.jobs.size).toBe(1);
  });
  it('keeps PDF names and server progress separate from cached pages and fixes completion time', async () => {
    let complete = false;
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/files')) return Response.json({ id: 'file' });
      if (String(url).endsWith('/batches')) return Response.json({ id: 'remote', status: 'validating' });
      if (String(url).endsWith('/content')) return new Response(`${output(1)}\n${output(2)}`);
      return Response.json({ id: 'remote', status: complete ? 'completed' : 'in_progress', request_counts: { completed: complete ? 2 : 1, failed: 0, total: 2 }, output_file_id: complete ? 'output' : null });
    });
    const service = createPdfBatchService({ getSettings: async () => settings, fetch });
    const job = await service.command({ action: 'create', documentKey: key, total: 2, pdfName: 'Report\u0000.pdf' }) as PdfBatchSummary;
    db.jobs.get(job.id)!.prepared = 2;
    for (let n = 1; n <= 2; n++) db.pages.set(`${job.id}:${n}`, page(job.id, n));
    await service.command({ action: 'seal', id: job.id }); await service.tick();
    expect(db.jobs.get(job.id)).toMatchObject({ pdfName: 'Report.pdf', processed: 1, completed: 0 });
    expect(db.jobs.get(job.id)!.finishedAt).toBeUndefined();
    complete = true; await service.tick();
    const finished = db.jobs.get(job.id)!.finishedAt; expect(finished).toBeGreaterThan(0);
    await service.command({ action: 'refresh', id: job.id }); await service.tick();
    expect(db.jobs.get(job.id)!.finishedAt).toBe(finished);
  });
  it('retries only failed original page numbers without reopening a PDF and retains parent history', async () => {
    let attempt = 0; const submitted: string[][] = [];
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/files')) {
        const lines = (await ((init!.body as FormData).get('file') as File).text()).trim().split('\n').map(line => JSON.parse(line));
        submitted.push(lines.map(line => line.custom_id));
        return Response.json({ id: `file-${submitted.length}` });
      }
      if (String(url).endsWith('/batches')) { ++attempt; return Response.json({ id: `batch-${attempt}`, status: 'validating' }); }
      if (String(url).endsWith('/content')) return new Response(attempt === 1 ? `${output(3)}\n${output(1)}` : output(2));
      return Response.json({ id: `batch-${attempt}`, status: 'completed', output_file_id: `output-${attempt}` });
    });
    const service = createPdfBatchService({ getSettings: async () => settings, fetch });
    const job = await staged(service, 3);
    await service.command({ action: 'seal', id: job.id }); await service.tick();
    const parent = structuredClone(db.jobs.get(job.id)!);
    expect(parent).toMatchObject({ status: 'partial', completed: 2, failed: 1, failedPages: [{ number: 2, error: expect.any(String) }] });
    expect(db.pages.has(`${job.id}:2`)).toBe(true); expect(db.pages.has(`${job.id}:1`)).toBe(false);
    const retry = await service.command({ action: 'retry', id: job.id }) as PdfBatchSummary;
    await service.tick();
    expect(submitted).toEqual([['page-1', 'page-2', 'page-3'], ['page-2']]);
    expect(db.jobs.get(retry.id)).toMatchObject({ status: 'completed', total: 1, pageNumbers: [2], retryOf: job.id, completed: 1, failed: 0 });
    expect(db.jobs.get(job.id)).toMatchObject({ status: 'partial', completed: 2, failed: 1, finishedAt: parent.finishedAt, retryJobId: retry.id });
    expect(db.cache.size).toBe(3); expect(db.pages.size).toBe(0);
    const repeated = await service.command({ action: 'retry', id: job.id }) as PdfBatchSummary;
    expect(repeated.id).toBe(retry.id); expect(submitted).toHaveLength(2);
  });
  it('resumes retry preparation after a worker restart', async () => {
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/files')) return Response.json({ id: 'file' });
      if (String(url).endsWith('/batches')) return Response.json({ id: 'remote', status: 'validating' });
      return Response.json({ id: 'remote', status: 'in_progress' });
    });
    db.jobs.set('parent', { id: 'parent', documentKey: key, model: 'gpt-5-mini', target: '繁體中文', total: 3, prepared: 3, completed: 2, failed: 1, failedPages: [{ number: 3, error: 'failed' }], status: 'partial', createdAt: 1, updatedAt: 1, chunks: [], notifiedAt: 1 });
    db.pages.set('parent:3', { ...page('parent', 3), error: 'failed' });
    db.jobs.set('retry', { ...db.jobs.get('parent')!, id: 'retry', retryOf: 'parent', total: 1, pageNumbers: [3], prepared: 0, completed: 0, failed: 0, failedPages: [], status: 'preparing', notifiedAt: undefined });
    await createPdfBatchService({ getSettings: async () => settings, fetch }).tick();
    expect(db.jobs.get('retry')).toMatchObject({ status: 'running', prepared: 1 });
    expect(db.pages.get('retry:3')!.image).toBeTruthy();
    expect(db.pages.has('parent:3')).toBe(false);
  });
  it('does not retry while cancellation is pending, after discard, or with missing legacy inputs', async () => {
    const service = createPdfBatchService({ getSettings: async () => settings, fetch: vi.fn() });
    const job = await staged(service, 1);
    Object.assign(db.jobs.get(job.id)!, { status: 'cancelled', failed: 1, failedPages: [{ number: 1, error: 'failed' }], chunks: [{ id: '0', numbers: [1], input: new Blob([]), status: 'cancelling', remoteId: 'remote' }] });
    await expect(service.command({ action: 'retry', id: job.id })).rejects.toThrow('遠端取消完成');
    Object.assign(db.jobs.get(job.id)!, { status: 'partial', chunks: [], discardResults: true });
    await expect(service.command({ action: 'retry', id: job.id })).rejects.toThrow('已清除');
    Object.assign(db.jobs.get(job.id)!, { discardResults: false, failedPages: undefined });
    await expect(service.command({ action: 'retry', id: job.id })).rejects.toThrow('舊工作');
    expect(db.jobs.size).toBe(1);
  });
  it('skips failed pages already translated by another path', async () => {
    const service = createPdfBatchService({ getSettings: async () => settings, fetch: vi.fn() });
    const job = await staged(service, 1);
    Object.assign(db.jobs.get(job.id)!, { status: 'partial', failed: 1, failedPages: [{ number: 1, error: 'failed' }] });
    db.cache.set(`${key}:1`, new Blob(['already translated']));
    await expect(service.command({ action: 'retry', id: job.id })).rejects.toThrow('均已有快取');
    expect(db.jobs.size).toBe(1);
  });
});

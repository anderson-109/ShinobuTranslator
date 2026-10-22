import type { ExtensionBrowserApi, ExtensionMessageSender } from '../../shared/extensionRuntime';
import { getBatchJob, getBatchPage, listBatchJobs, putBatchJob, putBatchPage, releaseBatchImages, batchSummary, batchPageNumbers, hasPendingBatchRemote, batchJobName, type PdfBatchJob } from '../../shared/pdfBatchStore';
import { batchPageRequest, parseBatchRegions, renderBatchPage } from '../../shared/pdfBatchFormat';
import { readCachedPdfPage, saveCachedPdfPage } from '../../pdf/translationCache';
import { getSettings } from '../settings/settingsStore';

const alarmName = 'anderson-pdf-batch-poll';
const endpoint = 'https://api.openai.com/v1';
const terminal = new Set(['completed', 'failed', 'expired', 'cancelled']);
type RemoteBatch = { id: string; status: string; output_file_id?: string; error_file_id?: string; metadata?: { job?: string; chunk?: string }; created_at?: number; request_counts?: { completed: number; failed: number; total: number }; errors?: { data?: Array<{ message?: string }> } };
class BatchHttpError extends Error {
  constructor(readonly status: number) { super(`OpenAI Batch HTTP ${status}；請檢查 API Key、額度與 Batch 權限`); }
}

export function createPdfBatchService(dependencies = { getSettings, fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init) }, notify: (job: PdfBatchJob) => Promise<void> = async () => {}) {
  let busy: Promise<void> | undefined;
  let commands: Promise<unknown> = Promise.resolve();
  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const key = (await dependencies.getSettings()).llmProfiles.openai.apiKey.trim();
    if (!key) throw new Error('Batch 省費模式需要在設定中填入 OpenAI API Key');
    const response = await dependencies.fetch(`${endpoint}${path}`, { ...init, signal: AbortSignal.timeout(25000), headers: { ...init.headers, Authorization: `Bearer ${key}` } });
    if (!response.ok) {
      // Do not surface raw response bodies, which can echo uploaded document data.
      throw new BatchHttpError(response.status);
    }
    return response;
  }
  async function seal(job: PdfBatchJob): Promise<void> {
    if (job.prepared !== job.total) throw new Error('PDF 頁面尚未準備完成，請重新開啟相同 PDF 繼續');
    let lines: string[] = [], numbers: number[] = [], bytes = 0;
    const flush = () => {
      if (!numbers.length) return;
      job.chunks.push({ id: String(job.chunks.length), numbers, input: new Blob([lines.join('\n') + '\n'], { type: 'application/jsonl' }), status: 'pending' });
      lines = []; numbers = []; bytes = 0;
    };
    job.chunks = []; job.completed = 0; job.failed = 0; job.failedPages = [];
    for (const number of batchPageNumbers(job)) {
      const page = await getBatchPage(job.id, number);
      if (!page) throw new Error(`缺少第 ${number} 頁，請重新準備`);
      if (page.cached) { ++job.completed; continue; }
      const line = batchPageRequest(page, job.model, job.target);
      const size = new TextEncoder().encode(line).length + 1;
      if (size > 8 * 1024 * 1024) throw new Error(`第 ${number} 頁影像太大`);
      if (bytes + size > 8 * 1024 * 1024) flush();
      lines.push(line); numbers.push(number); bytes += size;
    }
    flush(); job.status = job.chunks.length ? 'queued' : 'completed';
    job.skipped = job.completed; job.processed = job.completed;
    if (job.status === 'completed') job.finishedAt = Date.now();
    await putBatchJob(job);
    if (!job.chunks.length) await releaseBatchImages(job.id);
  }
  async function importResults(job: PdfBatchJob, chunk: PdfBatchJob['chunks'][number], remote: RemoteBatch): Promise<void> {
    if (job.discardResults) { chunk.status = remote.status; chunk.input = new Blob([]); return; }
    const seen = new Set<number>();
    if (remote.output_file_id) {
      const text = await (await request(`/files/${encodeURIComponent(remote.output_file_id)}/content`)).text();
      for (const line of text.split('\n').filter(line => line.trim())) {
        const result = JSON.parse(line);
        const match = /^page-(\d+)$/.exec(String(result.custom_id));
        const number = match ? Number(match[1]) : 0;
        if (!chunk.numbers.includes(number) || seen.has(number)) throw new Error('Batch 結果的頁碼重複或不屬於此工作');
        seen.add(number);
        const page = await getBatchPage(job.id, number);
        if (!page || page.cached) continue;
        try {
          if (result.error || result.response?.status_code !== 200) throw new Error('此頁的 Batch API 請求失敗');
          const message = result.response?.body?.choices?.[0];
          if (message?.finish_reason !== 'stop' || typeof message.message?.content !== 'string') throw new Error('此頁輸出不完整或遭拒絕');
          const regions = parseBatchRegions(message.message.content);
          if (!regions.length && page.text.trim()) throw new Error('此頁有文字，但 Batch 未回傳譯文');
          await saveCachedPdfPage(job.documentKey, number, renderBatchPage(page, regions));
          page.cached = true; page.error = undefined;
        } catch (error) { page.error = String(error); }
        await putBatchPage(page);
      }
    }
    for (const number of chunk.numbers) {
      const page = await getBatchPage(job.id, number);
      if (!page) continue;
      if (!page.cached && !page.error) { page.error = `OpenAI 工作狀態 ${remote.status}：此頁沒有成功結果`; await putBatchPage(page); }
    }
    chunk.status = remote.status;
    chunk.processed = remote.request_counts ? Math.min(chunk.numbers.length, Math.max(0, remote.request_counts.completed + remote.request_counts.failed)) : remote.status === 'completed' ? chunk.numbers.length : seen.size;
    chunk.input = new Blob([]);
  }
  async function advance(job: PdfBatchJob): Promise<void> {
    const deadline = Date.now() + 20000;
    job.error = undefined;
    for (const chunk of job.chunks) {
      if (terminal.has(chunk.status)) continue;
      let creatingRequest = false;
      try {
        if (job.status === 'cancelled') {
          if (chunk.remoteId) {
            const remote = await (await request(`/batches/${encodeURIComponent(chunk.remoteId)}`)).json() as RemoteBatch;
            if (!terminal.has(remote.status) && remote.status !== 'cancelling') await request(`/batches/${encodeURIComponent(chunk.remoteId)}/cancel`, { method: 'POST' });
          } else if (chunk.status !== 'creating') chunk.status = 'cancelled';
          // A creation interrupted before its response must first be recovered below.
        }
        if (terminal.has(chunk.status)) { await putBatchJob(job); continue; }
        if (chunk.status === 'pending') {
          const form = new FormData(); form.append('purpose', 'batch'); form.append('file', chunk.input, `anderson-${job.id}-${chunk.id}.jsonl`);
          const file = await (await request('/files', { method: 'POST', body: form })).json() as { id: string };
          if (!file.id) throw new Error('OpenAI 未回傳檔案編號');
          chunk.fileId = file.id; chunk.input = new Blob([]); chunk.status = 'uploaded'; await putBatchJob(job);
        }
        if (chunk.status === 'creating' && !chunk.remoteId) {
          // Never blindly repeat POST /batches after a lost response: recover via metadata.
          let after = '', found: RemoteBatch | undefined;
          for (let attempt = 0; attempt < 100; attempt++) {
            const list = await (await request(`/batches?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`)).json() as { data: RemoteBatch[]; has_more?: boolean };
            found = list.data.find(b => b.metadata?.job === job.id && b.metadata?.chunk === chunk.id);
            if (found || !list.has_more || !list.data.length || (list.data.at(-1)?.created_at ?? Infinity) * 1000 < job.createdAt - 60000) break;
            after = list.data.at(-1)!.id;
          }
          if (!found) throw new Error('送出狀態待確認；背景會持續查詢，為避免重複扣款不會自動重新送出');
          chunk.remoteId = found.id; chunk.status = 'polling'; await putBatchJob(job);
        }
        if (chunk.status === 'uploaded') {
          chunk.status = 'creating'; await putBatchJob(job);
          creatingRequest = true;
          const remote = await (await request('/batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input_file_id: chunk.fileId, endpoint: '/v1/chat/completions', completion_window: '24h', metadata: { job: job.id, chunk: chunk.id } }) })).json() as RemoteBatch;
          if (!remote.id) throw new Error('OpenAI 未回傳 Batch 工作編號');
          chunk.remoteId = remote.id; chunk.status = 'polling'; await putBatchJob(job);
        }
        if (chunk.remoteId) {
          const remote = await (await request(`/batches/${encodeURIComponent(chunk.remoteId)}`)).json() as RemoteBatch;
          if (remote.request_counts && Number.isFinite(remote.request_counts.completed) && Number.isFinite(remote.request_counts.failed)) chunk.processed = Math.min(chunk.numbers.length, Math.max(0, remote.request_counts.completed + remote.request_counts.failed));
          if (terminal.has(remote.status)) {
            // Persist terminal status only after all successful results are durably cached.
            await importResults(job, chunk, remote);
            if (remote.errors?.data?.length) chunk.error = remote.errors.data.map(e => e.message ?? 'Batch 錯誤').join('; ').slice(0, 1000);
          } else chunk.status = remote.status;
        }
        if (!terminal.has(chunk.status)) chunk.error = undefined;
      } catch (error) {
        if (!chunk.remoteId && (chunk.status === 'pending' || creatingRequest) && error instanceof BatchHttpError && [400, 401, 403, 404, 422].includes(error.status)) {
          await importResults(job, chunk, { id: '', status: 'failed' });
        }
        chunk.error = String(error); job.error = chunk.error;
      }
      await putBatchJob(job);
      if (Date.now() >= deadline) break;
    }
    job.completed = 0; job.failed = 0; job.failedPages = [];
    for (const number of batchPageNumbers(job)) {
      const page = await getBatchPage(job.id, number);
      if (page?.cached) ++job.completed;
      else if (page?.error) { ++job.failed; job.failedPages.push({ number, error: page.error }); }
    }
    job.processed = Math.min(job.total, (job.skipped ?? 0) + job.chunks.reduce((sum, chunk) => sum + (chunk.processed ?? (terminal.has(chunk.status) ? chunk.numbers.length : 0)), 0));
    if (job.chunks.every(c => terminal.has(c.status))) {
      if (job.status !== 'cancelled') job.status = job.completed === job.total ? 'completed' : 'partial';
      job.finishedAt ??= Date.now();
    } else if (job.status !== 'cancelled') job.status = 'running';
    await putBatchJob(job);
    if (job.chunks.every(c => terminal.has(c.status))) await releaseBatchImages(job.id, job.failed > 0 && !job.discardResults);
  }
  async function hydrateRetry(job: PdfBatchJob): Promise<void> {
    if (!job.retryOf) return;
    for (const [index, number] of batchPageNumbers(job).entries()) {
      if (!await getBatchPage(job.id, number)) {
        const source = await getBatchPage(job.retryOf, number);
        if (!source?.image) throw new Error(`第 ${number} 頁沒有保留原圖，請重新選擇原 PDF 再送出未完成頁面`);
        await putBatchPage({ ...source, id: `${job.id}:${number}`, jobId: job.id, cached: false, error: undefined });
      }
      job.prepared = index + 1;
      await putBatchJob(job);
    }
    await seal(job);
    await releaseBatchImages(job.retryOf);
  }
  function tick(): Promise<void> {
    return busy ??= (async () => {
      const deadline = Date.now() + 20000;
      for (const job of await listBatchJobs()) {
        if (job.status === 'preparing' && job.retryOf) {
          try { await hydrateRetry(job); }
          catch (error) { job.error = String(error); await putBatchJob(job); }
        }
        if (job.status === 'queued' || job.status === 'running' || (job.status === 'cancelled' && job.chunks.some(c => !terminal.has(c.status)))) await advance(job);
        if (['completed', 'partial'].includes(job.status) && !job.notifiedAt) {
          try { await notify(job); job.notifiedAt = Date.now(); job.notificationError = undefined; }
          catch { job.notificationError = '桌面通知未送出，請確認瀏覽器與系統允許通知；譯文仍已快取。'; }
          await putBatchJob(job);
        }
        if (Date.now() >= deadline) break;
      }
    })().finally(() => { busy = undefined; });
  }
  async function command(message: Record<string, unknown>) {
    if (message.action === 'create') {
      if (typeof message.documentKey !== 'string' || !/^v2:[a-f0-9]{64}:[a-f0-9]{64}$/.test(message.documentKey)
        || !Number.isInteger(message.total) || Number(message.total) < 1 || Number(message.total) > 500) throw new Error('Batch 目前支援 1–500 頁 PDF');
      const existing = (await listBatchJobs()).find(j => j.documentKey === message.documentKey && (['preparing', 'queued', 'running'].includes(j.status) || j.status === 'cancelled' && j.chunks.some(c => !terminal.has(c.status))));
      if (existing) return batchSummary(existing);
      const settings = await dependencies.getSettings();
      if (!settings.llmProfiles.openai.apiKey.trim()) throw new Error('請先在擴充功能設定中填入 OpenAI API Key');
      const pdfName = typeof message.pdfName === 'string' ? message.pdfName.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200) : '';
      const job: PdfBatchJob = { id: crypto.randomUUID(), documentKey: message.documentKey, pdfName: pdfName || '未命名 PDF', documentTotal: Number(message.total), model: 'gpt-5-mini', target: settings.targetLang === 'zh-CHT' ? '繁體中文' : '简体中文', total: Number(message.total), prepared: 0, status: 'preparing', chunks: [], createdAt: Date.now(), updatedAt: Date.now(), completed: 0, failed: 0 };
      await putBatchJob(job); return batchSummary(job);
    }
    if (message.action === 'list') return (await listBatchJobs()).map(batchSummary);
    if (typeof message.id !== 'string') throw new Error('缺少 Batch 工作編號');
    const job = await getBatchJob(message.id);
    if (!job) throw new Error('找不到 Batch 工作');
    if (message.action === 'retry') {
      await busy;
      const latest = (await getBatchJob(job.id))!;
      const jobs = await listBatchJobs();
      const previousRetry = jobs.find(j => j.id === latest.retryJobId) ?? jobs.find(j => j.retryOf === latest.id);
      if (previousRetry) return batchSummary(previousRetry);
      if (latest.status === 'preparing' || hasPendingBatchRemote(latest)) throw new Error('請等待此工作完成或遠端取消完成，再重試失敗頁面');
      if (latest.discardResults) throw new Error('此工作已清除，請重新選擇 PDF 建立新工作');
      if (jobs.some(j => j.documentKey === latest.documentKey && (j.status === 'preparing' || hasPendingBatchRemote(j)))) throw new Error('此 PDF 已有工作處理中，請等待完成');
      if (!latest.failedPages?.length) throw new Error(latest.failed ? '此舊工作沒有保留失敗頁資料，請重新選擇原 PDF，再送出未完成頁面' : '沒有需要重試的失敗頁面');
      const numbers: number[] = [];
      for (const failure of latest.failedPages) {
        if (await readCachedPdfPage(latest.documentKey, failure.number)) continue;
        if (!(await getBatchPage(latest.id, failure.number))?.image) throw new Error(`第 ${failure.number} 頁沒有保留原圖，請重新選擇原 PDF 再送出未完成頁面`);
        numbers.push(failure.number);
      }
      if (!numbers.length) throw new Error('失敗頁面目前均已有快取，無須重複送出');
      if (!(await dependencies.getSettings()).llmProfiles.openai.apiKey.trim()) throw new Error('請先設定 OpenAI API Key');
      const retry: PdfBatchJob = { id: crypto.randomUUID(), documentKey: latest.documentKey, pdfName: latest.pdfName, documentTotal: latest.documentTotal ?? latest.total, pageNumbers: numbers, retryOf: latest.id, model: latest.model, target: latest.target, total: numbers.length, prepared: 0, status: 'preparing', chunks: [], createdAt: Date.now(), updatedAt: Date.now(), completed: 0, failed: 0 };
      await putBatchJob(retry);
      latest.retryJobId = retry.id; await putBatchJob(latest);
      void tick().catch(() => {});
      return batchSummary(retry);
    }
    if (message.action === 'seal' && job.status === 'preparing') { await seal(job); void tick().catch(() => {}); }
    else if (message.action === 'cancel' || message.action === 'discard') {
      // Serialize against polling so a stale poll cannot overwrite cancellation.
      await busy;
      const latest = await getBatchJob(job.id);
      if (latest && !['completed', 'partial'].includes(latest.status)) { latest.status = 'cancelled'; latest.discardResults ||= message.action === 'discard'; if (!latest.chunks.length) latest.finishedAt ??= Date.now(); await putBatchJob(latest); if (!latest.chunks.length) await releaseBatchImages(latest.id); void tick().catch(() => {}); }
    } else if (message.action === 'refresh') { void tick().catch(() => {}); }
    else if (message.action !== 'status') throw new Error('不支援的 Batch 操作');
    return batchSummary((await getBatchJob(job.id))!);
  }
  return { command(message: Record<string, unknown>) {
    const result = commands.then(() => command(message));
    commands = result.catch(() => {});
    return result;
  }, tick };
}

export function registerPdfBatchService(api: ExtensionBrowserApi): void {
  const service = createPdfBatchService(undefined, job => new Promise<void>((resolve, reject) => {
    if (!api.notifications) { reject(new Error('通知不可用')); return; }
    api.notifications.create(`anderson-batch:${job.id}`, {
      type: 'basic', iconUrl: api.runtime?.getURL?.('icons/icon128.png') ?? 'icons/icon128.png',
      title: job.status === 'completed' ? 'PDF Batch 翻譯完成' : 'PDF Batch 部分完成',
      message: `${batchJobName(job)}：${job.completed}/${job.total} 頁已快取${job.failed ? `，${job.failed} 頁失敗，可重新送出未完成頁面` : ''}。點擊開啟工作清單。`,
    }, () => { if (api.runtime?.lastError) reject(new Error(api.runtime.lastError.message)); else resolve(); });
  }));
  api.notifications?.onClicked.addListener(id => {
    if (!/^anderson-batch:[a-f0-9-]{36}$/.test(id)) return;
    void api.tabs?.create?.({ url: `${api.runtime?.getURL?.('pdf.html')}#batch=${encodeURIComponent(id.slice('anderson-batch:'.length))}`, active: true });
  });
  const reader = api.runtime?.getURL?.('pdf.html');
  api.runtime?.onMessage?.addListener((message: unknown, sender: ExtensionMessageSender, reply) => {
    if (!message || typeof message !== 'object' || (message as { type?: string }).type !== 'anderson:pdf-batch') return false;
    if (!reader || sender.url?.split(/[?#]/)[0] !== reader) { reply({ ok: false, error: 'Batch 僅允許 PDF 閱讀器操作' }); return false; }
    void service.command(message as Record<string, unknown>).then(result => reply({ ok: true, result }), error => reply({ ok: false, error: String(error) }));
    return true;
  });
  api.alarms?.onAlarm.addListener(alarm => { if (alarm.name === alarmName) void service.tick().catch(() => {}); });
  void api.alarms?.create(alarmName, { periodInMinutes: 1 });
  void service.tick().catch(() => {});
}

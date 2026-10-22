import { pdfBatchCommand as command } from '../shared/pdfBatchClient';
import { batchPageNumbers, getBatchJob, getBatchPage, hasPendingBatchRemote, markBatchPrepared, stageBatchPage, type PdfBatchSummary } from '../shared/pdfBatchStore';
import { readCachedPdfPage } from './translationCache';
import { bindPdfBatchJobList } from './pdfBatchJobList';

type Snapshot = { key: string; total: number; generation: number; pdfName: string };
export function bindPdfBatchControls(deps: {
  snapshot: () => Snapshot | null;
  render: (number: number) => Promise<{ file: File }>;
  pageText: (number: number) => Promise<string>;
  onCacheReady: () => void;
  onBatchMode: () => void;
}) {
  const start = document.querySelector<HTMLButtonElement>('#batch-start')!;
  const cancel = document.querySelector<HTMLButtonElement>('#batch-cancel')!;
  const status = document.querySelector<HTMLElement>('#batch-status')!;
  const mode = document.querySelector<HTMLSelectElement>('#translation-mode')!;
  let job: PdfBatchSummary | undefined, preparing = false, stopped = false, disposed = false;
  const labels: Record<string, string> = { preparing: '準備頁面中', queued: '等待送出', running: 'OpenAI 背景處理中', completed: '完成，譯文已快取', partial: '部分完成，成功頁面已快取', cancelled: '已取消（OpenAI 取消可能需要 10 分鐘）' };
  const pendingRemote = () => !!job && (hasPendingBatchRemote(job) || !!job.retryOf && job.status === 'preparing');
  const jobs = bindPdfBatchJobList({
    cancel: async id => {
      if (preparing && job?.id === id) { stopped = true; while (preparing && !disposed) await new Promise(resolve => setTimeout(resolve, 50)); }
      await command('cancel', { id }); await refresh();
    },
    changed: async () => { await refresh(); },
  });
  function show(): void {
    start.disabled = preparing || !deps.snapshot() || pendingRemote();
    start.textContent = job?.status === 'preparing' ? '繼續準備並送出' : '整份 PDF 背景翻譯';
    cancel.disabled = !job || !['preparing', 'queued', 'running'].includes(job.status);
    if (!job) return;
    status.textContent = `${labels[job.status]} · ${job.model} · ${job.target} · 準備 ${job.prepared}/${job.total} 頁 · 快取 ${job.completed}/${job.total} 頁 · 失敗 ${job.failed} 頁。${job.error ?? ''} ${job.notificationError ?? ''} ${job.chunks.filter(c => c.remoteId).map(c => `${c.remoteId}: ${c.status}${c.error ? ` (${c.error})` : ''}`).join('；')}${!deps.snapshot() ? ' 請選擇原本的 PDF，便可直接閱讀快取譯文。' : ''}`;
  }
  async function refresh(): Promise<void> {
    const snapshot = deps.snapshot();
    if (!snapshot || preparing || disposed) return;
    try {
      const jobs = await command('list') as PdfBatchSummary[];
      if (deps.snapshot()?.key !== snapshot.key || preparing || disposed) return;
      const previous = job;
      job = jobs.filter(j => j.documentKey === snapshot.key).sort((a, b) => b.createdAt - a.createdAt)[0];
      if (job && job.completed > (previous?.completed ?? 0)) deps.onCacheReady();
      show();
    } catch (error) { status.textContent = String(error); }
  }
  async function prepare(): Promise<void> {
    const snapshot = deps.snapshot();
    if (!snapshot || preparing) return;
    preparing = true; stopped = false; show();
    try {
      job = await command('create', { documentKey: snapshot.key, total: snapshot.total, pdfName: snapshot.pdfName }) as PdfBatchSummary;
      if (job.status !== 'preparing' || job.retryOf) { show(); return; }
      const local = (await getBatchJob(job.id))!;
      let bytes = 0;
      for (const [index, number] of batchPageNumbers(local).entries()) {
        if (stopped || disposed || deps.snapshot()?.generation !== snapshot.generation || deps.snapshot()?.key !== snapshot.key) throw new Error('準備已暫停；重新開啟相同 PDF 可繼續');
        let page = await getBatchPage(local.id, number);
        if (!page) {
          const cached = await readCachedPdfPage(snapshot.key, number);
          if (cached) page = { id: `${local.id}:${number}`, jobId: local.id, number, cached: true, image: '', text: '', before: '', after: '', width: 1, height: 1 };
          else {
            const rendered = await deps.render(number);
            const bitmap = await createImageBitmap(rendered.file);
            const canvas = document.createElement('canvas');
            let data: string;
            try { canvas.width = bitmap.width; canvas.height = bitmap.height; canvas.getContext('2d')!.drawImage(bitmap, 0, 0); data = canvas.toDataURL('image/jpeg', .85); }
            finally { bitmap.close(); canvas.width = canvas.height = 0; }
            const [text, before, after] = await Promise.all([deps.pageText(number), deps.pageText(number - 1), deps.pageText(number + 1)]);
            const info = await createImageBitmap(rendered.file);
            page = { id: `${local.id}:${number}`, jobId: local.id, number, image: data, width: info.width, height: info.height, text, before, after }; info.close();
          }
          bytes += page.image.length;
          if (bytes > 200 * 1024 * 1024) throw new Error('準備資料超過 200 MB，請將 PDF 拆分後送出');
          // Cancellation can occur during page rendering; do not overwrite its job state.
          if (stopped || disposed) throw new Error('準備已暫停');
          await stageBatchPage(page);
        } else bytes += page.image.length;
        if (bytes > 200 * 1024 * 1024) throw new Error('準備資料超過 200 MB，請將 PDF 拆分後送出');
        await markBatchPrepared(local.id, index + 1);
        job.prepared = index + 1; show();
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (stopped || disposed || deps.snapshot()?.key !== snapshot.key) throw new Error('準備已暫停');
      job = await command('seal', { id: local.id }) as PdfBatchSummary;
      show();
    } catch (error) { status.textContent = String(error); }
    finally { preparing = false; start.disabled = !deps.snapshot() || pendingRemote(); }
  }
  mode.addEventListener('change', () => {
    document.querySelector<HTMLElement>('#batch-panel')!.hidden = mode.value !== 'batch';
    document.querySelector<HTMLElement>('#batch-controls')!.hidden = mode.value !== 'batch';
    if (mode.value === 'batch') deps.onBatchMode();
    void refresh();
  });
  start.addEventListener('click', () => { void prepare(); });
  cancel.addEventListener('click', () => {
    stopped = true; cancel.disabled = true;
    // Let the last local write finish before cancellation is persisted by the background.
    void (async () => {
      while (preparing && !disposed) await new Promise(resolve => setTimeout(resolve, 50));
      if (job) job = await command('cancel', { id: job.id }) as PdfBatchSummary;
      show();
    })().catch(error => { status.textContent = String(error); });
  });
  document.querySelector('#batch-refresh')!.addEventListener('click', () => {
    void (async () => { if (job) await command('refresh', { id: job.id }); await refresh(); })().catch(error => { status.textContent = String(error); });
  });
  const timer = setInterval(() => { void refresh(); }, 10000);
  const requestedJob = new URLSearchParams(location.hash.slice(1)).get('batch');
  if (requestedJob) {
    mode.value = 'batch'; document.querySelector<HTMLElement>('#batch-controls')!.hidden = false;
    document.querySelector<HTMLElement>('#batch-panel')!.hidden = false;
    void command('status', { id: requestedJob }).then(value => { if (!disposed && !deps.snapshot()) { job = value as PdfBatchSummary; show(); } }).catch(error => { status.textContent = String(error); });
  }
  return {
    async discard(key: string) {
      stopped = true;
      while (preparing && !disposed) await new Promise(resolve => setTimeout(resolve, 50));
      const jobs = await command('list') as PdfBatchSummary[];
      for (const item of jobs.filter(j => j.documentKey === key && !['completed', 'partial'].includes(j.status))) await command('discard', { id: item.id });
      await refresh();
    },
    changed() { job = undefined; start.disabled = !deps.snapshot() || preparing; cancel.disabled = true; status.textContent = '準備頁面時請保持此分頁開啟；送出後可關閉。背景每分鐘查詢，瀏覽器重開後會繼續。'; void refresh(); },
    dispose() { disposed = true; stopped = true; clearInterval(timer); jobs.dispose(); },
  };
}

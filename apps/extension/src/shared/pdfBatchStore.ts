export type BatchPage = { id: string; jobId: string; number: number; image: string; width: number; height: number; text: string; before: string; after: string; cached?: boolean; error?: string };
export type BatchChunk = { id: string; numbers: number[]; input: Blob; fileId?: string; remoteId?: string; status: string; error?: string; processed?: number };
export type PdfBatchJob = {
  id: string; documentKey: string; model: string; target: string; total: number; prepared: number;
  pdfName?: string; documentTotal?: number; pageNumbers?: number[]; retryOf?: string; retryJobId?: string;
  failedPages?: Array<{ number: number; error: string }>; processed?: number; skipped?: number; finishedAt?: number;
  status: 'preparing' | 'queued' | 'running' | 'completed' | 'partial' | 'cancelled';
  chunks: BatchChunk[]; createdAt: number; updatedAt: number; error?: string; completed: number; failed: number; discardResults?: boolean; notifiedAt?: number; notificationError?: string;
};
let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('anderson-pdf-batches', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('jobs', { keyPath: 'id' });
      const pages = request.result.createObjectStore('pages', { keyPath: 'id' });
      pages.createIndex('jobId', 'jobId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}
async function operation<T>(store: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? request.error);
  });
}
export const listBatchJobs = (): Promise<PdfBatchJob[]> => operation('jobs', 'readonly', s => s.getAll());
export const getBatchJob = (id: string): Promise<PdfBatchJob | undefined> => operation('jobs', 'readonly', s => s.get(id));
export const putBatchJob = async (job: PdfBatchJob): Promise<void> => { job.updatedAt = Date.now(); await operation('jobs', 'readwrite', s => s.put(job)); };
export const getBatchPage = (jobId: string, number: number): Promise<BatchPage | undefined> => operation('pages', 'readonly', s => s.get(`${jobId}:${number}`));
export const putBatchPage = async (page: BatchPage): Promise<void> => { await operation('pages', 'readwrite', s => s.put(page)); };
/** Preparation and cancellation in different reader tabs must not leave orphan images. */
export async function stageBatchPage(page: BatchPage): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['jobs', 'pages'], 'readwrite');
    const request = tx.objectStore('jobs').get(page.jobId);
    request.onsuccess = () => {
      if ((request.result as PdfBatchJob | undefined)?.status !== 'preparing') { tx.abort(); return; }
      tx.objectStore('pages').put(page);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new Error('Batch 準備已取消或已送出'));
  });
}
export async function markBatchPrepared(id: string, number: number): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('jobs', 'readwrite');
    const store = tx.objectStore('jobs');
    const request = store.get(id);
    request.onsuccess = () => {
      const job = request.result as PdfBatchJob | undefined;
      if (!job || job.status !== 'preparing') { tx.abort(); return; }
      job.prepared = Math.max(job.prepared, number); job.updatedAt = Date.now(); store.put(job);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new Error('Batch 準備已取消或已送出'));
  });
}
export async function releaseBatchImages(jobId: string, keepFailed = false): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('pages', 'readwrite');
    const request = tx.objectStore('pages').index('jobId').openCursor(jobId);
    request.onsuccess = () => { const cursor = request.result; if (cursor) { const page = cursor.value as BatchPage; if (!keepFailed || page.cached || !page.error) cursor.delete(); cursor.continue(); } };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
export type PdfBatchSummary = Omit<PdfBatchJob, 'chunks'> & { chunks: Array<Pick<BatchChunk, 'id' | 'remoteId' | 'status' | 'error' | 'processed'>> };
export function batchSummary(job: PdfBatchJob): PdfBatchSummary {
  return { ...job, chunks: job.chunks.map(({ id, remoteId, status, error, processed }) => ({ id, remoteId, status, error, processed })) };
}
export const batchPageNumbers = (job: Pick<PdfBatchJob, 'pageNumbers' | 'total'>): number[] => job.pageNumbers ?? Array.from({ length: job.total }, (_, i) => i + 1);
export const hasPendingBatchRemote = (job: Pick<PdfBatchSummary, 'status' | 'chunks'>): boolean => ['queued', 'running'].includes(job.status) || job.status === 'cancelled' && job.chunks.some(c => !['completed', 'failed', 'expired', 'cancelled'].includes(c.status));
export const batchJobName = (job: Pick<PdfBatchSummary, 'pdfName' | 'id'>): string => job.pdfName || `PDF（舊工作 ${job.id.slice(0, 8)}）`;

import { pdfBatchCommand } from '../shared/pdfBatchClient';
import { batchJobName, hasPendingBatchRemote, type PdfBatchSummary } from '../shared/pdfBatchStore';

const date = (time?: number): string => time ? new Date(time).toLocaleString('zh-TW', { hour12: false }) : '—';
function statusLabel(job: PdfBatchSummary): string {
  if (job.status === 'cancelled') return hasPendingBatchRemote(job) ? '取消中' : '已取消';
  return { preparing: job.retryOf ? '準備重試頁面' : '準備頁面中', queued: '等待送出', running: '背景處理中', completed: '已完成', partial: job.completed ? '部分完成' : '失敗' }[job.status];
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function bindPdfBatchJobList(deps: { cancel: (id: string) => Promise<void>; changed: () => Promise<void> }) {
  const dialog = document.querySelector<HTMLDialogElement>('#batch-jobs')!;
  const list = document.querySelector<HTMLElement>('#batch-jobs-list')!;
  const message = document.querySelector<HTMLElement>('#batch-jobs-message')!;
  const search = document.querySelector<HTMLInputElement>('#batch-jobs-search')!;
  const filter = document.querySelector<HTMLSelectElement>('#batch-jobs-filter')!;
  let jobs: PdfBatchSummary[] = [], disposed = false, loading = false, feedback = '', rendered = '';
  const pending = new Set<string>();
  const highlighted = new URLSearchParams(location.hash.slice(1)).get('batch');

  async function action(job: PdfBatchSummary, kind: 'cancel' | 'retry'): Promise<void> {
    if (pending.has(job.id)) return;
    pending.add(job.id); feedback = '正在處理…'; render(true);
    try {
      if (kind === 'cancel') { await deps.cancel(job.id); feedback = `已提出取消「${batchJobName(job)}」；遠端取消完成後才可重試。`; }
      else {
        const retry = await pdfBatchCommand<PdfBatchSummary>('retry', { id: job.id });
        feedback = `「${batchJobName(job)}」已建立重試工作，只處理 ${retry.total} 個失敗頁面。`;
        await deps.changed();
      }
    } catch (error) { feedback = String(error); }
    finally { pending.delete(job.id); await refresh(); render(true); }
  }

  function render(force = false): void {
    const query = search.value.trim().toLocaleLowerCase();
    const visible = jobs.filter(job => {
      const active = job.status === 'preparing' || hasPendingBatchRemote(job);
      const match = filter.value === 'all' || filter.value === 'active' && active || filter.value === 'completed' && job.status === 'completed' || filter.value === 'attention' && !active && ['partial', 'cancelled'].includes(job.status);
      return match && `${batchJobName(job)} ${job.id} ${job.chunks.map(c => c.remoteId ?? '').join(' ')}`.toLocaleLowerCase().includes(query);
    });
    message.textContent = `${visible.length} / ${jobs.length} 項工作。${feedback}`;
    const signature = JSON.stringify([visible, [...pending]]);
    if (!force && signature === rendered) return;
    rendered = signature;
    const openDetails = new Set([...list.querySelectorAll<HTMLDetailsElement>('details[open]')].map(d => d.dataset.job));
    const focused = document.activeElement instanceof HTMLButtonElement ? { job: document.activeElement.dataset.job, action: document.activeElement.dataset.action } : null;
    const cards = visible.map(job => {
      const card = node('article', undefined, 'batch-job'); card.dataset.jobId = job.id;
      if (job.id === highlighted) card.classList.add('batch-job-highlight');
      const header = node('div', undefined, 'batch-job-header');
      header.append(node('h3', batchJobName(job)), node('span', statusLabel(job), `batch-job-badge batch-job-${job.status}`));
      const meta = node('p', `${job.model} · ${job.target} · ${job.retryOf ? `重試 ${job.total} 頁（原 PDF ${job.documentTotal ?? job.total} 頁）` : `PDF 共 ${job.total} 頁`}`, 'batch-job-meta');
      const progress = node('progress'); progress.max = Math.max(1, job.total);
      progress.value = Math.min(job.total, job.status === 'preparing' ? job.prepared : job.processed ?? job.completed + job.failed);
      progress.setAttribute('aria-label', `${batchJobName(job)}處理進度`);
      const counts = node('p', `準備 ${job.prepared}/${job.total} 頁 · OpenAI 已處理 ${job.processed ?? job.completed + job.failed}/${job.total} 頁 · 已快取 ${job.completed} 頁 · 失敗 ${job.failed} 頁`, 'batch-job-counts');
      const times = node('p', `建立 ${date(job.createdAt)}　${job.finishedAt ? `完成 ${date(job.finishedAt)}` : `最近更新 ${date(job.updatedAt)}`}`, 'batch-job-meta');
      card.append(header, meta, progress, counts, times);
      if (job.error || job.notificationError) card.append(node('p', [job.error, job.notificationError].filter(Boolean).join('；'), 'batch-job-error'));
      const details = node('details'); details.dataset.job = job.id; details.open = openDetails.has(job.id);
      details.append(node('summary', '頁面明細與工作編號'));
      details.append(node('p', `工作編號：${job.id}`));
      if (job.retryOf) details.append(node('p', `來源工作：${job.retryOf}；本次頁碼：${job.pageNumbers?.join('、') ?? '—'}`));
      for (const chunk of job.chunks) details.append(node('p', `${chunk.remoteId ?? '尚未取得遠端編號'} · ${chunk.status}${chunk.error ? ` · ${chunk.error}` : ''}`));
      if (job.failedPages?.length) {
        const failures = node('ul');
        for (const page of job.failedPages) failures.append(node('li', `第 ${page.number} 頁：${page.error}`));
        details.append(failures);
      } else if (job.failed) details.append(node('p', '此舊版工作沒有逐頁失敗紀錄，請重新選擇原 PDF 再送出未完成頁面。'));
      card.append(details);
      const actions = node('div', undefined, 'batch-job-actions');
      if (job.status === 'preparing' || hasPendingBatchRemote(job)) {
        const cancel = node('button', '取消工作'); cancel.dataset.job = job.id; cancel.dataset.action = 'cancel';
        cancel.disabled = pending.has(job.id) || job.status === 'cancelled';
        cancel.addEventListener('click', () => { void action(job, 'cancel'); }); actions.append(cancel);
      }
      if (job.failed > 0 && !hasPendingBatchRemote(job) && !job.discardResults) {
        if (job.retryJobId) {
          const related = node('button', '查看重試工作'); related.addEventListener('click', () => { search.value = job.retryJobId!; filter.value = 'all'; render(true); }); actions.append(related);
        } else {
          const retry = node('button', '重試失敗頁面'); retry.dataset.job = job.id; retry.dataset.action = 'retry';
          retry.disabled = pending.has(job.id) || !job.failedPages?.length;
          retry.addEventListener('click', () => { void action(job, 'retry'); }); actions.append(retry);
        }
      }
      card.append(actions);
      return card;
    });
    list.replaceChildren(...(cards.length ? cards : [node('p', jobs.length ? '找不到符合條件的工作。' : '尚無 Batch 工作。選擇 PDF 後，即可送出背景翻譯。', 'batch-jobs-empty')]));
    if (focused?.job && focused.action) [...list.querySelectorAll<HTMLButtonElement>('button')].find(b => b.dataset.job === focused.job && b.dataset.action === focused.action)?.focus({ preventScroll: true });
  }
  async function refresh(): Promise<void> {
    if (loading || disposed) return;
    loading = true;
    try {
      const result = await pdfBatchCommand<PdfBatchSummary[]>('list');
      if (disposed) return;
      jobs = result.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)); render();
    } catch (error) { feedback = String(error); message.textContent = feedback; }
    finally { loading = false; }
  }
  function open(): void { if (!dialog.open) dialog.showModal(); void refresh(); }
  document.querySelector('#batch-jobs-open')!.addEventListener('click', open);
  document.querySelector('#batch-jobs-close')!.addEventListener('click', () => dialog.close());
  document.querySelector('#batch-jobs-refresh')!.addEventListener('click', () => {
    void (async () => {
      const active = jobs.find(j => j.status === 'preparing' || hasPendingBatchRemote(j));
      if (active) await pdfBatchCommand('refresh', { id: active.id });
      await refresh();
    })().catch(error => { feedback = String(error); message.textContent = feedback; });
  });
  search.addEventListener('input', () => render(true)); filter.addEventListener('change', () => render(true));
  const timer = setInterval(() => { if (dialog.open) void refresh(); }, 10000);
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has('jobs') || highlighted) open();
  return { dispose() { disposed = true; clearInterval(timer); if (dialog.open) dialog.close(); } };
}

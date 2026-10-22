import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import { TranslatorCore } from '../content/core/TranslatorCore';
import type { ReadingPageReference, ReadingPageTarget, SiteAdapter } from '../content/core/types';
import { bindContentLifecycle } from '../content/core/contentLifecycle';
import { createContentSessionId, setActiveContentSessionId, toContentSessionPortName } from '../shared/contentSession';
import { getExtensionApi } from '../shared/extensionRuntime';
import { normalizePdfSource } from '../shared/pdfSource';
import { sendExtensionControlCommand, extensionControlPortName, extensionControlChangedEventType, type ExtensionControlChangedEvent } from '../shared/extensionControlTransport';
import { DocumentTranslationMemory } from './documentContext';
import { pdfCacheKey, readCachedPdfPage, saveCachedPdfPage, clearPdfCache } from './translationCache';
import { bindPdfBatchControls } from './pdfBatchControls';
import './style.css';

const api = getExtensionApi();
const resource = (path: string): string => api?.runtime?.getURL?.(`pdfjs/${path}`) ?? `pdfjs/${path}`;
GlobalWorkerOptions.workerSrc = resource('pdf.worker.min.mjs');
const image = document.querySelector<HTMLImageElement>('#pdf-page')!;
const input = document.querySelector<HTMLInputElement>('#file')!;
const pageInput = document.querySelector<HTMLInputElement>('#page')!;
const previous = document.querySelector<HTMLButtonElement>('#previous')!;
const next = document.querySelector<HTMLButtonElement>('#next')!;
const status = document.querySelector<HTMLElement>('#status')!;
const original = document.querySelector<HTMLAnchorElement>('#original')!;
const fitMode = document.querySelector<HTMLSelectElement>('#fit-mode')!;
const cacheState = document.querySelector<HTMLElement>('#cache-state')!;
const clearCache = document.querySelector<HTMLButtonElement>('#clear-cache')!;
const stopButton = document.querySelector<HTMLButtonElement>('#stop')!;
let generation = 0;
let current = 1;
let projection = 0;
let pdf: PDFDocumentProxy | null = null;
let loading: ReturnType<typeof getDocument> | null = null;
let disposeCore: (() => void) | null = null;
let activeCore: TranslatorCore | null = null;
let memory = new DocumentTranslationMemory();
let cacheKey: string | null = null;
let pdfName = '未命名 PDF';
let contentBytes: Uint8Array | null = null;
let cacheRevision = 0;
let cacheWrites: Promise<void> = Promise.resolve();
let notify = (): void => {};
let pages: ReadingPageTarget[] = [];
const originals = new Map<number, { file: File; url: string }>();
const rendering = new Map<number, Promise<{ file: File; url: string }>>();
const batchControls = bindPdfBatchControls({
  snapshot: () => pdf && cacheKey ? { key: cacheKey, total: pdf.numPages, generation, pdfName } : null,
  render: renderPage,
  pageText,
  onCacheReady: () => { void goToPage(current); },
  onBatchMode: () => { activeCore?.cancelReadingTranslation(); },
});

function showStatus(text: string, error = false): void {
  status.textContent = text;
  status.toggleAttribute('data-error', error);
}

/** Render only pages requested by navigation/translation; retain at most 3 originals. */
async function renderPage(number: number): Promise<{ file: File; url: string }> {
  const cached = originals.get(number);
  if (cached) return cached;
  const pending = rendering.get(number);
  if (pending) return pending;
  const document = pdf;
  const epoch = generation;
  if (!document) throw new Error('尚未載入 PDF');
  const task = (async () => {
    const page = await document.getPage(number);
    const natural = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 2400 / Math.max(natural.width, natural.height), Math.sqrt(6_000_000 / (natural.width * natural.height)));
    const viewport = page.getViewport({ scale });
    const canvas = window.document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    try {
      const renderingTask = page.render({ canvas, viewport, background: 'white' });
      renderingTask.onContinue = (resume: () => void) => { window.setTimeout(resume, 0); };
      await renderingTask.promise;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error('無法產生 PDF 頁面影像')), 'image/png',
      ));
      if (epoch !== generation) throw new DOMException('PDF 已切換', 'AbortError');
      const result = { file: new File([blob], `pdf-page-${number}.png`, { type: 'image/png' }), url: URL.createObjectURL(blob) };
      originals.set(number, result);
      for (const [key, entry] of originals) {
        if (originals.size <= 3) break;
        if (key === current || key === number) continue;
        URL.revokeObjectURL(entry.url);
        originals.delete(key);
      }
      return result;
    } finally {
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
  })();
  rendering.set(number, task);
  try { return await task; } finally { if (rendering.get(number) === task) rendering.delete(number); }
}

const pageTexts = new Map<number, Promise<string>>();
function pageText(number: number): Promise<string> {
  if (!pdf || number < 1 || number > pdf.numPages) return Promise.resolve('');
  const cached = pageTexts.get(number);
  if (cached) return cached;
  const task = extractPageText(pdf, number);
  pageTexts.set(number, task);
  if (pageTexts.size > 128) pageTexts.delete(pageTexts.keys().next().value!);
  void task.catch(() => { if (pageTexts.get(number) === task) pageTexts.delete(number); });
  return task;
}
async function extractPageText(document: PDFDocumentProxy, number: number): Promise<string> {
  const page = await document.getPage(number);
  const text = await page.getTextContent();
  let result = '';
  for (const item of text.items) {
    if ('str' in item) result += item.str + ('hasEOL' in item && item.hasEOL ? '\n' : ' ');
    if (result.length >= 4000) break;
  }
  return result.slice(0, 4000);
}

function makeAdapter(epoch: number, scope: string | null): SiteAdapter {
  return {
    getReadingConcurrency: () => Number(document.querySelector<HTMLSelectElement>('#parallel-pages')!.value),
    getCachedReadingPage: async (page) => {
      if (!scope) return null;
      const number = (page.pageIndex ?? 0) + 1;
      const cached = await readCachedPdfPage(scope, number);
      if (cached?.record) memory.remember(number, cached.record);
      return cached?.image ?? null;
    },
    rememberReadingPage: (page, translatedImage, record) => {
      const pageNumber = (page.pageIndex ?? 0) + 1;
      if (record) memory.remember(pageNumber, record);
      if (!scope) return;
      cacheWrites = cacheWrites.then(() => saveCachedPdfPage(scope, pageNumber, translatedImage, record)).then(() => {
        if (epoch === generation && scope === cacheKey) cacheState.textContent = `第 ${pageNumber} 頁譯文已快取，下次可直接顯示。`;
      }).catch((error: unknown) => { if (epoch === generation) cacheState.textContent = `快取無法寫入：${String(error)}；本次譯文仍可閱讀。`; });
    },
    match: () => true,
    findImages: () => [],
    createUiAnchor: () => document.createElement('div'),
    applyImage: () => {},
    observe: (onChange) => { notify = onChange; return () => { notify = () => {}; }; },
    isReadingMode: () => true,
    getReadingContextKey: () => `pdf-document-${epoch}`,
    discoverReadingPages: async () => ({ status: 'complete', pages }),
    getVisiblePages: () => pages[current - 1] ? [pages[current - 1]] : [],
    createBottomBarAnchor: () => document.querySelector<HTMLElement>('#reading-anchor'),
    prepareReadingPage: async (page: ReadingPageReference, signal: AbortSignal) => {
      signal.throwIfAborted();
      const number = (page.pageIndex ?? 0) + 1;
      const priors = Array.from({ length: number - Math.max(1, number - 3) }, (_, i) => Math.max(1, number - 3) + i);
      const [rendered, contextText, previous] = await Promise.all([
        renderPage(number),
        Promise.all([pageText(number), pageText(number - 1), pageText(number + 1)]),
        Promise.all(priors.map(async prior => ({ prior, cached: scope ? await readCachedPdfPage(scope, prior).catch(() => null) : null }))),
      ]);
      signal.throwIfAborted();
      for (const { prior, cached } of previous) if (cached?.record) memory.remember(prior, cached.record);
      return { source: { kind: 'prepared-file', file: rendered.file },
        allowedKinds: ['local-pipeline', 'whole-image'],
        translationContext: memory.context(number, ...contextText as [string, string, string]) };
    },
    applyImageByKey: (key, url) => {
      const page = pages[current - 1];
      if (!page || page.key !== key || epoch !== generation) return;
      const revision = ++projection;
      if (url !== page.originalUrl) { image.src = url; return; }
      const selected = current;
      void renderPage(selected).then((rendered) => {
        if (current === selected && epoch === generation && revision === projection) image.src = rendered.url;
      }).catch((error: unknown) => showStatus(String(error), true));
    },
  };
}

function fitPage(): void {
  const container = document.querySelector<HTMLElement>('#page-container')!;
  const width = Math.max(100, window.innerWidth - 32);
  document.body.dataset.fit = fitMode.value;
  const main = document.querySelector('main')!;
  const availableHeight = Math.max(1, window.innerHeight - main.getBoundingClientRect().top);
  const ratio = image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : .75;
  const heightWidth = availableHeight * ratio;
  container.style.width = `${fitMode.value === 'page' ? Math.min(width, heightWidth) : fitMode.value === 'height' ? heightWidth : width}px`;
}

function startCore(epoch: number): void {
  disposeCore?.();
  const session = createContentSessionId();
  setActiveContentSessionId(session);
  const port = api?.runtime?.connect?.({ name: toContentSessionPortName(session) }) ?? null;
  const core = new TranslatorCore(makeAdapter(epoch, cacheKey), session);
  activeCore = core;
  core.start();
  disposeCore = bindContentLifecycle(core, port);
  stopButton.disabled = false;
}

async function updateCacheScope(settings?: unknown): Promise<void> {
  if (!pdf) return;
  const document = pdf;
  const epoch = generation;
  const revision = ++cacheRevision;
  let selectedSettings = settings;
  if (!selectedSettings) {
    const result = await sendExtensionControlCommand({ kind: 'read' });
    if (result.kind === 'control-projection') selectedSettings = result.projection.settings;
  }
  const bytes = contentBytes ?? await document.getData();
  if (epoch !== generation || revision !== cacheRevision) return;
  contentBytes = bytes;
  const key = await pdfCacheKey(bytes, selectedSettings);
  if (epoch !== generation || revision !== cacheRevision || key === cacheKey) return;
  cacheKey = key;
  batchControls.changed();
  memory = new DocumentTranslationMemory();
  clearCache.disabled = false;
  startCore(epoch);
}

async function goToPage(number: number): Promise<void> {
  if (!pdf || !Number.isFinite(number)) return;
  current = Math.max(1, Math.min(pdf.numPages, Math.trunc(number)));
  ++projection;
  const selected = current;
  const epoch = generation;
  const scope = cacheKey;
  pageInput.value = String(current);
  previous.disabled = current === 1;
  next.disabled = current === pdf.numPages;
  image.hidden = true;
  showStatus(`正在載入第 ${current} 頁…`);
  try {
    const cached = cacheKey ? await readCachedPdfPage(cacheKey, selected).catch(() => null) : null;
    const rendered = cached ? null : await renderPage(selected);
    if (current !== selected || epoch !== generation || scope !== cacheKey) return;
    if (cached) {
      if (cached.record) memory.remember(selected, cached.record);
      const restored = activeCore?.restoreReadingPageTranslation(pages[selected - 1].key, pages[selected - 1].originalUrl, cached.image);
      if (restored) image.src = restored;
      cacheState.textContent = `第 ${selected} 頁已載入快取譯文。`;
    } else {
      image.src = rendered!.url;
      cacheState.textContent = '';
    }
    image.hidden = false;
    showStatus(`第 ${current} / ${pdf!.numPages} 頁。使用上方工具列「翻譯當前頁／全部」按鈕處理 PDF。`);
    notify();
    fitPage();
  } catch (error) {
    if (epoch === generation) showStatus(`頁面載入失敗：${String(error)}`, true);
  }
}

async function openPdf(source: string | File): Promise<void> {
  try { pdfName = typeof source === 'string' ? decodeURIComponent(new URL(source).pathname.split('/').pop() || '線上 PDF') : source.name; }
  catch { pdfName = '線上 PDF'; }
  const epoch = ++generation;
  disposeCore?.();
  disposeCore = null;
  activeCore = null;
  cacheKey = null;
  batchControls.changed();
  contentBytes = null;
  memory = new DocumentTranslationMemory();
  stopButton.disabled = clearCache.disabled = true;
  cacheState.textContent = '';
  const oldLoading = loading;
  loading = null;
  pdf = null;
  pages = [];
  for (const entry of originals.values()) URL.revokeObjectURL(entry.url);
  originals.clear();
  rendering.clear();
  pageTexts.clear();
  image.hidden = true;
  previous.disabled = next.disabled = pageInput.disabled = true;
  document.querySelector('#total')!.textContent = '—';
  original.hidden = typeof source !== 'string';
  if (typeof source === 'string') {
    const url = new URL(source);
    url.hash += `${url.hash ? '&' : ''}shinobu-native=1`;
    original.href = url.href;
  }
  showStatus('正在載入 PDF…');
  try {
    await oldLoading?.destroy();
    const params = typeof source === 'string'
      ? { url: source, withCredentials: true }
      : { data: new Uint8Array(await source.arrayBuffer()) };
    if (epoch !== generation) return;
    const task = getDocument({ ...params, cMapUrl: resource('cmaps/'), cMapPacked: true,
      standardFontDataUrl: resource('standard_fonts/'), wasmUrl: resource('wasm/'),
      iccUrl: resource('iccs/'), useWorkerFetch: true });
    loading = task;
    task.onPassword = (update: (password: string) => void, reason: number) => {
      const password = window.prompt(reason === 2 ? '密碼錯誤，請重新輸入 PDF 密碼' : '請輸入 PDF 密碼');
      if (password === null) { void task.destroy(); showStatus('已取消開啟加密 PDF，請重新選擇檔案。'); }
      else update(password);
    };
    const document = await task.promise;
    if (epoch !== generation) return;
    pdf = document;
    pages = Array.from({ length: document.numPages }, (_, index) => ({
      key: `pdf-${epoch}-${index}`, originalUrl: `pdf-page:${epoch}/${index}`, pageIndex: index,
    }));
    window.document.querySelector('#total')!.textContent = String(document.numPages);
    pageInput.disabled = false;
    pageInput.max = String(document.numPages);
    try { await updateCacheScope(); } catch (error) { cacheState.textContent = `快取暫時無法使用：${String(error)}`; }
    if (epoch !== generation) return;
    if (!activeCore) startCore(epoch);
    await goToPage(1);
  } catch (error) {
    if (epoch === generation) showStatus(`PDF 載入失敗：${String(error)}。本機檔案請按「選擇 PDF」；需登入或無法重新下載的 PDF，請先下載再選取。`, true);
  }
}

input.addEventListener('change', () => { const file = input.files?.[0]; if (file) void openPdf(file); input.value = ''; });
previous.addEventListener('click', () => void goToPage(current - 1));
next.addEventListener('click', () => void goToPage(current + 1));
pageInput.addEventListener('change', () => void goToPage(Number(pageInput.value)));
fitMode.addEventListener('change', fitPage);
image.addEventListener('load', fitPage);
window.addEventListener('resize', fitPage);
new ResizeObserver(fitPage).observe(document.querySelector('#toolbar')!);
new ResizeObserver(fitPage).observe(document.querySelector('#batch-panel')!);
new ResizeObserver(fitPage).observe(status);
new ResizeObserver(fitPage).observe(cacheState);
stopButton.addEventListener('click', () => activeCore?.cancelReadingTranslation());
document.querySelector('#fullscreen')!.addEventListener('click', () => {
  void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch((error: unknown) => showStatus(String(error), true));
});
clearCache.addEventListener('click', () => {
  if (!cacheKey) return;
  const key = cacheKey;
  const epoch = generation;
  activeCore?.cancelReadingTranslation();
  void batchControls.discard(key).then(() => cacheWrites).then(() => clearPdfCache(key)).then(async () => {
    if (generation !== epoch || cacheKey !== key) return;
    memory = new DocumentTranslationMemory();
    startCore(generation);
    await goToPage(current);
    cacheState.textContent = '此 PDF 的快取已清除。';
  }).catch((error: unknown) => { cacheState.textContent = `清除快取失敗：${String(error)}`; });
});
const settingsPort = api?.runtime?.connect?.({ name: extensionControlPortName });
settingsPort?.onMessage.addListener((event) => {
  const changed = event as ExtensionControlChangedEvent;
  if (changed?.type !== extensionControlChangedEventType || !pdf) return;
  const previousKey = cacheKey;
  void updateCacheScope(changed.projection.settings).then(() => {
    if (previousKey !== cacheKey) void goToPage(current);
  }).catch((error: unknown) => { cacheState.textContent = `設定更新失敗：${String(error)}`; });
});
window.addEventListener('pagehide', () => { batchControls.dispose(); ++generation; disposeCore?.(); void loading?.destroy(); for (const item of originals.values()) URL.revokeObjectURL(item.url); });
const source = new URLSearchParams(location.hash.slice(1)).get('source');
if (source) {
  const normalized = normalizePdfSource(source);
  if (normalized) void openPdf(normalized);
  else showStatus('不支援的 PDF 網址，請使用「選擇 PDF」載入檔案。', true);
}

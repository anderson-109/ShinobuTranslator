import { getExtensionApi } from '../../shared/extensionRuntime';
import { bypassPdfReader, isPdfNavigation, normalizePdfSource, pdfReaderUrl } from '../../shared/pdfSource';

/** Chrome's built-in PDF viewer cannot host our content script. */
export function registerPdfNavigation(): void {
  const api = getExtensionApi();
  const reader = api?.runtime?.getURL?.('pdf.html');
  if (!reader || !api?.tabs?.update) return;
  const route = (tabId: number, source: string): void => {
    if (tabId < 0 || !normalizePdfSource(source) || bypassPdfReader(source)) return;
    void api.tabs!.update!(tabId, { url: pdfReaderUrl(reader, source) }).catch(() => {
      // A tab can close or navigate away before the PDF navigation completes.
    });
  };
  api.tabs.onUpdated?.addListener((tabId, change, tab) => {
    const source = change.url ?? tab.url;
    if (change.status === 'complete' && source && isPdfNavigation(source)) route(tabId, source);
  });
  api.webRequest?.onHeadersReceived?.addListener((details) => {
    const headers = details.responseHeaders ?? [];
    const isPdf = headers.some(({ name, value }) => name.toLowerCase() === 'content-type'
      && value?.split(';')[0].trim().toLowerCase() === 'application/pdf');
    const attachment = headers.some(({ name, value }) => name.toLowerCase() === 'content-disposition'
      && /^attachment(?:;|$)/iu.test(value?.trim() ?? ''));
    if (isPdf && !attachment) route(details.tabId, details.url);
  }, { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] }, ['responseHeaders']);
}

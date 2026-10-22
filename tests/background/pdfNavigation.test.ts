import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPdfNavigation } from '../../apps/extension/src/background/pdf/registerPdfNavigation';
import { isPdfNavigation, normalizePdfSource, pdfReaderUrl } from '../../apps/extension/src/shared/pdfSource';

afterEach(() => vi.unstubAllGlobals());

describe('PDF navigation', () => {
  it('recognizes local and remote PDFs without treating query strings as filenames', () => {
    expect(isPdfNavigation('https://example.org/BOOK.PDF?download=1#page=4')).toBe(true);
    expect(isPdfNavigation('file:///C:/Books/book.pdf')).toBe(true);
    expect(isPdfNavigation('https://example.org/view?file=book.pdf')).toBe(false);
    expect(normalizePdfSource('javascript:alert(1)')).toBeNull();
    expect(normalizePdfSource('https://user:password@example.org/book.pdf')).toBeNull();
    const source = 'https://example.org/book.pdf?token=a%26b#page=4';
    expect(new URLSearchParams(new URL(pdfReaderUrl('https://extension.test/pdf.html', source)).hash.slice(1)).get('source')).toBe(source);
  });

  function setup() {
    const update = vi.fn().mockResolvedValue({});
    const onUpdated = vi.fn();
    const onHeadersReceived = vi.fn();
    vi.stubGlobal('chrome', {
      runtime: { getURL: (path: string) => `https://extension.test/${path}` },
      tabs: { update, onUpdated: { addListener: onUpdated } },
      webRequest: { onHeadersReceived: { addListener: onHeadersReceived } },
    });
    registerPdfNavigation();
    return { update, updated: onUpdated.mock.calls[0][0], headers: onHeadersReceived.mock.calls[0][0] };
  }

  it('routes a loaded PDF, preserves its URL and lets the user return to the native viewer', () => {
    const { updated, update } = setup();
    updated(7, { status: 'complete' }, { url: 'file:///C:/Books/book.pdf' });
    expect(update).toHaveBeenCalledWith(7, { url: pdfReaderUrl('https://extension.test/pdf.html', 'file:///C:/Books/book.pdf') });
    update.mockClear();
    updated(7, { status: 'complete' }, { url: 'https://example.org/book.pdf#page=2&shinobu-native=1' });
    updated(7, { status: 'complete' }, { url: 'https://example.org/article' });
    expect(update).not.toHaveBeenCalled();
  });

  it('detects PDFs without a suffix by MIME type and leaves downloads alone', () => {
    const { headers, update } = setup();
    const details = { tabId: 9, url: 'https://example.org/document/123', responseHeaders: [{ name: 'Content-Type', value: 'application/pdf; charset=binary' }] };
    headers(details);
    expect(update).toHaveBeenCalledTimes(1);
    update.mockClear();
    headers({ ...details, responseHeaders: [...details.responseHeaders, { name: 'Content-Disposition', value: 'attachment; filename="book.pdf"' }] });
    headers({ ...details, tabId: -1 });
    expect(update).not.toHaveBeenCalled();
  });
});

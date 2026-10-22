/** Only navigation URLs are accepted; never execute a URL supplied by a PDF. */
export function normalizePdfSource(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:', 'file:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function isPdfNavigation(raw: string): boolean {
  const source = normalizePdfSource(raw);
  return source !== null && /\.pdf$/iu.test(new URL(source).pathname);
}

export function bypassPdfReader(raw: string): boolean {
  return /(?:^#|&)shinobu-native=1(?:&|$)/u.test(new URL(raw).hash);
}

export function pdfReaderUrl(base: string, source?: string): string {
  const url = new URL(base);
  if (source && normalizePdfSource(source)) url.hash = new URLSearchParams({ source }).toString();
  return url.href;
}

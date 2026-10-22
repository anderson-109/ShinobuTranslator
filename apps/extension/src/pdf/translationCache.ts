import type { PipelineRecord } from '@shinobu/image-pipeline';

export type CachedPdfPage = { id: string; documentKey: string; pageNumber: number; image: Blob; record?: PipelineRecord; updatedAt: number };
const databaseName = 'anderson-pdf-translations';
const storeName = 'pages';
const maxBytes = 256 * 1024 * 1024;
let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(storeName, { keyPath: 'id' });
      store.createIndex('documentKey', 'documentKey');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(request.error); };
  });
  return database;
}

export async function pdfCacheKey(bytes: Uint8Array, settings: unknown): Promise<string> {
  const digest = async (data: Uint8Array): Promise<string> => {
    const result = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
    return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  };
  // Settings are the public projection, containing no API keys or login tokens.
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/^(?:apiKey|accessToken|refreshToken|autoTranslate|show.*|enableDebugLog|translationButtonStyle)$/u.test(key))
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, clean(child)]));
    return value;
  };
  const [documentHash, settingsHash] = await Promise.all([digest(bytes), digest(new TextEncoder().encode(JSON.stringify(clean(settings))))]);
  return `v2:${documentHash}:${settingsHash}`;
}

export async function readCachedPdfPage(documentKey: string, pageNumber: number): Promise<CachedPdfPage | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).get(`${documentKey}:${pageNumber}`);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveCachedPdfPage(documentKey: string, pageNumber: number, image: Blob, record?: PipelineRecord): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.put({ id: `${documentKey}:${pageNumber}`, documentKey, pageNumber, image, record, updatedAt: Date.now() } satisfies CachedPdfPage);
    // A cursor avoids reading every cached image into memory during eviction.
    const entries: Array<{ id: string; bytes: number; updatedAt: number }> = [];
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const value = cursor.value as CachedPdfPage;
        entries.push({ id: value.id, bytes: value.image.size, updatedAt: value.updatedAt });
        cursor.continue();
      } else {
        let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
        let count = entries.length;
        for (const entry of entries.sort((a, b) => a.updatedAt - b.updatedAt)) {
          if (bytes <= maxBytes && count <= 500) break;
          store.delete(entry.id);
          bytes -= entry.bytes;
          --count;
        }
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export async function clearPdfCache(documentKey: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const request = tx.objectStore(storeName).index('documentKey').openKeyCursor(documentKey);
    request.onsuccess = () => { const cursor = request.result; if (cursor) { tx.objectStore(storeName).delete(cursor.primaryKey); cursor.continue(); } };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

import { requireExtensionRuntime } from './extensionRuntime';

export async function pdfBatchCommand<T = unknown>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const response = await requireExtensionRuntime().sendMessage<{ ok: boolean; result?: T; error?: string }>({ type: 'anderson:pdf-batch', action, ...extra });
  if (!response?.ok) throw new Error(response?.error ?? 'Batch 背景連線失敗');
  return response.result as T;
}

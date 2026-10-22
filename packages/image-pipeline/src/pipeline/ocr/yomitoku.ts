import type { PipelineCanvas, PlatformProvider } from '../../runtime/platform';
import type { QuadPoint, TextRegion } from '../../types';
import { describeVisionRegions } from '../visionRegionFilter';
import { fillMissingOcrFields, inferDirectionFromQuad } from './provider';
import { mapResultsToRegions } from './index';

export async function runYomitokuOcr(image: PipelineCanvas, regions: TextRegion[], platform: PlatformProvider, signal?: AbortSignal) {
  const recognized: TextRegion[] = [];
  for (let offset = 0; offset < regions.length; offset += 8) {
    signal?.throwIfAborted();
    const batch = regions.slice(offset, offset + 8);
    const crops = await describeVisionRegions(batch, batch, image, platform);
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      if (signal?.aborted) abort();
      const response = await fetch('http://127.0.0.1:8766/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ regions: crops.map(c => ({ id: c.id, imageDataUrl: c.imageDataUrl })) }), signal: controller.signal });
      if (!response.ok) throw new Error(`YomiToku HTTP ${response.status}`);
      const result = await response.json() as { regions?: Array<{ id: string; text: string; confidence: number }> };
      if (!Array.isArray(result.regions) || result.regions.length !== batch.length) throw new Error('YomiToku 回傳的區域數量錯誤');
      const texts = new Map<string, { text: string; confidence: number }>();
      for (const item of result.regions) {
        if (!item || !batch.some(r => r.id === item.id) || texts.has(item.id) || typeof item.text !== 'string' || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) throw new Error('YomiToku 回傳內容無效');
        texts.set(item.id, item);
      }
      const results = batch.map(region => {
        const { x, y, width, height } = region.box;
        const quad: [QuadPoint, QuadPoint, QuadPoint, QuadPoint] = region.quad ?? [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
        return { regionId: region.id, text: texts.get(region.id)!.text.trim(), confidence: texts.get(region.id)!.confidence, quad, direction: region.direction ?? inferDirectionFromQuad(quad) };
      }).filter(r => r.text);
      recognized.push(...mapResultsToRegions(fillMissingOcrFields(results, image, platform), batch));
    } catch (error) {
      signal?.throwIfAborted();
      throw new Error(`YomiToku 無法辨識：${String(error)}。請先執行「啟動YomiToku.cmd」，確認本機服務已就緒。`);
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
  }
  return { regions: recognized, actualProvider: undefined, actualWebnnDeviceType: undefined, debug: undefined };
}

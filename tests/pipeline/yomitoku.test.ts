import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TextRegion } from '../../packages/image-pipeline/src/types';
import type { PipelineCanvas, PlatformProvider } from '../../packages/image-pipeline/src/runtime/platform';
import { normalizeSettings, defaultExtensionSettings } from '../../apps/extension/src/shared/config';
vi.mock('../../packages/image-pipeline/src/pipeline/visionRegionFilter', () => ({ describeVisionRegions: async (regions: TextRegion[]) => regions.map(r => ({ id: r.id, imageDataUrl: 'data:image/jpeg;base64,AA==' })) }));
vi.mock('../../packages/image-pipeline/src/pipeline/ocr/provider', async importOriginal => ({ ...await importOriginal<object>(), fillMissingOcrFields: (results: unknown) => results }));
import { runYomitokuOcr } from '../../packages/image-pipeline/src/pipeline/ocr/yomitoku';
const region: TextRegion = { id: 'r1', box: { x: 10, y: 20, width: 30, height: 40 }, sourceText: '', translatedText: '', prob: .8 };
const image = {} as PipelineCanvas, platform = {} as PlatformProvider;
describe('optional YomiToku OCR', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('preserves the optional engine setting and detector geometry', async () => {
    expect(normalizeSettings({ ...defaultExtensionSettings, ocrEngine: 'yomitoku' }).ocrEngine).toBe('yomitoku');
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ regions: [{ id: 'r1', text: 'こんにちは', confidence: .9 }] })); vi.stubGlobal('fetch', fetch);
    const result = await runYomitokuOcr(image, [region], platform);
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:8766/ocr');
    expect(result.regions[0]).toMatchObject({ id: 'r1', box: region.box, sourceText: 'こんにちは', prob: .9 });
  });
  it('reports a missing local service and rejects mismatched IDs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(runYomitokuOcr(image, [region], platform)).rejects.toThrow('啟動YomiToku.cmd');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ regions: [{ id: 'other', text: 'x', confidence: 1 }] })));
    await expect(runYomitokuOcr(image, [region], platform)).rejects.toThrow('內容無效');
  });
  it('does not issue requests for empty pages or cancelled work', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await runYomitokuOcr(image, [], platform)).regions).toEqual([]);
    const controller = new AbortController(); controller.abort();
    await expect(runYomitokuOcr(image, [region], platform, controller.signal)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

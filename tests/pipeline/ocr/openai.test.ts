import { describe, expect, it, vi } from 'vitest';
import type { TextTranslationTransport } from '@shinobu/text-translation';
import type { PipelineCanvas, PlatformProvider } from '../../../packages/image-pipeline/src/runtime/platform';
import type { TextRegion } from '../../../packages/image-pipeline/src/types';
import { normalizeSettings, toPipelineConfig } from '../../../apps/extension/src/shared/config';
import { runOpenAiOcr } from '../../../packages/image-pipeline/src/pipeline/ocr/openai';

const config = toPipelineConfig(normalizeSettings({
  translator: 'llm', llmProvider: 'openai', ocrEngine: 'openai',
  llmProfiles: { openai: { authMode: 'api_key', modelPreset: 'gpt-4.1-mini' } },
}));
const regions: TextRegion[] = ['a', 'b'].map((id, i) => ({
  id, box: { x: i * 30, y: 0, width: 20, height: 40 },
  sourceText: '', translatedText: '',
}));
const image = { width: 100, height: 100 } as PipelineCanvas;
const platform = {
  createCanvas: vi.fn(() => ({
    getContext: () => ({
      drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray(20 * 40 * 4), width: 20, height: 40 }),
    }),
    toDataURL: () => 'data:image/jpeg;base64,fixture',
    dispose: vi.fn(),
  })),
} as unknown as PlatformProvider;
function transportFor(content: string) {
  return {
    requestChatCompletion: vi.fn().mockResolvedValue({ choices: [{ message: { content } }] }),
    translatePlain: vi.fn(),
  } satisfies TextTranslationTransport;
}

describe('OpenAI OCR', () => {
  it('maps out-of-order responses by ID, skips empty text and keeps geometry', async () => {
    const transport = transportFor(JSON.stringify({ regions: [
      { id: 'b', text: 'こんにちは\n世界' }, { id: 'a', text: '' },
    ] }));
    const result = await runOpenAiOcr(image, regions, config, platform, transport);
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]).toMatchObject({
      id: 'b', box: regions[1].box, sourceText: 'こんにちは\n世界', direction: 'v',
    });
    expect(result.regions[0].prob).toBeUndefined();
    const request = transport.requestChatCompletion.mock.calls[0][0];
    expect(request).toMatchObject({
      body: { model: 'gpt-4.1-mini', response_format: { type: 'json_object' } },
      proxyConfig: { provider: 'openai', authMode: 'api_key' },
    });
    expect(request.body.messages[1].content).toHaveLength(4);
    expect(JSON.stringify(request)).not.toContain('apiKey');
  });

  it.each([
    'not json',
    '{"regions":[]}',
    '{"regions":[{"id":"a","text":"a"},{"id":"a","text":"b"}]}',
    '{"regions":[{"id":"a","text":"a"},{"id":"unknown","text":"b"}]}',
    '{"regions":[{"id":"a","text":42},{"id":"b","text":"b"}]}',
  ])('rejects incomplete or malformed OCR: %s', async (content) => {
    await expect(runOpenAiOcr(image, regions, config, platform, transportFor(content)))
      .rejects.toThrow('OpenAI OCR');
  });

  it('does not send requests when cancelled or there are no regions', async () => {
    const transport = transportFor('{}');
    await runOpenAiOcr(image, [], config, platform, transport);
    const controller = new AbortController();
    controller.abort();
    await expect(runOpenAiOcr(image, regions, config, platform, transport, controller.signal))
      .rejects.toThrow();
    expect(transport.requestChatCompletion).not.toHaveBeenCalled();
  });

  it('propagates authentication errors and refuses OAuth for API OCR', async () => {
    const transport = transportFor('{}');
    transport.requestChatCompletion.mockRejectedValue(new Error('Invalid API key'));
    await expect(runOpenAiOcr(image, regions, config, platform, transport)).rejects.toThrow('Invalid API key');
    await expect(runOpenAiOcr(image, regions, { ...config, llmAuthMode: 'openai_oauth' }, platform, transport))
      .rejects.toThrow('API Key');
  });
});

import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ policies: [] as unknown[] }));
vi.mock('../../apps/extension/src/shared/extensionRuntime', () => ({ installExtensionWorkerRuntime: vi.fn() }));
vi.mock('../../apps/extension/src/shared/extensionModelRuntime', () => ({ createExtensionModelRuntime: vi.fn() }));
vi.mock('../../apps/extension/src/shared/workerPipelinePlatform', () => ({ createOffscreenPlatform: vi.fn() }));
vi.mock('../../apps/extension/src/offscreen/pipelineHost', () => ({
  PipelineHost: class {
    connect() { state.policies.push((globalThis as Record<string, unknown>).__shinobuColdStartStructuredClone); }
  },
}));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); state.policies.length = 0; });

it.each([true, false])('inherits binary transport policy %s before connecting the host', async (enabled) => {
  let receive: (event: { data: unknown }) => void = () => {};
  vi.stubGlobal('addEventListener', (_name: string, listener: typeof receive) => { receive = listener; });
  vi.stubGlobal('postMessage', vi.fn());
  vi.stubGlobal('__shinobuColdStartStructuredClone', !enabled);
  await import('../../apps/extension/src/offscreen/pipeline.worker');
  receive({ data: { kind: 'init', baseUrl: 'https://example.test/', version: '1', structuredClone: enabled } });
  expect(state.policies).toEqual([enabled]);
});

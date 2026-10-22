import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  sent: [] as any[], receive: (_value: any) => {}, disconnect: () => {},
}));
vi.mock('../../apps/extension/src/shared/extensionRuntime', () => ({
  requireExtensionRuntime: () => ({
    connect: () => ({
      postMessage: (value: any) => state.sent.push(value), disconnect: vi.fn(),
      onMessage: { addListener: (listener: typeof state.receive) => { state.receive = listener; } },
      onDisconnect: { addListener: (listener: () => void) => { state.disconnect = listener; } },
    }),
    getURL: () => 'https://example.test/', getVersion: () => 'test', sendMessage: vi.fn(),
  }),
}));
class FakeWorker {
  static all: FakeWorker[] = [];
  listeners = new Map<string, Function>();
  posted: any[] = [];
  constructor() { FakeWorker.all.push(this); }
  addEventListener(name: string, listener: Function) { this.listeners.set(name, listener); }
  postMessage(value: any) { this.posted.push(value); }
  terminate() {}
  emit(payload: any) { this.listeners.get('message')?.({ data: { kind: 'port', payload } }); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); FakeWorker.all = []; state.sent = []; });

it('isolates two active pipelines, reuses a freed worker, and waits for both workers before idle close', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('window', { setTimeout: vi.fn() });
  vi.stubGlobal('__shinobuColdStartStructuredClone', true);
  await import('../../apps/extension/src/offscreen/index');
  const first = FakeWorker.all[0];
  first.emit({ type: 'host-ready', hostInstanceId: 'first' });
  expect(state.sent).toEqual([{ type: 'host-ready', hostInstanceId: 'first', concurrency: 2 }]);
  for (const id of ['one', 'two']) state.receive({ type: 'prepare', jobId: id });
  expect(FakeWorker.all).toHaveLength(2);
  const second = FakeWorker.all[1];
  second.emit({ type: 'host-ready', hostInstanceId: 'second' });
  expect(state.sent).toHaveLength(1);
  expect(first.posted[0].structuredClone).toBe(true);
  expect(second.posted[0].structuredClone).toBe(true);
  state.receive({ type: 'cancel', jobId: 'two' });
  expect(second.posted.at(-1).payload).toEqual({ type: 'cancel', jobId: 'two' });
  expect(first.posted.some(value => value.payload?.type === 'cancel')).toBe(false);
  first.emit({ type: 'complete', jobId: 'one' });
  state.receive({ type: 'prepare', jobId: 'three' });
  expect(first.posted.at(-1).payload.jobId).toBe('three');
  expect(FakeWorker.all).toHaveLength(2);
  first.emit({ type: 'complete', jobId: 'three' });
  first.emit({ type: 'idle-close', hostInstanceId: 'first' });
  expect(state.sent.some(value => value.type === 'idle-close')).toBe(false);
  second.emit({ type: 'error', jobId: 'two' });
  second.emit({ type: 'idle-close', hostInstanceId: 'second' });
  expect(state.sent.at(-1)).toEqual({ type: 'idle-close', hostInstanceId: 'first' });
});

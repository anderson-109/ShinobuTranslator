import { requireExtensionRuntime } from '../shared/extensionRuntime';
import { LOCAL_PIPELINE_HOST_PORT } from '@shinobu/image-pipeline/protocol';

// Relay a bounded pool of independent pipelines; heavy processing stays off the document.
const runtime = requireExtensionRuntime();
function connectWorker(): void {
  const port = runtime.connect(LOCAL_PIPELINE_HOST_PORT);
  const workers: Worker[] = [];
  const routes = new Map<string, Worker>();
  const idle = new Set<Worker>();
  let hostInstanceId: string | undefined;
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    for (const worker of workers) worker.terminate();
    try { port.disconnect(); } catch { /* Already disconnected. */ }
    window.setTimeout(connectWorker, 250);
  };
  const createWorker = (): Worker => {
    const worker = new Worker(new URL('./pipeline.worker.ts', import.meta.url), { type: 'module' });
    workers.push(worker);
    worker.addEventListener('message', (event: MessageEvent) => {
      if (closed) return;
      const message = event.data;
      if (message?.kind === 'port') {
        const payload = message.payload;
        if (payload.type === 'host-ready') {
          if (!hostInstanceId) {
            hostInstanceId = payload.hostInstanceId;
            try { port.postMessage({ ...payload, concurrency: 2 }); } catch { close(); }
          }
          return;
        }
        if (payload.type === 'idle-close') {
          idle.add(worker);
          if (hostInstanceId && idle.size === workers.length && routes.size === 0) {
            try { port.postMessage({ type: 'idle-close', hostInstanceId }); } catch { close(); }
          }
          return;
        }
        if (payload.type === 'complete' || payload.type === 'error') routes.delete(payload.jobId);
        try { port.postMessage(message.payload); } catch { close(); }
      } else if (message?.kind === 'rpc') {
        void runtime.sendMessage(message.payload).then(
          (payload) => { if (!closed) worker.postMessage({ kind: 'rpc-result', id: message.id, payload }); },
          (error: unknown) => { if (!closed) worker.postMessage({ kind: 'rpc-result', id: message.id, error: String(error) }); },
        );
      }
    });
    worker.addEventListener('error', close);
    worker.addEventListener('messageerror', close);
    worker.postMessage({
      kind: 'init', baseUrl: runtime.getURL(''), version: runtime.getVersion(),
      structuredClone: (globalThis as typeof globalThis & { __shinobuColdStartStructuredClone?: boolean }).__shinobuColdStartStructuredClone === true,
    });
    return worker;
  };
  createWorker();
  port.onMessage.addListener((payload) => {
    if (closed || !payload || typeof payload !== 'object' || !('jobId' in payload)) return;
    const message = payload as { type: string; jobId: string };
    let worker = routes.get(message.jobId);
    if (message.type === 'prepare' && !worker) {
      worker = workers.find(candidate => ![...routes.values()].includes(candidate));
      if (!worker && workers.length < 2) worker = createWorker();
      if (worker) { routes.set(message.jobId, worker); idle.delete(worker); }
    }
    if (worker) worker.postMessage({ kind: 'port', payload });
  });
  port.onDisconnect.addListener(close);
}
connectWorker();

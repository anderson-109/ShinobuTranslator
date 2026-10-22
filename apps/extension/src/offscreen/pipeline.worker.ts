import { installExtensionWorkerRuntime } from '../shared/extensionRuntime';
import { createLocalExtensionPortPair } from '../shared/localExtensionPort';
import { FixedPipelineHostTransport } from '../shared/pipelineHostTransport';
import { LOCAL_PIPELINE_HOST_PORT } from '@shinobu/image-pipeline/protocol';
import { createExtensionModelRuntime } from '../shared/extensionModelRuntime';
import { createOffscreenPlatform } from '../shared/workerPipelinePlatform';
import { PipelineHost } from './pipelineHost';

let sequence = 0;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
const [relay, hostPort] = createLocalExtensionPortPair(LOCAL_PIPELINE_HOST_PORT);
relay.onMessage.addListener((payload) => postMessage({ kind: 'port', payload }));
let initialized = false;
globalThis.addEventListener('message', (event: MessageEvent) => {
  const message = event.data;
  if (message?.kind === 'init' && !initialized) {
    initialized = true;
    // Worker bundles do not receive the document's cold-start build banner.
    // Keep the binary transport policy identical on both sides of the relay.
    (globalThis as typeof globalThis & { __shinobuColdStartStructuredClone?: boolean }).__shinobuColdStartStructuredClone = message.structuredClone === true;
    installExtensionWorkerRuntime({ runtime: {
      getURL: (path) => new URL(path, message.baseUrl).href,
      getManifest: () => ({ version: message.version, manifest_version: 3 }),
      sendMessage: (payload, callback) => new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        postMessage({ kind: 'rpc', id, payload });
      }).then((value) => { callback?.(value); return value; }, (error: unknown) => {
        const value = { ok: false, error: String(error) };
        callback?.(value);
        return value;
      }),
    } });
    const host = new PipelineHost(new FixedPipelineHostTransport(hostPort), {
      modelRuntime: createExtensionModelRuntime(),
      platform: createOffscreenPlatform(),
      fontSource: (path) => new URL(path, message.baseUrl).href,
    });
    host.connect();
  } else if (message?.kind === 'port') {
    relay.postMessage(message.payload);
  } else if (message?.kind === 'rpc-result') {
    const task = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) task?.reject(new Error(message.error));
    else task?.resolve(message.payload);
  }
});

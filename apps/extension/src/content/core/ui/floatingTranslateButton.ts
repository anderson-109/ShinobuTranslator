import { createIcon } from './icons';

/** A page-level entry point; PDF reader actions remain in their own toolbar. */
export function mountFloatingTranslateButton(start: () => Promise<void>): () => void {
  if (window.top !== window || !/^https?:$/.test(location.protocol)) return () => {};
  document.getElementById('anderson-translator-launcher')?.remove();
  const host = document.createElement('div');
  host.id = 'anderson-translator-launcher';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial !important; position: fixed !important; right: max(12px, env(safe-area-inset-right)) !important; top: 50% !important; transform: translateY(-50%) !important; z-index: 2147483646 !important; display: block !important; color-scheme: light; }
    :host([hidden]) { display: none !important; }
    button { box-sizing: border-box; display: grid; place-items: center; width: 48px; height: 48px; padding: 10px; border: 2px solid #fff; border-radius: 50%; background: #7954ce; color: #fff; opacity: 1; box-shadow: 0 3px 14px #29144838; cursor: pointer; }
    button:hover { background: #6541b5; }
    button:focus-visible { outline: 3px solid #b8a0ee; outline-offset: 3px; }
    svg { display: block; width: 25px; height: 25px; }
    .message { position: absolute; right: 58px; top: 0; width: max-content; max-width: min(280px, calc(100vw - 90px)); padding: 10px 12px; border: 1px solid #d7cbe9; border-radius: 10px; background: #fff; color: #382a49; box-shadow: 0 2px 10px #29144820; font: 13px/1.5 system-ui, sans-serif; overflow-wrap: anywhere; }
    .message:empty { display: none; }
  `;
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', '選取範圍翻譯');
  button.title = '選取範圍翻譯（Esc 可取消）';
  const icon = createIcon('translate');
  icon.setAttribute('aria-hidden', 'true');
  button.appendChild(icon);
  const message = document.createElement('div');
  message.className = 'message';
  message.setAttribute('role', 'status');
  root.append(style, button, message);
  let disposed = false, running = false;
  const activate = (): void => {
    if (running || disposed) return;
    running = true;
    message.textContent = '';
    // Keep this control out of the user's selection and captured image.
    host.hidden = true;
    void Promise.resolve().then(start).catch(() => {
      if (!disposed) message.textContent = '無法啟動翻譯，請重新整理頁面後再試。';
    }).finally(() => {
      running = false;
      if (!disposed) host.hidden = false;
    });
  };
  button.addEventListener('click', activate);
  document.documentElement.appendChild(host);
  return () => {
    disposed = true;
    button.removeEventListener('click', activate);
    host.remove();
  };
}

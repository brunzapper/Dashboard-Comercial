import { schedulePreviewIdle } from "./queue";

/** Remove execução e recorta widgets fora da janela antes de guardar o DOM. */
export function snapshotDocument(source: Document, width: number, height: number): string {
  const copyVisible = (node: Node): Node | null => {
    // O documento é de outro realm: instanceof Element não funciona aqui.
    const element = node.nodeType === 1 ? node as Element : null;
    if (element?.matches("script,noscript,iframe,object,embed,base,meta[http-equiv],link:not([rel='stylesheet'])")) return null;
    if (element?.classList.contains("react-grid-item")) {
      const rect = element.getBoundingClientRect();
      if (rect.top >= height || rect.left >= width || rect.bottom <= 0 || rect.right <= 0) return null;
    }
    // Descarta widgets fora da janela ANTES de copiar tabelas e árvores grandes.
    const copy = node.cloneNode(false);
    if (element) for (const attr of [...element.attributes]) {
      if (/^on/i.test(attr.name) || /^(?:javascript|vbscript):/i.test(attr.value.trim())) (copy as Element).removeAttribute(attr.name);
    }
    for (const child of node.childNodes) {
      const cloned = copyVisible(child);
      if (cloned) copy.appendChild(cloned);
    }
    return copy;
  };
  const clone = copyVisible(source.documentElement) as HTMLElement;
  const head = clone.querySelector("head")!;
  const base = source.createElement("base");
  base.href = source.baseURI;
  head.prepend(base);
  const style = source.createElement("style");
  style.textContent = "html,body{margin:0;overflow:hidden!important}*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
  head.append(style);
  clone.querySelector("body")?.setAttribute("inert", "");
  return "<!doctype html>" + clone.outerHTML;
}

/** Iframe temporário: a captura estática não hidrata React nem executa actions. */
export function capturePreview(host: HTMLElement, url: string, width: number, height: number, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.title = "Preparando prévia";
    frame.tabIndex = -1;
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px;border:0;opacity:0;pointer-events:none;`;
    let observer: MutationObserver | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let cancelIdle: (() => void) | undefined;
    let done = false;
    const cleanup = () => {
      done = true;
      observer?.disconnect();
      clearInterval(poll);
      clearTimeout(timeout);
      cancelIdle?.();
      signal.removeEventListener("abort", abort);
      frame.remove();
    };
    const fail = (error: Error) => { if (!done) { cleanup(); reject(error); } };
    const abort = () => fail(new DOMException("Prévia cancelada", "AbortError"));
    const timeout = setTimeout(() => fail(new Error("Prévia indisponível")), 25_000);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    frame.onerror = () => fail(new Error("Prévia indisponível"));
    frame.onload = () => {
      if (done) return;
      const doc = frame.contentDocument;
      if (!doc) { fail(new Error("Prévia indisponível")); return; }
      if (doc.location.pathname !== new URL(url, location.href).pathname) {
        fail(new Error("Prévia indisponível")); return;
      }
      let changedAt = performance.now();
      observer = new MutationObserver(() => { changedAt = performance.now(); });
      observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      poll = setInterval(() => {
        if (done || cancelIdle || !doc.querySelector('[data-preview-ready="true"]') ||
          doc.querySelector('[aria-busy="true"], .animate-spin') ||
          doc.fonts?.status === "loading" || performance.now() - changedAt < 400) return;
        cancelIdle = schedulePreviewIdle(() => {
          if (done || signal.aborted) return;
          if (performance.now() - changedAt < 400 || doc.querySelector('[aria-busy="true"], .animate-spin')) {
            cancelIdle = undefined;
            return;
          }
          try {
            const html = snapshotDocument(doc, width, height);
            cleanup();
            resolve(html);
          } catch { fail(new Error("Prévia indisponível")); }
        });
      }, 150);
    };
    frame.src = url;
    host.append(frame);
  });
}

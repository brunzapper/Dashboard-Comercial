import { previewIsReady } from "./readiness";
import { thumbnail } from "./capture";
import { PREVIEW_SIZE, PREVIEW_FORMAT } from "./geometry";

/** Preparação inicial autenticada, automática ou pela tela de manutenção. */
export async function prepareInitialPreview(host: HTMLElement, id: string, signal: AbortSignal) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1440px;height:900px;border:0";
  frame.title = "Preparação inicial";
  let observer: MutationObserver | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let changed = performance.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      abort = () => reject(new DOMException("Cancelado", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      timeout = setTimeout(() => reject(new Error("Dashboard ainda não está pronto")), 90_000);
      const finish = () => { clearTimeout(timeout); signal.removeEventListener("abort", abort!); resolve(); };
      frame.onload = () => {
        const doc = frame.contentDocument;
        if (!doc || doc.location.pathname !== `/dashboards/${id}/preview`) {reject(new Error("Sessão sem acesso ao dashboard"));return;}
        const main = doc.querySelector<HTMLElement>("main[data-app-main]");
        if (!main) return;
        observer = new MutationObserver(() => { changed = performance.now(); });
        observer.observe(doc.body, { subtree:true,childList:true,attributes:true,characterData:true });
        poll = setInterval(() => {
          if (doc.querySelector('[data-preview-ready="true"]') && previewIsReady(main) && performance.now()-changed > 750) finish();
        },200);
      };
      if (signal.aborted) { clearTimeout(timeout); abort(); return; }
      frame.src = `/dashboards/${id}/preview`; host.append(frame);
    });
    observer?.disconnect(); clearInterval(poll);
    const main = frame.contentDocument!.querySelector<HTMLElement>("main[data-app-main]")!;
    return { image: await thumbnail(main,signal), width:PREVIEW_SIZE, height:PREVIEW_SIZE, format:PREVIEW_FORMAT };
  } finally { observer?.disconnect(); clearInterval(poll); clearTimeout(timeout); if(abort)signal.removeEventListener("abort",abort); frame.remove(); }
}

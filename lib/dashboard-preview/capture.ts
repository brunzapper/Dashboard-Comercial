import { PREVIEW_SIZE, previewCrop } from "./geometry";

/** Captura apenas o main já renderizado. Não abre páginas nem dispara consultas. */
export async function snapshotMain(source: HTMLElement, signal: AbortSignal): Promise<string> {
  const doc = source.ownerDocument;
  const viewport = previewCrop(source);
  let nodes = 0;
  const copyVisible = async (node: Node): Promise<Node | null> => {
    if (signal.aborted) throw new DOMException("Prévia cancelada", "AbortError");
    if (++nodes % 150 === 0) {
      // Cede a thread entre blocos: cliques e navegação podem abortar a captura.
      await new Promise(resolve => setTimeout(resolve, 0));
      if (signal.aborted) throw new DOMException("Prévia cancelada", "AbortError");
    }
    if (nodes > 12_000) throw new Error("Prévia excede o limite de complexidade");
    const element = node.nodeType === 1 ? node as Element : null;
    if (element?.matches("script,noscript,iframe,object,embed,base,meta,link,style,[data-preview-exclude]")) return null;
    if (element?.classList.contains("react-grid-item")) {
      const rect = element.getBoundingClientRect();
      if (rect.top >= viewport.bottom || rect.left >= viewport.right || rect.bottom <= viewport.top || rect.right <= viewport.left) return null;
    }
    const copy = node.cloneNode(false);
    if (element) for (const attr of [...element.attributes]) {
      if (/^on/i.test(attr.name) || /^(?:javascript|vbscript):/i.test(attr.value.trim())) (copy as Element).removeAttribute(attr.name);
    }
    for (const child of node.childNodes) {
      const cloned = await copyVisible(child);
      if (cloned) copy.appendChild(cloned);
    }
    return copy;
  };
  const main = await copyVisible(source) as HTMLElement;
  main.style.cssText += `;position:relative;flex:none;width:${viewport.width}px;height:${viewport.side}px;overflow:hidden;`;
  const root = doc.documentElement.cloneNode(false) as HTMLElement;
  const head = doc.createElement("head"), body = doc.createElement("body");
  // CSS inline: a captura sobrevive a novos deploys sem solicitar chunks antigos.
  const styles: string[] = [];
  for (const sheet of doc.styleSheets) {
    try { styles.push([...sheet.cssRules].map(rule => rule.cssText).join("\n")); }
    catch { /* CSS cross-origin não é copiado. O app usa folhas same-origin. */ }
  }
  const style = doc.createElement("style");
  style.textContent = styles.join("\n") + "\nhtml,body{margin:0;display:block;overflow:hidden!important}*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
  const base = doc.createElement("base"); base.href = doc.baseURI;
  head.append(base, style);
  body.style.width = `${viewport.width}px`;
  body.setAttribute("inert", ""); body.append(main); root.append(head, body);
  return "<!doctype html>" + root.outerHTML;
}

/** Rasterização nativa: cópia do recorte inicial vira uma WebP de até 40 KB.
 * Sem clone de estilos computados por nó, iframe vivo ou engine adicional. */
export async function thumbnail(main: HTMLElement, signal: AbortSignal): Promise<string> {
  const { width, side } = previewCrop(main);
  if (side <= 0) throw new Error("Área de captura vazia");
  const html = await snapshotMain(main, signal);
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelector("base")?.remove();
  // Recursos de imagem devem estar prontos e embutidos: SVG usado como imagem
  // não pode buscar sub-recursos. Falha conserva a captura anterior.
  for (const image of doc.querySelectorAll("img")) {
    const url = new URL(image.getAttribute("src") ?? "", main.ownerDocument.baseURI);
    if (url.protocol === "data:") continue;
    const response = await fetch(url, { signal, priority: "low" });
    if (!response.ok) throw new Error("Imagem incompleta");
    const blob = await response.blob();
    image.src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject; reader.readAsDataURL(blob);
    });
    image.removeAttribute("srcset");
  }
  // Fontes externas não são necessárias à identificação dos widgets. Os
  // tamanhos/posições permanecem; evita baixar/embutir centenas de KB de fontes.
  const style = doc.createElement("style");
  style.textContent = "*{font-family:Arial,sans-serif!important}.react-resizable-handle,[data-preview-exclude]{visibility:hidden!important}";
  doc.head.append(style);
  const xml = new XMLSerializer().serializeToString(doc.documentElement);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${side}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`;
  const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  if (signal.aborted) throw new DOMException("Cancelado", "AbortError");
  const canvas = document.createElement("canvas");
  canvas.width = PREVIEW_SIZE; canvas.height = PREVIEW_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível");
  ctx.drawImage(image, 0, 0, side, side, 0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
  let result = canvas.toDataURL("image/webp", 0.45);
  if (result.length > 53_356) result = canvas.toDataURL("image/webp", 0.25);
  if (!result.startsWith("data:image/webp;") || result.length > 53_356) throw new Error("Imagem excede limite");
  return result;
}

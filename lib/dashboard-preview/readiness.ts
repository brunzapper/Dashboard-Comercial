/** Só o recorte inicial precisa estar pronto; widgets lazy fora dele não bloqueiam. */
export function previewIsReady(main: HTMLElement) {
  if (main.scrollTop || main.scrollLeft || main.ownerDocument.defaultView?.scrollY) return false;
  const viewport = main.getBoundingClientRect();
  const visible = (element: Element) => {
    const r = element.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top < viewport.bottom && r.bottom > viewport.top && r.left < viewport.right && r.right > viewport.left;
  };
  for (const element of main.querySelectorAll('[aria-busy="true"],.animate-spin,[role="dialog"],img')) {
    if (!visible(element)) continue;
    if (element.tagName !== "IMG") return false;
    const image = element as HTMLImageElement;
    if (!image.complete || !image.naturalWidth) return false;
  }
  return ![...main.querySelectorAll("*")].some(el => visible(el) && (el.scrollTop > 0 || el.scrollLeft > 0));
}

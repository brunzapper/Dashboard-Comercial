/** Cache privado da sessão JS: não persiste dados de dashboards no disco. */
export class PreviewCache {
  private entries = new Map<string, { html: string; at: number }>();
  private bytes = 0;
  constructor(private maxBytes = 12 * 1024 * 1024, private maxAge = 30 * 60_000) {}

  get(key: string, now = Date.now()): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (now - entry.at > this.maxAge) { this.delete(key); return; }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.html;
  }

  set(key: string, html: string, now = Date.now()) {
    this.delete(key);
    // Strings JS usam até dois bytes por unidade UTF-16.
    if (html.length * 2 > this.maxBytes) return;
    this.entries.set(key, { html, at: now });
    this.bytes += html.length * 2;
    while (this.bytes > this.maxBytes) this.delete(this.entries.keys().next().value!);
  }

  private delete(key: string) {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.html.length * 2;
    this.entries.delete(key);
  }
}

export function previewCacheKey(scope: string, id: string, revision: string, width: number, height: number, theme: string) {
  return JSON.stringify([scope, id, revision, width, height, theme]);
}

export const previewCache = new PreviewCache();

// Versão: 1.0 | Data: 31/07/2026
// Fingerprint curto da CONFIG de um widget para o gatilho de re-busca dos
// widgets DEFERIDOS (Tabela Livre/kanban/engine em lote). O deferredScopeById
// da page cobria só período/filtros/__pw__ — editar a config do widget
// (métrica/dimensão/filtro/settings) não mudava a chave e o effect do cliente
// NÃO re-buscava: o payload velho ficava na tela até F5. A config entra aqui
// como hash djb2 (base36) das colunas de CONFIG — `grid_position`/`sort_order`
// ficam FORA por construção: mover/redimensionar não dispara re-busca do lote.
export interface WidgetConfigLike {
  title?: unknown;
  visual_type?: unknown;
  source?: unknown;
  sources?: unknown;
  split_by_source?: unknown;
  dimensions?: unknown;
  metrics?: unknown;
  filters?: unknown;
  settings?: unknown;
}

export function widgetConfigFingerprint(w: WidgetConfigLike): string {
  const payload = JSON.stringify([
    w.title ?? null,
    w.visual_type ?? null,
    w.source ?? null,
    w.sources ?? null,
    w.split_by_source ?? null,
    w.dimensions ?? null,
    w.metrics ?? null,
    w.filters ?? null,
    w.settings ?? null,
  ]);
  // djb2: barato e suficiente p/ fingerprint de gatilho (colisão só custaria
  // uma re-busca a menos num caso astronômico — nunca corrompe dado).
  let hash = 5381;
  for (let i = 0; i < payload.length; i++) {
    hash = ((hash << 5) + hash + payload.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

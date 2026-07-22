// Versão: 1.0 | Data: 22/07/2026
// Opções ocultas dos dropdowns de filtro (Filtro por campo + filtros rápidos):
// helper puro compartilhado entre field-filter-controls e quick-filters-bar.
//
// - A config é uma BLACKLIST por entry (`hiddenOptions` em FieldFilterEntry/
//   QuickFilterEntry, lib/widgets/types.ts): opção nova (novo responsável,
//   options do pipeline reescritas no sync) entra visível por padrão.
// - SÓ exibição: nunca altera a consulta. Um valor selecionado que ficou
//   oculto segue aplicando e permanece na lista (conjunto `keep`) para o
//   rótulo do chip resolver e o usuário conseguir desmarcá-lo.
// - A filtragem é client-side de propósito: o viewer de snapshot congela
//   widgets.settings inteiro (cfg.widgets) e monta os MESMOS componentes,
//   então herda o comportamento sem mudança nos arquivos de snapshot.

/** Remove da lista as opções ocultas, preservando as em `keep` (selecionadas). */
export function visibleOptions<T extends { value: string }>(
  options: T[],
  hidden?: string[],
  keep?: Iterable<string>
): T[] {
  if (!hidden || hidden.length === 0) return options;
  const h = new Set(hidden);
  const k = new Set(keep ?? []);
  return options.filter((o) => !h.has(o.value) || k.has(o.value));
}

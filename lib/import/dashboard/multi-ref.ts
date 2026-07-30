// Versão: 1.0 | Data: 30/07/2026
// MESCLA de referências no modo "Criar a partir de" (multi-referência): funde
// os exports das referências ADICIONAIS (além da base, que será COPIADA) no
// material que a geração por IA consome — keys de widget prefixadas `rN_`
// (N = índice da referência, a base é a "referência 1") para nunca colidir com
// as keys da base, `settings.tab` removida (aba de OUTRO board: preservada, o
// validador moveria o widget para a 1ª aba mantendo um grid alienígena →
// sobreposição; o rewrite empilha cópias sem aba abaixo do conteúdo real),
// união das bases (o prompt cobre o catálogo de campos de todas) e uma section
// de prompt por referência. Puro, sem I/O — as extras existem SÓ na geração:
// o `copy_of` é resolvido por normalizeImportRaw (refWidgets) ANTES do apply,
// então applyFromReference/duplicateBoard seguem intocados e keys `rN_` nunca
// chegam ao validador em operação normal.

import type { DashboardImportJson, ImportWidgetSpec } from "./types";
import type { WidgetSettings } from "@/lib/widgets/types";

/** Máximo de referências ADICIONAIS (além da base) numa mescla. */
export const MAX_EXTRA_REFS = 4;

export interface ExtraRefInput {
  /** Nome do dashboard de referência (título da section do prompt). */
  name: string;
  /** Export do board (exportDashboardJson(...).json). */
  json: DashboardImportJson;
}

export interface MultiRefFusion {
  /** União ordenada: bases da BASE ∪ bases das extras (dedup). */
  bases: string[];
  /** Widgets das extras com key prefixada `rN_` e `settings.tab` removida —
   * catálogo de origem do `copy_of` (rewrite.refWidgets) E fonte das sections
   * (mesmos objetos, 1:1 — um rename de dedup vale nos dois lugares). */
  refWidgets: ImportWidgetSpec[];
  /** Uma section de prompt por extra, na ordem de seleção (N começa em 2). */
  sections: { title: string; body: string }[];
}

/** Funde os exports das referências adicionais no material da geração. */
export function fuseExtraReferences(
  base: { bases: string[]; widgetKeys: Iterable<string> },
  extras: ExtraRefInput[]
): MultiRefFusion {
  // Keys já ocupadas (base + extras anteriores): colisão ganha sufixo `_2`,
  // `_3`… — a mesma convenção de assignWidgetKeys (export.ts).
  const used = new Set<string>(base.widgetKeys);
  const basesSet = new Set<string>(base.bases);
  const refWidgets: ImportWidgetSpec[] = [];
  const sections: { title: string; body: string }[] = [];

  extras.forEach((extra, i) => {
    const n = i + 2;
    for (const b of extra.json.bases ?? []) basesSet.add(b);
    const specs = (extra.json.widgets ?? []).map((w, idx) => {
      // Export sempre emite key; o fallback posicional é só robustez.
      const rawKey =
        typeof w.key === "string" && w.key ? w.key : `w${idx + 1}`;
      let key = `r${n}_${rawKey}`;
      if (used.has(key)) {
        let dedup = 2;
        while (used.has(`${key}_${dedup}`)) dedup++;
        key = `${key}_${dedup}`;
      }
      used.add(key);
      const spec: ImportWidgetSpec = { ...w, key };
      if (spec.settings && typeof spec.settings === "object") {
        const s = { ...(spec.settings as Record<string, unknown>) };
        delete s.tab; // aba de OUTRO board (ver cabeçalho)
        if (Object.keys(s).length > 0) {
          spec.settings = s as WidgetSettings;
        } else {
          delete spec.settings;
        }
      }
      return spec;
    });
    refWidgets.push(...specs);
    sections.push({
      title: `REFERÊNCIA ADICIONAL ${n} — "${extra.name}" (JSON)`,
      body: JSON.stringify({ dashboard: extra.name, widgets: specs }, null, 2),
    });
  });

  return { bases: [...basesSet].sort(), refWidgets, sections };
}

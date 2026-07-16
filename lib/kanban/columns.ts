// Versão: 1.0 | Data: 16/07/2026
// Derivação das COLUNAS de um kanban (D2 do plano): colunas são configuração de
// visão, não dados — derivadas do campo/bucket + overrides em settings.columns
// (ordem do array = ordem das colunas; label/color/hidden/wip por chave).
//   - selecao: ordem de field_definitions.options (+ valores fora da lista);
//   - texto livre (stage etc.): valores distintos por frequência, com teto
//     (KANBAN_MAX_COLUMNS) e estouro em "Outros" (sem drop);
//   - weekday/month_name: conjuntos fixos PT-BR; month_year: meses presentes;
//   - tarefas: fases de settings.columns (seed DEFAULT_TASK_PHASES).
// Coluna "Sem valor"/"Sem data" (KANBAN_NO_VALUE_KEY) fecha o quadro.
import type { FieldDefinition } from "@/lib/records/types";
import { MONTH_NAMES_PT, WEEKDAY_NAMES_PT } from "@/lib/widgets/date-buckets";
import {
  DEFAULT_TASK_PHASES,
  KANBAN_MAX_COLUMNS,
  KANBAN_NO_VALUE_KEY,
  KANBAN_OVERFLOW_KEY,
  type KanbanColumn,
  type KanbanColumnOverride,
  type KanbanSettings,
} from "./types";

// Aplica ordem + overrides às colunas derivadas: primeiro as chaves presentes
// em `overrides` (na ordem salva), depois as novas (ordem natural). Ocultas
// saem; "Sem valor" e "Outros" ficam sempre no fim.
function applyOverrides(
  base: KanbanColumn[],
  overrides: KanbanColumnOverride[] | undefined
): KanbanColumn[] {
  const byKey = new Map(base.map((c) => [c.key, c] as const));
  const out: KanbanColumn[] = [];
  const used = new Set<string>();
  for (const ov of overrides ?? []) {
    const col = byKey.get(ov.key);
    if (!col) continue; // override órfão (valor sumiu) — ignora
    used.add(ov.key);
    if (ov.hidden) continue;
    out.push({
      ...col,
      label: ov.label?.trim() || col.label,
      color: ov.color ?? col.color,
      wipLimit: ov.wipLimit ?? col.wipLimit,
      completesTask: ov.completesTask ?? col.completesTask,
    });
  }
  for (const col of base) {
    if (used.has(col.key)) continue;
    out.push(col);
  }
  // Especiais sempre no fim (ordem: Outros, Sem valor).
  const special = (k: string) =>
    k === KANBAN_NO_VALUE_KEY ? 2 : k === KANBAN_OVERFLOW_KEY ? 1 : 0;
  return out.sort((a, b) => special(a.key) - special(b.key));
}

/**
 * Deriva as colunas do quadro a partir da config + dos valores presentes.
 * `groupKeys` são as chaves de grupo já calculadas por card (inclui
 * KANBAN_NO_VALUE_KEY); `fieldDef` é a definição do campo de agrupamento
 * quando é um custom (p/ ordem de options em selecao).
 */
export function deriveColumns(
  settings: KanbanSettings,
  groupKeys: string[],
  fieldDef?: FieldDefinition | null
): KanbanColumn[] {
  if (settings.mode === "tarefas") {
    const phases =
      settings.columns && settings.columns.length > 0
        ? settings.columns
        : DEFAULT_TASK_PHASES;
    // Fases vêm INTEIRAS dos overrides (são a própria definição das colunas).
    const base: KanbanColumn[] = phases
      .filter((p) => !p.hidden)
      .map((p) => ({
        key: p.key,
        label: p.label?.trim() || p.key,
        color: p.color,
        wipLimit: p.wipLimit,
        completesTask: p.completesTask,
      }));
    return base;
  }

  const counts = new Map<string, number>();
  for (const k of groupKeys) counts.set(k, (counts.get(k) ?? 0) + 1);
  const hasNoValue = counts.has(KANBAN_NO_VALUE_KEY);

  let base: KanbanColumn[] = [];

  if (settings.dateBucket === "weekday") {
    base = WEEKDAY_NAMES_PT.map((label, i) => ({ key: `w${i + 1}`, label }));
  } else if (settings.dateBucket === "month_name") {
    base = MONTH_NAMES_PT.map((label, i) => ({ key: `m${i + 1}`, label }));
  } else if (settings.dateBucket === "month_year") {
    // Meses presentes nos dados, em ordem cronológica (chave 'YYYY-M').
    const seen = [...counts.keys()].filter((k) => /^\d{4}-\d{1,2}$/.test(k));
    seen.sort((a, b) => {
      const [ay, am] = a.split("-").map(Number);
      const [by, bm] = b.split("-").map(Number);
      return ay * 12 + am - (by * 12 + bm);
    });
    base = seen.map((key) => {
      const [y, m] = key.split("-").map(Number);
      return { key, label: `${MONTH_NAMES_PT[m - 1]}/${String(y).slice(-2)}` };
    });
  } else {
    // Agrupamento por VALOR: options do selecao primeiro (ordem da definição),
    // depois os demais valores distintos por frequência, com teto + "Outros".
    const fromOptions =
      fieldDef?.data_type === "selecao" ? (fieldDef.options ?? []) : [];
    const extras = [...counts.keys()]
      .filter(
        (k) =>
          k !== KANBAN_NO_VALUE_KEY &&
          k !== KANBAN_OVERFLOW_KEY &&
          !fromOptions.includes(k)
      )
      .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
    const keys = [...fromOptions, ...extras];
    const visible = keys.slice(0, KANBAN_MAX_COLUMNS);
    base = visible.map((k) => ({ key: k, label: k }));
    if (keys.length > visible.length) {
      base.push({
        key: KANBAN_OVERFLOW_KEY,
        label: "Outros",
        noDrop: true,
      });
    }
  }

  if (hasNoValue || settings.dateBucket) {
    base.push({
      key: KANBAN_NO_VALUE_KEY,
      label: settings.dateBucket ? "Sem data" : "Sem valor",
    });
  }

  return applyOverrides(base, settings.columns);
}

/** Chaves visíveis → cards de valores estourados caem em "Outros". */
export function resolveCardColumn(
  groupKey: string,
  columns: KanbanColumn[]
): string | null {
  if (columns.some((c) => c.key === groupKey)) return groupKey;
  if (columns.some((c) => c.key === KANBAN_OVERFLOW_KEY)) {
    return KANBAN_OVERFLOW_KEY;
  }
  // Coluna oculta (override hidden): card fora do quadro.
  return null;
}

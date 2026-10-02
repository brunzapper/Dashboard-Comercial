// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): CONVERSOR da antiga Tabela de metas (visual_type 'metas',
//   `settings.goalTable`) para a Tabela Livre (`settings.quickTable` com
//   colunas de meta e linhas ligadas a indicador) — módulo PURO e client-safe.
//
// A Tabela Livre absorveu a Tabela de metas: o tipo 'metas' saiu do seletor e
// os widgets existentes são convertidos NA LEITURA (page, widget-scope, save de
// células, viewer de snapshot) por `normalizeLegacyWidget`. Nada é migrado no
// banco: o widget vira 'tabela_editavel' de verdade na primeira vez que alguém
// salvar a estrutura dele.
//
// Os IDS são FIXOS (`qc_g_label`, `qc_g_meses`, `qc_g_total`, `qr_g<i>`,
// `qr_g_total`) porque a conversão roda em memória a CADA carga: um id novo a
// cada vez mudaria as chaves de célula e de aparência (largura de coluna,
// cores) entre um carregamento e outro. O mesmo conversor serve ao preset e ao
// import da IA (`goalTable` segue aceito como atalho).
import type {
  GoalTableSettings,
  QuickTableColumn,
  QuickTableRow,
  QuickTableSettings,
  Widget,
  WidgetSettings,
} from "@/lib/widgets/types";

type QuickTable = NonNullable<QuickTableSettings["quickTable"]>;

export const GOAL_LABEL_COL_ID = "qc_g_label";
export const GOAL_MONTHS_COL_ID = "qc_g_meses";
export const GOAL_TOTAL_COL_ID = "qc_g_total";
export const GOAL_TOTAL_ROW_ID = "qr_g_total";

/** "N1 MRR novo" → { tag: "N1", text: "MRR novo" } (só o legado usa). */
function splitLegacyTag(label: string): { tag: string | null; text: string } {
  const m = /^(N\d{1,2})\s+(.+)$/.exec(label.trim());
  return m ? { tag: m[1], text: m[2] } : { tag: null, text: label };
}

export function goalTableToQuickTable(gt: GoalTableSettings | undefined): QuickTable {
  const s = gt ?? {};
  const byResp = s.mode === "por_responsavel";
  const columns: QuickTableColumn[] = [
    {
      id: GOAL_LABEL_COL_ID,
      kind: "rowLabel",
      header: s.headerLabel ?? (byResp ? "Responsável" : "Indicador"),
    },
    {
      id: GOAL_MONTHS_COL_ID,
      kind: "goal",
      ...(s.months && s.months.length > 0 ? { months: [...s.months] } : {}),
    },
    ...(s.totalColumn === false
      ? []
      : [
          {
            id: GOAL_TOTAL_COL_ID,
            kind: "goalTotal" as const,
            header: "Total",
            of: GOAL_MONTHS_COL_ID,
          },
        ]),
  ];
  const rows: QuickTableRow[] = [];
  if (byResp) {
    if (s.indicator) {
      (s.responsibles ?? []).forEach((name, i) => {
        rows.push({
          id: `qr_g${i}`,
          label: name,
          bind: { kind: "indicator", indicator: s.indicator!, responsible: name },
        });
      });
    }
    if (s.totalRowLabel) {
      rows.push({ id: GOAL_TOTAL_ROW_ID, label: s.totalRowLabel, bold: true, bind: { kind: "total" } });
    }
  } else {
    (s.rows ?? []).forEach((r, i) => {
      // A etiqueta de nível ("N1 ") saía do rótulo por regex A CADA render;
      // aqui ela é extraída UMA vez e vira dado da linha.
      const split = r.label ? splitLegacyTag(r.label) : { tag: null, text: "" };
      rows.push({
        id: `qr_g${i}`,
        ...(r.label ? { label: split.text } : {}),
        ...(split.tag ? { tag: split.tag } : {}),
        ...(r.bold ? { bold: true } : {}),
        bind: {
          kind: "indicator",
          indicator: r.indicator,
          ...(r.responsible ? { responsible: r.responsible } : {}),
        },
      });
    });
  }
  const goals: NonNullable<QuickTable["goals"]> = {};
  if (s.editable === true) goals.editable = true;
  if (s.showRealized === false) goals.showRealized = false;
  if (s.showAttainment === false) goals.showAttainment = false;
  const display: NonNullable<QuickTable["display"]> = {};
  if (s.density) display.density = s.density;
  if (s.attainmentStyle) display.attainmentStyle = s.attainmentStyle;
  if (s.emptyRealized) display.emptyRealized = s.emptyRealized;
  if (s.unitPlacement) display.unitPlacement = s.unitPlacement;
  if (typeof s.levelTags === "boolean") display.levelTags = s.levelTags;
  if (s.note) display.note = s.note;
  return {
    columns,
    rows,
    ...(Object.keys(goals).length > 0 ? { goals } : {}),
    // Presença de `display` = o visual de tabela de slide (o da Tabela de metas).
    display,
  };
}

/** Settings convertidos (o `goalTable` sai; o resto do widget fica). */
export function goalTableSettingsToQuickTable(settings: WidgetSettings | undefined): WidgetSettings {
  const { goalTable, ...rest } = settings ?? {};
  return { ...rest, quickTable: goalTableToQuickTable(goalTable) };
}

/**
 * Widget 'metas' (legado) → 'tabela_editavel'. Qualquer outro tipo volta
 * IDÊNTICO (mesma referência) — é chamado em toda leitura de widget.
 */
export function normalizeLegacyWidget<T extends Pick<Widget, "visual_type" | "settings">>(w: T): T {
  if (w.visual_type !== "metas") return w;
  return {
    ...w,
    visual_type: "tabela_editavel",
    settings: goalTableSettingsToQuickTable(w.settings),
  };
}

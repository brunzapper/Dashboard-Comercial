// Versão: 1.0 | Data: 19/11/2026
// SELETOR DE CAMPOS do construtor (esquema por Base, fases 5 e 6) — módulo
// PURO. Reorganiza as opções de campo (as mesmas de `toFieldOptions`, mesmos
// valores) em SEÇÕES pensadas para quem monta um widget:
//
//   Métricas salvas ƒ        (só no seletor de métrica — calculado_agg)
//   ↔ Campos comuns          (correspondências entre Bases)
//   <Base> · Principais | Datas | Números | Listas e textos | Calculados ƒ |
//            De outra Base ↪  — uma por Base DO WIDGET
//   Todas as Bases · …       (núcleo, quando o widget tem 2+ Bases ou nenhuma)
//   Gerais                   (campo "de todas" sem Base única)
//   Fora do widget · <Base>  (campo de Base que o widget não consulta — fica
//                            visível e explicado, nunca escondido)
//
// Com UMA Base no widget, as colunas do núcleo entram nas seções DELA e com o
// rótulo DELA (`SourceDef.fieldLabels`, 0156): é aqui que `stage` aparece como
// "Fase do negócio" em Negócios e "Etapa do lead" em Leads. A busca casa
// também o código da origem (UF_CRM_…). Nada muda na consulta: só a lista.
import type { ComboboxOption } from "@/components/ui/combobox";
import type { SourceDef } from "@/lib/sources";

import type { AvailableField } from "./fields";

export type FieldKind =
  | "principais"
  | "datas"
  | "numeros"
  | "listas"
  | "calculados"
  | "casado";

export const FIELD_KIND_LABELS: Record<FieldKind, string> = {
  principais: "Principais",
  datas: "Datas",
  numeros: "Números",
  listas: "Listas e textos",
  calculados: "Calculados ƒ",
  casado: "De outra Base ↪",
};

const KIND_ORDER: FieldKind[] = [
  "principais",
  "datas",
  "numeros",
  "listas",
  "calculados",
  "casado",
];

export const SAVED_METRICS_GROUP = "Métricas salvas ƒ";
export const COMMON_FIELDS_GROUP = "↔ Campos comuns";
export const ALL_BASES_GROUP = "Todas as Bases";
export const GENERAL_GROUP = "Gerais";
export const OUTSIDE_GROUP = "Fora do widget";

export interface FieldPickerOption extends ComboboxOption {
  /** Texto extra da busca (código da origem). */
  searchText?: string;
}

export function fieldKind(f: AvailableField): FieldKind {
  if (f.baseLabel != null) return "casado";
  if (f.calc) return "calculados";
  if (f.isDate) return "datas";
  if (f.isNumeric || f.isMoney) return "numeros";
  if (!f.field.startsWith("custom:")) return "principais";
  return "listas";
}

export interface FieldPickerContext {
  available: readonly AvailableField[];
  catalog: readonly SourceDef[];
  /** `widgets.sources` (sub-base ok); vazio = todas as Bases. */
  widgetSources: readonly string[];
}

/** Bases raiz do widget, na ordem do catálogo. */
export function widgetRootKeys(
  widgetSources: readonly string[],
  catalog: readonly SourceDef[]
): string[] {
  const byKey = new Map(catalog.map((s) => [s.key, s]));
  const roots = new Set(
    widgetSources.map((k) => byKey.get(k)?.parentKey ?? k).filter(Boolean)
  );
  return catalog.filter((s) => !s.parentKey && roots.has(s.key)).map((s) => s.key);
}

export function organizeFieldOptions(
  options: readonly ComboboxOption[],
  ctx: FieldPickerContext
): FieldPickerOption[] {
  const byField = new Map(ctx.available.map((f) => [f.field, f]));
  const roots = ctx.catalog.filter((s) => !s.parentKey);
  const rootByKey = new Map(roots.map((s) => [s.key, s]));
  const short = (key: string) => {
    const s = rootByKey.get(key);
    return s?.shortLabel || s?.label || key;
  };
  const inWidget = widgetRootKeys(ctx.widgetSources, ctx.catalog);
  const single = inWidget.length === 1 ? rootByKey.get(inWidget[0]) : undefined;
  const baseIndex = (key: string) => {
    const i = roots.findIndex((s) => s.key === key);
    return i === -1 ? roots.length : i;
  };

  const ranked = options.map((opt, index) => {
    const f = byField.get(opt.value);
    let rank: number;
    let group = opt.group;
    let label = opt.label;
    let cleanLabel = opt.cleanLabel;
    let title = opt.title;
    if (!f) {
      // Sentinelas (contagem, fórmula própria) no topo; grupos próprios
      // (Base manual, tarefa…) mantidos, no fim.
      rank = opt.group ? 9000 : -1;
    } else if (f.aggCalc) {
      group = SAVED_METRICS_GROUP;
      rank = 0;
    } else if (f.unified) {
      group = COMMON_FIELDS_GROUP;
      rank = 1;
    } else {
      const kind = fieldKind(f);
      const k = KIND_ORDER.indexOf(kind);
      const kindLabel = FIELD_KIND_LABELS[kind];
      if (!f.source) {
        const isCore = !f.field.startsWith("custom:");
        if (isCore && single) {
          group = `${short(single.key)} · ${kindLabel}`;
          rank = 100 + baseIndex(single.key) * 10 + k;
          const own = single.fieldLabels?.[`core:${f.field}`];
          if (own) {
            label = own;
            cleanLabel = own;
          }
        } else if (isCore) {
          group = `${ALL_BASES_GROUP} · ${kindLabel}`;
          rank = 5000 + k;
        } else {
          group = GENERAL_GROUP;
          rank = 6000 + k;
        }
      } else if (inWidget.length === 0 || inWidget.includes(f.source)) {
        group = `${short(f.source)} · ${kindLabel}`;
        rank = 100 + baseIndex(f.source) * 10 + k;
        const own = rootByKey.get(f.source)?.fieldLabels?.[f.field];
        if (own) {
          label = `${short(f.source)} · ${own}`;
          cleanLabel = own;
        }
      } else {
        group = `${OUTSIDE_GROUP} · ${short(f.source)}`;
        rank = 8000 + baseIndex(f.source);
        title =
          title ??
          `Campo de ${short(f.source)}, Base que este widget não consulta: nos registros das Bases do widget ele vem vazio. Marque a Base em "Bases" para usá-lo.`;
      }
    }
    const out: FieldPickerOption = { ...opt, label, rank, index } as FieldPickerOption & {
      rank: number;
      index: number;
    };
    if (group !== undefined) out.group = group;
    if (cleanLabel !== undefined) out.cleanLabel = cleanLabel;
    if (title !== undefined) out.title = title;
    if (f?.code) out.searchText = f.code;
    return out as FieldPickerOption & { rank: number; index: number };
  });

  return ranked
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ rank: _r, index: _i, ...o }) => {
      void _r;
      void _i;
      return o as FieldPickerOption;
    });
}

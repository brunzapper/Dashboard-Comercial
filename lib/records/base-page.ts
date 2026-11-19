// Versão: 1.0 | Data: 19/11/2026
// Modelo da PÁGINA DA BASE (esquema por Base, fase 4) — módulo PURO e
// client-safe. A página junta num lugar o que antes vivia em quatro telas:
// os campos DESTA Base (aba Campos), o que está fora do lugar (aba Qualidade)
// e o resumo (Visão geral). Tudo é derivado de `source_fields` + a definição
// global do campo + o preenchimento real (`source_field_fill`, 0156).
import {
  isRecentlyAdded,
  type BaseSchemaRow,
} from "@/lib/records/base-schema";
import { isInternalBitrixLabel } from "@/lib/sync/bitrix/field-label";
import { CORE_FIELDS } from "@/lib/widgets/fields";

export interface BaseFieldDef {
  field_key: string;
  label: string;
  data_type: string;
  source_system: string | null;
  source_field_id: string | null;
}

export interface BaseFieldRow {
  ref: string;
  /** Rótulo exibido nesta Base (o da Base, senão o global). */
  label: string;
  /** Rótulo global (da definição / do núcleo) — "herdado" na edição. */
  globalLabel: string;
  /** Rótulo próprio da Base (null = herda). */
  baseLabel: string | null;
  dataType: string;
  origin: string;
  /** Código na origem (UF_CRM_…, cabeçalho do CSV) — busca e conferência. */
  originRef: string | null;
  filled: number;
  /** 0–100; null quando a Base não tem registros. */
  filledPct: number | null;
  visible: boolean;
  isNew: boolean;
  removed: boolean;
  /** O nome exibido é só o código interno do Bitrix. */
  internalName: boolean;
  isCore: boolean;
}

export interface FillRow {
  field_ref: string;
  filled: number;
  total: number;
}

const CORE_LABEL = new Map(CORE_FIELDS.map((f) => [f.field, f.label]));
const CORE_TYPE = new Map(
  CORE_FIELDS.map((f) => [
    f.field,
    f.isDate ? "data" : f.isMoney ? "moeda" : f.isNumeric ? "numero" : f.fk ? "relacao" : "texto",
  ])
);

export const ORIGIN_LABELS: Record<string, string> = {
  core: "Sistema",
  bitrix: "Bitrix",
  spa: "Bitrix (processo)",
  csv: "CSV",
  sheet: "Planilha",
  api: "API",
  manual: "Manual",
  calc: "Calculado",
};

function pct(filled: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((filled / total) * 1000) / 10;
}

export function buildBaseFieldRows(input: {
  schemaRows: readonly BaseSchemaRow[];
  defs: readonly BaseFieldDef[];
  /** Rótulos das linhas core (0086) por coluna. */
  coreLabels?: ReadonlyMap<string, string>;
  fill: readonly FillRow[];
  now?: Date;
}): BaseFieldRow[] {
  const defByKey = new Map(input.defs.map((d) => [d.field_key, d]));
  const fillByRef = new Map(input.fill.map((f) => [f.field_ref, f]));
  const total = input.fill[0]?.total ?? 0;
  const out: BaseFieldRow[] = [];
  for (const row of input.schemaRows) {
    const isCore = row.field_ref.startsWith("core:");
    const key = row.field_ref.slice(isCore ? 5 : 7);
    const def = isCore ? null : defByKey.get(key);
    const globalLabel = isCore
      ? input.coreLabels?.get(key) ?? CORE_LABEL.get(key) ?? key
      : def?.label ?? key;
    const baseLabel = row.label && row.label.trim() ? row.label.trim() : null;
    const label = baseLabel ?? globalLabel;
    const filled = Number(fillByRef.get(row.field_ref)?.filled ?? 0);
    out.push({
      ref: row.field_ref,
      label,
      globalLabel,
      baseLabel,
      dataType: isCore ? CORE_TYPE.get(key) ?? "texto" : def?.data_type ?? "texto",
      origin: row.origin,
      originRef: row.origin_ref ?? def?.source_field_id ?? null,
      filled,
      filledPct: pct(filled, total),
      visible: row.visible !== false,
      isNew: isRecentlyAdded(row, input.now),
      removed: Boolean(row.removed_at),
      internalName: isInternalBitrixLabel(label),
      isCore,
    });
  }
  // Núcleo primeiro (perfil), depois os campos pela ordem/rótulo.
  return out.sort((a, b) =>
    a.isCore !== b.isCore ? (a.isCore ? -1 : 1) : a.label.localeCompare(b.label, "pt-BR")
  );
}

export interface OutsideKey {
  ref: string;
  label: string;
  /** Existe definição do campo (em outra Base) ou é chave solta. */
  defined: boolean;
  filled: number;
}

export interface BaseQuality {
  /** Valores gravados em registros desta Base com chave fora do esquema. */
  outside: OutsideKey[];
  /** Campos do esquema, visíveis, sem nenhum valor. */
  neverFilled: BaseFieldRow[];
  /** Nome exibido é o código interno. */
  internalNames: BaseFieldRow[];
  /** A origem deixou de enviar. */
  removed: BaseFieldRow[];
  /** Colunas do núcleo com valor e fora do perfil. */
  coreOutside: OutsideKey[];
}

export function buildBaseQuality(input: {
  rows: readonly BaseFieldRow[];
  schemaRefs: ReadonlySet<string>;
  defs: readonly BaseFieldDef[];
  fill: readonly FillRow[];
}): BaseQuality {
  const defByKey = new Map(input.defs.map((d) => [d.field_key, d]));
  const outside: OutsideKey[] = [];
  const coreOutside: OutsideKey[] = [];
  for (const f of input.fill) {
    if (Number(f.filled) <= 0 || input.schemaRefs.has(f.field_ref)) continue;
    if (f.field_ref.startsWith("core:")) {
      const col = f.field_ref.slice(5);
      coreOutside.push({
        ref: f.field_ref,
        label: CORE_LABEL.get(col) ?? col,
        defined: true,
        filled: Number(f.filled),
      });
      continue;
    }
    const key = f.field_ref.slice(7);
    const def = defByKey.get(key);
    outside.push({
      ref: f.field_ref,
      label: def?.label ?? key,
      defined: Boolean(def),
      filled: Number(f.filled),
    });
  }
  outside.sort((a, b) => b.filled - a.filled);
  coreOutside.sort((a, b) => b.filled - a.filled);
  return {
    outside,
    coreOutside,
    neverFilled: input.rows.filter(
      (r) => !r.isCore && r.visible && r.filled === 0 && (r.filledPct ?? 0) === 0
    ),
    internalNames: input.rows.filter((r) => r.internalName),
    removed: input.rows.filter((r) => r.removed),
  };
}

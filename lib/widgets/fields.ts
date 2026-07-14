// Versão: 1.2 | Data: 09/07/2026
// Campos disponíveis no construtor de widgets: colunas do núcleo (com rótulos
// PT) + campos personalizados (custom:<key>). Marca quais são numéricos
// (métricas), quais são datas (aceitam transform) e quais são FK (resolver
// rótulo id→nome no engine).
// v1.1 (09/07/2026): Fase 7 — 'calculado' conta como numérico (métrica); a
//   filtragem por show_in_builder é feita por quem carrega os field_definitions.
// v1.2 (09/07/2026): Fase 8 — buildAvailableFields agrega os campos UNIFICADOS
//   (unified:<key>) vindos das correspondências globais.
import { NUMERIC_DATA_TYPES, type FieldDefinition } from "@/lib/records/types";
import type { Correspondence } from "@/lib/correspondences";
import {
  SOURCE_KEYS,
  SOURCE_LABELS,
  fieldAppliesToSource,
} from "@/lib/sources";
import {
  isEditableCoreColumn,
  isEditableRelation,
  isWriteBackRelation,
} from "@/lib/config/core-writeback";
import { resolveFieldMoney } from "./currency";
import type { Aggregation, Transform } from "./types";

export type FkKind = "responsible" | "operation" | "lead";

export interface AvailableField {
  field: string; // 'stage' | 'responsible_id' | 'custom:xxx' | 'unified:xxx'
  label: string;
  isNumeric: boolean; // pode ser métrica sum/avg
  isDate: boolean; // aceita transform (dia/mês/...)
  // Métrica monetária: value/mrr (moeda do registro) ou campo 'moeda'/'calculado'
  // -moeda. Habilita as opções de moeda/conversão da métrica no construtor.
  isMoney?: boolean;
  fk?: FkKind;
  unified?: boolean; // campo vindo de uma correspondência
  // Só p/ unificados: membro por record_type (ex.: { negocio: 'closed_at',
  // venda_site: 'custom:data' }). Permite resolver o valor POR REGISTRO nos
  // caminhos client-side (modo registros, "Agrupar período"), espelhando o
  // coalesce que o RPC monta.
  unifiedMembers?: Record<string, string>;
  // Pode ser editável inline na tabela de registros (custom não calculado, ou
  // coluna do núcleo suportada). O toggle "Editável" do builder só aparece p/ estes.
  editableCapable?: boolean;
  // Editar esta coluna pode gravar de volta no Bitrix (custom de Sync, ou coluna
  // do núcleo mapeada). Habilita o toggle "Gravar no Bitrix".
  writable?: boolean;
  // Campo sintético só de exibição (ex.: "Data atual"): não existe coluna no
  // banco, então NÃO pode virar dimensão/filtro do RPC. Serve como coluna do
  // modo lista e operando de fórmula. O builder filtra estes de dimensão/filtro.
  displayOnly?: boolean;
  // Campo 'calculado_agg' (14/07/2026): métrica calculada de AGREGADOS. Só pode
  // ser métrica (fórmula avaliada por grupo — ver lib/widgets/calc-metrics.ts);
  // nunca dimensão/filtro/coluna de registro (não há valor por registro).
  // isNumeric fica false de propósito: fora de operandos de outras fórmulas
  // (sem aninhamento) e da lista genérica de métricas — o builder o adiciona
  // explicitamente ao seletor de métricas.
  aggCalc?: boolean;
}

// Campo sintético "Data atual" (hoje em Brasília). Resolvido no cliente
// (lib/date/today.ts) — ver record-list-table (coluna) e engine/runKpi (KPI).
export const TODAY_FIELD: AvailableField = {
  field: "today",
  label: "Data atual",
  isNumeric: false,
  isDate: true,
  displayOnly: true,
};

// Campos do núcleo expostos no builder.
export const CORE_FIELDS: AvailableField[] = [
  { field: "title", label: "Nome (título)", isNumeric: false, isDate: false },
  { field: "record_type", label: "Tipo de registro", isNumeric: false, isDate: false },
  { field: "source_system", label: "Fonte", isNumeric: false, isDate: false },
  { field: "pipeline", label: "Pipeline", isNumeric: false, isDate: false },
  { field: "stage", label: "Etapa", isNumeric: false, isDate: false },
  { field: "stage_semantic", label: "Situação (aberto/ganho/perdido)", isNumeric: false, isDate: false },
  { field: "sale_type", label: "Tipo de venda", isNumeric: false, isDate: false },
  { field: "channel", label: "Canal", isNumeric: false, isDate: false },
  { field: "currency", label: "Moeda", isNumeric: false, isDate: false },
  { field: "closed", label: "Fechado?", isNumeric: false, isDate: false },
  { field: "responsible_id", label: "Responsável", isNumeric: false, isDate: false, fk: "responsible" },
  { field: "operation_id", label: "Operação", isNumeric: false, isDate: false, fk: "operation" },
  { field: "related_lead_id", label: "Lead relacionado", isNumeric: false, isDate: false, fk: "lead" },
  { field: "value", label: "Valor", isNumeric: true, isDate: false, isMoney: true },
  { field: "mrr", label: "MRR", isNumeric: true, isDate: false, isMoney: true },
  { field: "lead_time_days", label: "Lead time (dias)", isNumeric: true, isDate: false },
  { field: "closed_at", label: "Data de fechamento", isNumeric: false, isDate: true },
  { field: "opened_at", label: "Data de abertura", isNumeric: false, isDate: true },
  { field: "source_created_at", label: "Data de criação (origem)", isNumeric: false, isDate: true },
];

/**
 * Junta os campos do núcleo + personalizados (field_definitions) + unificados
 * (correspondências globais). Os unificados aparecem como `unified:<key>`.
 */
export function buildAvailableFields(
  customFields: FieldDefinition[],
  correspondences: Correspondence[] = []
): AvailableField[] {
  const core = CORE_FIELDS.map((f) => ({
    ...f,
    // Colunas do núcleo editáveis inline: as colunas suportadas (write-back) OU as
    // relações editáveis (ex.: responsável). `writable` (a caixa "Gravar no Bitrix")
    // vale para as colunas do núcleo mapeadas ao Bitrix e para as relações com
    // write-back (responsável → ASSIGNED_BY_ID).
    editableCapable: isEditableCoreColumn(f.field) || isEditableRelation(f.field),
    writable: isEditableCoreColumn(f.field) || isWriteBackRelation(f.field),
  }));
  const custom = customFields.map((f) =>
    f.data_type === "calculado_agg"
      ? {
          field: `custom:${f.field_key}`,
          label: f.label,
          isNumeric: false,
          isDate: false,
          isMoney: false,
          editableCapable: false,
          aggCalc: true,
        }
      : {
          field: `custom:${f.field_key}`,
          label: f.label,
          isNumeric: NUMERIC_DATA_TYPES.includes(f.data_type),
          isDate: f.data_type === "data",
          isMoney: resolveFieldMoney(f).isMoney,
          editableCapable: f.data_type !== "calculado",
          // Campo de Sync do Bitrix (custom com source_field_id) → grava de volta.
          writable: f.source_system === "bitrix" && Boolean(f.source_field_id),
        }
  );
  const unified = correspondences.map((c) => ({
    field: `unified:${c.key}`,
    label: `↔ ${c.label}`,
    isNumeric: NUMERIC_DATA_TYPES.includes(c.data_type),
    isDate: c.data_type === "data",
    isMoney: c.data_type === "moeda",
    unified: true,
    unifiedMembers: Object.fromEntries(
      c.members
        .filter((m) => m.field_ref)
        .map((m) => [m.record_type, m.field_ref])
    ),
  }));
  const match = buildMatchFields(customFields);
  return [...core, TODAY_FIELD, ...custom, ...unified, ...match];
}

// Colunas do núcleo úteis de puxar do registro CASADO (match:<fonte>:<ref>).
// Foca em datas/numéricos/texto identificador — evita ruído (FKs/timestamps de
// sistema). Custom entram por fonte (applies_to).
const MATCH_CORE_FIELDS = CORE_FIELDS.filter((f) =>
  [
    "title",
    "stage",
    "channel",
    "sale_type",
    "value",
    "mrr",
    "lead_time_days",
    "closed_at",
    "opened_at",
    "source_created_at",
  ].includes(f.field)
);

// Campos do registro casado, por fonte: `match:<fonte>:<ref>`. Não são editáveis
// (vêm do outro registro) nem de write-back. Ficam disponíveis em
// dimensões/métricas/filtros e como colunas do modo lista.
function buildMatchFields(customFields: FieldDefinition[]): AvailableField[] {
  const out: AvailableField[] = [];
  for (const src of SOURCE_KEYS) {
    for (const f of MATCH_CORE_FIELDS) {
      out.push({
        field: `match:${src}:${f.field}`,
        label: `↪ ${SOURCE_LABELS[src]}: ${f.label}`,
        isNumeric: f.isNumeric,
        isDate: f.isDate,
        isMoney: f.isMoney,
      });
    }
    for (const f of customFields) {
      // 'calculado_agg' não tem valor por registro → nada a puxar do casado.
      if (f.data_type === "calculado_agg") continue;
      if (!fieldAppliesToSource(f.applies_to, src)) continue;
      out.push({
        field: `match:${src}:custom:${f.field_key}`,
        label: `↪ ${SOURCE_LABELS[src]}: ${f.label}`,
        isNumeric: NUMERIC_DATA_TYPES.includes(f.data_type),
        isDate: f.data_type === "data",
        isMoney: resolveFieldMoney(f).isMoney,
      });
    }
  }
  return out;
}

export function fieldLabel(
  field: string,
  available: AvailableField[]
): string {
  return available.find((a) => a.field === field)?.label ?? field;
}

export function fieldFk(
  field: string,
  available: AvailableField[]
): FkKind | undefined {
  return available.find((a) => a.field === field)?.fk;
}

export const AGGREGATIONS: Aggregation[] = ["sum", "count", "avg"];
// Lista exibida na UI (o RPC ainda aceita os legados day/week/month). Ordem:
// dia da semana, semanas, mês por nome, mês/ano, trimestre, ano.
export const DATE_TRANSFORMS: Transform[] = [
  "none",
  "weekday",
  "week_year",
  "week_month",
  "month_name",
  "month_year",
  "quarter",
  "year",
];

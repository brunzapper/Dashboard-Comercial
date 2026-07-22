// Versão: 1.5 | Data: 20/07/2026
// v1.5 (20/07/2026): unifiedMembers RAIZ primeiro — pai e sub (0078) compartilham
//   o record_type e o Object.fromEntries deixava o membro da SUB sobrescrever o
//   da pai (last-wins) nos caminhos client-side de widget só-pai.
// Campos disponíveis no construtor de widgets: colunas do núcleo (com rótulos
// PT) + campos personalizados (custom:<key>). Marca quais são numéricos
// (métricas), quais são datas (aceitam transform) e quais são FK (resolver
// rótulo id→nome no engine).
// v1.1 (09/07/2026): Fase 7 — 'calculado' conta como numérico (métrica); a
//   filtragem por show_in_builder é feita por quem carrega os field_definitions.
// v1.2 (09/07/2026): Fase 8 — buildAvailableFields agrega os campos UNIFICADOS
//   (unified:<key>) vindos das correspondências globais.
// v1.3 (15/07/2026): metadados de exibição p/ os dropdowns de campo: `source`
//   (fonte única efetiva — applies_to ou, em calculados, os operandos da
//   fórmula), `calc` (indicador ƒ), `formulaText` (tooltip com a fórmula em
//   rótulos client-side) e `baseLabel` (match: rótulo sem o prefixo de fonte).
//   `label` segue LIMPO — prefixos só na camada de opções (filter-ops).
// v1.4 (20/07/2026): buildMatchFields exportado com parâmetro estrutural mínimo
//   (MatchFieldDef) — o catálogo agregado do lado defs (defsAggCatalogInput)
//   passa a derivar os operandos de registro casado da MESMA construção.
import {
  NUMERIC_DATA_TYPES,
  type DataType,
  type FieldDefinition,
} from "@/lib/records/types";
import { splitCoreDefs } from "@/lib/records/core-defs";
import { formulaRefs, formulaToText } from "@/lib/records/formulas";
import type { Correspondence } from "@/lib/correspondences";
import {
  BUILTIN_SOURCES,
  fieldAppliesToSource,
  toSourceKey,
  type SourceDef,
  type SourceKey,
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
  // coalesce que o RPC monta. RAIZ primeiro (0078/v1.5): pai e sub compartilham
  // o record_type — o membro da sub NUNCA sobrescreve o da raiz; só entra p/
  // record_type que não tem membro raiz (correspondência só-sub).
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
  // Fonte ÚNICA efetiva (prefixo/chips nos dropdowns de campo): custom com
  // applies_to de exatamente 1 fonte, match:<fonte>:, ou calculado cujos
  // operandos tocam só 1 fonte. Ausente = campo "geral" (todas/múltiplas).
  // NAVEGAÇÃO apenas — não restringe a consulta (isso é widget.sources).
  source?: SourceKey;
  // Campo calculado ('calculado' por-registro ou 'calculado_agg') → indicador ƒ
  // nos dropdowns.
  calc?: boolean;
  // Fórmula legível (rótulos client-side, nunca refs internos) p/ o tooltip das
  // opções de dropdown. Só campos calculados com fórmula.
  formulaText?: string;
  // Só match:<fonte>:*: rótulo do campo interno (sem o prefixo '↪ <Fonte>: ' do
  // `label`), p/ os dropdowns comporem o prefixo curto sem duplicar a fonte.
  baseLabel?: string;
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

// applies_to (record_types) → fontes correspondentes, deduplicadas.
function appliesSources(appliesTo: string[] | null | undefined): SourceKey[] {
  if (!appliesTo || appliesTo.length === 0) return [];
  const out = new Set<SourceKey>();
  for (const rt of appliesTo) {
    const src = toSourceKey(rt);
    if (src) out.add(src);
  }
  return [...out];
}

function isCalcType(dataType: FieldDefinition["data_type"]): boolean {
  return dataType === "calculado" || dataType === "calculado_agg";
}

// Campo interno de um ref 'agg:<sum|avg|count>:<campo>[@<fonte>]' ('*' =
// contagem de registros). Parser local — NÃO importar calc-metrics aqui (ciclo
// de import: calc-metrics → cond-operands → CORE_FIELDS deste módulo). Devolve
// também a fonte do ESCOPO (`@<fonte>`, split no último '@'), quando houver.
function aggInner(ref: string): { field: string; source?: SourceKey } {
  const rest = ref.slice("agg:".length);
  const i = rest.indexOf(":");
  let field = i === -1 ? "*" : rest.slice(i + 1);
  const at = field.lastIndexOf("@");
  if (at === -1) return { field };
  const source = field.slice(at + 1);
  field = field.slice(0, at);
  return source ? { field, source } : { field };
}

// Acumula em `out` as fontes que um ref de fórmula toca: match pina a própria
// fonte; custom usa o applies_to do referenciado (vazio + calculado → recursão
// na fórmula dele, com `visited` anti-ciclo); agg recursa no campo interno;
// núcleo/'today'/'unified:' são neutros (não pinam fonte).
function collectRefSources(
  ref: string,
  byKey: Map<string, FieldDefinition>,
  visited: Set<string>,
  out: Set<SourceKey>
): void {
  if (ref.startsWith("match:")) {
    // Qualquer key de fonte vale (fontes dinâmicas: key === record_type);
    // refs órfãos (fonte excluída) só pinam uma fonte sem registros.
    const src = ref.split(":")[1];
    if (src) out.add(src);
    return;
  }
  if (ref.startsWith("agg:")) {
    const { field: inner, source } = aggInner(ref);
    // Escopo de fonte (`@<fonte>`): o operando pina a própria fonte do escopo —
    // um calculado só de operandos @leads classifica sob Leads.
    if (source) out.add(source);
    if (inner !== "*") collectRefSources(inner, byKey, visited, out);
    return;
  }
  if (ref.startsWith("custom:")) {
    const key = ref.slice("custom:".length);
    if (visited.has(key)) return;
    visited.add(key);
    const def = byKey.get(key);
    if (!def) return;
    const srcs = appliesSources(def.applies_to);
    if (srcs.length > 0) {
      for (const s of srcs) out.add(s);
      return;
    }
    if (isCalcType(def.data_type) && def.formula) {
      for (const r of formulaRefs(def.formula))
        collectRefSources(r, byKey, visited, out);
    }
  }
}

// Fonte única efetiva de uma FieldDefinition: applies_to com exatamente 1 fonte
// → ela; múltiplas → geral. Sem applies_to, calculados herdam a fonte quando a
// união das fontes dos operandos tem exatamente 1 elemento (campo calculado com
// dados de uma fonte só é classificado nessa fonte).
function singleFieldSource(
  f: FieldDefinition,
  byKey: Map<string, FieldDefinition>
): SourceKey | undefined {
  const direct = appliesSources(f.applies_to);
  if (direct.length === 1) return direct[0];
  if (direct.length > 1) return undefined;
  if (isCalcType(f.data_type) && f.formula) {
    const out = new Set<SourceKey>();
    const visited = new Set([f.field_key]);
    for (const r of formulaRefs(f.formula))
      collectRefSources(r, byKey, visited, out);
    if (out.size === 1) return [...out][0];
  }
  return undefined;
}

// Pré-computa a fórmula legível dos campos calculados (tooltip das opções de
// dropdown), com rótulos de exibição. Refs 'agg:' espelham os rótulos de
// aggOperandRefs (calc-metrics) sem importá-lo (ciclo — ver aggInnerField).
// Ref fora do catálogo (ex.: builder não-admin sem o campo) cai no ref cru.
function decorateFormulaTexts(
  all: AvailableField[],
  byKey: Map<string, FieldDefinition>
): void {
  const labelByRef = new Map(all.map((a) => [a.field, a.label] as const));
  const labelForRef = (ref: string): string => {
    if (ref.startsWith("agg:")) {
      const rest = ref.slice("agg:".length);
      const i = rest.indexOf(":");
      const fn = i === -1 ? rest : rest.slice(0, i);
      // Escopo de fonte (`@<fonte>`): sufixa "· <fonte>" (espelha o rótulo do
      // catálogo com escopo, sem o rótulo curto — este módulo não vê o catálogo).
      const { field: inner, source } = aggInner(ref);
      const scope = source ? ` · ${source}` : "";
      if (fn === "count")
        return inner === "*"
          ? `Contagem de registros${scope}`
          : `Contagem de ${labelForRef(inner)}${scope}`;
      if (fn === "sum") return `Σ ${labelForRef(inner)}${scope}`;
      if (fn === "avg") return `Média ${labelForRef(inner)}${scope}`;
      return ref;
    }
    return labelByRef.get(ref) ?? ref;
  };
  for (const a of all) {
    if (!a.calc) continue;
    // custom:<key> ou match:<fonte>:custom:<key> (calculado do registro casado).
    let key: string | null = null;
    if (a.field.startsWith("custom:")) {
      key = a.field.slice("custom:".length);
    } else if (a.field.startsWith("match:")) {
      const inner = a.field.split(":").slice(2).join(":");
      if (inner.startsWith("custom:")) key = inner.slice("custom:".length);
    }
    const def = key ? byKey.get(key) : undefined;
    if (def?.formula) a.formulaText = formulaToText(def.formula, labelForRef);
  }
}

/**
 * Junta os campos do núcleo + personalizados (field_definitions) + unificados
 * (correspondências globais). Os unificados aparecem como `unified:<key>`.
 * Linhas core (source_system='core', 0086) são OVERRIDES das colunas núcleo —
 * aplicam rótulo/visibilidade e NUNCA viram `custom:<key>` (split aqui, no
 * único ponto de montagem; ver lib/records/core-defs.ts).
 */
export function buildAvailableFields(
  fields: FieldDefinition[],
  correspondences: Correspondence[] = [],
  // Catálogo de fontes (data_sources); ausente = builtins. Define quais fontes
  // geram campos match:<fonte>:* e seus rótulos.
  sources: SourceDef[] = BUILTIN_SOURCES
): AvailableField[] {
  const { custom: customFields, core: coreOverrides } = splitCoreDefs(fields);
  const core = CORE_FIELDS.filter(
    // Olho do /campos: override core com show_in_builder=false oculta a coluna
    // de todos os seletores (mesma degradação dos custom ocultos).
    (f) => coreOverrides.get(f.field)?.show_in_builder !== false
  ).map((f) => ({
    ...f,
    label: coreOverrides.get(f.field)?.label ?? f.label,
    // Colunas do núcleo editáveis inline: as colunas suportadas (write-back) OU as
    // relações editáveis (ex.: responsável). `writable` (a caixa "Gravar no Bitrix")
    // vale para as colunas do núcleo mapeadas ao Bitrix e para as relações com
    // write-back (responsável → ASSIGNED_BY_ID).
    editableCapable: isEditableCoreColumn(f.field) || isEditableRelation(f.field),
    writable: isEditableCoreColumn(f.field) || isWriteBackRelation(f.field),
  }));
  const byKey = new Map(customFields.map((f) => [f.field_key, f] as const));
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
          calc: true,
          source: singleFieldSource(f, byKey),
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
          calc: f.data_type === "calculado" || undefined,
          source: singleFieldSource(f, byKey),
        }
  );
  // SUB-FONTES (0078): pai e sub compartilham o record_type, então o mapa por
  // record_type colidiria — RAIZ primeiro (first-wins), membro de sub só
  // preenche record_type SEM membro raiz. Assim o caminho client-side espelha a
  // consulta principal (fonte efetiva = raiz); o membro da sub em perna própria
  // resolve por source_key (correspondenceMapForSources), não por este mapa.
  const subKeys = new Set(sources.filter((s) => s.parentKey).map((s) => s.key));
  const unified = correspondences.map((c) => {
    const members: Record<string, string> = {};
    const withRef = c.members.filter((m) => m.field_ref);
    for (const m of withRef) {
      if (!subKeys.has(m.source_key) && !(m.record_type in members))
        members[m.record_type] = m.field_ref;
    }
    for (const m of withRef) {
      if (!(m.record_type in members)) members[m.record_type] = m.field_ref;
    }
    return {
      field: `unified:${c.key}`,
      label: `↔ ${c.label}`,
      isNumeric: NUMERIC_DATA_TYPES.includes(c.data_type),
      isDate: c.data_type === "data",
      isMoney: c.data_type === "moeda",
      unified: true,
      unifiedMembers: members,
    };
  });
  const match = buildMatchFields(customFields, sources);
  const all = [...core, TODAY_FIELD, ...custom, ...unified, ...match];
  decorateFormulaTexts(all, byKey);
  return all;
}

// Colunas do núcleo úteis de puxar do registro CASADO (match:<fonte>:<ref>).
// Foca em datas/numéricos/texto identificador — evita ruído (FKs/timestamps de
// sistema). Custom entram por fonte (applies_to).
// Gap aceito (0086): os rótulos `↪ <Fonte>: <Campo>` do casado seguem os labels
// ESTÁTICOS de CORE_FIELDS — rótulo renomeado no /campos não propaga aqui.
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

// Linha mínima p/ construir os campos do registro casado — FieldDefinition
// (client), AggCatalogDefRow e o DefRow do servidor são todos atribuíveis.
// currency_* só alimentam isMoney (resolveFieldMoney) — irrelevante p/ o
// catálogo agregado (ScopedAggField não tem isMoney).
export interface MatchFieldDef {
  field_key: string;
  label: string;
  data_type: DataType;
  applies_to?: string[] | null;
  currency_code?: string | null;
  currency_mode?: string | null;
}

// Campos do registro casado, por fonte: `match:<fonte>:<ref>`. Não são editáveis
// (vêm do outro registro) nem de write-back. Ficam disponíveis em
// dimensões/métricas/filtros e como colunas do modo lista. Exportado: é a
// construção ÚNICA de ref+rótulo `↪ <Fonte>: <Campo>` — o catálogo agregado do
// lado defs (defsAggCatalogInput) deriva daqui, nunca remonta os rótulos.
export function buildMatchFields(
  customFields: MatchFieldDef[],
  sources: SourceDef[] = BUILTIN_SOURCES
): AvailableField[] {
  const out: AvailableField[] = [];
  for (const { key: src, label: srcLabel } of sources) {
    for (const f of MATCH_CORE_FIELDS) {
      out.push({
        field: `match:${src}:${f.field}`,
        label: `↪ ${srcLabel}: ${f.label}`,
        isNumeric: f.isNumeric,
        isDate: f.isDate,
        isMoney: f.isMoney,
        source: src,
        baseLabel: f.label,
      });
    }
    for (const f of customFields) {
      // 'calculado_agg' não tem valor por registro → nada a puxar do casado.
      if (f.data_type === "calculado_agg") continue;
      if (!fieldAppliesToSource(f.applies_to, src)) continue;
      out.push({
        field: `match:${src}:custom:${f.field_key}`,
        label: `↪ ${srcLabel}: ${f.label}`,
        isNumeric: NUMERIC_DATA_TYPES.includes(f.data_type),
        isDate: f.data_type === "data",
        isMoney: resolveFieldMoney(f).isMoney,
        source: src,
        baseLabel: f.label,
        calc: f.data_type === "calculado" || undefined,
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

export const AGGREGATIONS: Aggregation[] = ["sum", "count", "avg", "min", "max"];
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

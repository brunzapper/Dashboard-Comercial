// Versão: 1.0 | Data: 22/07/2026
// Validador/materializador PURO do import de dashboard via JSON (modo IA):
// recebe o texto colado + um contexto carregado pelo chamador (catálogo de
// fontes, field_definitions, correspondências, nomes de responsáveis/
// operações) e devolve erros/avisos legíveis em pt-BR OU um PresetDashboard
// pronto para o motor idempotente dos presets (applyPresetDefinition).
// Reusa OS MESMOS módulos dos editores para fórmulas — tokenizeFormulaText +
// validateFormulaForContext + findFormulaCycle sobre catálogos únicos
// (perRecordCalcOperands / buildAggOperandCatalog) — para que uma fórmula
// aceita aqui seja exatamente a que os editores aceitariam. Nenhum I/O aqui:
// client-safe e testável (npx tsx) sem banco.
import type {
  PresetCorrespondence,
  PresetDashboard,
  PresetField,
  PresetSubSource,
  PresetWidget,
} from "@/lib/presets/definitions";
import type { SourceDef } from "@/lib/sources";
import type {
  DashboardSettings,
  Dimension,
  GridPosition,
  Metric,
  VisualType,
  WidgetFilter,
  WidgetSettings,
} from "@/lib/widgets/types";
import {
  AGG_LABELS,
  DATE_AGG_LABELS,
  TRANSFORM_LABELS,
  VISUAL_TYPE_LABELS,
} from "@/lib/widgets/types";
import { PERIOD_PRESETS, PERIOD_ALL } from "@/lib/widgets/period";
import { FILTER_OPS } from "@/lib/widgets/filter-ops";
import { CORE_FIELDS } from "@/lib/widgets/fields";
import { CALC_METRIC_FIELD } from "@/lib/widgets/calc-metrics";
import { DEFAULT_WIDGET_SIZE } from "@/lib/widgets/widget-defaults";
import { sanitizeImageSettings } from "@/lib/widgets/image-url";
import { slugify } from "@/lib/records/slug";
import { isCoreDef } from "@/lib/records/core-defs";
import { ROLE_LABELS } from "@/lib/auth/roles";
import {
  formulaCondAggInfo,
  type Formula,
} from "@/lib/records/formulas";
import { findFormulaCycle, refCustomKey } from "@/lib/records/formula-deps";
import { perRecordCalcOperands } from "@/lib/records/calc-operands";
import { tokenizeFormulaText } from "@/lib/records/formula-text";
import { validateFormulaForContext } from "@/lib/records/formula-validate";
import {
  buildAggOperandCatalog,
  defsAggCatalogInput,
} from "@/lib/widgets/agg-catalog";
import type { DataType } from "@/lib/records/types";
import {
  DASHBOARD_IMPORT_FORMAT,
  DASHBOARD_IMPORT_VERSION,
  IMPORT_PRESET_PREFIX,
  type DashboardImportContext,
  type DashboardImportValidation,
  type ImportDefRow,
} from "./types";

// ---------- Conjuntos fechados (mesmas fontes de verdade da UI) ----------

const VISUAL_TYPES = new Set(Object.keys(VISUAL_TYPE_LABELS));
const AGGS = new Set(Object.keys(AGG_LABELS));
const TRANSFORMS = new Set(Object.keys(TRANSFORM_LABELS));
const DATE_AGGS = new Set(Object.keys(DATE_AGG_LABELS));
const UI_FILTER_OPS = new Set<string>(FILTER_OPS.map((o) => o.op));
const PERIOD_PRESET_KEYS = new Set<string>([
  ...Object.keys(PERIOD_PRESETS),
  PERIOD_ALL,
  "",
]);
const ROLE_KEYS = new Set(Object.keys(ROLE_LABELS));
const DATA_TYPES = new Set<string>([
  "texto",
  "numero",
  "data",
  "selecao",
  "moeda",
  "booleano",
  "calculado",
  "calculado_agg",
]);
// Colunas core aceitas como campo de período (CHECK da 0060 + sub-fontes 0082).
const PERIOD_FIELDS = new Set([
  "closed_at",
  "opened_at",
  "source_created_at",
  "source_modified_at",
  "created_at",
  "updated_at",
]);
// Refs de coluna do núcleo aceitos em dimensões/métricas/filtros: o catálogo
// do construtor (CORE_FIELDS) + colunas de data/flags fora dele.
const CORE_REFS = new Set<string>([
  ...CORE_FIELDS.map((f) => f.field),
  ...PERIOD_FIELDS,
  "closed",
]);
// Ops aceitos no recorte de sub-base (mesmo conjunto do parseSubFilter de
// configuracoes/fontes/actions.ts — os 10 da UI; nunca sources/record_types).
const SUB_FILTER_OPS = UI_FILTER_OPS;
const RESERVED_SOURCE_KEYS = new Set(["geral", "gerais", "records", "todas"]);
const SOURCE_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,59}$/;
const FK_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- Helpers ----------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// A IA costuma devolver o JSON dentro de cerca ```json … ``` — tolerar.
export function stripCodeFence(raw: string): string {
  const t = raw.trim();
  const m = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/.exec(t);
  return m ? m[1] : t;
}

function cleanRoles(v: unknown, warnings: string[], where: string): string[] {
  const roles = asArray(v).map(String);
  const ok = roles.filter((r) => ROLE_KEYS.has(r));
  const bad = roles.filter((r) => !ROLE_KEYS.has(r));
  if (bad.length > 0) {
    warnings.push(
      `${where}: papéis desconhecidos ignorados: ${bad.join(", ")} (válidos: ${[...ROLE_KEYS].join(", ")}).`
    );
  }
  return ok;
}

// ---------- Validação principal ----------

export function validateDashboardImport(
  raw: string,
  ctx: DashboardImportContext
): DashboardImportValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (): DashboardImportValidation => ({
    ok: false,
    errors,
    warnings,
    declares: { fields: false, subSources: false, correspondences: false },
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch (e) {
    errors.push(
      `O texto colado não é um JSON válido: ${e instanceof Error ? e.message : String(e)}`
    );
    return fail();
  }
  if (!isRecord(parsed)) {
    errors.push("O JSON precisa ser um objeto ({...}) no formato do manual.");
    return fail();
  }

  // --- Envelope ---
  if (asString(parsed.formato) !== DASHBOARD_IMPORT_FORMAT) {
    errors.push(`"formato" deve ser "${DASHBOARD_IMPORT_FORMAT}".`);
  }
  if (Number(parsed.versao) !== DASHBOARD_IMPORT_VERSION) {
    errors.push(`"versao" deve ser ${DASHBOARD_IMPORT_VERSION}.`);
  }
  const chave = slugify(asString(parsed.chave));
  if (!chave) {
    errors.push(
      '"chave" é obrigatória (slug do import — reimportar a mesma chave atualiza o dashboard).'
    );
  }
  const baseKey = asString(parsed.base);
  const rootSources = ctx.sources.filter((s) => !s.parentKey);
  if (!baseKey || !ctx.sources.some((s) => s.key === baseKey)) {
    errors.push(
      `"base" precisa ser a key de uma Base existente. Disponíveis: ${rootSources.map((s) => s.key).join(", ")}.`
    );
  }
  const dash = isRecord(parsed.dashboard) ? parsed.dashboard : null;
  const dashName = dash ? asString(dash.name) : "";
  if (!dashName) errors.push('"dashboard.name" é obrigatório.');
  if (errors.length > 0) return fail();

  // --- Estado de trabalho (existentes + declarados) ---
  // defs de trabalho: field_definitions existentes + campos declarados no JSON
  // (adicionados NA ORDEM, para fórmulas posteriores enxergarem os anteriores).
  const workingDefs: ImportDefRow[] = [...ctx.defs];
  const existingFieldKeys = new Set(
    ctx.defs.filter((d) => !isCoreDef(d)).map((d) => d.field_key)
  );
  const coreColNames = new Set(CORE_REFS);
  const workingCorrKeys = new Set(ctx.correspondenceKeys);
  const workingSources: SourceDef[] = [...ctx.sources];
  const sourceKeySet = () => new Set(workingSources.map((s) => s.key));
  const respNames = new Set(
    ctx.responsibleNames.map((n) => n.trim().toLocaleLowerCase("pt-BR"))
  );
  const opNames = new Set(
    ctx.operationNames.map((n) => n.trim().toLocaleLowerCase("pt-BR"))
  );

  const defKeyExists = (key: string) =>
    workingDefs.some((d) => !isCoreDef(d) && d.field_key === key);

  // Valida um ref de campo usado em dimensão/filtro/coluna. `where` entra na
  // mensagem. Retorna false quando inválido (erro já registrado).
  const checkRef = (ref: string, where: string): boolean => {
    if (!ref) {
      errors.push(`${where}: campo vazio.`);
      return false;
    }
    if (ref === "today") return true; // "Data atual" (modo lista)
    if (ref.startsWith("@")) {
      errors.push(
        `${where}: "${ref}" é um sentinela interno — não pode ser usado como campo.`
      );
      return false;
    }
    if (ref.startsWith("custom:")) {
      const key = ref.slice("custom:".length);
      if (!defKeyExists(key)) {
        errors.push(
          `${where}: o campo "${ref}" não existe e não está declarado em "fields".`
        );
        return false;
      }
      return true;
    }
    if (ref.startsWith("unified:")) {
      const key = ref.slice("unified:".length);
      if (!workingCorrKeys.has(key)) {
        errors.push(
          `${where}: o campo unificado "${ref}" não existe e não está declarado em "correspondences".`
        );
        return false;
      }
      return true;
    }
    if (ref.startsWith("match:")) {
      const rest = ref.slice("match:".length);
      const i = rest.indexOf(":");
      const src = i > 0 ? rest.slice(0, i) : "";
      const inner = i > 0 ? rest.slice(i + 1) : "";
      if (!src || !sourceKeySet().has(src)) {
        errors.push(
          `${where}: "${ref}" referencia uma Base desconhecida ("${src}").`
        );
        return false;
      }
      return checkRef(inner, where);
    }
    if (!coreColNames.has(ref)) {
      errors.push(
        `${where}: campo desconhecido "${ref}". Use uma coluna do núcleo (${[...coreColNames].slice(0, 8).join(", ")}…), "custom:<key>", "unified:<key>" ou "match:<base>:<ref>".`
      );
      return false;
    }
    return true;
  };

  // Catálogos de operandos SOB DEMANDA (recriados quando workingDefs cresce).
  const recordCatalog = (excludeKey?: string) =>
    perRecordCalcOperands(workingDefs, workingSources).allRefs.filter((o) => {
      const key = refCustomKey(o.ref);
      return excludeKey == null || key !== excludeKey;
    });
  const aggCatalog = (excludeKey?: string) =>
    buildAggOperandCatalog(
      defsAggCatalogInput(
        workingDefs,
        workingSources,
        excludeKey ? new Set([excludeKey]) : new Set()
      )
    );

  // Valida condições de SOMASE/CONT.SE sobre relações (comparadas por NOME em
  // runtime — nome inexistente viraria contagem 0 silenciosa).
  const checkFkCondNames = (formula: Formula, where: string) => {
    for (const spec of formulaCondAggInfo(formula).specs) {
      for (const c of spec.conds) {
        if (
          (c.ref === "responsible_id" || c.ref === "operation_id") &&
          typeof c.value === "string" &&
          !FK_UUID_RE.test(c.value)
        ) {
          const pool = c.ref === "responsible_id" ? respNames : opNames;
          if (!pool.has(c.value.trim().toLocaleLowerCase("pt-BR"))) {
            const kind =
              c.ref === "responsible_id" ? "o responsável" : "a operação";
            errors.push(
              `${where}: não encontrei ${kind} "${c.value}" — use o nome exatamente como cadastrado.`
            );
          }
        }
      }
    }
  };

  // Resolve a fórmula de um campo/métrica: texto → tokens + validação de
  // contexto + (agregado) nomes de FK. Retorna null quando inválida.
  const resolveFormula = (
    spec: { formula_text?: unknown; formula?: unknown },
    kind: "record" | "aggregate",
    where: string,
    excludeKey?: string
  ): Formula | null => {
    const catalog =
      kind === "aggregate" ? aggCatalog(excludeKey) : recordCatalog(excludeKey);
    let formula: Formula | null = null;
    const text = asString(spec.formula_text);
    if (text) {
      const tok = tokenizeFormulaText(text, catalog);
      if (!tok.ok) {
        errors.push(`${where}: ${tok.error}`);
        return null;
      }
      formula = tok.formula;
    } else if (isRecord(spec.formula) && Array.isArray(spec.formula.tokens)) {
      formula = spec.formula as unknown as Formula;
    }
    if (!formula) {
      errors.push(
        `${where}: informe a fórmula em "formula_text" (estilo planilha, ex.: [Σ Valor] / [Contagem de registros]).`
      );
      return null;
    }
    const v = validateFormulaForContext(formula, {
      kind,
      catalog,
      sources: workingSources,
    });
    if (!v.ok) {
      errors.push(`${where}: ${v.error ?? "Fórmula inválida."}`);
      return null;
    }
    for (const w of v.warnings) warnings.push(`${where}: ${w}`);
    if (kind === "aggregate") checkFkCondNames(formula, where);
    return formula;
  };

  // --- fields (campos declarados) ---
  const fieldSpecs = asArray(parsed.fields);
  const declaredFieldKeys = new Set<string>();
  const presetFields: PresetField[] = [];
  fieldSpecs.forEach((f, i) => {
    const where = `fields[${i}]`;
    if (!isRecord(f)) {
      errors.push(`${where}: precisa ser um objeto.`);
      return;
    }
    const key = asString(f.field_key);
    const label = asString(f.label) || key;
    const dataType = asString(f.data_type);
    if (!FIELD_KEY_RE.test(key)) {
      errors.push(
        `${where}: "field_key" inválido ("${key}") — use minúsculas/números/underscore, começando por letra.`
      );
      return;
    }
    if (coreColNames.has(key)) {
      errors.push(
        `${where}: "${key}" colide com uma coluna do núcleo — escolha outra key.`
      );
      return;
    }
    if (declaredFieldKeys.has(key)) {
      errors.push(`${where}: field_key duplicado no JSON ("${key}").`);
      return;
    }
    if (!DATA_TYPES.has(dataType)) {
      errors.push(
        `${where}: "data_type" inválido ("${dataType}"). Válidos: ${[...DATA_TYPES].join(", ")}.`
      );
      return;
    }
    declaredFieldKeys.add(key);
    if (existingFieldKeys.has(key)) {
      const existing = ctx.defs.find(
        (d) => !isCoreDef(d) && d.field_key === key
      );
      warnings.push(
        existing && existing.data_type !== dataType
          ? `${where}: o campo "${key}" JÁ EXISTE com tipo "${existing.data_type}" (o JSON pede "${dataType}") — será reutilizado como está, sem alteração.`
          : `${where}: o campo "${key}" já existe — será reutilizado como está.`
      );
      return; // não recria nem valida fórmula de campo que não será criado
    }
    let formula: Formula | undefined;
    if (dataType === "calculado" || dataType === "calculado_agg") {
      const resolved = resolveFormula(
        f,
        dataType === "calculado_agg" ? "aggregate" : "record",
        where,
        key
      );
      if (!resolved) return;
      const cycle = findFormulaCycle(key, resolved, workingDefs);
      if (cycle) {
        errors.push(
          `${where}: dependência circular na fórmula (${cycle.join(" → ")}).`
        );
        return;
      }
      formula = resolved;
    }
    if (dataType === "moeda" && asString(f.currency_mode) === "fixed") {
      warnings.push(
        `${where}: moeda fixa não é suportada no import — o campo será criado com moeda herdada do registro.`
      );
    }
    const applies = asArray(f.applies_to).map(String).filter(Boolean);
    presetFields.push({
      field_key: key,
      label,
      data_type: dataType as DataType,
      options: asArray(f.options).map(String).filter(Boolean),
      visible_to_roles:
        asArray(f.visible_to_roles).length > 0
          ? cleanRoles(f.visible_to_roles, warnings, where)
          : [...ROLE_KEYS],
      editable_by_roles: cleanRoles(f.editable_by_roles, warnings, where),
      is_local: f.is_local !== false,
      currency_mode: dataType === "moeda" ? "inherit" : undefined,
      formula,
      applies_to: applies.length > 0 ? applies : undefined,
    });
    workingDefs.push({
      id: `import:${key}`,
      field_key: key,
      label,
      data_type: dataType as DataType,
      formula: formula ?? null,
      applies_to: applies.length > 0 ? applies : null,
      source_system: null,
    });
  });

  // --- subSources (sub-bases declaradas) ---
  const subSpecs = asArray(parsed.subSources);
  const presetSubs: PresetSubSource[] = [];
  subSpecs.forEach((s, i) => {
    const where = `subSources[${i}]`;
    if (!isRecord(s)) {
      errors.push(`${where}: precisa ser um objeto.`);
      return;
    }
    const key = slugify(asString(s.key)).slice(0, 40);
    const parent = asString(s.parent_key);
    const label = asString(s.label) || key;
    if (!SOURCE_KEY_RE.test(key) || RESERVED_SOURCE_KEYS.has(key)) {
      errors.push(`${where}: "key" inválida ("${key}").`);
      return;
    }
    const parentDef = workingSources.find(
      (p) => p.key === parent && !p.parentKey
    );
    if (!parentDef) {
      errors.push(
        `${where}: "parent_key" precisa ser uma Base raiz existente ("${parent}" não é). Raízes: ${rootSources.map((r) => r.key).join(", ")}.`
      );
      return;
    }
    if (sourceKeySet().has(key)) {
      warnings.push(
        `${where}: a Sub-base "${key}" já existe — será mantida como está (o filtro do JSON é ignorado).`
      );
      return;
    }
    const filter: WidgetFilter[] = [];
    for (const [j, c] of asArray(s.filter).entries()) {
      if (!isRecord(c)) continue;
      const field = asString(c.field);
      const op = asString(c.op);
      if (!field || !SUB_FILTER_OPS.has(op)) {
        errors.push(
          `${where}.filter[${j}]: operador inválido ("${op}"). Válidos: ${[...SUB_FILTER_OPS].join(", ")}.`
        );
        continue;
      }
      if (!checkRef(field, `${where}.filter[${j}]`)) continue;
      filter.push({ field, op: op as WidgetFilter["op"], value: c.value });
    }
    if (filter.length === 0) {
      errors.push(
        `${where}: o recorte ("filter") precisa de pelo menos uma condição válida.`
      );
      return;
    }
    const period = asString(s.default_period_field);
    const periodOk =
      PERIOD_FIELDS.has(period) ||
      (period.startsWith("custom:") &&
        workingDefs.some(
          (d) =>
            d.field_key === period.slice("custom:".length) &&
            d.data_type === "data"
        ));
    if (!periodOk) {
      errors.push(
        `${where}: "default_period_field" inválido ("${period}") — use uma coluna core de data (${[...PERIOD_FIELDS].join(", ")}) ou "custom:<key>" de um campo tipo data.`
      );
      return;
    }
    presetSubs.push({
      key,
      parent_key: parent,
      label,
      short_label: asString(s.short_label) || undefined,
      default_period_field: period,
      filter,
    });
    workingSources.push({
      key,
      recordType: parentDef.recordType,
      label,
      shortLabel: asString(s.short_label) || label,
      defaultPeriodField: period,
      builtin: false,
      manualEntry: false,
      parentKey: parent,
      filter,
    });
  });

  // --- correspondences (campos unificados declarados) ---
  const corrSpecs = asArray(parsed.correspondences);
  const presetCorrs: PresetCorrespondence[] = [];
  corrSpecs.forEach((c, i) => {
    const where = `correspondences[${i}]`;
    if (!isRecord(c)) {
      errors.push(`${where}: precisa ser um objeto.`);
      return;
    }
    const key = slugify(asString(c.key));
    if (!key) {
      errors.push(`${where}: "key" é obrigatória.`);
      return;
    }
    if (workingCorrKeys.has(key)) {
      warnings.push(
        `${where}: o campo unificado "${key}" já existe — será mantido como está.`
      );
      return;
    }
    const members: { source_key: string; field_ref: string }[] = [];
    for (const [j, m] of asArray(c.members).entries()) {
      if (!isRecord(m)) continue;
      const sk = asString(m.source_key);
      const fr = asString(m.field_ref);
      if (!sourceKeySet().has(sk)) {
        errors.push(`${where}.members[${j}]: Base desconhecida ("${sk}").`);
        continue;
      }
      if (!checkRef(fr, `${where}.members[${j}]`)) continue;
      members.push({ source_key: sk, field_ref: fr });
    }
    if (members.length < 2) {
      errors.push(`${where}: precisa de pelo menos 2 membros válidos.`);
      return;
    }
    const dataType = asString(c.data_type) || "texto";
    if (!DATA_TYPES.has(dataType)) {
      errors.push(`${where}: "data_type" inválido ("${dataType}").`);
      return;
    }
    presetCorrs.push({
      key,
      label: asString(c.label) || key,
      data_type: dataType as DataType,
      members,
    });
    workingCorrKeys.add(key);
  });

  // --- dashboard.settings (abas, barra de período, canvas) ---
  const settings: DashboardSettings = isRecord(dash?.settings)
    ? ({ ...(dash!.settings as DashboardSettings) } as DashboardSettings)
    : {};
  delete (settings as Record<string, unknown>).preset; // identidade é nossa
  const tabs = Array.isArray(settings.tabs) ? settings.tabs : [];
  const tabIds = new Set<string>();
  tabs.forEach((t, i) => {
    const id = asString((t as { id?: unknown }).id);
    const name = asString((t as { name?: unknown }).name);
    if (!id || !name) {
      errors.push(
        `dashboard.settings.tabs[${i}]: cada aba precisa de "id" (slug estável) e "name".`
      );
      return;
    }
    if (tabIds.has(id)) {
      errors.push(`dashboard.settings.tabs[${i}]: id de aba duplicado ("${id}").`);
      return;
    }
    tabIds.add(id);
  });
  const pb = settings.periodBar;
  if (pb) {
    if (pb.field) checkRef(pb.field, "dashboard.settings.periodBar.field");
    if (pb.defaultPreset != null && !PERIOD_PRESET_KEYS.has(pb.defaultPreset)) {
      errors.push(
        `dashboard.settings.periodBar.defaultPreset inválido ("${pb.defaultPreset}"). Válidos: ${Object.keys(PERIOD_PRESETS).join(", ")}, "${PERIOD_ALL}".`
      );
    }
    for (const [sk, f] of Object.entries(pb.fieldBySource ?? {})) {
      if (!sourceKeySet().has(sk)) {
        errors.push(
          `dashboard.settings.periodBar.fieldBySource: Base desconhecida ("${sk}").`
        );
      } else if (typeof f === "string") {
        checkRef(f, `dashboard.settings.periodBar.fieldBySource.${sk}`);
      }
    }
  }
  const canvasCols =
    typeof settings.canvas?.cols === "number" ? settings.canvas.cols : 12;

  // --- widgets ---
  const widgetSpecs = asArray(parsed.widgets);
  if (widgetSpecs.length === 0) {
    errors.push('"widgets" precisa de pelo menos 1 widget.');
  }
  const presetWidgets: PresetWidget[] = [];
  const usedWidgetKeys = new Set<string>();
  // Cursor de auto-posicionamento por aba (widgets sem grid_position empilham).
  const autoY = new Map<string, number>();
  widgetSpecs.forEach((w, i) => {
    const where = `widgets[${i}]`;
    if (!isRecord(w)) {
      errors.push(`${where}: precisa ser um objeto.`);
      return;
    }
    const title = asString(w.title);
    const visual = asString(w.visual_type);
    if (!VISUAL_TYPES.has(visual)) {
      errors.push(
        `${where}: "visual_type" inválido ("${visual}"). Válidos: ${[...VISUAL_TYPES].join(", ")}.`
      );
      return;
    }
    const visualType = visual as VisualType;
    const wKeySlug = slugify(asString(w.key)) || `w${i + 1}`;
    if (usedWidgetKeys.has(wKeySlug)) {
      errors.push(`${where}: "key" duplicada ("${wKeySlug}").`);
      return;
    }
    usedWidgetKeys.add(wKeySlug);

    // Bases do widget: todas precisam existir (ou terem sido declaradas).
    const sources = asArray(w.sources).map(String).filter(Boolean);
    for (const sk of sources) {
      if (!sourceKeySet().has(sk)) {
        errors.push(
          `${where}: Base desconhecida em "sources" ("${sk}"). Disponíveis: ${[...sourceKeySet()].join(", ")}.`
        );
      }
    }

    // Dimensões
    const dimensions: Dimension[] = [];
    asArray(w.dimensions).forEach((d, j) => {
      if (!isRecord(d)) return;
      const field = asString(d.field);
      const dw = `${where}.dimensions[${j}]`;
      if (!checkRef(field, dw)) return;
      const transform = asString(d.transform);
      if (transform && !TRANSFORMS.has(transform)) {
        errors.push(
          `${dw}: "transform" inválido ("${transform}"). Válidos: ${[...TRANSFORMS].join(", ")}.`
        );
        return;
      }
      const dateAgg = asString(d.dateAgg);
      if (dateAgg && !DATE_AGGS.has(dateAgg)) {
        errors.push(
          `${dw}: "dateAgg" inválido ("${dateAgg}"). Válidos: ${[...DATE_AGGS].join(", ")}.`
        );
        return;
      }
      dimensions.push({
        field,
        label: asString(d.label) || undefined,
        transform: (transform || undefined) as Dimension["transform"],
        weekMode:
          d.weekMode === "full" || d.weekMode === "restricted"
            ? d.weekMode
            : undefined,
        dateAgg: (dateAgg || undefined) as Dimension["dateAgg"],
      });
    });

    // Métricas
    const metrics: Metric[] = [];
    asArray(w.metrics).forEach((m, j) => {
      if (!isRecord(m)) return;
      const mw = `${where}.metrics[${j}]`;
      const field = asString(m.field);
      const isCalc =
        m.calc === true ||
        field === CALC_METRIC_FIELD ||
        asString(m.formula_text) !== "" ||
        isRecord(m.formula);
      if (isCalc && field.startsWith("custom:")) {
        // Reuso de campo calculado_agg salvo: métrica normal (sem fórmula própria).
        if (!checkRef(field, mw)) return;
        metrics.push({ field, agg: "sum", label: asString(m.label) || undefined });
        return;
      }
      if (isCalc) {
        const formula = resolveFormula(m, "aggregate", mw);
        if (!formula) return;
        metrics.push({
          field: CALC_METRIC_FIELD,
          agg: "sum",
          calc: true,
          formula,
          label: asString(m.label) || undefined,
          resultPercent: m.resultPercent === true || undefined,
          resultCurrency:
            typeof m.resultCurrency === "string" ? m.resultCurrency : undefined,
          percent: m.percent === true || undefined,
          sources:
            asArray(m.sources).length > 0
              ? asArray(m.sources).map(String)
              : undefined,
        });
        return;
      }
      const agg = asString(m.agg) || (field === "*" ? "count" : "sum");
      if (!AGGS.has(agg)) {
        errors.push(
          `${mw}: "agg" inválida ("${agg}"). Válidas: ${[...AGGS].join(", ")}.`
        );
        return;
      }
      if (field !== "*" && !checkRef(field, mw)) return;
      const mSources = asArray(m.sources).map(String).filter(Boolean);
      for (const sk of mSources) {
        if (!sourceKeySet().has(sk)) {
          errors.push(`${mw}: Base desconhecida em "sources" ("${sk}").`);
        }
      }
      metrics.push({
        field: field || "*",
        agg: (field === "*" ? "count" : agg) as Metric["agg"],
        label: asString(m.label) || undefined,
        percent: m.percent === true || undefined,
        sources: mSources.length > 0 ? mSources : undefined,
        conversionBasis: m.conversionBasis as Metric["conversionBasis"],
        currencyDisplay: m.currencyDisplay as Metric["currencyDisplay"],
        currencyMultiMode: m.currencyMultiMode as Metric["currencyMultiMode"],
        grandTotalMode: m.grandTotalMode as Metric["grandTotalMode"],
      });
    });

    // Filtros
    const filters: WidgetFilter[] = [];
    asArray(w.filters).forEach((f, j) => {
      if (!isRecord(f)) return;
      const fw = `${where}.filters[${j}]`;
      const field = asString(f.field);
      const op = asString(f.op);
      if (!UI_FILTER_OPS.has(op)) {
        errors.push(
          `${fw}: operador inválido ("${op}"). Válidos: ${[...UI_FILTER_OPS].join(", ")}.`
        );
        return;
      }
      if (!checkRef(field, fw)) return;
      const fSources = asArray(f.sources).map(String).filter(Boolean);
      for (const sk of fSources) {
        if (!sourceKeySet().has(sk)) {
          errors.push(`${fw}: Base desconhecida em "sources" ("${sk}").`);
        }
      }
      filters.push({
        field,
        op: op as WidgetFilter["op"],
        value: f.value,
        sources: fSources.length > 0 ? fSources : undefined,
      });
    });

    // Settings do widget: aba válida + saneamento de imagem; identidade é nossa.
    const wSettings: WidgetSettings = isRecord(w.settings)
      ? ({ ...(w.settings as WidgetSettings) } as WidgetSettings)
      : {};
    delete (wSettings as Record<string, unknown>).presetKey;
    if (tabIds.size > 0) {
      const tab = asString(wSettings.tab);
      if (!tab || !tabIds.has(tab)) {
        const first = [...tabIds][0];
        if (tab) {
          warnings.push(
            `${where}: aba desconhecida ("${tab}") — movido para a primeira aba ("${first}").`
          );
        }
        wSettings.tab = first;
      }
    } else {
      delete (wSettings as Record<string, unknown>).tab;
    }
    // Filtros rápidos: campos restritos (responsável/operação/data).
    if (Array.isArray(wSettings.quickFilters)) {
      wSettings.quickFilters = wSettings.quickFilters.filter((q, j) => {
        if (!isRecord(q) || !asString(q.field)) return false;
        const qf = asString(q.field);
        const okField =
          qf === "responsible_id" ||
          qf === "operation_id" ||
          checkRef(qf, `${where}.settings.quickFilters[${j}]`);
        if (!q.id) (q as { id?: string }).id = `qf_${wKeySlug}_${j}`;
        return okField;
      });
    }

    // grid_position: fornecida (validada) ou auto-empilhada por aba.
    const tabKey = asString(wSettings.tab) || "__single__";
    let grid: GridPosition;
    const gp = w.grid_position;
    if (
      isRecord(gp) &&
      [gp.x, gp.y, gp.w, gp.h].every((n) => typeof n === "number" && n >= 0) &&
      (gp.w as number) >= 1 &&
      (gp.h as number) >= 1
    ) {
      grid = {
        x: Math.floor(gp.x as number),
        y: Math.floor(gp.y as number),
        w: Math.floor(gp.w as number),
        h: Math.floor(gp.h as number),
      };
      if (grid.x + grid.w > canvasCols) {
        warnings.push(
          `${where}: grid_position excede as ${canvasCols} colunas do grid (x+w=${grid.x + grid.w}) — o widget pode ficar fora da área visível.`
        );
      }
    } else {
      const size = DEFAULT_WIDGET_SIZE[visualType] ?? { w: 6, h: 8 };
      const y = autoY.get(tabKey) ?? 0;
      grid = { x: 0, y, w: size.w, h: size.h };
      if (gp !== undefined) {
        warnings.push(
          `${where}: grid_position inválida — o widget foi posicionado automaticamente.`
        );
      }
    }
    autoY.set(tabKey, Math.max(autoY.get(tabKey) ?? 0, grid.y + grid.h));

    presetWidgets.push({
      presetKey: `${IMPORT_PRESET_PREFIX}${chave}.${wKeySlug}`,
      title: title || VISUAL_TYPE_LABELS[visualType],
      visual_type: visualType,
      sources: sources.length > 0 ? sources : undefined,
      split_by_source: w.split_by_source === true || undefined,
      dimensions,
      metrics,
      filters,
      settings: sanitizeImageSettings(wSettings),
      grid_position: grid,
    });
  });

  const declares = {
    fields: presetFields.length > 0,
    subSources: presetSubs.length > 0,
    correspondences: presetCorrs.length > 0,
  };
  if (errors.length > 0) return { ok: false, errors, warnings, declares };

  const preset: PresetDashboard = {
    presetKey: `${IMPORT_PRESET_PREFIX}${chave}`,
    version: 1,
    name: dashName,
    visible_to_roles: cleanRoles(
      dash?.visible_to_roles,
      warnings,
      "dashboard.visible_to_roles"
    ),
    settings,
    fields: presetFields.length > 0 ? presetFields : undefined,
    subSources: presetSubs.length > 0 ? presetSubs : undefined,
    correspondences: presetCorrs.length > 0 ? presetCorrs : undefined,
    widgets: presetWidgets,
  };
  return { ok: true, errors, warnings, preset, declares };
}

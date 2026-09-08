// Versão: 1.0 | Data: 08/09/2026
// Modelo do ESQUEMA de Workflow (0125). Um esquema é um fluxo declarado como
// DADO: um FORMULÁRIO (lista PLANA de campos) + uma sequência de PASSOS que
// consomem as respostas por referência ({{form.<key>}}, {{steps.<id>.id}}).
//
// O formulário é PLANO de propósito. Quem executa vê uma lista única de campos
// — nunca abas/seções por entidade de destino. O destrinchar em várias
// entidades (empresa → contato → lead) é interno aos PASSOS, e um campo não
// sabe em qual passo será usado: é isso que permite trocar os passos (outro
// CRM, outro destino, outro tipo de informação) sem tocar no formulário.
//
// Persistido como jsonb versionado em workflow_schemas.definition; parse
// FAIL-CLOSED — definição malformada não vira "esquema que roda como der",
// vira esquema inválido que a UI recusa (precedente de lib/comp/model.ts e
// lib/kanban/automations/types.ts). Segredo NUNCA mora aqui: o passo referencia
// uma CONEXÃO pela chave do registry (lib/workflow/connections.ts).
import { isWorkflowConnectionKey } from "./connections";

/** Tipos de campo do formulário. Espelham os inputs que a UI sabe renderizar
 *  (molde: components/registros/record-create-sheet.tsx). */
export const WORKFLOW_FIELD_TYPES = [
  "texto",
  "texto_longo",
  "email",
  "telefone",
  "numero",
  "data",
  "selecao",
] as const;
export type WorkflowFieldType = (typeof WORKFLOW_FIELD_TYPES)[number];

/** Provedores de OPÇÕES de um campo `selecao`. Todos leem o que o sistema JÁ
 *  computou — nenhum faz chamada externa na renderização do formulário. */
export const WORKFLOW_OPTIONS_SOURCES = [
  // Origens do CRM (crm.status.list ENTITY_ID='SOURCE'), já materializadas nas
  // `options` da definição `fonte` pelo syncFieldCatalog.
  "bitrix:sources",
  // Etapas de lead (ENTITY_ID='STATUS'), nas `options` da linha core `stage`.
  "bitrix:lead_status",
  // Responsáveis ativos PRINCIPAIS (canonical_id null) — mesmo recorte de
  // lib/config/responsible-options.ts.
  "responsibles",
  // Lista digitada pelo admin (o campo carrega `options`).
  "static",
] as const;
export type WorkflowOptionsSource = (typeof WORKFLOW_OPTIONS_SOURCES)[number];

export interface WorkflowFormField {
  /** Identidade do campo dentro do esquema — é o que as refs {{form.<key>}}
   *  endereçam. Slug; imutável na prática (renomear órfã as refs dos passos,
   *  e o validador do save recusa). */
  key: string;
  label: string;
  type: WorkflowFieldType;
  required: boolean;
  /** Visível no formulário. Campo oculto continua no esquema (e nas refs) —
   *  simplesmente não é perguntado; a ref dele resolve para o default/vazio. */
  visible: boolean;
  order: number;
  optionsSource?: WorkflowOptionsSource;
  /** Só para optionsSource 'static' (nos demais, as options vêm do provedor). */
  options?: string[];
  defaultValue?: string;
  placeholder?: string;
  /** Texto de ajuda sob o campo. */
  help?: string;
}

export interface WorkflowFormSpec {
  fields: WorkflowFormField[];
}

/** Como o valor resolvido é entregue ao destino. 'comm' é o formato de
 *  comunicação multi-valor do Bitrix ([{VALUE, VALUE_TYPE}]) — declarado no
 *  ESQUEMA, nunca hardcoded no executor. */
export type WorkflowValueShape = "scalar" | "comm";

export interface WorkflowFieldSpec {
  /** Template com refs (ver lib/workflow/refs.ts). */
  value: string;
  shape?: WorkflowValueShape;
}

/** Passo que cria uma entidade no CRM (crm.<entity>.add). */
export interface WorkflowBitrixAddStep {
  id: string;
  type: "bitrix.entity.add";
  label: string;
  enabled: boolean;
  /** Chave do registry de conexões — nunca um nome de variável de ambiente. */
  connection: string;
  params: {
    entity: "company" | "contact" | "lead" | "deal";
    /** fieldId do Bitrix (TITLE, UF_CRM_*, …) → como preenchê-lo. */
    fields: Record<string, WorkflowFieldSpec>;
    /** Ref cujo valor vazio faz o passo ser PULADO (sem erro). Ex.: não criar
     *  empresa quando o formulário não trouxe o nome dela. */
    skipIfEmpty?: string;
  };
}

/** Passo que grava o registro local, espelhando a entidade criada. */
export interface WorkflowRecordCreateStep {
  id: string;
  type: "record.create";
  label: string;
  enabled: boolean;
  params: {
    /** Base de destino (data_sources.key). */
    sourceKey: string;
    /** Coluna do núcleo → template. */
    core: Record<string, WorkflowFieldSpec>;
    /** field_key do campo personalizado → template. */
    custom: Record<string, WorkflowFieldSpec>;
    /**
     * Passo cujo id vira `source_id` da linha, com source_system='bitrix' e
     * last_synced_at=null — é o que faz o próximo sync ADOTAR a linha via
     * (source_system, source_id) em vez de duplicá-la
     * (mesmo contrato de lib/records/actions.ts).
     */
    linkSourceIdFrom?: string;
  };
}

export type WorkflowStep = WorkflowBitrixAddStep | WorkflowRecordCreateStep;

export const WORKFLOW_STEP_TYPES = [
  "bitrix.entity.add",
  "record.create",
] as const;

export interface WorkflowDefinition {
  version: 1;
  form: WorkflowFormSpec;
  steps: WorkflowStep[];
}

/** Tetos — um esquema é configuração humana, não carga de dados. */
export const MAX_WORKFLOW_FIELDS = 40;
export const MAX_WORKFLOW_STEPS = 12;
export const MAX_WORKFLOW_STEP_FIELDS = 60;

const SLUG_RE = /^[a-z][a-z0-9_]{0,39}$/;
const BITRIX_ENTITIES = new Set(["company", "contact", "lead", "deal"]);
// fieldId do Bitrix: TITLE, COMPANY_ID, UF_CRM_1729887583805, UTM_SOURCE…
// Restrito para o valor nunca virar interpolação em outro lugar.
const BITRIX_FIELD_ID_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function parseFieldSpec(raw: unknown): WorkflowFieldSpec | null {
  // Forma curta: a própria string é o template (shape 'scalar').
  if (typeof raw === "string") return { value: raw };
  if (!isRecord(raw)) return null;
  const value = str(raw.value);
  if (value === null) return null;
  const shape = raw.shape;
  if (shape === undefined) return { value };
  if (shape !== "scalar" && shape !== "comm") return null;
  return { value, shape };
}

function parseFieldSpecMap(
  raw: unknown,
  keyOk: (k: string) => boolean
): Record<string, WorkflowFieldSpec> | null {
  if (raw === undefined) return {};
  if (!isRecord(raw)) return null;
  const entries = Object.entries(raw);
  if (entries.length > MAX_WORKFLOW_STEP_FIELDS) return null;
  const out: Record<string, WorkflowFieldSpec> = {};
  for (const [k, v] of entries) {
    if (!keyOk(k)) return null;
    const spec = parseFieldSpec(v);
    if (!spec) return null;
    out[k] = spec;
  }
  return out;
}

function parseFormField(raw: unknown, index: number): WorkflowFormField | null {
  if (!isRecord(raw)) return null;
  const key = str(raw.key);
  if (!key || !SLUG_RE.test(key)) return null;
  const label = str(raw.label);
  if (!label || label.trim() === "") return null;
  const type = raw.type;
  if (
    typeof type !== "string" ||
    !(WORKFLOW_FIELD_TYPES as readonly string[]).includes(type)
  ) {
    return null;
  }
  const optionsSourceRaw = raw.optionsSource;
  let optionsSource: WorkflowOptionsSource | undefined;
  if (optionsSourceRaw !== undefined && optionsSourceRaw !== null) {
    if (
      typeof optionsSourceRaw !== "string" ||
      !(WORKFLOW_OPTIONS_SOURCES as readonly string[]).includes(optionsSourceRaw)
    ) {
      return null;
    }
    optionsSource = optionsSourceRaw as WorkflowOptionsSource;
  }
  // Campo de seleção sem provedor não teria de onde tirar as opções.
  if (type === "selecao" && !optionsSource) return null;
  let options: string[] | undefined;
  if (raw.options !== undefined && raw.options !== null) {
    if (!Array.isArray(raw.options)) return null;
    if (!raw.options.every((o) => typeof o === "string")) return null;
    options = raw.options as string[];
  }
  const field: WorkflowFormField = {
    key,
    label,
    type: type as WorkflowFieldType,
    required: raw.required === true,
    // Ausente = visível: um campo acrescentado ao esquema não some calado.
    visible: raw.visible !== false,
    order: typeof raw.order === "number" ? raw.order : index,
  };
  if (optionsSource) field.optionsSource = optionsSource;
  if (options) field.options = options;
  const defaultValue = str(raw.defaultValue);
  if (defaultValue) field.defaultValue = defaultValue;
  const placeholder = str(raw.placeholder);
  if (placeholder) field.placeholder = placeholder;
  const help = str(raw.help);
  if (help) field.help = help;
  return field;
}

function parseStep(raw: unknown): WorkflowStep | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  if (!id || !SLUG_RE.test(id)) return null;
  const label = str(raw.label);
  if (!label || label.trim() === "") return null;
  // Ausente = ligado: passo acrescentado ao esquema não fica inerte calado.
  const enabled = raw.enabled !== false;
  const params = isRecord(raw.params) ? raw.params : null;
  if (!params) return null;

  if (raw.type === "bitrix.entity.add") {
    const connection = str(raw.connection);
    // Conexão fora do registry = esquema inválido. É esta linha que impede o
    // jsonb de apontar para uma variável de ambiente arbitrária.
    if (!connection || !isWorkflowConnectionKey(connection)) return null;
    const entity = str(params.entity);
    if (!entity || !BITRIX_ENTITIES.has(entity)) return null;
    const fields = parseFieldSpecMap(params.fields, (k) =>
      BITRIX_FIELD_ID_RE.test(k)
    );
    if (!fields) return null;
    const step: WorkflowBitrixAddStep = {
      id,
      type: "bitrix.entity.add",
      label,
      enabled,
      connection,
      params: {
        entity: entity as WorkflowBitrixAddStep["params"]["entity"],
        fields,
      },
    };
    const skipIfEmpty = str(params.skipIfEmpty);
    if (skipIfEmpty) step.params.skipIfEmpty = skipIfEmpty;
    return step;
  }

  if (raw.type === "record.create") {
    const sourceKey = str(params.sourceKey);
    if (!sourceKey || sourceKey.trim() === "") return null;
    const core = parseFieldSpecMap(params.core, (k) => SLUG_RE.test(k));
    if (!core) return null;
    const custom = parseFieldSpecMap(params.custom, (k) => SLUG_RE.test(k));
    if (!custom) return null;
    const step: WorkflowRecordCreateStep = {
      id,
      type: "record.create",
      label,
      enabled,
      params: { sourceKey, core, custom },
    };
    const linkSourceIdFrom = str(params.linkSourceIdFrom);
    if (linkSourceIdFrom) step.params.linkSourceIdFrom = linkSourceIdFrom;
    return step;
  }

  return null;
}

/**
 * Parse FAIL-CLOSED do `definition`. Qualquer sujeira (versão errada, tipo de
 * passo desconhecido, conexão fora do registry, id duplicado, ref para um
 * passo que não existe) devolve null — o esquema inteiro fica inválido, nunca
 * meio-aplicado. A UI mostra "esquema inválido" em vez de rodar um fluxo que
 * ninguém escreveu.
 */
export function parseWorkflowDefinition(
  raw: unknown
): WorkflowDefinition | null {
  if (!isRecord(raw) || raw.version !== 1) return null;

  const formRaw = raw.form;
  if (!isRecord(formRaw) || !Array.isArray(formRaw.fields)) return null;
  if (formRaw.fields.length > MAX_WORKFLOW_FIELDS) return null;
  const fields: WorkflowFormField[] = [];
  const fieldKeys = new Set<string>();
  for (let i = 0; i < formRaw.fields.length; i += 1) {
    const parsed = parseFormField(formRaw.fields[i], i);
    if (!parsed) return null;
    if (fieldKeys.has(parsed.key)) return null;
    fieldKeys.add(parsed.key);
    fields.push(parsed);
  }
  fields.sort((a, b) => a.order - b.order);

  const stepsRaw = raw.steps;
  if (!Array.isArray(stepsRaw)) return null;
  if (stepsRaw.length > MAX_WORKFLOW_STEPS) return null;
  const steps: WorkflowStep[] = [];
  const stepIds = new Set<string>();
  for (const s of stepsRaw) {
    const parsed = parseStep(s);
    if (!parsed) return null;
    if (stepIds.has(parsed.id)) return null;
    stepIds.add(parsed.id);
    steps.push(parsed);
  }

  // `linkSourceIdFrom` apontando para passo inexistente gravaria a linha local
  // sem source_id e o sync criaria uma DUPLICATA — barra no parse.
  for (const s of steps) {
    if (s.type === "record.create" && s.params.linkSourceIdFrom) {
      if (!stepIds.has(s.params.linkSourceIdFrom)) return null;
    }
  }

  return { version: 1, form: { fields }, steps };
}

/** Campos que o formulário PERGUNTA (ordem já normalizada pelo parse). */
export function visibleFields(def: WorkflowDefinition): WorkflowFormField[] {
  return def.form.fields.filter((f) => f.visible);
}

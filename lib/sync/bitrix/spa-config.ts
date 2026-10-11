// Versão: 1.0 | Data: 11/10/2026
// CONFIGURAÇÃO de uma Base de PROCESSO INTELIGENTE (0155) — módulo PURO.
//
// Duas formas, um parse:
//   - `SpaSourceConfig` é o que fica APROVADO em `data_sources.bitrix_spa_config`
//     e o sync lê a cada job (quais campos entram, com que chave e rótulo, e de
//     quais funis);
//   - `SpaRequestConfig` é o rascunho da TRIAGEM (`sync_source_requests.config`):
//     a mesma coisa MAIS o que vira coluna da `data_sources` na aprovação (nome,
//     nome curto, período, fuso, espelho de atividades).
//
// Parse FAIL-CLOSED: o que não reconhece some (campo sem id, chave inválida,
// chave repetida). A tela da triagem e a action de aprovação usam o MESMO
// parse — o que se vê na amostra é o que entra no sync.
//
// Client-safe (sem import de servidor): a tela de triagem é Client Component e
// precisa recalcular a amostra a cada ajuste.

/** Um campo do processo escolhido para entrar na Base. */
export interface SpaFieldChoice {
  /** Id do campo no Bitrix (camelCase do `crm.item.fields`, ex. `ufCrm5_1712…`). */
  id: string;
  /** Chave em `records.custom_fields` (= `field_definitions.field_key`). */
  key: string;
  /** Rótulo do campo no app. */
  label: string;
}

export interface SpaSourceConfig {
  v: 1;
  fields: SpaFieldChoice[];
  /** Funis (categoryId) lidos. Vazio = todos. */
  categoryIds: string[];
}

export interface SpaRequestConfig extends SpaSourceConfig {
  /** Nome da Base. */
  label: string;
  shortLabel: string;
  /** Chave pedida (slug); a aprovação pode sufixar em colisão. */
  key: string;
  /** Coluna/campo de período padrão (como em Bases). */
  periodField: string;
  /** Fuso da ORIGEM (IANA) ou null — igual ao das Bases do Bitrix. */
  timezone: string | null;
  /** Espelhar tarefas/atividades no próprio processo (ida e volta). */
  mirrorActivities: boolean;
}

/**
 * Campos-padrão do item que viram COLUNAS do núcleo (`records`) no mapper —
 * nunca são oferecidos como campo personalizado. Os ids são os do
 * `crm.item.fields` (camelCase).
 */
export const SPA_CORE_FIELD_IDS = new Set<string>([
  "id",
  "title",
  "stageId",
  "previousStageId",
  "categoryId",
  "opportunity",
  "currencyId",
  "assignedById",
  "createdTime",
  "updatedTime",
  "closedate",
  "begindate",
]);

/** Campos técnicos que não fazem sentido como coluna (ids internos, arquivos…). */
export const SPA_HIDDEN_FIELD_IDS = new Set<string>([
  "xmlId",
  "createdBy",
  "updatedBy",
  "movedBy",
  "movedTime",
  "lastActivityBy",
  "lastActivityTime",
  "isManualOpportunity",
  "webformId",
  "observers",
  "contactIds",
  "taxValue",
  "opened",
  "isRecurring",
  "lastCommunicationTime",
]);

const KEY_RE = /^[a-z][a-z0-9_]{1,59}$/;
const BASE_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
export const MAX_SPA_FIELDS = 200;

function slugPart(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Slug de base (nome → chave), no formato aceito por `data_sources.key`. */
export function spaBaseKey(label: string): string {
  let k = slugPart(label).slice(0, 40);
  if (!/^[a-z]/.test(k)) k = `p_${k}`.slice(0, 40);
  return k.replace(/_+$/g, "");
}

/**
 * Chave do campo do processo em `custom_fields`: prefixada pela Base, porque
 * dois processos têm campos homônimos ("Valor", "Observação") e a chave é
 * única por org.
 */
export function spaFieldKey(baseKey: string, fieldId: string): string {
  const raw = `${baseKey}_${slugPart(fieldId.replace(/^ufCrm\d+_/i, "uf_"))}`;
  return raw.slice(0, 60).replace(/_+$/g, "");
}

/** `field_definitions.source_field_id` do campo SPA (único por portal). */
export function spaSourceFieldId(entityTypeId: number, fieldId: string): string {
  return `${entityTypeId}:${fieldId}`;
}

/** Inverso de `spaSourceFieldId`: o id do campo no Bitrix, sem o tipo. */
export function spaFieldIdFromSource(sourceFieldId: string): string {
  const i = sourceFieldId.indexOf(":");
  return i >= 0 ? sourceFieldId.slice(i + 1) : sourceFieldId;
}

function str(v: unknown, max = 200): string {
  return typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

function parseFields(raw: unknown): SpaFieldChoice[] {
  if (!Array.isArray(raw)) return [];
  const out: SpaFieldChoice[] = [];
  const seenId = new Set<string>();
  const seenKey = new Set<string>();
  for (const f of raw) {
    if (!f || typeof f !== "object") continue;
    const o = f as Record<string, unknown>;
    const id = str(o.id, 100);
    const key = str(o.key, 60);
    if (!id || !KEY_RE.test(key)) continue;
    if (SPA_CORE_FIELD_IDS.has(id)) continue;
    if (seenId.has(id) || seenKey.has(key)) continue;
    seenId.add(id);
    seenKey.add(key);
    out.push({ id, key, label: str(o.label) || id });
    if (out.length >= MAX_SPA_FIELDS) break;
  }
  return out;
}

function parseCategoryIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .map((c) => String(c ?? "").trim())
        .filter((c) => /^[0-9]+$/.test(c))
    ),
  ];
}

/** Config APROVADA (data_sources.bitrix_spa_config). null = inválida/ausente. */
export function parseSpaConfig(raw: unknown): SpaSourceConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  return {
    v: 1,
    fields: parseFields(o.fields),
    categoryIds: parseCategoryIds(o.categoryIds),
  };
}

/** Só a parte aprovável de um rascunho de triagem. */
export function toSourceConfig(c: SpaRequestConfig): SpaSourceConfig {
  return { v: 1, fields: c.fields, categoryIds: c.categoryIds };
}

const TZ_MAX = 64;

/**
 * Rascunho da triagem. Nunca lança: o que falta volta ao padrão, e o erro de
 * aprovação (nome vazio, chave inválida) é dito por `requestConfigError`.
 */
export function parseSpaRequestConfig(
  raw: unknown,
  fallback: { title: string }
): SpaRequestConfig {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw
    : {}) as Record<string, unknown>;
  const label = str(o.label, 80) || fallback.title.trim().slice(0, 80);
  const key = str(o.key, 40) || spaBaseKey(label);
  const tz = str(o.timezone, TZ_MAX);
  return {
    v: 1,
    label,
    shortLabel: str(o.shortLabel, 40) || label.slice(0, 40),
    key,
    periodField: str(o.periodField, 80) || "source_created_at",
    timezone: tz || null,
    mirrorActivities: o.mirrorActivities !== false,
    fields: parseFields(o.fields),
    categoryIds: parseCategoryIds(o.categoryIds),
  };
}

/** Mensagem que impede aprovar o rascunho, ou null. */
export function requestConfigError(c: SpaRequestConfig): string | null {
  if (!c.label) return "Dê um nome à Base.";
  if (!BASE_KEY_RE.test(c.key)) {
    return "Chave inválida: comece com letra e use só a-z, 0-9 e _ (2 a 40).";
  }
  const PERIOD_CORE = new Set([
    "source_created_at",
    "source_modified_at",
    "closed_at",
    "opened_at",
  ]);
  if (!PERIOD_CORE.has(c.periodField)) {
    const fieldKey = c.periodField.startsWith("custom:")
      ? c.periodField.slice("custom:".length)
      : null;
    if (!fieldKey || !c.fields.some((f) => f.key === fieldKey)) {
      return "O campo de período precisa ser uma data padrão ou um campo incluído.";
    }
  }
  return null;
}

/** Tipo do campo no `crm.item.fields`, o mínimo para sugerir. */
export interface SpaFieldInfo {
  id: string;
  title: string;
  type: string;
}

/**
 * Rascunho inicial de uma solicitação: todos os campos personalizados (`ufCrm*`)
 * e os padrões úteis (empresa, contato, origem…) entram; técnicos e núcleo
 * ficam de fora. Espelho de atividades LIGADO (é o pedido: ver as atividades).
 */
export function defaultSpaRequestConfig(
  type: { title: string },
  fields: SpaFieldInfo[],
  /** Fuso das Bases do Bitrix já configuradas (o portal é um só). */
  timezone: string | null = null
): SpaRequestConfig {
  const label = type.title.trim().slice(0, 80) || "Processo";
  const key = spaBaseKey(label);
  const chosen: SpaFieldChoice[] = [];
  const seen = new Set<string>();
  for (const f of fields) {
    if (SPA_CORE_FIELD_IDS.has(f.id) || SPA_HIDDEN_FIELD_IDS.has(f.id)) continue;
    if (f.type === "file") continue;
    let k = spaFieldKey(key, f.id);
    for (let n = 2; seen.has(k); n++) k = `${spaFieldKey(key, f.id).slice(0, 56)}_${n}`;
    seen.add(k);
    chosen.push({ id: f.id, key: k, label: f.title || f.id });
  }
  return {
    v: 1,
    label,
    shortLabel: label.slice(0, 40),
    key,
    periodField: "source_created_at",
    timezone,
    mirrorActivities: true,
    fields: chosen.slice(0, MAX_SPA_FIELDS),
    categoryIds: [],
  };
}

/**
 * Ao trocar a CHAVE da Base no rascunho, as chaves dos campos que ainda seguem
 * o padrão antigo acompanham (a que o usuário renomeou à mão fica).
 */
export function rekeyFields(
  fields: SpaFieldChoice[],
  oldBase: string,
  newBase: string
): SpaFieldChoice[] {
  return fields.map((f) =>
    f.key === spaFieldKey(oldBase, f.id) ? { ...f, key: spaFieldKey(newBase, f.id) } : f
  );
}

// Versão: 1.0 | Data: 11/10/2026
// AMOSTRA de um processo inteligente para a TRIAGEM (0155) — sem gravar nada.
//
// O ponto é a fidelidade: a amostra passa pelo MESMO `mapSpaItem` que o sync
// usa, então o que o usuário avalia na tela (etapa resolvida, responsável,
// datas no fuso de Brasília, campos com rótulo) é o que vai entrar como
// registro. A tela recebe os valores de TODOS os campos não-núcleo (por id) e
// mostra só os incluídos — ajustar a seleção não exige outra ida ao Bitrix.
import { ownerTypeIdOf, dynamicEntity } from "./entities";
import type { BitrixLookups } from "./lookups";
import { mapSpaItem, spaFieldType, type SpaMapEntry } from "./mapper";
import { fetchSpaSample, loadSpaSchema, type SpaSchema } from "./spa";
import { SPA_CORE_FIELD_IDS, SPA_HIDDEN_FIELD_IDS } from "./spa-config";
import type { BitrixCallable } from "./task-mirror";

export interface SpaPreviewField {
  id: string;
  title: string;
  type: string;
  readOnly: boolean;
  /** Campo técnico/arquivo — escondido por padrão na tela. */
  technical: boolean;
}

export interface SpaPreviewRow {
  id: string;
  title: string;
  stage: string;
  pipeline: string;
  responsible: string;
  value: string;
  created: string;
  modified: string;
  closed: boolean;
  /** Valor exibível por id de campo (todos os não-núcleo). */
  values: Record<string, string>;
}

export interface SpaPreviewActivity {
  id: string;
  ownerId: string;
  subject: string;
  kind: string;
  deadline: string;
  completed: boolean;
}

export interface SpaPreview {
  entityTypeId: number;
  fields: SpaPreviewField[];
  categories: { id: string; name: string }[];
  stages: string[];
  total: number | null;
  rows: SpaPreviewRow[];
  activities: SpaPreviewActivity[];
}

/** Valor do mapper → texto da tela (pt-BR). */
export function displayValue(v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (typeof v === "number") return v.toLocaleString("pt-BR");
  return String(v);
}

/** Dia/hora de Brasília (YYYY-MM-DD HH:mm) a partir do ISO normalizado. */
function displayDate(v: string | null): string {
  if (!v) return "";
  return v.slice(0, 16).replace("T", " ");
}

const ACTIVITY_KIND: Record<string, string> = {
  CRM_TODO: "Tarefa",
  CRM_MEETING: "Reunião",
  CRM_CALL: "Ligação",
  VOXIMPLANT_CALL: "Ligação",
  CRM_EMAIL: "E-mail",
};

/** Monta a amostra (schema + itens mapeados + atividades de alguns itens). */
export async function buildSpaPreview(
  api: BitrixCallable,
  lookups: BitrixLookups,
  entityTypeId: number,
  opts: { limit?: number; categoryIds?: string[]; timezone?: string | null } = {}
): Promise<SpaPreview> {
  const schema: SpaSchema = await loadSpaSchema(api, entityTypeId);
  const fields: SpaPreviewField[] = schema.fields
    .filter((f) => !SPA_CORE_FIELD_IDS.has(f.fieldId))
    .map((f) => ({
      id: f.fieldId,
      title: f.title,
      type: f.type,
      readOnly: f.isReadOnly,
      technical: SPA_HIDDEN_FIELD_IDS.has(f.fieldId) || f.type === "file",
    }));

  // Todos os campos não-núcleo, com a CHAVE = id (a tela escolhe depois).
  const mapping: SpaMapEntry[] = schema.fields
    .filter((f) => !SPA_CORE_FIELD_IDS.has(f.fieldId) && f.type !== "file")
    .map((f) => {
      const type = spaFieldType(f.fieldId, f.type);
      return {
        fieldId: f.fieldId,
        key: f.fieldId,
        type,
        ...(type === "enumeration" && f.items
          ? { items: Object.fromEntries(f.items.map((i) => [i.ID, i.VALUE])) }
          : {}),
      };
    });

  const { items, total } = await fetchSpaSample(api, entityTypeId, {
    limit: opts.limit ?? 20,
    categoryIds: opts.categoryIds,
  });

  const ctx = {
    recordType: "__preview__",
    entityTypeId,
    mapping,
    categories: schema.categories,
  };
  const rows: SpaPreviewRow[] = [];
  for (const raw of items) {
    const m = await mapSpaItem(raw, ctx, lookups, opts.timezone ?? null);
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(m.custom_fields)) values[k] = displayValue(v);
    rows.push({
      id: String(raw.id ?? ""),
      title: m.title ?? "",
      stage: m.stage ?? "",
      pipeline: m.pipeline ?? "",
      responsible: m._assignedById ? ((await lookups.userName(m._assignedById)) ?? "") : "",
      value: m.value != null ? `${displayValue(m.value)}${m.currency ? ` ${m.currency}` : ""}` : "",
      created: displayDate(m.source_created_at),
      modified: displayDate(m.source_modified_at),
      closed: m.closed,
      values,
    });
  }

  // Atividades de alguns itens da amostra — o outro lado do pedido.
  let activities: SpaPreviewActivity[] = [];
  const ownerIds = rows.slice(0, 10).map((r) => r.id).filter(Boolean);
  if (ownerIds.length > 0) {
    try {
      const res = await api.call<Record<string, unknown>[]>("crm.activity.list", {
        filter: {
          OWNER_TYPE_ID: ownerTypeIdOf(dynamicEntity(entityTypeId)),
          "@OWNER_ID": ownerIds,
        },
        select: ["ID", "OWNER_ID", "SUBJECT", "PROVIDER_ID", "DEADLINE", "COMPLETED"],
        order: { ID: "DESC" },
        start: 0,
      });
      activities = (res.result ?? []).slice(0, 20).map((a) => ({
        id: String(a.ID ?? ""),
        ownerId: String(a.OWNER_ID ?? ""),
        subject: String(a.SUBJECT ?? ""),
        kind: ACTIVITY_KIND[String(a.PROVIDER_ID ?? "")] ?? String(a.PROVIDER_ID ?? ""),
        deadline: String(a.DEADLINE ?? "").slice(0, 16).replace("T", " "),
        completed: a.COMPLETED === "Y",
      }));
    } catch {
      // Sem permissão de atividades no webhook: a amostra segue sem elas.
    }
  }

  return {
    entityTypeId,
    fields,
    categories: Object.entries(schema.categories).map(([id, name]) => ({ id, name })),
    stages: lookups.spaStageNames(entityTypeId),
    total,
    rows,
    activities,
  };
}

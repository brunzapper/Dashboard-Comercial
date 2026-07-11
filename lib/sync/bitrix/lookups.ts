// Versão: 1.1 | Data: 09/07/2026
// Resolução de IDs → nomes/labels do Bitrix, com cache. Stages/status,
// categorias (pipelines) e labels de enumeration são carregados uma vez por
// execução; nomes de usuários (user.get) usam cache persistente em
// bitrix_lookup_cache (para atravessar invocações serverless).
// v1.1 (09/07/2026): Fase 7 — guarda o metadata COMPLETO de crm.deal.fields /
//   crm.lead.fields (título, tipo, items) e expõe dealFieldMetas()/leadFieldMetas()
//   para a descoberta dinâmica de colunas (lib/sync/bitrix/catalog.ts).
import type { SupabaseClient } from "@supabase/supabase-js";

import { BitrixClient } from "./client";

interface StatusRow {
  STATUS_ID: string;
  NAME: string;
  ENTITY_ID: string;
}
interface CategoryRow {
  ID: string;
  NAME: string;
}
interface FieldDef {
  type: string;
  title?: string;
  listLabel?: string;
  formLabel?: string;
  isMultiple?: boolean;
  isReadOnly?: boolean;
  items?: { ID: string; VALUE: string }[];
}

// Metadata normalizado de um campo do Bitrix (deal/lead), consumido pela
// descoberta de colunas.
export interface BitrixFieldMeta {
  fieldId: string;
  title: string;
  type: string;
  isMultiple: boolean;
  items?: { ID: string; VALUE: string }[];
}

// Maps de resolução (status/categoria/enum) serializados para persistir na linha
// do job — permite reidratar sem re-bater em crm.status.list / crm.deal.fields a
// cada passo do sync retomável (ver serializeContext/hydrate).
export interface SerializedLookups {
  // Mapas de nomes de etapa/status SEPARADOS por entidade. crm.status.list
  // devolve status de leads (ENTITY_ID="STATUS") e etapas de deals
  // (ENTITY_ID="DEAL_STAGE"…) juntos, compartilhando códigos como "NEW"; manter
  // tudo num mapa único fazia um sobrescrever o outro (deal recebia o nome da
  // etapa do lead). Ver preload()/statusName().
  leadStatuses: Record<string, string>;
  dealStages: Record<string, string>;
  // Compat: formato antigo (mapa único) — usado só como fallback ao reidratar
  // jobs em andamento durante o deploy da correção.
  statuses?: Record<string, string>;
  categories: Record<string, string>;
  dealEnums: Record<string, Record<string, string>>;
  leadEnums: Record<string, Record<string, string>>;
}

function mapToObj(m: Map<string, string>): Record<string, string> {
  return Object.fromEntries(m);
}

function enumMapToObj(
  m: Map<string, Map<string, string>>
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [k, inner] of m) out[k] = mapToObj(inner);
  return out;
}

function objToEnumMap(
  o: Record<string, Record<string, string>>
): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const [k, inner] of Object.entries(o ?? {})) {
    out.set(k, new Map(Object.entries(inner ?? {})));
  }
  return out;
}

function toFieldMetas(fields: Record<string, FieldDef>): BitrixFieldMeta[] {
  const out: BitrixFieldMeta[] = [];
  for (const [fieldId, def] of Object.entries(fields ?? {})) {
    if (!def || typeof def !== "object") continue;
    out.push({
      fieldId,
      title: def.title || def.listLabel || def.formLabel || fieldId,
      type: def.type,
      isMultiple: Boolean(def.isMultiple),
      items: def.items,
    });
  }
  return out;
}

export class BitrixLookups {
  // Nomes de status/etapa por entidade (ver SerializedLookups). Manter separados
  // evita a colisão de código (ex.: "NEW") entre status de lead e etapa de deal.
  private leadStatuses = new Map<string, string>();
  private dealStages = new Map<string, string>();
  private categories = new Map<string, string>();
  private dealEnums = new Map<string, Map<string, string>>();
  private leadEnums = new Map<string, Map<string, string>>();
  private dealFieldMetasCache: BitrixFieldMeta[] = [];
  private leadFieldMetasCache: BitrixFieldMeta[] = [];
  private users = new Map<string, string>();
  private companies = new Map<string, string>();
  private loaded = false;

  constructor(
    private client: BitrixClient,
    private db?: SupabaseClient
  ) {}

  async preload(): Promise<void> {
    if (this.loaded) return;

    // Particiona por ENTITY_ID: leads usam "STATUS"; etapas de deal usam
    // "DEAL_STAGE" (pipeline padrão) ou "DEAL_STAGE_<categoryId>" (demais).
    const statuses = await this.client.listAll<StatusRow>("crm.status.list");
    for (const s of statuses) {
      const key = String(s.STATUS_ID);
      if (s.ENTITY_ID?.startsWith("DEAL_STAGE")) this.dealStages.set(key, s.NAME);
      else if (s.ENTITY_ID === "STATUS") this.leadStatuses.set(key, s.NAME);
    }

    this.categories.set("0", "Vendas"); // default (pode não vir na lista)
    const cats = await this.client.listAll<CategoryRow>(
      "crm.dealcategory.list"
    );
    for (const c of cats) this.categories.set(String(c.ID), c.NAME);

    const dealFields = (
      await this.client.call<Record<string, FieldDef>>("crm.deal.fields")
    ).result;
    this.dealEnums = this.buildEnumMap(dealFields);
    this.dealFieldMetasCache = toFieldMetas(dealFields);
    const leadFields = (
      await this.client.call<Record<string, FieldDef>>("crm.lead.fields")
    ).result;
    this.leadEnums = this.buildEnumMap(leadFields);
    this.leadFieldMetasCache = toFieldMetas(leadFields);

    this.loaded = true;
  }

  /**
   * Serializa os maps de resolução (status/categoria/enum) para persistir na
   * linha do job. NÃO inclui o schema de campos (dealFieldMetas) — este só é
   * usado na fase de "preparar" (buildCustomMapping/catalog), não no mapeamento
   * de cada página.
   */
  serializeContext(): SerializedLookups {
    return {
      leadStatuses: mapToObj(this.leadStatuses),
      dealStages: mapToObj(this.dealStages),
      categories: mapToObj(this.categories),
      dealEnums: enumMapToObj(this.dealEnums),
      leadEnums: enumMapToObj(this.leadEnums),
    };
  }

  /**
   * Reconstrói um BitrixLookups a partir do contexto persistido (sem tocar no
   * Bitrix). userName continua funcionando (client + cache em bitrix_lookup_cache).
   * O schema de campos (dealFieldMetas/leadFieldMetas) fica vazio — não é preciso
   * para o mapeamento de páginas.
   */
  static hydrate(
    client: BitrixClient,
    db: SupabaseClient | undefined,
    ctx: SerializedLookups
  ): BitrixLookups {
    const l = new BitrixLookups(client, db);
    // Formato novo (mapas por entidade). Fallback tolerante para o formato antigo
    // (mapa único `statuses`): sem ENTITY_ID não dá para separar, então usa o mesmo
    // mapa nos dois — jobs assim precisam de re-sync de qualquer forma.
    const legacy = ctx.statuses ? new Map(Object.entries(ctx.statuses)) : null;
    l.leadStatuses = ctx.leadStatuses
      ? new Map(Object.entries(ctx.leadStatuses))
      : (legacy ?? new Map());
    l.dealStages = ctx.dealStages
      ? new Map(Object.entries(ctx.dealStages))
      : (legacy ?? new Map());
    l.categories = new Map(Object.entries(ctx.categories ?? {}));
    l.dealEnums = objToEnumMap(ctx.dealEnums ?? {});
    l.leadEnums = objToEnumMap(ctx.leadEnums ?? {});
    l.loaded = true;
    return l;
  }

  /** Todos os campos de negócios do Bitrix (schema), para descoberta. */
  dealFieldMetas(): BitrixFieldMeta[] {
    return this.dealFieldMetasCache;
  }

  /** Todos os campos de leads do Bitrix (schema), para descoberta. */
  leadFieldMetas(): BitrixFieldMeta[] {
    return this.leadFieldMetasCache;
  }

  private buildEnumMap(
    fields: Record<string, FieldDef>
  ): Map<string, Map<string, string>> {
    const map = new Map<string, Map<string, string>>();
    for (const [key, def] of Object.entries(fields ?? {})) {
      if (def.type === "enumeration" && Array.isArray(def.items)) {
        const inner = new Map<string, string>();
        for (const it of def.items) inner.set(String(it.ID), it.VALUE);
        map.set(key, inner);
      }
    }
    return map;
  }

  statusName(
    statusId: string | null | undefined,
    entity: "deal" | "lead"
  ): string | null {
    if (statusId == null || statusId === "") return null;
    const key = String(statusId);
    const map = entity === "deal" ? this.dealStages : this.leadStatuses;
    return map.get(key) ?? key;
  }

  categoryName(categoryId?: string | null): string | null {
    if (categoryId == null || categoryId === "") return null;
    return this.categories.get(String(categoryId)) ?? String(categoryId);
  }

  findCategoryIdByName(name: string): string | null {
    const target = name.toLowerCase();
    for (const [id, n] of this.categories) {
      if (n.toLowerCase() === target) return id;
    }
    return null;
  }

  dealEnumLabel(fieldKey: string, id?: string | null): string | null {
    if (id == null || id === "") return null;
    return this.dealEnums.get(fieldKey)?.get(String(id)) ?? String(id);
  }

  leadEnumLabel(fieldKey: string, id?: string | null): string | null {
    if (id == null || id === "") return null;
    return this.leadEnums.get(fieldKey)?.get(String(id)) ?? String(id);
  }

  async userName(userId?: string | null): Promise<string | null> {
    if (userId == null || userId === "" || userId === "0") return null;
    const id = String(userId);

    const cached = this.users.get(id);
    if (cached) return cached;

    if (this.db) {
      const { data } = await this.db
        .from("bitrix_lookup_cache")
        .select("label")
        .eq("lookup_type", "user")
        .eq("source_id", id)
        .maybeSingle();
      if (data?.label) {
        this.users.set(id, data.label);
        return data.label;
      }
    }

    const resp = await this.client.call<{ NAME?: string; LAST_NAME?: string }[]>(
      "user.get",
      { ID: id }
    );
    const u = resp.result?.[0];
    const name = u
      ? `${u.NAME ?? ""} ${u.LAST_NAME ?? ""}`.trim() || id
      : id;

    this.users.set(id, name);
    if (this.db) {
      await this.db.from("bitrix_lookup_cache").upsert({
        lookup_type: "user",
        source_id: id,
        label: name,
        updated_at: new Date().toISOString(),
      });
    }
    return name;
  }

  // COMPANY_ID → nome da empresa (crm.company.get). Mesmo padrão de userName:
  // cache em memória + cache persistente (bitrix_lookup_cache) para atravessar
  // invocações serverless e evitar re-bater no Bitrix a cada deal.
  async companyName(companyId?: string | null): Promise<string | null> {
    if (companyId == null || companyId === "" || companyId === "0") return null;
    const id = String(companyId);

    const cached = this.companies.get(id);
    if (cached) return cached;

    if (this.db) {
      const { data } = await this.db
        .from("bitrix_lookup_cache")
        .select("label")
        .eq("lookup_type", "company")
        .eq("source_id", id)
        .maybeSingle();
      if (data?.label) {
        this.companies.set(id, data.label);
        return data.label;
      }
    }

    const resp = await this.client.call<{ TITLE?: string }>("crm.company.get", {
      ID: id,
    });
    const name = resp.result?.TITLE?.trim() || id;

    this.companies.set(id, name);
    if (this.db) {
      await this.db.from("bitrix_lookup_cache").upsert({
        lookup_type: "company",
        source_id: id,
        label: name,
        updated_at: new Date().toISOString(),
      });
    }
    return name;
  }
}

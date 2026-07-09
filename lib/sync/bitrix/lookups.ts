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
  private statuses = new Map<string, string>();
  private categories = new Map<string, string>();
  private dealEnums = new Map<string, Map<string, string>>();
  private leadEnums = new Map<string, Map<string, string>>();
  private dealFieldMetasCache: BitrixFieldMeta[] = [];
  private leadFieldMetasCache: BitrixFieldMeta[] = [];
  private users = new Map<string, string>();
  private loaded = false;

  constructor(
    private client: BitrixClient,
    private db?: SupabaseClient
  ) {}

  async preload(): Promise<void> {
    if (this.loaded) return;

    const statuses = await this.client.listAll<StatusRow>("crm.status.list");
    for (const s of statuses) this.statuses.set(String(s.STATUS_ID), s.NAME);

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

  statusName(statusId?: string | null): string | null {
    if (statusId == null || statusId === "") return null;
    return this.statuses.get(String(statusId)) ?? String(statusId);
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
}

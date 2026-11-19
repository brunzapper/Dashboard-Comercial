// Versão: 1.0 | Data: 19/11/2026
// Server Actions da PÁGINA DA BASE (esquema por Base, fase 4). Tudo que se
// edita aqui é o ESQUEMA da Base (`source_fields`) — rótulo e olho POR Base,
// adotar chave gravada fora do esquema, ocultar campo nunca preenchido — e o
// "Atualizar do Bitrix" (re-cataloga os campos na hora, sem esperar o sync).
// Nada aqui toca `field_definitions` (definição global) nem valor de registro.
//
// Gate: admin + área `fontes` (mesmo da tela de Bases). A RLS de
// `source_fields` (manage_field_definitions + org) é a muralha.
"use server";

import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { isSettingsAreaDenied } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { loadSources } from "@/lib/config/sources";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { BitrixClient } from "@/lib/sync/bitrix/client";
import { syncFieldCatalog } from "@/lib/sync/bitrix/catalog";
import { BitrixLookups } from "@/lib/sync/bitrix/lookups";
import {
  loadSpaSchema,
  loadSpaSyncSources,
  syncSpaFieldCatalog,
} from "@/lib/sync/bitrix/spa";

export interface BaseActionResult {
  ok: boolean;
  message?: string;
}

const REF_RE = /^(core|custom):[A-Za-z0-9_]+$/;
const MAX_BATCH = 200;

async function requireBaseWrite(): Promise<void> {
  await requireRole("admin");
  if (await isSettingsAreaDenied("fontes")) redirect("/");
}

async function rootKeyOrError(
  sourceKey: string
): Promise<{ key: string } | { error: string }> {
  const supabase = await createClient();
  const sources = await loadSources(supabase);
  const src = sources.find((s) => s.key === sourceKey);
  if (!src) return { error: "Base não encontrada." };
  if (src.parentKey) {
    return { error: "Sub-bases usam o esquema da Base pai." };
  }
  return { key: src.key };
}

/** Garante a linha e aplica o patch (rótulo/olho) — upsert por ref. */
async function patchRows(
  sourceKey: string,
  refs: string[],
  patch: { visible?: boolean; label?: string | null },
  origin: string = "manual"
): Promise<BaseActionResult> {
  await requireBaseWrite();
  const valid = refs.filter((r) => REF_RE.test(r)).slice(0, MAX_BATCH);
  if (valid.length === 0) return { ok: false, message: "Nenhum campo válido." };
  const root = await rootKeyOrError(sourceKey);
  if ("error" in root) return { ok: false, message: root.error };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, message: "Sem organização ativa." };
  const supabase = await createClient();
  const now = new Date().toISOString();

  // 1) Linhas que faltam nascem (core:<col> sem valor ainda, chave adotada).
  const { error: insErr } = await supabase.from("source_fields").upsert(
    valid.map((ref) => ({
      organization_id: orgId,
      source_key: root.key,
      field_ref: ref,
      origin: ref.startsWith("core:") ? "core" : origin,
    })),
    { onConflict: "organization_id,source_key,field_ref", ignoreDuplicates: true }
  );
  if (insErr) return { ok: false, message: insErr.message };

  // 2) Patch só do que foi pedido.
  const { error } = await supabase
    .from("source_fields")
    .update({ ...patch, updated_at: now })
    .eq("organization_id", orgId)
    .eq("source_key", root.key)
    .in("field_ref", valid);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/** Olho POR Base: some do registro desta Base (o campo segue existindo). */
export async function setBaseFieldsVisible(
  sourceKey: string,
  refs: string[],
  visible: boolean
): Promise<BaseActionResult> {
  return patchRows(sourceKey, refs, { visible });
}

/** Rótulo DESTA Base (vazio = volta ao nome global). */
export async function setBaseFieldLabel(
  sourceKey: string,
  ref: string,
  label: string
): Promise<BaseActionResult> {
  const clean = label.trim().slice(0, 80);
  return patchRows(sourceKey, [ref], { label: clean || null });
}

/** Adota chaves gravadas fora do esquema e colunas do núcleo (aba Qualidade). */
export async function adoptBaseFields(
  sourceKey: string,
  keys: string[]
): Promise<BaseActionResult> {
  return patchRows(
    sourceKey,
    keys.map((k) => (REF_RE.test(k) ? k : `custom:${k}`)),
    { visible: true }
  );
}

/**
 * "Atualizar do Bitrix": re-cataloga AGORA os campos da Base (Negócios/Leads
 * pelo catálogo do CRM; Processo Inteligente pelo schema do processo). Campo
 * novo entra no esquema pelo trigger da 0156; o que sumiu ganha o selo
 * "Removido no Bitrix". Service role (o mesmo caminho do sync).
 */
export async function refreshBaseFromBitrix(
  sourceKey: string
): Promise<BaseActionResult> {
  await requireBaseWrite();
  const supabase = await createClient();
  const sources = await loadSources(supabase);
  const src = sources.find((s) => s.key === sourceKey);
  if (!src) return { ok: false, message: "Base não encontrada." };
  const db = createServiceClient();
  try {
    const client = new BitrixClient();
    const lookups = new BitrixLookups(client, db);
    await lookups.preload();
    if (src.builtin && (src.recordType === "negocio" || src.recordType === "lead")) {
      await syncFieldCatalog(db, lookups);
      return { ok: true, message: "Campos atualizados a partir do Bitrix." };
    }
    const spa = (await loadSpaSyncSources(db)).find((s) => s.key === sourceKey);
    if (!spa) {
      return { ok: false, message: "Esta Base não vem do Bitrix." };
    }
    const schema = await loadSpaSchema(client, spa.entityTypeId);
    await syncSpaFieldCatalog(db, spa, schema, lookups.sourceNames());
    return { ok: true, message: "Campos atualizados a partir do Bitrix." };
  } catch (e) {
    return {
      ok: false,
      message: `Falha ao ler o Bitrix: ${(e as Error).message}`,
    };
  }
}

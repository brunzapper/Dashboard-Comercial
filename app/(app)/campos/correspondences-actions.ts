// Versão: 1.0 | Data: 09/07/2026
// Fase 8: Server Actions das correspondências de colunas (campos unificados).
// CRUD de field_correspondences + field_correspondence_members. Gravação com o
// client do usuário — a RLS exige manage_field_definitions. As correspondências
// são GLOBAIS: valem para todos os dashboards.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import { recordTypeOf, type SourceDef } from "@/lib/sources";
import { slugify } from "@/lib/records/slug";

export interface CorrespondenceActionState {
  ok?: boolean;
  message?: string;
}

const DATA_TYPES = [
  "texto",
  "numero",
  "data",
  "selecao",
  "moeda",
  "booleano",
  "calculado",
] as const;

async function ensureCanManage(): Promise<string | null> {
  const session = await getSessionInfo();
  if (!session) return "Sessão expirada.";
  if (!session.permissions.includes("manage_field_definitions")) {
    return "Apenas administradores podem gerenciar correspondências.";
  }
  return null;
}

// Lê os membros do form: um field_ref por fonte do CATÁLOGO — inclusive
// sub-fontes (0078). A identidade é a source-key; record_type vem do catálogo
// (o da PAI, para subs — recordTypeOf).
function readMembers(
  formData: FormData,
  sources: SourceDef[]
): { record_type: string; source_key: string; field_ref: string }[] {
  const members: {
    record_type: string;
    source_key: string;
    field_ref: string;
  }[] = [];
  for (const s of sources) {
    const ref = String(formData.get(`member_${s.key}`) ?? "").trim();
    if (ref) {
      members.push({
        record_type: recordTypeOf(s.key, sources),
        source_key: s.key,
        field_ref: ref,
      });
    }
  }
  return members;
}

export async function createCorrespondence(
  _prev: CorrespondenceActionState,
  formData: FormData
): Promise<CorrespondenceActionState> {
  const err = await ensureCanManage();
  if (err) return { ok: false, message: err };

  const label = String(formData.get("label") ?? "").trim();
  const dataType = String(formData.get("data_type") ?? "texto");
  if (!label) return { ok: false, message: "Informe o rótulo." };
  if (!DATA_TYPES.includes(dataType as (typeof DATA_TYPES)[number])) {
    return { ok: false, message: "Tipo de dado inválido." };
  }
  const key = slugify(label);
  if (!key) return { ok: false, message: "Rótulo inválido para gerar a chave." };
  const supabase = await createClient();
  const members = readMembers(formData, await loadSources(supabase));
  if (members.length < 2) {
    return { ok: false, message: "Ligue colunas de pelo menos duas bases." };
  }

  // Carimbo de org (multi-org, 0090).
  const orgId = await getActiveOrgId();
  const { data: created, error } = await supabase
    .from("field_correspondences")
    .insert({
      key,
      label,
      data_type: dataType,
      ...(orgId ? { organization_id: orgId } : {}),
    })
    .select("id")
    .maybeSingle();
  if (error) {
    const msg =
      error.code === "23505"
        ? `Já existe uma correspondência com a chave "${key}".`
        : error.message;
    return { ok: false, message: msg };
  }
  const id = created?.id as string | undefined;
  if (id) {
    await supabase
      .from("field_correspondence_members")
      .insert(members.map((m) => ({ ...m, correspondence_id: id })));
  }
  revalidatePath("/campos");
  return { ok: true, message: `Correspondência "${label}" criada.` };
}

export async function updateCorrespondence(
  _prev: CorrespondenceActionState,
  formData: FormData
): Promise<CorrespondenceActionState> {
  const err = await ensureCanManage();
  if (err) return { ok: false, message: err };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Correspondência não identificada." };
  const label = String(formData.get("label") ?? "").trim();
  const dataType = String(formData.get("data_type") ?? "texto");
  if (!label) return { ok: false, message: "Informe o rótulo." };
  const supabase = await createClient();
  const members = readMembers(formData, await loadSources(supabase));
  if (members.length < 2) {
    return { ok: false, message: "Ligue colunas de pelo menos duas bases." };
  }

  const { error } = await supabase
    .from("field_correspondences")
    .update({ label, data_type: dataType })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };

  // Substitui os membros (delete + insert) — mais simples que diff.
  await supabase
    .from("field_correspondence_members")
    .delete()
    .eq("correspondence_id", id);
  await supabase
    .from("field_correspondence_members")
    .insert(members.map((m) => ({ ...m, correspondence_id: id })));

  revalidatePath("/campos");
  return { ok: true, message: `Correspondência "${label}" atualizada.` };
}

export async function deleteCorrespondence(formData: FormData): Promise<void> {
  const err = await ensureCanManage();
  if (err) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  // members caem por ON DELETE CASCADE.
  await supabase.from("field_correspondences").delete().eq("id", id);
  revalidatePath("/campos");
}

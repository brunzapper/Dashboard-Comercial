// Versão: 1.0 | Data: 09/07/2026
// Fase 8: Server Actions das correspondências de colunas (campos unificados).
// CRUD de field_correspondences + field_correspondence_members. Gravação com o
// client do usuário — a RLS exige manage_field_definitions. As correspondências
// são GLOBAIS: valem para todos os dashboards.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { SOURCE_KEYS, SOURCE_RECORD_TYPE } from "@/lib/sources";

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

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

async function ensureCanManage(): Promise<string | null> {
  const session = await getSessionInfo();
  if (!session) return "Sessão expirada.";
  if (!session.permissions.includes("manage_field_definitions")) {
    return "Apenas administradores podem gerenciar correspondências.";
  }
  return null;
}

// Lê os membros do form: um field_ref por fonte (vazio = sem membro).
function readMembers(formData: FormData): {
  record_type: "lead" | "negocio" | "venda_site";
  field_ref: string;
}[] {
  const members: {
    record_type: "lead" | "negocio" | "venda_site";
    field_ref: string;
  }[] = [];
  for (const key of SOURCE_KEYS) {
    const ref = String(formData.get(`member_${key}`) ?? "").trim();
    if (ref) {
      members.push({ record_type: SOURCE_RECORD_TYPE[key], field_ref: ref });
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
  const members = readMembers(formData);
  if (members.length < 2) {
    return { ok: false, message: "Ligue colunas de pelo menos duas fontes." };
  }

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from("field_correspondences")
    .insert({ key, label, data_type: dataType })
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
  const members = readMembers(formData);
  if (members.length < 2) {
    return { ok: false, message: "Ligue colunas de pelo menos duas fontes." };
  }

  const supabase = await createClient();
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

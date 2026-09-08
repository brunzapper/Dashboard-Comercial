// Versão: 1.0 | Data: 07/08/2026
// Server Actions da aba Campos → Reclassificações (domínios DINÂMICOS de
// mapeamento, 0119). CRUD da linha `mapping_domains` com o client do USUÁRIO
// (RLS: admin da org); a aplicação aos registros e a tarefa de pendências
// rodam com service role + org EXPLÍCITA (mesmo caminho do "Aplicar agora").
// Gate: admin + área "mapeamentos" (feature org — deny barra escrita também;
// a aba some da UI, e aqui é a muralha). Key do domínio é IMUTÁVEL na edição
// (identidade das entradas value_mappings.domain) e não pode colidir com os
// domínios em código. Excluir domínio EXCLUI as entradas do de-para dele
// (config do domínio) mas PRESERVA os field_definitions alvo e os valores já
// materializados nos registros (padrão "desligar nunca apaga dados").
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { isSettingsAreaDenied } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { MAPPING_DOMAINS } from "@/lib/mappings/domains";
import { loadMappingDomains } from "@/lib/mappings/registry";
import {
  applyValueMappings,
  ensureMappingFields,
} from "@/lib/mappings/apply";
import { syncUnmappedTasks } from "@/lib/mappings/notify";
import {
  loadMappingOverview,
  type DomainOverview,
} from "@/lib/mappings/overview";
import { slugify } from "@/lib/records/slug";

const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,59}$/;
const MAX_TARGETS = 3;

export interface ReclassTargetInput {
  fieldKey: string;
  label: string;
  options: string[];
}

export interface ReclassDomainInput {
  /** Vazio na criação (derivado do label); imutável na edição. */
  key?: string;
  label: string;
  recordTypes: string[];
  rawFieldKey: string;
  rawFieldLabel: string;
  targets: ReclassTargetInput[];
}

export interface ReclassActionState {
  ok?: boolean;
  message?: string;
}

/** Linha crua de mapping_domains p/ o form de edição da aba. */
export interface ReclassDomainRow {
  key: string;
  label: string;
  recordTypes: string[];
  rawFieldKey: string;
  rawFieldLabel: string;
  targets: ReclassTargetInput[];
}

export interface ReclassOverviewPayload {
  ok: boolean;
  message?: string;
  overview: DomainOverview[];
  /** Só os domínios DINÂMICOS (linhas do banco), p/ edição. */
  rows: ReclassDomainRow[];
}

async function ensureCanManage(): Promise<string | null> {
  const session = await getSessionInfo();
  if (!session) return "Sessão expirada.";
  if (!session.roles.includes("admin")) {
    return "Apenas administradores podem gerenciar reclassificações.";
  }
  if (await isSettingsAreaDenied("mapeamentos")) {
    return "Acesso a esta área foi bloqueado.";
  }
  return null;
}

function revalidate() {
  revalidatePath("/campos");
  revalidatePath("/operacao/mapeamentos");
  revalidatePath("/dashboards/[id]", "page");
}

/**
 * Carregamento LAZY da aba (na 1ª ativação): overview de TODOS os domínios
 * (código + dinâmicos) + linhas cruas dos dinâmicos p/ o form de edição.
 */
export async function loadReclassOverview(): Promise<ReclassOverviewPayload> {
  const err = await ensureCanManage();
  if (err) return { ok: false, message: err, overview: [], rows: [] };
  const orgId = await getActiveOrgId();
  if (!orgId) {
    return {
      ok: false,
      message: "Organização ativa não identificada.",
      overview: [],
      rows: [],
    };
  }
  const supabase = await createClient();
  const domains = await loadMappingDomains(supabase, orgId);
  const overview = await loadMappingOverview(supabase, orgId, { domains });
  const { data } = await supabase
    .from("mapping_domains")
    .select("key, label, record_types, raw_field_key, raw_field_label, targets")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });
  const rows: ReclassDomainRow[] = (data ?? []).map((r) => ({
    key: r.key as string,
    label: r.label as string,
    recordTypes: (r.record_types ?? []) as string[],
    rawFieldKey: r.raw_field_key as string,
    rawFieldLabel: r.raw_field_label as string,
    targets: (Array.isArray(r.targets) ? r.targets : []) as ReclassTargetInput[],
  }));
  return { ok: true, overview, rows };
}

function validateInput(input: ReclassDomainInput): string | null {
  if (!input.label.trim()) return "Informe o nome da reclassificação.";
  if (input.recordTypes.length === 0) return "Escolha ao menos uma base.";
  if (input.recordTypes.some((t) => typeof t !== "string" || !t.trim())) {
    return "Base inválida.";
  }
  if (!FIELD_KEY_RE.test(input.rawFieldKey)) {
    return "Campo de origem inválido.";
  }
  if (!input.rawFieldLabel.trim()) return "Campo de origem sem rótulo.";
  if (input.targets.length === 0) return "Defina ao menos um campo classificado.";
  if (input.targets.length > MAX_TARGETS) {
    return `No máximo ${MAX_TARGETS} campos classificados por reclassificação.`;
  }
  const seen = new Set<string>();
  for (const t of input.targets) {
    if (!t.label.trim()) return "Campo classificado sem nome.";
    if (!FIELD_KEY_RE.test(t.fieldKey)) {
      return `Chave de campo inválida: "${t.fieldKey}".`;
    }
    if (t.fieldKey === input.rawFieldKey) {
      return "O campo classificado não pode ser o próprio campo de origem.";
    }
    if (seen.has(t.fieldKey)) return `Campo repetido: "${t.fieldKey}".`;
    seen.add(t.fieldKey);
    if (t.options.filter((o) => o.trim()).length === 0) {
      return `Defina as categorias de "${t.label}" antes de começar.`;
    }
  }
  return null;
}

/** Cria/edita um domínio dinâmico e aplica aos registros. */
export async function saveMappingDomain(
  input: ReclassDomainInput
): Promise<ReclassActionState> {
  const err = await ensureCanManage();
  if (err) return { ok: false, message: err };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, message: "Organização ativa não identificada." };

  const editing = Boolean(input.key?.trim());
  const key = editing ? input.key!.trim() : slugify(input.label);
  if (!KEY_RE.test(key)) {
    return { ok: false, message: `Chave de reclassificação inválida: "${key}".` };
  }
  if (MAPPING_DOMAINS.some((d) => d.key === key)) {
    return { ok: false, message: `A chave "${key}" é reservada pelo sistema.` };
  }
  const invalid = validateInput(input);
  if (invalid) return { ok: false, message: invalid };

  const supabase = await createClient();

  // Alvo homônimo já existente precisa ser texto (a classificação grava
  // strings); campo de origem precisa existir.
  const { data: defs } = await supabase
    .from("field_definitions")
    .select("field_key, data_type")
    .in("field_key", [
      input.rawFieldKey,
      ...input.targets.map((t) => t.fieldKey),
    ]);
  const byKey = new Map(
    (defs ?? []).map((d) => [d.field_key as string, d.data_type as string])
  );
  if (!byKey.has(input.rawFieldKey)) {
    return {
      ok: false,
      message: `Campo de origem "${input.rawFieldKey}" não existe no catálogo.`,
    };
  }
  for (const t of input.targets) {
    const dt = byKey.get(t.fieldKey);
    if (dt && dt !== "texto") {
      return {
        ok: false,
        message:
          `O campo "${t.fieldKey}" já existe com tipo "${dt}" — o alvo de uma ` +
          `reclassificação precisa ser um campo de texto.`,
      };
    }
  }

  const { error } = await supabase.from("mapping_domains").upsert(
    {
      organization_id: orgId,
      key,
      label: input.label.trim(),
      record_types: input.recordTypes,
      raw_field_key: input.rawFieldKey,
      raw_field_label: input.rawFieldLabel.trim(),
      targets: input.targets.map((t) => ({
        fieldKey: t.fieldKey,
        label: t.label.trim(),
        options: t.options.map((o) => o.trim()).filter(Boolean),
      })),
    },
    { onConflict: "organization_id,key" }
  );
  if (error) return { ok: false, message: `Falha ao salvar: ${error.message}` };

  // Garante os campos alvo + aplica + sincroniza a tarefa de pendências.
  const service = createServiceClient();
  const domains = (await loadMappingDomains(service, orgId)).filter(
    (d) => d.key === key
  );
  await ensureMappingFields(service, orgId, domains);
  const res = await applyValueMappings(service, orgId, [key]);
  await syncUnmappedTasks(service, orgId, res.unmapped, domains);
  const pend = Object.values(res.unmapped).reduce((s, m) => s + m.size, 0);
  revalidate();
  return {
    ok: true,
    message:
      `Reclassificação ${editing ? "atualizada" : "criada"}. ` +
      `${res.changedRecords} registro(s) atualizado(s); ${pend} valor(es) pendente(s).`,
  };
}

/**
 * Exclui um domínio dinâmico: fecha a tarefa de pendências, exclui as
 * ENTRADAS do de-para e a linha do domínio. Campos alvo e valores já
 * materializados nos registros são preservados.
 */
export async function deleteMappingDomain(
  key: string
): Promise<ReclassActionState> {
  const err = await ensureCanManage();
  if (err) return { ok: false, message: err };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, message: "Organização ativa não identificada." };
  if (MAPPING_DOMAINS.some((d) => d.key === key)) {
    return { ok: false, message: "Reclassificações do sistema não podem ser excluídas." };
  }

  const service = createServiceClient();
  const domains = (await loadMappingDomains(service, orgId)).filter(
    (d) => d.key === key
  );
  if (domains.length === 0) {
    return { ok: false, message: "Reclassificação não encontrada." };
  }
  // Fecha a tarefa de pendências aberta (tally vazio ⇒ auto-completa).
  await syncUnmappedTasks(service, orgId, {}, domains);

  const supabase = await createClient();
  const { error: entriesErr } = await supabase
    .from("value_mappings")
    .delete()
    .eq("organization_id", orgId)
    .eq("domain", key);
  if (entriesErr) {
    return { ok: false, message: `Falha ao excluir entradas: ${entriesErr.message}` };
  }
  const { error } = await supabase
    .from("mapping_domains")
    .delete()
    .eq("organization_id", orgId)
    .eq("key", key);
  if (error) return { ok: false, message: `Falha ao excluir: ${error.message}` };
  revalidate();
  return {
    ok: true,
    message:
      "Reclassificação excluída. Os campos classificados e os valores já " +
      "gravados nos registros foram preservados.",
  };
}

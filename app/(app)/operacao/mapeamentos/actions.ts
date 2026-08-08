// Versão: 1.1 | Data: 08/08/2026
// Server Actions de /operacao/mapeamentos (de-para de valores, 0117).
// Escrita em value_mappings com o client do USUÁRIO (RLS: admin da org);
// a APLICAÇÃO aos registros roda com service role + org EXPLÍCITA
// (lib/mappings/apply.ts — espelho derivado) e sincroniza a tarefa de
// pendências do admin (lib/mappings/notify.ts). Gate: papel admin + área
// "mapeamentos" (feature org "mapeamentos"; deny barra escrita também).
// v1.1: saveMappings em LOTE (o gestor coalesce linhas → UM upsert + UMA
// reaplicação) e opt-out `revalidate: false` nas 3 actions — padrão do save
// otimista em background (§4.10; o cliente reconcilia via refresh debounced).
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { isSettingsAreaDenied } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { applyValueMappings } from "@/lib/mappings/apply";
import { syncUnmappedTasks } from "@/lib/mappings/notify";
import { normalizeRawValue } from "@/lib/mappings/domains";
import { loadMappingDomains } from "@/lib/mappings/registry";

export interface MappingActionState {
  ok?: boolean;
  message?: string;
}

async function ensureCanManage(): Promise<string | null> {
  const session = await getSessionInfo();
  if (!session) return "Sessão expirada.";
  if (!session.roles.includes("admin")) {
    return "Apenas administradores podem gerenciar mapeamentos.";
  }
  if (await isSettingsAreaDenied("mapeamentos")) {
    return "Acesso a esta área foi bloqueado.";
  }
  return null;
}

/** Aplica o(s) domínio(s) aos registros + sincroniza tarefas de pendência. */
async function applyDomains(domainKeys?: string[]): Promise<string> {
  const orgId = await getActiveOrgId();
  if (!orgId) return "Organização ativa não identificada.";
  const service = createServiceClient();
  const res = await applyValueMappings(service, orgId, domainKeys);
  const all = await loadMappingDomains(service, orgId);
  const domains = domainKeys ? all.filter((d) => domainKeys.includes(d.key)) : all;
  await syncUnmappedTasks(service, orgId, res.unmapped, domains);
  const pend = Object.values(res.unmapped).reduce((s, m) => s + m.size, 0);
  const errs = res.errors.length > 0 ? ` (${res.errors.length} erro(s))` : "";
  const auto =
    res.autoMapped > 0
      ? `${res.autoMapped} valor(es) classificado(s) automaticamente; `
      : "";
  return (
    `${auto}${res.changedRecords} registro(s) atualizado(s); ` +
    `${pend} valor(es) pendente(s)${errs}.`
  );
}

function revalidate() {
  revalidatePath("/operacao/mapeamentos");
  revalidatePath("/campos");
  revalidatePath("/dashboards/[id]", "page");
}

export interface MappingEntryInput {
  rawValue: string;
  /** Classificação por target do domínio; vazio/ausente limpa o target. */
  outputs: Record<string, string>;
}

/**
 * Cria/edita entradas do de-para em LOTE — o gestor coalesce as linhas
 * salvas em sequência numa chamada só: UM upsert + UMA reaplicação do
 * domínio. Outputs substituem a coluna inteira (target vazio cai no fallback
 * "Não Classificado" na aplicação); dedup por raw_norm (última vence).
 */
export async function saveMappings(
  domainKey: string,
  entries: MappingEntryInput[],
  opts?: { revalidate?: boolean }
): Promise<MappingActionState> {
  const err = await ensureCanManage();
  if (err) return { ok: false, message: err };

  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, message: "Organização ativa não identificada." };
  const supabase = await createClient();
  const domains = await loadMappingDomains(supabase, orgId);
  const domain = domains.find((d) => d.key === domainKey);
  if (!domain) return { ok: false, message: "Domínio desconhecido." };

  const byNorm = new Map<string, Record<string, unknown>>();
  for (const entry of entries) {
    const rawValue = String(entry.rawValue ?? "").trim();
    const rawNorm = normalizeRawValue(rawValue);
    if (!rawNorm) return { ok: false, message: "Informe o valor a mapear." };
    const outputs: Record<string, string> = {};
    for (const t of domain.targets) {
      const v = String(entry.outputs?.[t.fieldKey] ?? "").trim();
      if (v) outputs[t.fieldKey] = v;
    }
    if (Object.keys(outputs).length === 0) {
      return {
        ok: false,
        message: `Preencha ao menos uma classificação ("${rawValue}").`,
      };
    }
    byNorm.set(rawNorm, {
      organization_id: orgId,
      domain: domain.key,
      raw_value: rawValue,
      raw_norm: rawNorm,
      outputs,
    });
  }
  if (byNorm.size === 0) return { ok: false, message: "Nenhum valor a mapear." };

  const { error } = await supabase
    .from("value_mappings")
    .upsert([...byNorm.values()], {
      onConflict: "organization_id,domain,raw_norm",
    });
  if (error) return { ok: false, message: `Falha ao salvar: ${error.message}` };

  const message = await applyDomains([domain.key]);
  if (opts?.revalidate !== false) revalidate();
  return { ok: true, message: `${byNorm.size} mapeamento(s) salvo(s). ${message}` };
}

/** Exclui uma entrada; os registros voltam ao fallback na reaplicação. */
export async function deleteMapping(
  id: string,
  opts?: { revalidate?: boolean }
): Promise<MappingActionState> {
  const err = await ensureCanManage();
  if (err) return { ok: false, message: err };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("value_mappings")
    .delete()
    .eq("id", id)
    .select("domain")
    .maybeSingle();
  if (error) return { ok: false, message: `Falha ao excluir: ${error.message}` };
  const domainKey = (data?.domain as string | undefined) ?? undefined;
  const message = await applyDomains(domainKey ? [domainKey] : undefined);
  if (opts?.revalidate !== false) revalidate();
  return { ok: true, message: `Mapeamento excluído. ${message}` };
}

/** Reaplica todos os domínios aos registros (botão "Aplicar agora"). */
export async function applyAllMappings(
  opts?: { revalidate?: boolean }
): Promise<MappingActionState> {
  const err = await ensureCanManage();
  if (err) return { ok: false, message: err };
  const message = await applyDomains();
  if (opts?.revalidate !== false) revalidate();
  return { ok: true, message };
}

// Versão: 1.0 | Data: 07/08/2026
// NÚCLEO do assistente de IA de MAPEAMENTOS (Operação → Mapeamentos →
// "Classificar com IA"). A IA NUNCA escreve: generateMappingsCore valida o
// lote (lib/import/mappings/validate — valores restritos aos PENDENTES,
// categorias restritas às aceitas) e devolve prévia EDITÁVEL;
// applyMappingsClassifyCore RE-VALIDA com contexto FRESCO e grava entradas
// `origin='ai'` pelo mesmo upsert da página (client do usuário — RLS admin),
// reaplicando o domínio (service role) + sincronizando a tarefa de
// pendências. previewMappingsCore valida JSON colado SEM IA (fluxo
// copiar-prompt → colar-JSON de IA externa) e buildMappingsPromptCore monta
// o MESMO prompt do chat interno. Padrão §4.17 (modelo: manage-operations).
import "server-only";

import { getSessionInfo } from "@/lib/auth/session";
import { isSettingsAreaDenied } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadOrgAiConfig } from "@/lib/ai/config";
import { aiSection, runJsonGenerationLoop } from "@/lib/ai/json-loop";
import { loadMappingOverview } from "@/lib/mappings/overview";
import { mappingDomain, normalizeRawValue } from "@/lib/mappings/domains";
import { applyValueMappings } from "@/lib/mappings/apply";
import { syncUnmappedTasks } from "@/lib/mappings/notify";
import { buildMappingsClassifyPromptText } from "@/lib/import/mappings/instructions";
import { validateMappingsClassify } from "@/lib/import/mappings/validate";
import type {
  MappingsClassifyContext,
  ParsedMappingItem,
} from "@/lib/import/mappings/types";

export interface GenerateMappingsInput {
  domainKey: string;
  description: string;
  priorTurns?: string[];
  /** Prévia pendente — a resposta SUBSTITUI a proposta inteira. */
  pendingJson?: string;
}

export interface GenerateMappingsState {
  ok: boolean;
  message?: string;
  errors?: string[];
  /** Itens validados — a prévia EDITÁVEL renderiza daqui. */
  items?: ParsedMappingItem[];
  summary?: string[];
  warnings?: string[];
}

export interface ApplyMappingsClassifyState {
  ok: boolean;
  message?: string;
  errors?: string[];
  appliedCount?: number;
  failed?: { rawValue: string; message: string }[];
}

// Mesmo gate do ensureCanManage de operacao/mapeamentos/actions.ts.
async function gate(): Promise<string | null> {
  const s = await getSessionInfo();
  if (!s) return "Sessão expirada.";
  if (!s.roles.includes("admin")) return "Apenas administradores.";
  if (await isSettingsAreaDenied("mapeamentos"))
    return "Acesso a esta área foi bloqueado.";
  return null;
}

interface LoadedContext {
  ctx: MappingsClassifyContext;
  targetsJson: string;
  pendingJson: string;
}

// Contexto FRESCO (geração E apply): pendências + categorias aceitas do
// domínio, do MESMO loader da página (RLS do usuário).
async function loadClassifyContext(
  domainKey: string
): Promise<LoadedContext | { error: string }> {
  const domain = mappingDomain(domainKey);
  if (!domain) return { error: "Domínio de mapeamento desconhecido." };
  const orgId = await getActiveOrgId();
  if (!orgId) return { error: "Organização ativa não identificada." };
  const supabase = await createClient();
  const overview = await loadMappingOverview(supabase, orgId);
  const dom = overview.find((d) => d.key === domainKey);
  if (!dom) return { error: "Domínio de mapeamento desconhecido." };

  const ctx: MappingsClassifyContext = {
    domainKey: domain.key,
    domainLabel: domain.label,
    rawFieldLabel: domain.rawFieldLabel,
    targets: domain.targets,
    optionsByTarget: dom.optionsByTarget,
    pending: dom.unmapped.map((u) => ({
      value: u.value,
      norm: normalizeRawValue(u.value),
      count: u.count,
    })),
  };
  const targetsJson = JSON.stringify(
    Object.fromEntries(
      domain.targets.map((t) => [
        t.fieldKey,
        { rotulo: t.label, categorias_aceitas: dom.optionsByTarget[t.fieldKey] ?? [] },
      ])
    ),
    null,
    2
  );
  const pendingJson = JSON.stringify(
    ctx.pending.map((p) => ({ valor: p.value, registros: p.count })),
    null,
    2
  );
  return { ctx, targetsJson, pendingJson };
}

function summaryOf(it: ParsedMappingItem): string {
  const saidas = Object.values(it.outputs).join(" / ");
  return `"${it.rawValue}" → ${saidas} (${it.count} registro${it.count === 1 ? "" : "s"})`;
}

export async function generateMappingsCore(
  input: GenerateMappingsInput
): Promise<GenerateMappingsState> {
  const err = await gate();
  if (err) return { ok: false, message: err };

  const orgId = await getActiveOrgId();
  const aiConfig = orgId ? await loadOrgAiConfig(orgId) : null;
  if (!aiConfig) {
    return {
      ok: false,
      message:
        "IA não configurada para a organização — um administrador define o provedor em Configurações → Integrações.",
    };
  }

  const loaded = await loadClassifyContext(input.domainKey);
  if ("error" in loaded) return { ok: false, message: loaded.error };
  if (loaded.ctx.pending.length === 0) {
    return { ok: false, message: "Não há valores pendentes neste domínio." };
  }

  let system = buildMappingsClassifyPromptText({
    domainKey: loaded.ctx.domainKey,
    domainLabel: loaded.ctx.domainLabel,
    rawFieldLabel: loaded.ctx.rawFieldLabel,
    targetsJson: loaded.targetsJson,
    pendingJson: loaded.pendingJson,
  });
  const pending = (input.pendingJson ?? "").trim();
  if (pending) {
    system += aiSection(
      "PRÉVIA PENDENTE (AINDA NÃO APLICADA)",
      "No turno anterior você propôs os itens abaixo e o usuário AINDA NÃO " +
        "confirmou. Sua resposta deste turno SUBSTITUI a proposta INTEIRA: " +
        "re-inclua os itens que continuarem desejados.\n\n" +
        pending
    );
  }

  const description =
    input.description.trim() ||
    "Classifique os valores pendentes listados no contexto.";
  const result = await runJsonGenerationLoop<{
    items: ParsedMappingItem[];
    warnings: string[];
  }>({
    config: aiConfig,
    system,
    priorTurns: input.priorTurns ?? [],
    description,
    validate: (raw) => {
      const v = validateMappingsClassify(raw, loaded.ctx);
      if (!v.ok) return { ok: false, errors: v.errors };
      return { ok: true, value: { items: v.items, warnings: v.warnings } };
    },
  });
  if (!result.ok) {
    return { ok: false, message: result.message, errors: result.errors };
  }
  const { items, warnings } = result.value;
  return {
    ok: true,
    message: "Prévia pronta — ajuste o que quiser e confirme a aplicação.",
    items,
    summary: items.map((it, i) => `${i + 1}. ${summaryOf(it)}`),
    warnings,
  };
}

/** Valida um JSON COLADO (fluxo de IA externa) — mesma prévia, sem IA. */
export async function previewMappingsCore(
  domainKey: string,
  raw: string
): Promise<GenerateMappingsState> {
  const err = await gate();
  if (err) return { ok: false, message: err };
  if (!raw.trim()) return { ok: false, message: "Cole o JSON devolvido pela IA." };
  const loaded = await loadClassifyContext(domainKey);
  if ("error" in loaded) return { ok: false, message: loaded.error };
  const v = validateMappingsClassify(raw, loaded.ctx);
  if (!v.ok) {
    return {
      ok: false,
      message: "O JSON tem problemas — corrija na IA externa e cole de novo.",
      errors: v.errors,
    };
  }
  return {
    ok: true,
    message: "Prévia pronta — ajuste o que quiser e confirme a aplicação.",
    items: v.items,
    summary: v.items.map((it, i) => `${i + 1}. ${summaryOf(it)}`),
    warnings: v.warnings,
  };
}

/** Prompt completo p/ IA externa: MESMO SPEC do chat + contexto atual. */
export async function buildMappingsPromptCore(domainKey: string): Promise<{
  ok: boolean;
  prompt?: string;
  message?: string;
}> {
  const err = await gate();
  if (err) return { ok: false, message: err };
  const loaded = await loadClassifyContext(domainKey);
  if ("error" in loaded) return { ok: false, message: loaded.error };
  if (loaded.ctx.pending.length === 0) {
    return { ok: false, message: "Não há valores pendentes neste domínio." };
  }
  return {
    ok: true,
    prompt: buildMappingsClassifyPromptText({
      domainKey: loaded.ctx.domainKey,
      domainLabel: loaded.ctx.domainLabel,
      rawFieldLabel: loaded.ctx.rawFieldLabel,
      targetsJson: loaded.targetsJson,
      pendingJson: loaded.pendingJson,
    }),
  };
}

export async function applyMappingsClassifyCore(
  domainKey: string,
  raw: string
): Promise<ApplyMappingsClassifyState> {
  const err = await gate();
  if (err) return { ok: false, message: err };

  // Contexto FRESCO + RE-VALIDAÇÃO: a prévia pode ter sido editada e as
  // pendências podem ter mudado entre a prévia e o clique.
  const loaded = await loadClassifyContext(domainKey);
  if ("error" in loaded) return { ok: false, message: loaded.error };
  const validation = validateMappingsClassify(raw, loaded.ctx);
  if (!validation.ok) {
    return {
      ok: false,
      message: "A proposta tem problemas — ajuste e tente de novo.",
      errors: validation.errors,
    };
  }

  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, message: "Organização ativa não identificada." };
  const supabase = await createClient();
  const failed: { rawValue: string; message: string }[] = [];
  let appliedCount = 0;
  for (const it of validation.items) {
    const { error } = await supabase.from("value_mappings").upsert(
      {
        organization_id: orgId,
        domain: domainKey,
        raw_value: it.rawValue,
        raw_norm: it.rawNorm,
        outputs: it.outputs,
        origin: "ai",
      },
      { onConflict: "organization_id,domain,raw_norm" }
    );
    if (error) failed.push({ rawValue: it.rawValue, message: error.message });
    else appliedCount += 1;
  }

  // Reaplica o domínio aos registros + sincroniza a tarefa de pendências
  // (service role com org explícita — mesmo caminho do "Aplicar agora").
  let applyNote = "";
  if (appliedCount > 0) {
    const service = createServiceClient();
    const res = await applyValueMappings(service, orgId, [domainKey]);
    await syncUnmappedTasks(service, orgId, res.unmapped, [domainKey]);
    const pend = Object.values(res.unmapped).reduce((s, m) => s + m.size, 0);
    applyNote = ` ${res.changedRecords} registro(s) atualizado(s); ${pend} valor(es) seguem pendentes.`;
  }

  const total = validation.items.length;
  const message =
    appliedCount === total
      ? `${appliedCount} classificação(ões) aplicada(s).${applyNote}`
      : appliedCount > 0
        ? `${appliedCount} de ${total} aplicadas — veja os erros por item.${applyNote}`
        : "Nenhuma classificação aplicada — veja os erros por item.";
  return { ok: appliedCount === total, message, appliedCount, failed };
}

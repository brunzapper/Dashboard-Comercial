// Versão: 1.1 | Data: 31/07/2026 (v1.1: campo rem_comissao — comissão por faixas)
// Espelho da remuneração numa Base de registros (0112): "Publicar" materializa
// 1 registro por responsável×mês numa base manual "Remuneração" para TODOS os
// widgets/dashboards existentes funcionarem de graça (período por closed_at =
// último dia do mês; "por responsável" via responsible_id; Valor = total).
// A ESCRITA dos registros é sempre pelos choke points createRecord/updateRecord
// com o client RLS do admin (invariante 25 — nada de service role p/ inserir);
// este módulo só garante a INFRA (base + field defs + ponteiro em sync_config)
// e monta os payloads (builders puros, testáveis).
// Dedup por comp_entries.mirror_record_id (a RLS do ramo manual exige
// source_id null — nunca dedupe por source_id).
import type { SupabaseClient } from "@supabase/supabase-js";

import { roundMoney, type CompBreakdown, type CompPlanConfig } from "./model";

// Ponteiro da base espelho em sync_config (PK organization_id,key desde 0090).
export const MIRROR_CONFIG_KEY = "remuneracao_mirror";
export const MIRROR_SOURCE_KEY = "remuneracao";
export const MIRROR_SOURCE_LABEL = "Remuneração";

// Campos custom FIXOS da base espelho (detalhe por fator fica na grade — campo
// dinâmico por fator exigiria gestão de defs por plano, fora do v1).
export const MIRROR_FIELDS = [
  { key: "rem_base", label: "Base variável", dataType: "moeda" },
  { key: "rem_bonus", label: "Bônus", dataType: "moeda" },
  { key: "rem_comissao", label: "Comissão", dataType: "moeda" },
  { key: "rem_atingimento", label: "Atingimento (%)", dataType: "numero" },
  { key: "rem_plano", label: "Plano", dataType: "texto" },
] as const;

/** Título do registro espelhado: "Nome — MM/AAAA". */
export function mirrorTitle(
  memberName: string,
  year: number,
  month: number
): string {
  return `${memberName} — ${String(month).padStart(2, "0")}/${year}`;
}

/**
 * Atingimento médio da linha p/ o campo rem_atingimento: média PONDERADA pelos
 * pesos dos fatores com atingimento efetivo não-nulo. Plano com TODOS os pesos
 * zerados (payout só por comissão — planos do preset Remuneração Variável) cai
 * na média SIMPLES desses fatores. Sem nenhum atingimento ⇒ null (campo fica
 * vazio — nunca 0 fabricado).
 */
export function mirrorAttainmentPct(
  config: CompPlanConfig,
  breakdown: CompBreakdown
): number | null {
  let weighted = 0;
  let weights = 0;
  let simpleSum = 0;
  let count = 0;
  for (const f of config.factors) {
    const att = breakdown.byFactor[f.id]?.attainmentPct;
    if (att == null) continue;
    weighted += f.weightPct * att;
    weights += f.weightPct;
    simpleSum += att;
    count += 1;
  }
  if (count === 0) return null;
  const avg = weights === 0 ? simpleSum / count : weighted / weights;
  return Math.round(avg * 100) / 100;
}

/**
 * Pares nome→valor do FormData de createRecord/updateRecord (strings; número
 * com ponto decimal — coerce/coerceCore aceitam). closed_at é `YYYY-MM-DD`
 * SEM hora: o coerceCore ancora o dia em Brasília (invariante 11) — nunca
 * pré-ancorar aqui.
 */
export function mirrorFormValues(opts: {
  config: CompPlanConfig;
  breakdown: CompBreakdown;
  planName: string;
  memberName: string;
  responsibleId: string;
  year: number;
  month: number;
  lastDay: number;
}): Record<string, string> {
  const { breakdown } = opts;
  const total = breakdown.total;
  const out: Record<string, string> = {
    core__title: mirrorTitle(opts.memberName, opts.year, opts.month),
    core__value: total == null ? "" : String(roundMoney(total)),
    core__currency: "BRL",
    core__closed_at: `${opts.year}-${String(opts.month).padStart(2, "0")}-${String(
      opts.lastDay
    ).padStart(2, "0")}`,
    responsible_id: opts.responsibleId,
    custom__rem_base: String(roundMoney(breakdown.base)),
    custom__rem_bonus: String(roundMoney(breakdown.bonusTotal)),
    // Vazio quando o plano não tem comissão — nunca 0 fabricado.
    custom__rem_comissao:
      breakdown.commission == null
        ? ""
        : String(roundMoney(breakdown.commission.value)),
    custom__rem_plano: opts.planName,
  };
  const att = mirrorAttainmentPct(opts.config, breakdown);
  out.custom__rem_atingimento = att == null ? "" : String(att);
  return out;
}

export interface MirrorSourceResult {
  ok: boolean;
  message?: string;
  sourceKey?: string;
  created?: boolean;
}

/**
 * Garante a base espelho da org: data_sources manual (key `remuneracao`, com
 * sufixo em colisão GLOBAL — mesma dança da createSource) + field defs fixas +
 * ponteiro em sync_config. Idempotente; roda com o client RLS do admin
 * (data_sources_write/field defs exigem o papel — a RLS é a muralha).
 */
export async function ensureMirrorSource(
  supabase: SupabaseClient,
  orgId: string | null
): Promise<MirrorSourceResult> {
  // 1) Ponteiro existente + base viva ⇒ só garante as defs.
  let cfgQuery = supabase
    .from("sync_config")
    .select("value")
    .eq("key", MIRROR_CONFIG_KEY);
  if (orgId) cfgQuery = cfgQuery.eq("organization_id", orgId);
  const { data: cfg } = await cfgQuery.maybeSingle();
  const pointed =
    cfg?.value && typeof cfg.value === "object"
      ? String((cfg.value as { sourceKey?: unknown }).sourceKey ?? "")
      : "";
  if (pointed) {
    const { data: src } = await supabase
      .from("data_sources")
      .select("key, record_type")
      .eq("key", pointed)
      .maybeSingle();
    if (src) {
      const err = await ensureMirrorFields(
        supabase,
        orgId,
        src.record_type as string
      );
      if (err) return { ok: false, message: err };
      return { ok: true, sourceKey: pointed, created: false };
    }
    // Base excluída à mão: recria abaixo (ponteiro será regravado).
  }

  // 2) Cria a base (key/record_type GLOBAIS — colisão invisível de outra org
  // vira sufixo, nunca erro opaco; padrão createSource).
  let finalKey = MIRROR_SOURCE_KEY;
  let insertError: { code?: string; message: string } | null = null;
  for (let n = 1; n <= 5; n++) {
    if (n > 1) finalKey = `${MIRROR_SOURCE_KEY.slice(0, 37)}_${n}`;
    const { error } = await supabase.from("data_sources").insert({
      key: finalKey,
      record_type: finalKey,
      label: MIRROR_SOURCE_LABEL,
      short_label: "Rem",
      default_period_field: "closed_at",
      builtin: false,
      // Requisito do ramo manual da RLS records_insert e do createRecord.
      manual_entry: true,
      ...(orgId ? { organization_id: orgId } : {}),
    });
    insertError = error;
    if (!error || error.code !== "23505") break;
  }
  if (insertError) {
    return { ok: false, message: `Falha ao criar a base: ${insertError.message}` };
  }

  const { error: cfgError } = await supabase.from("sync_config").upsert(
    {
      key: MIRROR_CONFIG_KEY,
      value: { sourceKey: finalKey },
      ...(orgId ? { organization_id: orgId } : {}),
    },
    { onConflict: "organization_id,key" }
  );
  if (cfgError) return { ok: false, message: cfgError.message };

  const err = await ensureMirrorFields(supabase, orgId, finalKey);
  if (err) return { ok: false, message: err };
  return { ok: true, sourceKey: finalKey, created: true };
}

// Garante as field defs fixas (select-antes-de-insert; idempotente). Locais,
// visíveis a todos os papéis, EDITÁVEIS só por admin — createRecord/
// updateRecord exigem editable_by_roles p/ aceitar custom__<key> (o Publicar
// roda como admin; ninguém mais escreve nos valores espelhados).
async function ensureMirrorFields(
  supabase: SupabaseClient,
  orgId: string | null,
  recordType: string
): Promise<string | null> {
  for (const f of MIRROR_FIELDS) {
    let q = supabase
      .from("field_definitions")
      .select("id, applies_to")
      .eq("field_key", f.key);
    if (orgId) q = q.eq("organization_id", orgId);
    const { data: existing, error: findError } = await q.maybeSingle();
    if (findError) return findError.message;
    if (existing) continue;
    const { error } = await supabase.from("field_definitions").insert({
      ...(orgId ? { organization_id: orgId } : {}),
      field_key: f.key,
      label: f.label,
      data_type: f.dataType,
      applies_to: [recordType],
      visible_to_roles: ["admin", "gestor", "vendedor"],
      editable_by_roles: ["admin"],
      is_local: true,
      show_in_builder: true,
      write_back: false,
      sort_order: 100,
    });
    if (error) return error.message;
  }
  return null;
}

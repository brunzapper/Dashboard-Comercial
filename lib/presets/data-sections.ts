// Versão: 1.0 | Data: 01/10/2026
// Executor das SEÇÕES DE DADOS de um preset de fábrica (0149): indicadores,
// metas, Base manual (famílias/dados) e mapas da Tree.
//
// Regime das seções de org (lib/presets/definitions.ts v2.1/v2.2): SÓ o
// caminho de fábrica (`applyPreset` → `allowOrgSections`) chega aqui, e TUDO é
// ensure-if-absent — o que o admin ajustou depois do apply nunca é
// sobrescrito, e reaplicar não duplica nada. Erros são POR ITEM e voltam para
// o relatório do apply (nunca derrubam o dashboard).
//
// Escrita: client RLS do admin, org EXPLÍCITA. A Base manual passa pelos
// choke points dela (app/(app)/registros/base-manual/actions.ts); metas pelo
// `ensureGoalTarget` (lib/metas/upsert.ts); indicadores pela régua estrutural
// de lib/indicators/validate.ts. Os nós do mapa são inseridos direto (com
// `preset_key`, que nenhuma action de usuário grava) e o payload passa pela
// MESMA régua do cliente (lib/tree/payload.ts).
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  saveManualFamily,
  saveManualFamilyMember,
  saveManualSeries,
  setManualSeriesFamilies,
} from "@/app/(app)/registros/base-manual/actions";
import {
  loadResponsibleNameIndex,
  responsibleIdForName,
} from "@/lib/config/responsible-names";
import { validateIndicatorShape } from "@/lib/indicators/validate";
import { ensureGoalTarget } from "@/lib/metas/upsert";
import { normalizeMapKey } from "@/lib/tree/model";
import { parseNodePayload } from "@/lib/tree/payload";
import type { PresetDashboard } from "./definitions";

export interface PresetDataResult {
  indicatorsCreated: number;
  goalsCreated: number;
  manualCreated: number;
  mapNodesCreated: number;
  errors: string[];
}

export async function applyPresetDataSections(
  supabase: SupabaseClient,
  ctx: { orgId: string | null; userId: string },
  preset: PresetDashboard
): Promise<PresetDataResult> {
  const out: PresetDataResult = {
    indicatorsCreated: 0,
    goalsCreated: 0,
    manualCreated: 0,
    mapNodesCreated: 0,
    errors: [],
  };
  const hasData =
    (preset.indicators?.length ?? 0) +
      (preset.goals?.length ?? 0) +
      (preset.manualFamilies?.length ?? 0) +
      (preset.manualSeries?.length ?? 0) +
      (preset.maps?.length ?? 0) >
    0;
  if (!hasData) return out;
  if (!ctx.orgId) {
    out.errors.push("Seções de dados do preset: nenhuma organização ativa.");
    return out;
  }
  const orgId = ctx.orgId;
  const names = await loadResponsibleNameIndex(supabase);

  // ---- 1) Indicadores ----
  if (preset.indicators?.length) {
    const { data: have } = await supabase
      .from("indicators")
      .select("key")
      .eq("organization_id", orgId);
    const existing = new Set(((have ?? []) as { key: string }[]).map((r) => r.key));
    for (const ind of preset.indicators) {
      if (existing.has(ind.key)) continue;
      const ownerId = ind.ownerName ? responsibleIdForName(names, ind.ownerName) : null;
      if (ind.ownerName && !ownerId) {
        out.errors.push(
          `Indicador "${ind.label}": dono "${ind.ownerName}" não encontrado — criado sem dono.`
        );
      }
      const v = validateIndicatorShape({
        key: ind.key,
        label: ind.label,
        description: ind.description ?? null,
        unit: ind.unit,
        rollup: ind.rollup ?? "soma",
        direction: ind.direction ?? "maior_melhor",
        tolerancePct: ind.tolerancePct ?? 5,
        ownerResponsibleId: ownerId,
        sortOrder: ind.sortOrder ?? 0,
        realized: ind.realized
          ? {
              v: 1,
              formula: ind.realized.formula,
              sources: ind.realized.sources,
              filters: ind.realized.filters ?? [],
            }
          : null,
      });
      if (!v.ok) {
        out.errors.push(`Indicador "${ind.label}": ${v.message}`);
        continue;
      }
      const { error } = await supabase.from("indicators").insert({
        ...v.row,
        organization_id: orgId,
        preset_key: `${preset.presetKey}.${ind.key}`,
        created_by: ctx.userId,
      });
      if (error) out.errors.push(`Indicador "${ind.label}": ${error.message}`);
      else {
        out.indicatorsCreated += 1;
        existing.add(ind.key);
      }
    }
  }

  // ---- 2) Metas ----
  for (const g of preset.goals ?? []) {
    let responsibleId: string | null = null;
    if (g.responsibleName) {
      responsibleId = responsibleIdForName(names, g.responsibleName);
      if (!responsibleId) {
        out.errors.push(
          `Meta ${g.indicator} ${g.month}/${g.year}: responsável "${g.responsibleName}" não encontrado — meta pulada.`
        );
        continue;
      }
    }
    const res = await ensureGoalTarget(
      supabase,
      orgId,
      {
        year: g.year,
        month: g.month,
        scope: responsibleId ? "responsible" : "global",
        responsibleId,
        metric: g.indicator,
      },
      g.target
    );
    if (res === "created") out.goalsCreated += 1;
    else if (res !== "kept") out.errors.push(`Meta ${g.indicator} ${g.month}/${g.year}: ${res.error}`);
  }

  // ---- 3) Base manual (famílias ANTES dos dados — a declaração as cita) ----
  if (preset.manualFamilies?.length || preset.manualSeries?.length) {
    const [{ data: famRows }, { data: memRows }, { data: serRows }] = await Promise.all([
      supabase.from("manual_families").select("id, key").eq("organization_id", orgId),
      supabase
        .from("manual_family_members")
        .select("family_id, key")
        .eq("organization_id", orgId),
      supabase.from("manual_series").select("id, key").eq("organization_id", orgId),
    ]);
    const famId = new Map(((famRows ?? []) as { id: string; key: string }[]).map((f) => [f.key, f.id]));
    const memberKeys = new Set(
      ((memRows ?? []) as { family_id: string; key: string }[]).map((m) => `${m.family_id}:${m.key}`)
    );
    const seriesId = new Map(((serRows ?? []) as { id: string; key: string }[]).map((x) => [x.key, x.id]));

    for (const fam of preset.manualFamilies ?? []) {
      let id = famId.get(fam.key) ?? null;
      if (!id) {
        const res = await saveManualFamily({ label: fam.label, key: fam.key });
        if (!res.ok || !res.id) {
          out.errors.push(`Família "${fam.label}": ${res.message ?? "falha ao criar."}`);
          continue;
        }
        id = res.id;
        famId.set(fam.key, id);
        out.manualCreated += 1;
      }
      for (const [i, m] of fam.members.entries()) {
        if (memberKeys.has(`${id}:${m.key}`)) continue;
        const res = await saveManualFamilyMember({
          familyId: id,
          label: m.label,
          key: m.key,
          sortOrder: i,
        });
        if (!res.ok) out.errors.push(`Membro "${m.label}": ${res.message ?? "falha ao criar."}`);
        else out.manualCreated += 1;
      }
    }
    for (const [i, ser] of (preset.manualSeries ?? []).entries()) {
      if (seriesId.has(ser.key)) continue;
      const res = await saveManualSeries({ label: ser.label, key: ser.key, sortOrder: i });
      if (!res.ok || !res.id) {
        out.errors.push(`Dado "${ser.label}": ${res.message ?? "falha ao criar."}`);
        continue;
      }
      out.manualCreated += 1;
      // Só no dado NOVO: a declaração de famílias de um dado existente é do admin.
      if (ser.families?.length) {
        const decl = await setManualSeriesFamilies(res.id, ser.families);
        if (!decl.ok) out.errors.push(`Dado "${ser.label}": ${decl.message ?? "famílias não declaradas."}`);
      }
    }
  }

  // ---- 4) Mapas da Tree ----
  for (const map of preset.maps ?? []) {
    const mapKey = normalizeMapKey(map.mapKey);
    if (!mapKey || mapKey !== map.mapKey) {
      out.errors.push(`Mapa "${map.mapKey}": chave inválida.`);
      continue;
    }
    const { data: have } = await supabase
      .from("tree_nodes")
      .select("id, preset_key")
      .eq("organization_id", orgId)
      .eq("scope_kind", "livre")
      .eq("scope_id", mapKey)
      .not("preset_key", "is", null);
    const idByKey = new Map(
      ((have ?? []) as { id: string; preset_key: string }[]).map((r) => [r.preset_key, r.id])
    );
    for (const [i, node] of map.nodes.entries()) {
      if (idByKey.has(node.key)) continue;
      let payload: unknown = null;
      if (node.kind !== "note") {
        payload = parseNodePayload(node.kind, node.payload);
        if (!payload) {
          out.errors.push(`Nó "${node.label}": configuração inválida — pulado.`);
          continue;
        }
      }
      const parentId = node.parentKey ? idByKey.get(node.parentKey) : null;
      if (node.parentKey && !parentId) {
        out.errors.push(`Nó "${node.label}": pai "${node.parentKey}" ausente — criado na raiz.`);
      }
      const { data, error } = await supabase
        .from("tree_nodes")
        .insert({
          organization_id: orgId,
          scope_kind: "livre",
          scope_id: mapKey,
          kind: node.kind,
          parent_ref: parentId ? `note:${parentId}` : "-",
          label: node.label.slice(0, 200),
          body: node.body ? node.body.slice(0, 4000) : null,
          status: node.kind === "note" ? (node.status ?? null) : null,
          is_goal: node.kind === "note" && node.goal === true,
          direction: node.direction ?? null,
          payload,
          position: i,
          preset_key: node.key,
          created_by: ctx.userId,
        })
        .select("id")
        .single();
      if (error || !data) {
        out.errors.push(`Nó "${node.label}": ${error?.message ?? "falha ao criar."}`);
        continue;
      }
      idByKey.set(node.key, data.id as string);
      out.mapNodesCreated += 1;
    }
  }
  return out;
}

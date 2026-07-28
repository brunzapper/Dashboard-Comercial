// Versão: 1.0 | Data: 28/07/2026
// Server Actions da alocação-como-campo (invariante 24): liga/desliga o toggle
// "Expor a fase como campo do registro" de um kanban Personalizar. AUTORIA =
// gate de configuração do quadro (config-gate — admin || dono || board_access
// 'edit'), como nas automações; a criação/manutenção do field_definitions roda
// com SERVICE ROLE + org EXPLÍCITA do dashboard dono (o editor do board
// tipicamente NÃO tem manage_field_definitions — superfície limitada: no
// máximo UM campo selecao derivado, nomeado pelo quadro). A persistência do
// vínculo (settings.kanban.allocationFieldKey) usa o client do USUÁRIO — a RLS
// de widgets/dashboards prova a permissão de escrita no quadro. Desligar só
// limpa o vínculo: campo e valores FICAM (gerencie/exclua em /campos; o
// reconcile se auto-desliga se o campo sumir).
"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadSources } from "@/lib/config/sources";
import { isCoreDef } from "@/lib/records/core-defs";
import { slugify } from "@/lib/records/slug";
import { recordTypeOf } from "@/lib/sources";
import { buildAllocationOptions } from "./allocation-field";
import { reconcileKanbanAllocationField } from "./allocation-reconcile";
import { ensureKanbanConfigGate } from "./config-gate";
import type { KanbanOwner } from "./data";
import type { KanbanSettings } from "./types";

const BACKFILL_BUDGET_MS = 20_000;

export interface AllocationActionState {
  ok?: boolean;
  message?: string;
  fieldKey?: string;
  updated?: number;
}

interface OwnerRow {
  dashboardId: string;
  boardName: string;
  orgId: string | null;
  kanban: KanbanSettings | null;
  // Settings COMPLETOS da linha dona (widget ou dashboard) — o update do
  // vínculo faz spread p/ não derrubar as demais chaves.
  settings: Record<string, unknown>;
}

async function loadOwnerRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  owner: KanbanOwner
): Promise<OwnerRow | string> {
  if (owner.kind === "widget") {
    const { data: w } = await supabase
      .from("widgets")
      .select("id, title, dashboard_id, settings")
      .eq("id", owner.id)
      .maybeSingle();
    if (!w) return "Widget não encontrado.";
    const settings = (w.settings as Record<string, unknown> | null) ?? {};
    const { data: d } = await supabase
      .from("dashboards")
      .select("id, organization_id")
      .eq("id", w.dashboard_id as string)
      .maybeSingle();
    if (!d) return "Dashboard do widget indisponível.";
    return {
      dashboardId: w.dashboard_id as string,
      boardName: ((w.title as string | null) ?? "").trim() || "Kanban",
      orgId: (d.organization_id as string) ?? null,
      kanban: (settings.kanban as KanbanSettings | undefined) ?? null,
      settings,
    };
  }
  const { data: d } = await supabase
    .from("dashboards")
    .select("id, name, organization_id, settings")
    .eq("id", owner.id)
    .eq("kind", "kanban")
    .maybeSingle();
  if (!d) return "Quadro não encontrado.";
  const settings = (d.settings as Record<string, unknown> | null) ?? {};
  return {
    dashboardId: d.id as string,
    boardName: ((d.name as string | null) ?? "").trim() || "Kanban",
    orgId: (d.organization_id as string) ?? null,
    kanban: (settings.kanban as KanbanSettings | undefined) ?? null,
    settings,
  };
}

// Persiste o vínculo nos settings do dono com o client do USUÁRIO (RLS prova
// a permissão de escrita no quadro). `fieldKey` null = limpa (disable).
async function persistAllocationKey(
  supabase: Awaited<ReturnType<typeof createClient>>,
  owner: KanbanOwner,
  row: OwnerRow,
  fieldKey: string | null
): Promise<string | null> {
  const kanban = { ...(row.kanban ?? {}) } as KanbanSettings;
  if (fieldKey) kanban.allocationFieldKey = fieldKey;
  else delete kanban.allocationFieldKey;
  const settings = { ...row.settings, kanban };
  const table = owner.kind === "widget" ? "widgets" : "dashboards";
  const { data, error } = await supabase
    .from(table)
    .update({ settings })
    .eq("id", owner.id)
    .select("id");
  if (error) return error.message;
  if (!data || data.length === 0) {
    return "Sem permissão para alterar as configurações deste quadro.";
  }
  return null;
}

/**
 * Liga/desliga a exposição da fase como campo. Enable: cria (ou ADOTA — off/on
 * não prolifera campos) o field_definitions "Fase — <nome do quadro>"
 * (selecao, options = colunas visíveis, applies_to = record_type da base,
 * campo LOCAL: source_system null + is_local), grava o vínculo e faz o
 * backfill inicial (sobras curam no tick). Idempotente nos dois sentidos.
 */
export async function setKanbanAllocationField(
  owner: KanbanOwner,
  enable: boolean
): Promise<AllocationActionState> {
  const gate = await ensureKanbanConfigGate(owner);
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const row = await loadOwnerRow(supabase, owner);
  if (typeof row === "string") return { ok: false, message: row };
  const kanban = row.kanban;
  if (!kanban) return { ok: false, message: "Quadro sem configuração de kanban." };

  const revalidate = () => {
    if (owner.kind === "board") revalidatePath(`/kanbans/${owner.id}`);
    else {
      revalidatePath(`/dashboards/${row.dashboardId}`);
      revalidatePath(`/kanbans/w/${owner.id}`);
    }
  };

  if (!enable) {
    if (!kanban.allocationFieldKey) return { ok: true };
    const err = await persistAllocationKey(supabase, owner, row, null);
    if (err) return { ok: false, message: err };
    revalidate();
    return {
      ok: true,
      message:
        "Vínculo desfeito. O campo e os valores foram mantidos — gerencie ou exclua em Configurações → Campos.",
    };
  }

  if (
    kanban.mode !== "registros" ||
    kanban.columnSource !== "custom" ||
    !kanban.source
  ) {
    return {
      ok: false,
      message:
        "Disponível apenas em kanbans de registros com colunas Personalizar.",
    };
  }
  if (kanban.allocationFieldKey) {
    // Idempotente: já ligado.
    return { ok: true, fieldKey: kanban.allocationFieldKey };
  }

  const label = `Fase — ${row.boardName}`;
  const baseKey = slugify(label);
  if (!baseKey) {
    return { ok: false, message: "Nome do quadro inválido para gerar a chave do campo." };
  }

  // Service role: o editor do board pode não ter manage_field_definitions; a
  // org é EXPLÍCITA (a do dashboard dono — invariante de escopo service-role).
  const service = createServiceClient();
  const catalog = await loadSources(service, row.orgId ?? undefined);
  const recordType = recordTypeOf(kanban.source, catalog);
  const options = buildAllocationOptions(kanban);

  let fieldKey: string | null = null;
  let insertedDefId: string | null = null;
  for (let n = 1; n <= 10 && !fieldKey; n++) {
    const candidate = n === 1 ? baseKey : `${baseKey}_${n}`;
    let q = service
      .from("field_definitions")
      .select("id, data_type, source_system, is_local, formula")
      .eq("field_key", candidate);
    if (row.orgId) q = q.eq("organization_id", row.orgId);
    const { data: clash, error } = await q.maybeSingle();
    if (error) return { ok: false, message: error.message };
    if (!clash) {
      const { data: insertedRow, error: insertError } = await service
        .from("field_definitions")
        .insert({
          // Carimbo de org obrigatório (0090) — sem ele a linha nasceria na
          // org default e sumiria para as demais.
          ...(row.orgId ? { organization_id: row.orgId } : {}),
          field_key: candidate,
          label,
          data_type: "selecao",
          options,
          applies_to: [recordType],
          visible_to_roles: ["admin", "gestor", "vendedor"],
          // Valor derivado do quadro: ninguém edita à mão (o reconcile
          // reverteria) — write-back e edição ficam desligados.
          editable_by_roles: [],
          is_local: true,
          show_in_builder: true,
          write_back: false,
          sort_order: 100,
        })
        .select("id")
        .maybeSingle();
      if (insertError) return { ok: false, message: insertError.message };
      insertedDefId = (insertedRow?.id as string | undefined) ?? null;
      fieldKey = candidate;
    } else if (
      !isCoreDef(clash) &&
      clash.source_system == null &&
      clash.is_local === true &&
      clash.data_type === "selecao" &&
      !clash.formula
    ) {
      // Campo de um enable anterior deste (ou de outro) quadro com o mesmo
      // nome: ADOTA — off/on não prolifera fase_x_2, fase_x_3…
      const { error: adoptError } = await service
        .from("field_definitions")
        .update({ label, options, applies_to: [recordType] })
        .eq("id", clash.id as string);
      if (adoptError) return { ok: false, message: adoptError.message };
      fieldKey = candidate;
    }
    // Clash não adotável (core, campo de sync, tipo diferente) → sufixo.
  }
  if (!fieldKey) {
    return { ok: false, message: "Não foi possível gerar uma chave livre para o campo." };
  }

  const err = await persistAllocationKey(supabase, owner, row, fieldKey);
  if (err) {
    // Sem vínculo o campo criado AGORA ficaria órfão — desfaz. Um campo
    // ADOTADO preexistente não é excluído (só recebeu label/options novos).
    if (insertedDefId) {
      await service.from("field_definitions").delete().eq("id", insertedDefId);
    }
    return { ok: false, message: err };
  }

  const { updated } = await reconcileKanbanAllocationField(service, owner, {
    deadline: Date.now() + BACKFILL_BUDGET_MS,
  });
  revalidate();
  return {
    ok: true,
    fieldKey,
    updated,
    message: `Campo "${label}" criado e preenchido (${updated} registro${updated === 1 ? "" : "s"}).`,
  };
}

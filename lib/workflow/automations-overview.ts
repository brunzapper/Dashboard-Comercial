// Versão: 1.0 | Data: 08/09/2026
// Todas as automações da organização num lugar só — a lista que o Workflow
// mostra.
//
// Por que existe: até aqui uma regra só era visível de dentro do quadro dela.
// Quem quisesse saber "o que este sistema mexe sozinho nos meus registros?"
// tinha que abrir quadro por quadro, e as regras de BASE (0127) não têm quadro
// nenhum para abrir. Isto é uma VISÃO — a edição continua sendo
// `saveAutomation`/`runAutomationsNow`, os mesmos choke points que o painel do
// quadro usa. Duas superfícies, um núcleo.
//
// Lê com o client do USUÁRIO: a RLS de `automation_rules` decide o que ele
// enxerga (editor do board, ou admin para as de Base). Nada de service role.
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadSources } from "@/lib/config/sources";
import { loadSourceLabels } from "@/lib/config/source-labels";
import {
  parseAutomationRule,
  type AutomationOwner,
  type AutomationRule,
} from "@/lib/kanban/automations/types";

export interface OrgAutomationRow {
  id: string;
  name: string;
  enabled: boolean;
  position: number;
  owner: AutomationOwner;
  /** "Quadro Parceiros" / "Base Leads" — o que a pessoa reconhece. */
  ownerLabel: string;
  /** Rota do quadro, quando há um. Regra de Base não tem para onde ir. */
  ownerHref: string | null;
  /** null = o jsonb não passou no parse fail-closed (a UI diz isso). */
  rule: AutomationRule | null;
  lastRunAt: string | null;
  lastError: string | null;
  lastActionCount: number;
}

interface RawRow {
  id: string;
  name: string | null;
  enabled: boolean;
  position: number | null;
  widget_id: string | null;
  board_id: string | null;
  source_key: string | null;
  rule: unknown;
  last_run_at: string | null;
  last_error: string | null;
  last_moved_count: number | null;
}

/**
 * Regras da org, na ordem em que a pessoa as procura: as com erro primeiro
 * (é o que exige ação), depois por dono e posição.
 */
export async function loadOrgAutomations(
  db: SupabaseClient,
  orgId: string | null
): Promise<OrgAutomationRow[]> {
  let query = db
    .from("automation_rules")
    .select(
      "id, name, enabled, position, widget_id, board_id, source_key, rule, last_run_at, last_error, last_moved_count"
    )
    .order("position", { ascending: true });
  if (orgId) query = query.eq("organization_id", orgId);
  const { data, error } = await query;
  if (error || !data) return [];
  const rows = data as RawRow[];
  if (rows.length === 0) return [];

  // Rótulo do dono. Um SELECT por família, nunca um por linha.
  const boardIds = new Set<string>();
  const widgetIds = new Set<string>();
  for (const r of rows) {
    if (r.board_id) boardIds.add(r.board_id);
    if (r.widget_id) widgetIds.add(r.widget_id);
  }

  const widgetToBoard = new Map<string, string>();
  if (widgetIds.size > 0) {
    const { data: ws } = await db
      .from("widgets")
      .select("id, dashboard_id")
      .in("id", [...widgetIds]);
    for (const w of ws ?? []) {
      const board = w.dashboard_id as string;
      widgetToBoard.set(w.id as string, board);
      boardIds.add(board);
    }
  }

  const boardTitle = new Map<string, string>();
  if (boardIds.size > 0) {
    const { data: bs } = await db
      .from("dashboards")
      .select("id, title")
      .in("id", [...boardIds]);
    for (const b of bs ?? []) {
      boardTitle.set(b.id as string, (b.title as string) || "Quadro");
    }
  }

  // Rótulo de Base pelo mesmo caminho do resto do app (rótulo curado vence a
  // key crua) — nunca exibir "leads" onde a pessoa vê "Leads" em todo lugar.
  const sources = await loadSources(db, orgId);
  const sourceLabels = await loadSourceLabels(db, sources, orgId);

  const out = rows.map((r): OrgAutomationRow => {
    let owner: AutomationOwner;
    let ownerLabel: string;
    let ownerHref: string | null = null;

    if (r.source_key) {
      owner = { kind: "source", id: r.source_key };
      const label =
        sourceLabels[r.source_key] ??
        sources.find((s) => s.key === r.source_key)?.label ??
        r.source_key;
      ownerLabel = `Base ${label}`;
    } else if (r.widget_id) {
      owner = { kind: "widget", id: r.widget_id };
      const board = widgetToBoard.get(r.widget_id);
      ownerLabel = `Quadro ${board ? (boardTitle.get(board) ?? "") : ""}`.trim();
      if (board) ownerHref = `/dashboards/${board}`;
    } else {
      owner = { kind: "board", id: r.board_id ?? "" };
      ownerLabel = `Quadro ${boardTitle.get(r.board_id ?? "") ?? ""}`.trim();
      if (r.board_id) ownerHref = `/kanbans/${r.board_id}`;
    }

    return {
      id: r.id,
      name: r.name ?? "",
      enabled: r.enabled,
      position: r.position ?? 0,
      owner,
      ownerLabel,
      ownerHref,
      rule: parseAutomationRule(r.rule),
      lastRunAt: r.last_run_at,
      lastError: r.last_error,
      lastActionCount: r.last_moved_count ?? 0,
    };
  });

  // Com erro primeiro: é o que precisa de alguém. Depois agrupadas por dono.
  return out.sort((a, b) => {
    const err = Number(Boolean(b.lastError)) - Number(Boolean(a.lastError));
    if (err !== 0) return err;
    const owner = a.ownerLabel.localeCompare(b.ownerLabel, "pt-BR");
    if (owner !== 0) return owner;
    return a.position - b.position;
  });
}

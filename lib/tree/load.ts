// Versão: 1.1 | Data: 09/09/2026
// v1.1 (09/09/2026): JANELA. Um registro sob cobrança quinzenal por dois
//   anos tem ~50 galhos, e a árvore inteira de uma vez é ilegível. O corte é
//   por COBRANÇA, nunca por linha solta: cortar no meio de uma deixaria a
//   anotação e a tarefa dela órfãs de tronco. Sem série (sem tronco), a
//   janela é dos próprios fatos, na direção da ordem.
// Monta os FATOS da árvore de um registro — tudo lido ao vivo, nada copiado.
//
// A ordem importa: primeiro o TRONCO (as cobranças previstas pela série, que é
// derivado e por isso mostra até a cobrança que nunca virou tarefa), depois o
// que aconteceu (tarefas, anotações, alterações), depois as exceções de
// parentesco. Quem transforma isso em árvore é `deriveTree`, puro.
//
// Leitura com o client RLS do usuário: as policies de records/tasks/comments e
// a da 0133 já recortam. Nada de service role.
import type { SupabaseClient } from "@supabase/supabase-js";

import { parseAutomationRule } from "@/lib/kanban/automations/types";
import { resolveCadence } from "@/lib/series/cadence";
import { loadSeriesSettings } from "@/lib/series/load";
import { occurrencesUntil, resolveAnchorDate, resolveBound } from "@/lib/series/occurrence";
import type { AvailableField } from "@/lib/widgets/fields";
import type { RecordRow } from "@/lib/records/types";

import { TREE_WINDOW_STEP } from "./model";
import type { TreeFact, TreeParentOverride } from "./model";

export { TREE_WINDOW_STEP };

/**
 * Teto por consulta. Não é a semântica da janela — é o cinto de segurança que
 * impede uma leitura descontrolada; quem recorta de verdade é o `limit`.
 */
const FACT_FETCH_CAP = 400;

export interface TreeWindow {
  /** `desc` = das cobranças mais recentes para trás (o padrão de quem abre). */
  order: "asc" | "desc";
  /** Quantas cobranças exibir. Cresce a cada "carregar mais". */
  limit: number;
}

export interface TreeFacts {
  facts: TreeFact[];
  overrides: TreeParentOverride[];
  /** Há cobrança (ou fato) fora da janela na direção corrente. */
  hasMore: boolean;
  /** Cadência efetiva e se a série está ligada — o cabeçalho da árvore. */
  series: {
    key: string;
    cadenceDays: number;
    active: boolean;
    anchorDate: string | null;
  } | null;
}

const day = (v: unknown): string =>
  typeof v === "string" ? v.slice(0, 10) : "";

/**
 * Fatos da árvore de UM registro.
 *
 * `ruleId` é a regra que concedeu o atributo (record_attributes.granted_by_rule_id):
 * é dela que sai a série, e sem ela a árvore ainda existe — só não tem tronco.
 */
export async function loadRecordTreeFacts(
  db: SupabaseClient,
  input: {
    record: RecordRow;
    /** records.field_modified_at do registro (a âncora "mudou de etapa"). */
    fieldModifiedAt?: Record<string, string> | null;
    orgId: string | null;
    ruleId?: string | null;
    todayIso: string;
    /** Catálogo p/ refs `unified:`/`match:` na âncora; [] resolve core e custom. */
    available?: AvailableField[];
    /** Recorte. Ausente = tudo (o comportamento de antes da v1.1). */
    window?: TreeWindow;
  }
): Promise<TreeFacts> {
  const recordId = input.record.id;
  const available = input.available ?? [];
  const facts: TreeFact[] = [];

  // --- o tronco: as cobranças PREVISTAS (derivadas), não as tarefas ---
  let series: TreeFacts["series"] = null;
  let hasMore = false;
  // Bordas de data do recorte (uma ou outra, nunca as duas — ver acima).
  let factsFrom: string | null = null;
  let factsUntil: string | null = null;
  if (input.ruleId) {
    const { data: ruleRow } = await db
      .from("automation_rules")
      .select("id, rule")
      .eq("id", input.ruleId)
      .maybeSingle();
    const parsed = ruleRow ? parseAutomationRule(ruleRow.rule) : null;
    if (parsed?.action.type === "create_task_series") {
      const config = parsed.action.series;
      const anchorFacts = {
        record: input.record,
        fieldModifiedAt: input.fieldModifiedAt ?? null,
        sourceCreatedAt: (input.record.source_created_at as string) ?? null,
        available,
      };
      const anchorDate = resolveAnchorDate(config.anchor, anchorFacts);
      const settings = await loadSeriesSettings(db, input.orgId, [config.key]);
      const cadence = resolveCadence(
        config.cadence,
        input.record,
        available,
        settings.get(config.key) ?? []
      );
      series = {
        key: config.key,
        cadenceDays: cadence.days,
        active: cadence.active,
        anchorDate,
      };
      const all = occurrencesUntil({
        anchorDate,
        cadenceDays: cadence.days,
        todayIso: input.todayIso,
        fromDate: resolveBound(config.from, anchorFacts),
        untilDate: resolveBound(config.until, anchorFacts),
        firstAt: config.firstAt,
        maxOccurrences: config.maxOccurrences,
      });
      // A janela corta AQUI, na lista de cobranças — antes de qualquer fato
      // ser lido. É o que garante que nenhum galho perca o tronco dele.
      const win = input.window;
      const shown = !win
        ? all
        : win.order === "asc"
          ? all.slice(0, win.limit)
          : all.slice(Math.max(0, all.length - win.limit));
      hasMore = win ? all.length > shown.length : false;
      if (shown.length > 0) {
        // Fora da janela, o fato é descartado. `desc` não tem teto superior
        // (o que veio DEPOIS da última cobrança é o mais recente, e é o que
        // se quer ver); `asc` não tem piso (o anterior à primeira pendura
        // nela, regra que o deriveTree já aplica).
        if (win?.order === "asc") factsUntil = shown[shown.length - 1].dueDate;
        else if (win) factsFrom = shown[0].dueDate;
      }
      for (const occ of shown) {
        facts.push({
          id: `occ:${occ.occurrence}`,
          kind: "occurrence",
          at: occ.dueDate,
          label: `${occ.occurrence}ª cobrança`,
          occurrence: occ.occurrence,
        });
      }
    }
  }

  // --- o que aconteceu ---
  // Com janela, as consultas vêm na direção dela e com teto: a árvore de um
  // registro antigo não pode arrastar o histórico inteiro para descartar 90%.
  const asc = input.window?.order !== "desc";
  const cap = input.window ? FACT_FETCH_CAP : 2000;
  const [{ data: tasks }, { data: comments }, { data: changes }] =
    await Promise.all([
      db
        .from("tasks")
        .select(
          "id, title, description, due_date, completed_at, series_key, series_occurrence, created_at"
        )
        .eq("record_id", recordId)
        .order("due_date", { ascending: asc, nullsFirst: false })
        .limit(cap),
      db
        .from("comments")
        .select("id, body, created_at")
        .eq("record_id", recordId)
        .order("created_at", { ascending: asc })
        .limit(cap),
      db
        .from("audit_log")
        .select("id, field, new_value, created_at, origin")
        .eq("record_id", recordId)
        .order("created_at", { ascending: asc })
        .limit(cap),
    ]);

  /**
   * O fato cabe na janela? Data vazia SEMPRE cabe: sem data ela não pode ser
   * julgada por uma borda, e sumir com ela seria perder o nó sem dizer.
   */
  const inWindow = (at: string): boolean => {
    if (at === "") return true;
    if (factsFrom && at < factsFrom) return false;
    if (factsUntil && at > factsUntil) return false;
    return true;
  };

  for (const t of tasks ?? []) {
    const occurrence = t.series_occurrence as number | null;
    // A tarefa de uma cobrança não vira nó próprio: ela É a cobrança, e o
    // tronco já a representa. Duplicá-la faria a árvore contar duas vezes.
    if (occurrence != null) {
      const trunk = facts.find((f) => f.id === `occ:${occurrence}`);
      if (trunk) {
        trunk.refId = t.id as string;
        trunk.status = t.completed_at ? "concluída" : "aberta";
        trunk.label = (t.title as string) || trunk.label;
        continue;
      }
    }
    const taskAt = day(t.due_date) || day(t.created_at);
    if (!inWindow(taskAt)) continue;
    facts.push({
      id: `task:${t.id as string}`,
      kind: "task",
      at: taskAt,
      label: (t.title as string) ?? "Tarefa",
      body: (t.description as string | null) ?? null,
      status: t.completed_at ? "concluída" : "aberta",
      refId: t.id as string,
    });
  }

  for (const c of comments ?? []) {
    if (!inWindow(day(c.created_at))) continue;
    facts.push({
      id: `comment:${c.id as string}`,
      kind: "comment",
      at: day(c.created_at),
      label: String(c.body ?? "").slice(0, 120),
      body: (c.body as string) ?? null,
      refId: c.id as string,
    });
  }

  for (const a of changes ?? []) {
    if (!inWindow(day(a.created_at))) continue;
    facts.push({
      id: `change:${a.id as string}`,
      kind: "change",
      at: day(a.created_at),
      label: `${a.field as string}: ${String(a.new_value ?? "").slice(0, 60)}`,
      status: (a.origin as string) ?? null,
      refId: a.id as string,
    });
  }

  // --- nós livres e exceções de parentesco ---
  const { data: nodes } = await db
    .from("tree_nodes")
    .select("id, kind, ref_id, node_ref, parent_ref, label, body, position, created_at")
    .eq("scope_kind", "record")
    .eq("scope_id", recordId);

  const overrides: TreeParentOverride[] = [];
  for (const n of nodes ?? []) {
    const nodeRef = n.node_ref as string | null;
    if (nodeRef) {
      overrides.push({
        nodeRef,
        // "-" é o "soltar na raiz": distingue de "sem exceção" (null).
        parentRef: n.parent_ref === "-" ? null : ((n.parent_ref as string) ?? null),
        position: (n.position as number) ?? null,
      });
      continue;
    }
    facts.push({
      id: `note:${n.id as string}`,
      kind: "note",
      at: day(n.created_at),
      label: (n.label as string) ?? "Nota",
      body: (n.body as string | null) ?? null,
      refId: n.id as string,
    });
  }

  // Sem tronco (registro fora de série), a janela recorta os PRÓPRIOS fatos:
  // não há cobrança para agrupá-los, e a linha do tempo crua é o que existe.
  if (!series && input.window) {
    const dated = facts.filter((f) => f.kind !== "note");
    if (dated.length > input.window.limit) {
      const sorted = [...facts].sort((a, b) =>
        input.window!.order === "asc"
          ? (a.at || "").localeCompare(b.at || "")
          : (b.at || "").localeCompare(a.at || "")
      );
      const keep = new Set(sorted.slice(0, input.window.limit).map((f) => f.id));
      hasMore = true;
      return {
        facts: facts.filter((f) => keep.has(f.id)),
        overrides,
        hasMore,
        series,
      };
    }
  }

  return { facts, overrides, hasMore, series };
}

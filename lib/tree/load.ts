// Versão: 1.5 | Data: 10/09/2026
// v1.5 (10/09/2026): VÁRIAS séries por registro. `ruleId` virou `ruleIds`, e o
//   tronco passa a ser um bloco por regra. O motivo é estrutural: o atributo é
//   ÚNICO por registro (`uq_record_attributes_record_key`, 0131) e o upsert do
//   executor é `ignoreDuplicates`, então a segunda série NUNCA vira
//   `granted_by_rule_id` — ela existia só como tarefas soltas, sem tronco e sem
//   a ocorrência que ninguém abriu, que é o que a árvore existe para mostrar.
//   As regras extras saem das PRÓPRIAS tarefas do registro
//   (`automation_rule_id` distintos com `series_occurrence not null`): é o fato,
//   não um segundo registro de participação. O id do fato ganhou o namespace da
//   regra (`occ:<ruleId>:<n>`) — sem ele, a 3ª ocorrência de duas séries
//   colidiria no mesmo nó.
//   A JANELA passou a ser aplicada por série (cada tronco traz as suas N) e o
//   recorte dos fatos usa a borda da série PRIMÁRIA, que é a de sempre.
//   Junto, um defeito antigo: a âncora era resolvida SEM o `anchorFallback` da
//   série (o executor o passa desde a 0132). Uma série com "contar da criação"
//   abria tarefas que a árvore desenhava SOLTAS — sem tronco e sem a ocorrência
//   que ninguém abriu, que é justamente o que ela existe para mostrar.
// v1.4 (10/09/2026): DUAS correções e uma mudança de vocabulário.
//   1. O nó de "Alteração" NUNCA existiu: a consulta pedia `audit_log.created_at`
//      e a coluna é `changed_at` (0006). O PostgREST devolvia erro, `changes`
//      voltava null e a árvore ficava sem os fatos de mudança — em silêncio,
//      desde que a Tree existe.
//   2. O substantivo do tronco saiu do código. Ele é DADO agora
//      (`tasks.occurrence_noun` → `SeriesConfig.noun` → "Tarefa"), montado só
//      por `occurrenceLabel` (lib/series/types.ts).
// v1.2 (09/09/2026): `tree_nodes` entra no MESMO Promise.all dos fatos. Ele
//   não depende de tarefa, anotação nem alteração — estava em série sem
//   razão, e cada ida ao banco pesa no tempo entre o clique e a árvore.
// v1.1 (09/09/2026): JANELA. Um registro em série quinzenal por dois anos
//   tem ~50 galhos, e a árvore inteira de uma vez é ilegível. O corte é
//   por OCORRÊNCIA, nunca por linha solta: cortar no meio de uma deixaria a
//   anotação e a tarefa dela órfãs de tronco. Sem série (sem tronco), a
//   janela é dos próprios fatos, na direção da ordem.
// Monta os FATOS da árvore de um registro — tudo lido ao vivo, nada copiado.
//
// A ordem importa: primeiro o TRONCO (as ocorrências previstas pela série, que
// é derivado e por isso mostra até a que nunca virou tarefa), depois o
// que aconteceu (tarefas, anotações, alterações), depois as exceções de
// parentesco. Quem transforma isso em árvore é `deriveTree`, puro.
//
// Leitura com o client RLS do usuário: as policies de records/tasks/comments e
// a da 0133 já recortam. Nada de service role.
import type { SupabaseClient } from "@supabase/supabase-js";

import { parseAutomationRule } from "@/lib/kanban/automations/types";
import { resolveCadence } from "@/lib/series/cadence";
import { loadSeriesSettings } from "@/lib/series/load";
import { loadFieldHistory } from "@/lib/records/field-history";
import { occurrencesUntil, resolveAnchorDate, resolveBound } from "@/lib/series/occurrence";
import { occurrenceLabel, type SeriesConfig } from "@/lib/series/types";
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
  /** `desc` = das ocorrências mais recentes para trás (o padrão de quem abre). */
  order: "asc" | "desc";
  /** Quantas ocorrências exibir. Cresce a cada "carregar mais". */
  limit: number;
}

/** Uma série que o registro segue — o cabeçalho de um tronco. */
export interface TreeSeriesInfo {
  key: string;
  /** Regra que a define, para o editor de automação abrir a certa. */
  ruleId: string;
  /** Nome da regra (o rótulo do tronco). */
  ruleName: string;
  cadenceDays: number;
  active: boolean;
  anchorDate: string | null;
  /** v1.4: como ESTA série chama cada ocorrência. null = o padrão. */
  noun: string | null;
  /** v1.5: é a que concedeu o atributo? Os fatos avulsos caem nela. */
  primary: boolean;
}

export interface TreeFacts {
  facts: TreeFact[];
  overrides: TreeParentOverride[];
  /** Há ocorrência (ou fato) fora da janela na direção corrente. */
  hasMore: boolean;
  /**
   * As séries do registro, a primária primeiro. v1.5: era uma só.
   */
  series: TreeSeriesInfo[];
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
    /**
     * records.field_modified_at do registro. NÃO é a âncora — é só uma das
     * duas fontes do histórico (a outra, e a que cobre o sync, é audit_log).
     * v1.3 (09/09/2026): ver lib/records/field-history.ts.
     */
    fieldModifiedAt?: Record<string, string> | null;
    orgId: string | null;
    /**
     * v1.5: as regras de série do registro. A PRIMEIRA é a primária (a que
     * concedeu o atributo) — é a janela dela que recorta os fatos avulsos.
     */
    ruleIds?: string[];
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

  // --- o tronco: as ocorrências PREVISTAS (derivadas), não as tarefas ---
  const series: TreeSeriesInfo[] = [];
  let hasMore = false;
  // Bordas de data do recorte (uma ou outra, nunca as duas — ver acima).
  let factsFrom: string | null = null;
  let factsUntil: string | null = null;
  const ruleIds = [...new Set((input.ruleIds ?? []).filter(Boolean))];
  if (ruleIds.length > 0) {
    const { data: ruleRows } = await db
      .from("automation_rules")
      .select("id, name, rule")
      .in("id", ruleIds);
    // A ORDEM de `ruleIds` manda: a primária é a primeira, e é a janela dela
    // que recorta os fatos avulsos. O `.in()` devolve na ordem do banco.
    const byId = new Map((ruleRows ?? []).map((r) => [r.id as string, r]));
    // As exceções de cadência de TODAS as séries numa consulta só.
    const configs: { ruleId: string; name: string; config: SeriesConfig }[] = [];
    for (const id of ruleIds) {
      const row = byId.get(id);
      const parsed = row ? parseAutomationRule(row.rule) : null;
      if (parsed?.action.type !== "create_task_series") continue;
      configs.push({
        ruleId: id,
        name: (row?.name as string) || "",
        config: parsed.action.series,
      });
    }
    const settings = await loadSeriesSettings(
      db,
      input.orgId,
      configs.map((c) => c.config.key)
    );

    // O HISTÓRICO de campo de TODAS as séries numa consulta só: cada `field_changed`
    // (âncora ou borda) é uma leitura de audit_log, e um registro em três séries
    // faria três idas ao banco para o mesmo fato.
    const historyFields = new Set<string>();
    for (const { config } of configs) {
      for (const src of [config.anchor, config.from, config.until]) {
        if (src && src.kind === "field_changed") historyFields.add(src.field);
      }
    }
    const history =
      historyFields.size > 0
        ? await loadFieldHistory(
            db,
            [{ id: recordId, fieldModifiedAt: input.fieldModifiedAt ?? null }],
            [...historyFields]
          )
        : null;
    const anchorFacts = {
      record: input.record,
      changedAt: history?.get(recordId) ?? null,
      sourceCreatedAt: (input.record.source_created_at as string) ?? null,
      available,
    };

    for (const [index, { ruleId, name, config }] of configs.entries()) {
      // O `anchorFallback` PRECISA vir junto (corrigido em 10/09/2026): o
      // executor o passa (`evaluate.ts`), a árvore não passava, e por isso uma
      // série com "contar da criação" gerava tarefas que a Tree desenhava
      // SOLTAS — sem tronco, e sem a ocorrência que ninguém abriu.
      const anchorDate = resolveAnchorDate(
        config.anchor,
        anchorFacts,
        config.anchorFallback
      );
      const cadence = resolveCadence(
        config.cadence,
        input.record,
        available,
        settings.get(config.key) ?? [],
        // v1.6: sem o dia de hoje, um adiamento (0139) leria como desligamento
        // permanente e a Tree diria "desligada" para sempre.
        input.todayIso
      );
      series.push({
        key: config.key,
        ruleId,
        ruleName: name,
        cadenceDays: cadence.days,
        active: cadence.active,
        anchorDate,
        noun: config.noun ?? null,
        primary: index === 0,
      });
      const all = occurrencesUntil({
        anchorDate,
        cadenceDays: cadence.days,
        todayIso: input.todayIso,
        fromDate: resolveBound(config.from, anchorFacts),
        untilDate: resolveBound(config.until, anchorFacts),
        firstAt: config.firstAt,
        maxOccurrences: config.maxOccurrences,
      });
      // A janela corta AQUI, na lista de ocorrências — antes de qualquer fato
      // ser lido. É o que garante que nenhum galho perca o tronco dele. Cada
      // série traz as SUAS N: cortar o conjunto fundido faria a série mais
      // longa esconder a mais curta.
      const win = input.window;
      const shown = !win
        ? all
        : win.order === "asc"
          ? all.slice(0, win.limit)
          : all.slice(Math.max(0, all.length - win.limit));
      if (win && all.length > shown.length) hasMore = true;
      // A borda dos fatos avulsos sai da série PRIMÁRIA: é nela que eles
      // penduram (ver deriveTree v1.2), e recortá-los por outra deixaria
      // comentário órfão de tronco.
      if (index === 0 && shown.length > 0) {
        // Fora da janela, o fato é descartado. `desc` não tem teto superior
        // (o que veio DEPOIS da última ocorrência é o mais recente, e é o que
        // se quer ver); `asc` não tem piso (o anterior à primeira pendura
        // nela, regra que o deriveTree já aplica).
        if (win?.order === "asc") factsUntil = shown[shown.length - 1].dueDate;
        else if (win) factsFrom = shown[0].dueDate;
      }
      for (const occ of shown) {
        facts.push({
          // v1.5: o namespace da regra. Sem ele, a 3ª ocorrência de duas
          // séries seria o MESMO nó, e a tarefa de uma fundiria na outra.
          id: `occ:${ruleId}:${occ.occurrence}`,
          kind: "occurrence",
          at: occ.dueDate,
          // O substantivo vem da série; a tarefa daquela ocorrência ainda
          // pode sobrepô-lo abaixo (occurrence_noun).
          label: occurrenceLabel(occ.occurrence, config.noun),
          occurrence: occ.occurrence,
          seriesKey: config.key,
        });
      }
    }
  }

  // --- o que aconteceu ---
  // Com janela, as consultas vêm na direção dela e com teto: a árvore de um
  // registro antigo não pode arrastar o histórico inteiro para descartar 90%.
  const asc = input.window?.order !== "desc";
  const cap = input.window ? FACT_FETCH_CAP : 2000;
  const [{ data: tasks }, { data: comments }, { data: changes }, { data: nodes }] =
    await Promise.all([
      db
        .from("tasks")
        .select(
          "id, title, description, due_date, completed_at, automation_rule_id, series_key, series_occurrence, occurrence_noun, created_at"
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
      // v1.4: `changed_at` — a coluna do audit_log (0006). Com `created_at`
      // (que não existe lá) o PostgREST erra e `changes` volta NULL: a árvore
      // ficava sem nó de alteração nenhum, sem dizer por quê.
      db
        .from("audit_log")
        .select("id, field, new_value, changed_at, origin")
        .eq("record_id", recordId)
        .order("changed_at", { ascending: asc })
        .limit(cap),
      // Nós livres e exceções de parentesco: independentes dos fatos acima.
      db
        .from("tree_nodes")
        .select(
          "id, kind, ref_id, node_ref, parent_ref, label, body, position, created_at"
        )
        .eq("scope_kind", "record")
        .eq("scope_id", recordId),
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
    const taskRuleId = (t.automation_rule_id as string | null) ?? null;
    // A tarefa de uma ocorrência não vira nó próprio: ela É a ocorrência, e o
    // tronco já a representa. Duplicá-la faria a árvore contar duas vezes.
    // v1.5: o par (regra, ocorrência) — a 3ª de duas séries são nós distintos.
    if (occurrence != null && taskRuleId) {
      const trunk = facts.find((f) => f.id === `occ:${taskRuleId}:${occurrence}`);
      if (trunk) {
        trunk.refId = t.id as string;
        trunk.status = t.completed_at ? "concluída" : "aberta";
        // Cadeia do rótulo: título da tarefa > substantivo DELA > o da série.
        const noun = (t.occurrence_noun as string | null) ?? null;
        trunk.label =
          (t.title as string) ||
          (noun ? occurrenceLabel(occurrence, noun) : trunk.label);
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
    if (!inWindow(day(a.changed_at))) continue;
    facts.push({
      id: `change:${a.id as string}`,
      kind: "change",
      at: day(a.changed_at),
      label: `${a.field as string}: ${String(a.new_value ?? "").slice(0, 60)}`,
      status: (a.origin as string) ?? null,
      refId: a.id as string,
    });
  }

  // --- nós livres e exceções de parentesco (vieram no lote acima) ---
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
  // não há ocorrência para agrupá-los, e a linha do tempo crua é o que existe.
  if (series.length === 0 && input.window) {
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

// Versão: 1.6 | Data: 10/09/2026
// v1.6 (10/09/2026): só vocabulário — o substantivo da ocorrência
//   da série saiu do código e virou dado (SeriesConfig.noun, e
//   tasks.occurrence_noun por tarefa).
// v1.5 (09/09/2026): ação `create_task_series` — a tarefa RECORRENTE. Não é
//   um `create_task` repetido: a trava dele é "uma tarefa ABERTA por regra ×
//   registro" (a regra só abre outra depois que a anterior é concluída), e
//   uma série precisa do contrário — a 3ª quinzena vence tenha ou não a 2ª
//   sido feita, e é ver as duas lado a lado que mostra a conduta. A trava é
//   por OCORRÊNCIA (índice único da 0132), e a ocorrência é DERIVADA da âncora
//   e da cadência (lib/series), nunca contada.
// Versão: 1.4 | Data: 09/09/2026
// v1.4 (09/09/2026): ação `run_schema` — executa os passos de um ESQUEMA do
//   Workflow tendo o registro como entrada. É a única ação que produz efeito
//   FORA do sistema sem ninguém olhando, então carrega o que as outras não
//   precisam: `simulate` (ausente ⇒ TRUE — armar é ato explícito) e um `map`
//   opcional que sobrescreve, campo a campo, de onde o esquema tira o valor
//   (precedência: map da regra → sourceRef do esquema → defaultValue). A TRAVA
//   não mora aqui: é o índice único parcial da 0130, e a natureza dela sai dos
//   PASSOS do esquema (criar = uma vez por registro; alterar = quando o payload
//   muda) via `schemaIsIrreversible`.
// Versão: 1.3 | Data: 08/09/2026
// v1.3 (08/09/2026): ação `create_task` — abre uma tarefa vinculada ao
//   registro. Diferente de `set_field`, que é idempotente por COMPARAÇÃO
//   (valor igual consome sem escrever), criar tarefa não tem estado anterior
//   para comparar: a trava é o índice único parcial da 0129 (uma tarefa ABERTA
//   por regra × registro) mais o gate no avaliador.
// v1.2 (08/09/2026): dono de tipo `source` (0127) — a regra passa a poder ter
//   uma BASE como universo, sem quadro nenhum. O motor nunca foi sobre kanban:
//   `decideActions` usa a coluna só para validar o alvo de `move_to_column`, e
//   as condições de tempo `field_changed`/`created` já são de REGISTRO. O que
//   prendia ao quadro era a origem das linhas — agora ela ramifica
//   (lib/kanban/automations/universe.ts).
// Modelo das AUTOMAÇÕES do kanban (modo registros): uma regra é uma lista de
// condições em E (podem MESCLAR as 4 famílias — campo do registro, registros
// conectados, tarefas e tempo) + uma ação. Várias regras em ordem (position)
// dão o OU: a primeira que casar vence por card. Persistida como jsonb
// versionado em automation_rules.rule (0109); parse fail-closed — regra
// malformada nunca roda (vira last_error), nunca "roda como der".
// A avaliação é 100% no engine (evaluate.ts/engine.ts) — RPCs intocados.
// v1.1 (31/07/2026): ação `set_field` (grava um valor fixo num campo do
// registro). O parse valida SÓ a estrutura (field/value não-vazios) —
// existência/tipo do campo é checagem de AVALIAÇÃO (evaluate.ts: regra inerte
// + last_error; o catálogo pode mudar depois da regra criada) com validação
// adicional no save (actions.ts) p/ mensagem imediata. IDEMPOTENTE por
// desenho: valor atual igual ao alvo consome o card SEM escrever (decidido no
// avaliador — zero churn de audit/webhook no tick por minuto).
import { parseSeriesConfig, type SeriesConfig } from "@/lib/series/types";
import type { WidgetFilter } from "@/lib/widgets/types";

/** Comparador numérico das condições de contagem (conectados/tarefas). */
export type AutomationNumOp = "gte" | "lte" | "eq";

export type AutomationTimeBasis =
  // Última alteração de um campo (records.field_modified_at[campo]).
  | { type: "field_changed"; field: string }
  // Criação na origem (records.source_created_at).
  | { type: "created" }
  // Entrada na coluna atual — só colunas "Personalizar"
  // (kanban_placements.updated_at; sem linha = nunca movido → não casa).
  | { type: "in_column" };

export type AutomationCondition =
  // (a) Campo do registro — reusa WidgetFilter inteiro (core, custom:,
  // unified:, match:<fonte>:<ref>). Ops da UI de filtros; avaliação local
  // espelha a semântica dos widgets (evalCondition: trim, case-insensitive,
  // null ≡ '').
  | { kind: "field"; filter: WidgetFilter }
  // (b) Registros CONECTADOS (record_matches, qualquer direção): nº de
  // registros da base `source` conectados ao card que passam em `filters`,
  // comparado a `value`. É o "parceiro com ≥ N leads". `filters` não aceita
  // refs match: (1 nível só).
  | {
      kind: "related_count";
      source: string;
      filters: WidgetFilter[];
      op: AutomationNumOp;
      value: number;
    }
  // (c) Tarefas do card: abertas ou atrasadas (abertas com prazo < hoje).
  | { kind: "tasks"; metric: "open" | "overdue"; op: AutomationNumOp; value: number }
  // (d) Tempo, em DIAS de calendário (prefixo YYYY-MM-DD, dia de Brasília —
  // todayIso injetado). Base ausente (campo nunca alterado, sem posição na
  // coluna) → condição NÃO casa.
  | { kind: "time"; basis: AutomationTimeBasis; op: "gte" | "lte"; days: number };

/** Ação da regra — união EXTENSÍVEL (v3: criar tarefa, …). `set_field`
 *  grava valor FIXO (string; coerção por tipo no executor); alvo de data/
 *  calculado/relação/`match:`/`unified:`/campo-espelho da alocação é barrado
 *  na avaliação e no save, nunca aqui (fail-closed estrutural apenas). */
export type AutomationAction =
  | { type: "move_to_column"; targetKey: string }
  | { type: "set_field"; field: string; value: string }
  // `dueInDays` conta a partir do dia da execução (null = sem prazo).
  // `responsibleFrom`: "record" usa o responsável do registro; "fixed" usa
  // `responsibleId`. Sem dono, a tarefa nasce sem responsável — visível a quem
  // a RLS de tasks já deixa ver.
  // `simulate` é o ensaio: avalia, grava em workflow_runs o que FARIA e não
  // envia nada. `map`: form key do esquema → ref do campo do registro.
  | {
      type: "run_schema";
      schemaKey: string;
      simulate: boolean;
      map?: Record<string, string>;
    }
  // Série periódica: a config inteira (âncora, janela, cadência e cascata)
  // mora no jsonb e é parseada fail-closed por `parseSeriesConfig`.
  | { type: "create_task_series"; series: SeriesConfig }
  | {
      type: "create_task";
      title: string;
      description?: string;
      dueInDays?: number | null;
      responsibleFrom?: "record" | "fixed" | "none";
      responsibleId?: string | null;
    };

export interface AutomationRule {
  v: 1;
  conditions: AutomationCondition[];
  action: AutomationAction;
}

/** Linha de automation_rules já parseada p/ UI/engine. */
export interface AutomationRow {
  id: string;
  name: string;
  enabled: boolean;
  position: number;
  rule: AutomationRule;
  last_run_at: string | null;
  last_error: string | null;
  last_moved_count: number;
}

/** Dono da automação — mesmo shape do KanbanOwner (widget ou board dedicado). */
/**
 * Dono da regra — e, por consequência, o UNIVERSO que ela avalia.
 * `widget`/`board`: os cards de um quadro. `source`: os registros de uma Base
 * (`data_sources.key`), sem quadro — aí `move_to_column` não existe e a
 * condição de tempo `in_column` fica inerte (não há posição para medir).
 * Exatamente um deles por linha (CHECK da 0127).
 */
export type AutomationOwner =
  | { kind: "widget"; id: string }
  | { kind: "board"; id: string }
  | { kind: "source"; id: string };

/** Coluna de `automation_rules` que guarda este dono. */
export function ownerColumn(
  owner: AutomationOwner
): "widget_id" | "board_id" | "source_key" {
  if (owner.kind === "widget") return "widget_id";
  if (owner.kind === "board") return "board_id";
  return "source_key";
}

/** O universo é um quadro? (decide guardas, placements e `move_to_column`) */
export function isBoardOwner(
  owner: AutomationOwner
): owner is { kind: "widget" | "board"; id: string } {
  return owner.kind !== "source";
}

// Teto de condições por regra (sanidade do jsonb; a UI limita antes).
export const MAX_RULE_CONDITIONS = 10;

const NUM_OPS: readonly string[] = ["gte", "lte", "eq"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseFilter(raw: unknown): WidgetFilter | null {
  if (!isRecord(raw)) return null;
  const field = raw.field;
  const op = raw.op;
  if (typeof field !== "string" || field === "") return null;
  if (typeof op !== "string" || op === "") return null;
  const out: WidgetFilter = { field, op } as WidgetFilter;
  if ("value" in raw) out.value = raw.value;
  return out;
}

function parseCondition(raw: unknown): AutomationCondition | null {
  if (!isRecord(raw)) return null;
  switch (raw.kind) {
    case "field": {
      const filter = parseFilter(raw.filter);
      return filter ? { kind: "field", filter } : null;
    }
    case "related_count": {
      const source = raw.source;
      const op = raw.op;
      const value = raw.value;
      if (typeof source !== "string" || source === "") return null;
      if (typeof op !== "string" || !NUM_OPS.includes(op)) return null;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        return null;
      const filtersRaw = Array.isArray(raw.filters) ? raw.filters : [];
      const filters: WidgetFilter[] = [];
      for (const f of filtersRaw) {
        const parsed = parseFilter(f);
        if (!parsed) return null;
        // 1 nível só: o registro conectado não resolve match: dele mesmo.
        if (parsed.field.startsWith("match:")) return null;
        filters.push(parsed);
      }
      return {
        kind: "related_count",
        source,
        filters,
        op: op as AutomationNumOp,
        value,
      };
    }
    case "tasks": {
      const metric = raw.metric;
      const op = raw.op;
      const value = raw.value;
      if (metric !== "open" && metric !== "overdue") return null;
      if (typeof op !== "string" || !NUM_OPS.includes(op)) return null;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        return null;
      return { kind: "tasks", metric, op: op as AutomationNumOp, value };
    }
    case "time": {
      const basisRaw = raw.basis;
      const op = raw.op;
      const days = raw.days;
      if (op !== "gte" && op !== "lte") return null;
      if (typeof days !== "number" || !Number.isFinite(days) || days < 0)
        return null;
      if (!isRecord(basisRaw)) return null;
      let basis: AutomationTimeBasis | null = null;
      if (basisRaw.type === "created") basis = { type: "created" };
      else if (basisRaw.type === "in_column") basis = { type: "in_column" };
      else if (
        basisRaw.type === "field_changed" &&
        typeof basisRaw.field === "string" &&
        basisRaw.field !== ""
      )
        basis = { type: "field_changed", field: basisRaw.field };
      return basis ? { kind: "time", basis, op, days } : null;
    }
    default:
      return null;
  }
}

/**
 * Valida uma regra crua (jsonb do banco / payload da UI). Fail-closed: retorna
 * null p/ qualquer estrutura fora do contrato — sem condições, condição de
 * kind desconhecido, ação sem alvo etc. Alvos especiais (overflow) são
 * barrados aqui; a existência da coluna no quadro é checada na avaliação
 * (evaluate.ts), que conhece as colunas derivadas.
 */
export function parseAutomationRule(raw: unknown): AutomationRule | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  const actionRaw = raw.action;
  let action: AutomationAction | null = null;
  if (isRecord(actionRaw)) {
    if (
      actionRaw.type === "move_to_column" &&
      typeof actionRaw.targetKey === "string" &&
      actionRaw.targetKey !== ""
    ) {
      action = { type: "move_to_column", targetKey: actionRaw.targetKey };
    } else if (
      actionRaw.type === "create_task" &&
      typeof actionRaw.title === "string" &&
      actionRaw.title.trim() !== ""
    ) {
      // Só estrutura, como as demais. Prazo negativo não existe (tarefa que
      // nasce vencida é ruído); ausente/inválido = sem prazo.
      const rawDue = actionRaw.dueInDays;
      const dueInDays =
        typeof rawDue === "number" && Number.isFinite(rawDue) && rawDue >= 0
          ? Math.floor(rawDue)
          : null;
      const from = actionRaw.responsibleFrom;
      const responsibleFrom =
        from === "record" || from === "fixed" || from === "none"
          ? from
          : "record";
      action = {
        type: "create_task",
        title: actionRaw.title.trim(),
        ...(typeof actionRaw.description === "string" &&
        actionRaw.description.trim() !== ""
          ? { description: actionRaw.description.trim() }
          : {}),
        dueInDays,
        responsibleFrom,
        responsibleId:
          responsibleFrom === "fixed" && typeof actionRaw.responsibleId === "string"
            ? actionRaw.responsibleId
            : null,
      };
    } else if (actionRaw.type === "create_task_series") {
      // Fail-closed inteiro: série sem âncora ou com cadência fora de faixa
      // abriria tarefa para o vendedor errado, ou todo dia.
      const series = parseSeriesConfig(actionRaw.series);
      if (series) action = { type: "create_task_series", series };
    } else if (
      actionRaw.type === "run_schema" &&
      typeof actionRaw.schemaKey === "string" &&
      actionRaw.schemaKey.trim() !== ""
    ) {
      // Ausente/inválido ⇒ SIMULA. Uma regra que escreve fora do sistema não
      // pode nascer armada por omissão de uma chave no jsonb.
      const simulate = actionRaw.simulate !== false;
      const rawMap = actionRaw.map;
      const map: Record<string, string> = {};
      if (isRecord(rawMap)) {
        for (const [k, v] of Object.entries(rawMap)) {
          if (typeof v === "string" && v.trim() !== "") map[k] = v.trim();
        }
      }
      action = {
        type: "run_schema",
        schemaKey: actionRaw.schemaKey.trim(),
        simulate,
        ...(Object.keys(map).length > 0 ? { map } : {}),
      };
    } else if (
      // set_field: só estrutura (v1 sem "limpar" — value não-vazio); o alvo é
      // validado na avaliação/save (o catálogo pode mudar após a regra).
      actionRaw.type === "set_field" &&
      typeof actionRaw.field === "string" &&
      actionRaw.field !== "" &&
      typeof actionRaw.value === "string" &&
      actionRaw.value.trim() !== ""
    ) {
      action = {
        type: "set_field",
        field: actionRaw.field,
        value: actionRaw.value,
      };
    }
  }
  if (!action) return null;
  const condsRaw = raw.conditions;
  if (
    !Array.isArray(condsRaw) ||
    condsRaw.length === 0 ||
    condsRaw.length > MAX_RULE_CONDITIONS
  )
    return null;
  const conditions: AutomationCondition[] = [];
  for (const c of condsRaw) {
    const parsed = parseCondition(c);
    if (!parsed) return null;
    conditions.push(parsed);
  }
  return { v: 1, conditions, action };
}

/**
 * Chave canônica de uma condição related_count — dedupe das consultas de
 * contagem no engine (condições idênticas em regras diferentes contam UMA vez)
 * e chave de CardFacts.relatedCounts.
 */
export function relatedCountKey(
  cond: Extract<AutomationCondition, { kind: "related_count" }>
): string {
  return JSON.stringify([
    cond.source,
    cond.filters.map((f) => [f.field, f.op, f.value ?? null]),
  ]);
}

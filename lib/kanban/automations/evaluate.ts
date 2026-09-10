// Versão: 1.6 | Data: 10/09/2026
// v1.6 (10/09/2026): a janela da série passa a ser reposta por CONCLUSÃO
//   (`occurrencesToOpen`), não pela virada do ciclo, e o fato
//   `seriesOccurrences` carrega o estado de cada ocorrência para isso. Junto:
//   a REVOGAÇÃO — registro que deixou de casar as condições devolve as
//   ocorrências ainda não concluídas (`revokedSeries`).
// v1.5 (10/09/2026): só vocabulário — o substantivo da ocorrência
//   da série saiu do código e virou dado (SeriesConfig.noun, e
//   tasks.occurrence_noun por tarefa).
// v1.4 (09/09/2026): ação `create_task_series`. A decisão de "abre hoje?" é
//   DERIVADA aqui, pura: âncora (o mesmo histórico que a condição de
//   tempo já usa) + cadência resolvida pela cascata = a ocorrência devida. O
//   fato `seriesOccurrences` evita a ida ao banco de uma ocorrência que já
//   existe; a trava de verdade é o índice único da 0132.
// Versão: 1.3 | Data: 09/09/2026
// v1.3 (09/09/2026): ação `run_schema`. As respostas que o esquema receberia de
//   uma pessoa são resolvidas AQUI, do registro — como o `set_field` resolve o
//   valor e o `create_task` resolve o prazo: o planejador entrega payload
//   pronto e o executor só escreve. Precedência de cada campo: `map` da regra →
//   `sourceRef` do esquema → `defaultValue`. Esquema ausente do catálogo da
//   rodada (apagado, desligado, inválido ou com gatilho de formulário) deixa a
//   regra INERTE com erro, pelo mesmo caminho de "coluna removida".
// Versão: 1.4 | Data: 09/09/2026
// v1.4 (09/09/2026): ação `create_task_series`. A decisão de "abre hoje?" é
//   DERIVADA aqui, pura: âncora (o mesmo histórico que a condição de
//   tempo já usa) + cadência resolvida pela cascata = a ocorrência devida. O
//   fato `seriesOccurrences` evita a ida ao banco de uma ocorrência que já
//   existe; a trava de verdade é o índice único da 0132.
// Versão: 1.3 | Data: 09/09/2026
// v1.3 (09/09/2026): `addDaysIso`/`daysSince` saíram para lib/date/days.ts
//   (dono único da aritmética de dia civil) e são reexportadas daqui.
// v1.2 (08/09/2026): ação `create_task`. A idempotência dela não cabe na
//   comparação que o `set_field` usa (criar tarefa não tem estado anterior
//   para comparar), então vem como FATO da rodada: `openAutomationRuleIds`
//   diz quais regras já têm tarefa ABERTA para aquele registro, e a regra
//   consome o card sem criar de novo. A trava definitiva é o índice único
//   parcial da 0129 — isto aqui evita a ida ao banco, não substitui.
// Avaliador PURO das automações do kanban: sem I/O — recebe fatos por card
// (CardFacts, montados pelo engine) e decide as AÇÕES. Semântica:
// regras em ordem (position), a PRIMEIRA que casar vence por card; decisões
// sobre o snapshot ORIGINAL do quadro (uma regra não "vê" o efeito de outra na
// mesma rodada — mata ping-pong intra-run); card já na coluna alvo = no-op
// (a regra casou, mas nada a fazer); mock nunca move (congelado, 0051);
// alvo overflow/inexistente/oculto = ERRO da regra (visível em last_error),
// nunca silêncio. Condição de campo espelha a semântica dos widgets via
// recordMatchesConds/evalCondition (trim, case-insensitive, null ≡ '');
// ilike é avaliado localmente (contém, case-insensitive) p/ não degradar.
// Tempo é dia de CALENDÁRIO (prefixo YYYY-MM-DD — todayIso já vem ancorado em
// Brasília pelo chamador; coerente com a regra de datas 0079/0085).
// v1.1 (31/07/2026): ação set_field — decideMoves vira decideActions
// ({moves, sets, ruleErrors}). Alvo do set validado POR REGRA aqui (campo
// inexistente/data/calculado/relação/match:/unified:/espelho da alocação ⇒
// regra INERTE + ruleError — o catálogo pode mudar depois da regra criada) e
// IDEMPOTÊNCIA decidida no snapshot: valor atual igual ao alvo consome o card
// SEM emitir escrita (zero churn de audit/webhook no tick por minuto).
import { addDaysIso, daysSince } from "@/lib/date/days";
import type { RecordRow } from "@/lib/records/types";
import type { AggCondition } from "@/lib/records/formulas";
import { EDITABLE_CORE_COLUMNS } from "@/lib/config/core-writeback";
import { recordMatchesConds } from "@/lib/widgets/calc-metrics";
import { recordRawValue } from "@/lib/widgets/quick-filters";
import type { AvailableField } from "@/lib/widgets/fields";
import type { FilterOp, WidgetFilter } from "@/lib/widgets/types";
import { resolveCadence, type SeriesSetting } from "@/lib/series/cadence";
import {
  occurrencesToOpen,
  resolveAnchorDate,
  resolveBound,
} from "@/lib/series/occurrence";
import type { WorkflowDefinition } from "@/lib/workflow/types";
import { KANBAN_OVERFLOW_KEY, type KanbanColumn } from "../types";
import {
  DEFAULT_MIRROR_LEAD_DAYS,
  DEFAULT_SERIES_LOOKAHEAD,
  type SeriesConfig,
} from "@/lib/series/types";
import {
  relatedCountKey,
  type AutomationCondition,
  type AutomationNumOp,
  type AutomationRow,
} from "./types";

/** Fatos de um card, pré-carregados pelo engine (só o que as regras pedem). */
export interface CardFacts {
  // Registro completo (com __match preenchido — runRecordList já anexa).
  record: RecordRow;
  // Coluna ATUAL resolvida (saída do runKanban — inclui placements/overflow).
  columnKey: string;
  isMock: boolean;
  openTasks: number;
  overdueTasks: number;
  // Contagens de conectados por chave canônica da condição (relatedCountKey).
  relatedCounts: Record<string, number>;
  // records.field_modified_at ({ campo: timestamp }) — null = nunca carimbado.
  /**
   * Última alteração de cada campo pedido pelas regras da rodada, do HISTÓRICO
   * (audit_log + edição local). null = nenhuma regra ativa pergunta por tempo
   * de campo.
   *
   * v1.1 (09/09/2026): era `fieldModifiedAt` cru. `records.field_modified_at`
   * é o marcador de proteção do sync, não histórico — para campo do Bitrix
   * ficava sempre vazio, e tanto a âncora da série quanto esta condição de
   * tempo nunca casavam, em silêncio. Ver lib/records/field-history.ts.
   */
  changedAt: Map<string, string> | null;
  sourceCreatedAt: string | null;
  // kanban_placements.updated_at (colunas Personalizar) — null = sem posição.
  placementUpdatedAt: string | null;
  // Regras que JÁ têm tarefa aberta para este registro (ação create_task).
  // Vazio quando nenhuma regra ativa da rodada cria tarefa.
  openAutomationRuleIds: string[];
  /**
   * Ocorrências de série JÁ criadas para este registro, com o estado delas.
   * Vazio quando nenhuma regra ativa da rodada mantém série.
   *
   * v1.3 (10/09/2026): era `string[]` de "<ruleId>:<n>" — só respondia "esta
   * ocorrência existe?". A janela agora repõe por CONCLUSÃO, e para isso
   * precisa saber quantas ainda estão ABERTAS.
   */
  seriesOccurrences: SeriesOccurrenceFact[];
  /**
   * Atributos do registro com status 'pausado' (record_attributes, 0131).
   * Vazio quando nenhuma regra ativa da rodada concede atributo.
   *
   * v1.2 (09/09/2026): pausar precisa PARAR a série — antes o status era
   * escrito e nunca lido.
   */
  pausedAttributes: string[];
}

/** Uma ocorrência já criada para o par (regra, registro). */
export interface SeriesOccurrenceFact {
  ruleId: string;
  occurrence: number;
  /** `completed_at is null`. */
  open: boolean;
}

export interface EvalContext {
  // Catálogo p/ resolver refs custom:/unified:/match: (recordRawValue).
  available: AvailableField[];
  // Dia de hoje YYYY-MM-DD (Brasília) — injetado p/ teste determinístico.
  todayIso: string;
  // Colunas derivadas do quadro (visíveis) — validação do alvo.
  columns: KanbanColumn[];
  // settings.kanban.allocationFieldKey do quadro DONO (invariante 24): o campo
  // ESPELHO da alocação nunca é alvo de set_field (dessincronizaria
  // kanban_placements, a verdade). null/ausente = sem vínculo.
  allocationFieldKey?: string | null;
  /**
   * Esquemas de Workflow ELEGÍVEIS da rodada (chave → definição), carregados
   * uma vez pelo engine: ligados, com gatilho `automacao` e definição válida.
   * Ausência da chave é o que torna a regra inerte — o mesmo tratamento da
   * coluna que sumiu.
   */
  schemaDefs?: Map<string, WorkflowDefinition>;
  /**
   * Exceções de cadência da rodada, por chave de série (linhas de
   * series_settings). Ausente = ninguém sobrescreveu nada e vale o padrão do
   * esquema — que é o caso comum.
   */
  seriesSettings?: Map<string, SeriesSetting[]>;
}

export interface PlannedMove {
  recordId: string;
  fromKey: string;
  targetKey: string;
  ruleId: string;
}

/** Escrita de campo decidida por uma regra set_field. */
export interface PlannedSet {
  recordId: string;
  field: string;
  value: string;
  ruleId: string;
}

/** Ocorrência de uma série decidida por uma regra create_task_series. */
/**
 * Uma série a DEVOLVER: o registro deixou de casar as condições da regra, e as
 * ocorrências que ninguém concluiu não têm mais por que existir.
 *
 * v1.6 (10/09/2026): sem isto, um deal que sai da etapa levava consigo as
 * tarefas da etapa antiga — abertas, no nome do vendedor, para sempre. Só as
 * NÃO concluídas saem: o que foi feito é histórico e fica.
 *
 * Pausar o atributo ou desligar a cadência para um recorte NÃO revoga — nesses
 * casos a regra continua casando, ela só não gera nada. Parar de pedir e
 * apagar o que já foi cobrado são decisões diferentes.
 */
export interface PlannedSeriesRevoke {
  recordId: string;
  ruleId: string;
}

export interface PlannedSeriesTask {
  recordId: string;
  ruleId: string;
  seriesKey: string;
  /** N-ésima ocorrência — vai para tasks.series_occurrence (a trava). */
  occurrence: number;
  title: string;
  description: string | null;
  /** Dia previsto da ocorrência (âncora + N × cadência). */
  dueDate: string;
  responsibleId: string | null;
  /** Atributo a conceder ao registro que entra na série (ex.: "tree"). */
  grantAttribute: string | null;
  /** Nível 2 do espelho no Bitrix (0136). "herdar" = segue a Base. */
  mirrorBitrix: "herdar" | "sempre" | "nunca";
  /**
   * Antecedência do espelho, em dias. A ocorrência nasce aqui de imediato, mas
   * só vira atividade no CRM quando o vencimento entra nesta janela.
   */
  mirrorLeadDays: number;
}

/** Execução de esquema decidida por uma regra run_schema. */
export interface PlannedSchemaRun {
  recordId: string;
  ruleId: string;
  schemaKey: string;
  simulate: boolean;
  /** Respostas do formulário do esquema, já resolvidas a partir do registro. */
  form: Record<string, string>;
}

/** Tarefa decidida por uma regra create_task. */
export interface PlannedTask {
  recordId: string;
  ruleId: string;
  title: string;
  description: string | null;
  /** YYYY-MM-DD, já resolvido a partir de `dueInDays` e do dia da rodada. */
  dueDate: string | null;
  /** Responsável resolvido pelo avaliador (do registro ou fixo); null = sem. */
  responsibleId: string | null;
}

export interface RuleError {
  ruleId: string;
  message: string;
}

// A aritmética de dia civil vive em lib/date/days.ts (dono único desde
// 09/09/2026 — havia uma cópia aqui e outra em lib/tasks/alerts.ts, e a série
// periódica seria a terceira). Reexportadas para não mexer nos chamadores.
export { addDaysIso, daysSince };

// Ops de comparação → op de AggCondition (mesma normalização dos widgets:
// eq_ci/neq_ci e *_num compartilham a semântica do evalCondition, que já
// decide texto×número pelo TIPO do literal).
const CMP_OPS: Partial<Record<FilterOp, "=" | "<>" | "<" | ">" | "<=" | ">=">> =
  {
    eq: "=",
    eq_ci: "=",
    eq_num: "=",
    neq: "<>",
    neq_ci: "<>",
    neq_num: "<>",
    gt: ">",
    gt_num: ">",
    gte: ">=",
    gte_num: ">=",
    lt: "<",
    lt_num: "<",
    lte: "<=",
    lte_num: "<=",
  };

function scalar(v: unknown): v is string | number | boolean {
  return (
    typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  );
}

/**
 * Um valor cru passa por um WidgetFilter? Avaliação LOCAL usada nas condições
 * de campo e nos filtros de registros conectados. Op desconhecido/valor não
 * escalar → false (fail-closed).
 */
export function fieldFilterMatches(
  filter: WidgetFilter,
  rawOf: (ref: string) => unknown
): boolean {
  if (filter.op === "ilike") {
    const term = String(filter.value ?? "")
      .trim()
      .toLowerCase();
    if (term === "") return true;
    const v = rawOf(filter.field);
    return v != null && String(v).toLowerCase().includes(term);
  }
  if (filter.op === "in" || filter.op === "in_ci") {
    const list = (
      Array.isArray(filter.value)
        ? filter.value
        : filter.value == null
          ? []
          : [filter.value]
    ).filter(scalar);
    if (list.length === 0) return false;
    const conds: AggCondition[] = [
      { ref: filter.field, op: "in", value: list },
    ];
    return recordMatchesConds(rawOf, conds);
  }
  if (filter.op === "is_null" || filter.op === "not_null") {
    return recordMatchesConds(rawOf, [{ ref: filter.field, op: filter.op }]);
  }
  const op = CMP_OPS[filter.op];
  if (!op) return false;
  const value = filter.op.endsWith("_num")
    ? Number(filter.value)
    : filter.value;
  if (!scalar(value) || (typeof value === "number" && !Number.isFinite(value)))
    return false;
  return recordMatchesConds(rawOf, [{ ref: filter.field, op, value }]);
}

function cmpNum(actual: number, op: AutomationNumOp, value: number): boolean {
  if (op === "gte") return actual >= value;
  if (op === "lte") return actual <= value;
  return actual === value;
}

/** Uma condição casa com um card? (puro — os fatos já foram carregados). */
export function evaluateCondition(
  cond: AutomationCondition,
  facts: CardFacts,
  ctx: EvalContext
): boolean {
  switch (cond.kind) {
    case "field":
      return fieldFilterMatches(cond.filter, (ref) =>
        recordRawValue(ref, facts.record, ctx.available)
      );
    case "related_count":
      return cmpNum(
        facts.relatedCounts[relatedCountKey(cond)] ?? 0,
        cond.op,
        cond.value
      );
    case "tasks":
      return cmpNum(
        cond.metric === "open" ? facts.openTasks : facts.overdueTasks,
        cond.op,
        cond.value
      );
    case "time": {
      const iso =
        cond.basis.type === "field_changed"
          ? facts.changedAt?.get(cond.basis.field)
          : cond.basis.type === "created"
            ? facts.sourceCreatedAt
            : facts.placementUpdatedAt;
      const days = daysSince(iso ?? null, ctx.todayIso);
      if (days == null) return false;
      return cond.op === "gte" ? days >= cond.days : days <= cond.days;
    }
  }
}

/**
 * Alvo de set_field é válido neste quadro/catálogo? null = ok; senão a
 * mensagem do ruleError. Mesma régua do save (actions.ts) e do picker da UI
 * (settableFields) — a guarda daqui é a DEFINITIVA (o campo pode sumir ou o
 * vínculo da alocação pode nascer DEPOIS da regra criada).
 */
export function setFieldTargetError(
  field: string,
  ctx: Pick<EvalContext, "available" | "allocationFieldKey">
): string | null {
  if (field.startsWith("match:") || field.startsWith("unified:")) {
    return `O campo "${field}" (casado/unificado) não pode ser alvo de "Definir campo".`;
  }
  if (
    ctx.allocationFieldKey &&
    field === `custom:${ctx.allocationFieldKey}`
  ) {
    return `O campo "${field}" espelha a fase deste quadro — use a ação "Mover para a coluna".`;
  }
  const af = ctx.available.find((f) => f.field === field);
  if (!af) {
    return `Campo alvo "${field}" não existe no catálogo (removido ou oculto).`;
  }
  if (af.fk) {
    return `O campo "${af.label}" é uma relação — fora do alcance de "Definir campo".`;
  }
  if (af.isDate) {
    return `O campo "${af.label}" é de data — datas nunca são alvo de automação (não idempotente).`;
  }
  if (af.calc || af.aggCalc) {
    return `O campo "${af.label}" é calculado — o valor é derivado, não gravável.`;
  }
  if (af.displayOnly) {
    return `O campo "${af.label}" é só de exibição — não existe coluna para gravar.`;
  }
  // Coluna do núcleo: só as EDITÁVEIS (barra record_type/source_system/
  // stage_semantic/lead_time_days — derivadas do sync, nunca graváveis).
  if (!field.startsWith("custom:") && !(field in EDITABLE_CORE_COLUMNS)) {
    return `A coluna "${af.label}" não é editável — fora do alcance de "Definir campo".`;
  }
  return null;
}

/**
 * Decide as AÇÕES da rodada: por card, primeira regra (ordem do array)
 * cujas condições TODAS casam vence; já na coluna alvo (move) ou já com o
 * valor alvo (set) = consome a regra sem escrever. Regras com alvo inválido
 * (overflow, coluna inexistente/oculta, campo proibido) são INERTES na rodada
 * e saem em ruleErrors — o quadro/catálogo pode ter mudado depois da regra
 * criada.
 */
export function decideActions(
  rules: AutomationRow[],
  cards: CardFacts[],
  ctx: EvalContext
): {
  moves: PlannedMove[];
  sets: PlannedSet[];
  tasks: PlannedTask[];
  schemaRuns: PlannedSchemaRun[];
  seriesTasks: PlannedSeriesTask[];
  revokedSeries: PlannedSeriesRevoke[];
  ruleErrors: RuleError[];
} {
  const ruleErrors: RuleError[] = [];
  const validKeys = new Set(
    ctx.columns.filter((c) => !c.noDrop).map((c) => c.key)
  );
  const active: AutomationRow[] = [];
  for (const rule of rules) {
    const action = rule.rule.action;
    if (action.type === "move_to_column") {
      const target = action.targetKey;
      if (target === KANBAN_OVERFLOW_KEY || !validKeys.has(target)) {
        ruleErrors.push({
          ruleId: rule.id,
          message: `Coluna alvo "${target}" não existe no quadro (removida ou oculta).`,
        });
        continue;
      }
    } else if (action.type === "set_field") {
      const err = setFieldTargetError(action.field, ctx);
      if (err) {
        ruleErrors.push({ ruleId: rule.id, message: err });
        continue;
      }
    } else if (action.type === "run_schema") {
      // O esquema pode ter sido apagado, desligado, invalidado ou virado
      // formulário DEPOIS da regra criada. Regra inerte com motivo, nunca uma
      // execução às cegas.
      if (!ctx.schemaDefs?.has(action.schemaKey)) {
        ruleErrors.push({
          ruleId: rule.id,
          message: `O esquema "${action.schemaKey}" não está disponível para automação (apagado, desligado, inválido ou é um formulário).`,
        });
        continue;
      }
    }
    // create_task não tem alvo no catálogo para validar: o título já veio
    // não-vazio do parse, e o resto (prazo, responsável) é opcional.
    active.push(rule);
  }

  const moves: PlannedMove[] = [];
  const sets: PlannedSet[] = [];
  const tasks: PlannedTask[] = [];
  const schemaRuns: PlannedSchemaRun[] = [];
  const seriesTasks: PlannedSeriesTask[] = [];
  const revokedSeries: PlannedSeriesRevoke[] = [];
  for (const card of cards) {
    if (card.isMock) continue;
    for (const rule of active) {
      const matched = rule.rule.conditions.every((c) =>
        evaluateCondition(c, card, ctx)
      );
      if (!matched) {
        // Saiu do recorte da regra (mudou de etapa, o campo virou outra coisa):
        // as ocorrências abertas voltam. As concluídas ficam — são histórico.
        if (
          rule.rule.action.type === "create_task_series" &&
          card.seriesOccurrences.some((o) => o.ruleId === rule.id && o.open)
        ) {
          revokedSeries.push({ recordId: card.record.id, ruleId: rule.id });
        }
        continue;
      }
      const action = rule.rule.action;
      if (action.type === "move_to_column") {
        if (card.columnKey !== action.targetKey) {
          moves.push({
            recordId: card.record.id,
            fromKey: card.columnKey,
            targetKey: action.targetKey,
            ruleId: rule.id,
          });
        }
      } else if (action.type === "set_field") {
        // Idempotência no snapshot: valor atual igual ao alvo NÃO escreve
        // (mesma régua string do updateRecord — null ≡ '').
        const current = recordRawValue(action.field, card.record, ctx.available);
        if (String(current ?? "") !== action.value) {
          sets.push({
            recordId: card.record.id,
            field: action.field,
            value: action.value,
            ruleId: rule.id,
          });
        }
      } else if (action.type === "create_task_series") {
        seriesTasks.push(...planSeriesTask(action.series, rule.id, card, ctx));
      } else if (action.type === "run_schema") {
        const def = ctx.schemaDefs?.get(action.schemaKey);
        if (def) {
          schemaRuns.push({
            recordId: card.record.id,
            ruleId: rule.id,
            schemaKey: action.schemaKey,
            simulate: action.simulate,
            form: resolveSchemaForm(def, card, ctx, action.map),
          });
        }
      } else {
        // Idempotência: já existe tarefa ABERTA desta regra para este
        // registro? Consome o card sem criar outra. Concluída a tarefa, a
        // condição volta a valer e a regra abre outra — é acompanhamento
        // recorrente, não marcador de "já cobrei uma vez na vida".
        if (!card.openAutomationRuleIds.includes(rule.id)) {
          tasks.push({
            recordId: card.record.id,
            ruleId: rule.id,
            title: action.title,
            description: action.description ?? null,
            dueDate:
              action.dueInDays == null
                ? null
                : addDaysIso(ctx.todayIso, action.dueInDays),
            responsibleId:
              action.responsibleFrom === "fixed"
                ? (action.responsibleId ?? null)
                : action.responsibleFrom === "none"
                  ? null
                  : (card.record.responsible_id ?? null),
          });
        }
      }
      break; // primeira regra que casou consome o card (mesmo sem escrever)
    }
  }
  return {
    moves,
    sets,
    tasks,
    schemaRuns,
    seriesTasks,
    revokedSeries,
    ruleErrors,
  };
}

/**
 * A ocorrência devida hoje para este registro — ou null.
 *
 * Null em quatro situações, todas silenciosas de propósito (não são erro da
 * regra, são a série ainda não tendo o que abrir): sem âncora (o campo nunca
 * foi preenchido), fora da janela, desligada por alguma exceção de escopo, ou
 * a ocorrência devida já existe. O último caso é o comum — a série passa a
 * maior parte dos dias sem nada a fazer.
 */
function planSeriesTask(
  series: SeriesConfig,
  ruleId: string,
  card: CardFacts,
  ctx: EvalContext
): PlannedSeriesTask[] {
  // v1.2 (09/09/2026): pausar o atributo agora PAUSA de verdade. O status era
  // só escrito (series.ts) e nunca lido, então "pausado" não parava nada — a
  // arquitetura prometia o contrário desde a 0131.
  if (card.pausedAttributes.includes(series.grantAttribute ?? "")) return [];

  const facts = {
    record: card.record,
    changedAt: card.changedAt,
    sourceCreatedAt: card.sourceCreatedAt,
    available: ctx.available,
  };
  const anchorDate = resolveAnchorDate(
    series.anchor,
    facts,
    series.anchorFallback
  );
  if (!anchorDate) return [];

  const cadence = resolveCadence(
    series.cadence,
    card.record,
    ctx.available,
    ctx.seriesSettings?.get(series.key) ?? []
  );
  // Desligado para este recorte (responsável, registro, etapa…): a série
  // continua existindo e o atributo continua no registro — só não gera nada.
  if (!cadence.active) return [];

  // v1.3: mantém `lookahead` ocorrências FUTURAS abertas, repondo a cada
  // conclusão (antes a janela só andava com a virada do ciclo — concluir uma
  // deixava o vendedor com uma a menos na tela até a próxima quinzena).
  const plans = occurrencesToOpen(
    {
      anchorDate,
      cadenceDays: cadence.days,
      todayIso: ctx.todayIso,
      fromDate: resolveBound(series.from, facts),
      untilDate: resolveBound(series.until, facts),
      firstAt: series.firstAt,
      maxOccurrences: series.maxOccurrences,
    },
    {
      keepAhead: series.lookahead ?? DEFAULT_SERIES_LOOKAHEAD,
      known: card.seriesOccurrences
        .filter((o) => o.ruleId === ruleId)
        .map((o) => ({ occurrence: o.occurrence, open: o.open })),
    }
  );

  const title =
    typeof series.title === "string" ? series.title : series.title.value;
  const out: PlannedSeriesTask[] = [];
  for (const plan of plans) {
    // Sem filtro de "já criada" aqui: `occurrencesToOpen` já recebeu o que
    // existe e só emite o que falta. A trava de verdade segue sendo o índice
    // único da 0132.
    out.push({
      recordId: card.record.id,
      ruleId,
      seriesKey: series.key,
      occurrence: plan.occurrence,
      title,
      description: series.description ?? null,
      dueDate: plan.dueDate,
      // Em nome do responsável DO REGISTRO — quem conduz o acompanhamento.
      responsibleId: card.record.responsible_id ?? null,
      grantAttribute: series.grantAttribute ?? null,
      mirrorBitrix: series.mirrorBitrix ?? "herdar",
      mirrorLeadDays: series.mirrorLeadDays ?? DEFAULT_MIRROR_LEAD_DAYS,
    });
  }
  return out;
}

/**
 * Preenche o formulário do esquema a partir do REGISTRO. Quem responderia é uma
 * pessoa; aqui responde o card, e a origem de cada campo tem precedência fixa:
 *   1. `map` da regra (a mesma regra pode alimentar o esquema de outra Base);
 *   2. `sourceRef` do esquema (a origem padrão, declarada uma vez);
 *   3. `defaultValue` (a constante do esquema).
 * Ref que não resolve vira string vazia — o passo trata campo vazio como "não
 * enviar", que é o comportamento certo para um dado que o registro não tem.
 */
function resolveSchemaForm(
  def: WorkflowDefinition,
  card: CardFacts,
  ctx: EvalContext,
  map?: Record<string, string>
): Record<string, string> {
  const form: Record<string, string> = {};
  for (const field of def.form.fields) {
    const ref = map?.[field.key] ?? field.sourceRef;
    let value = "";
    if (ref) {
      const raw = recordRawValue(ref, card.record, ctx.available);
      value = raw == null ? "" : String(raw);
    }
    form[field.key] = value.trim() !== "" ? value : (field.defaultValue ?? "");
  }
  return form;
}

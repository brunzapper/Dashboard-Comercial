// Versão: 1.0 | Data: 07/09/2026
// Saneamento de `settings.kanban` / `settings.agenda` vindos de JSON (import
// manual, IA, preset). Antes destas funções o validador tratava esses objetos
// como PASSTHROUGH e o applyPresetDefinition gravava o cru — um JSON com
// `allocationFieldKey` escrevia no campo-espelho do quadro de ORIGEM
// (invariante 24) e enums/refs errados só apareciam como quadro vazio em tela.
//
// PURO de propósito (nenhum I/O, nenhum import de servidor): o `checkRef` do
// validador é uma CLOSURE de validateDashboardImport, então as dependências
// entram por INJEÇÃO. Isso mantém o módulo testável sem banco e reusável pelo
// assistente de IA do quadro (contrato `kanban-config`), que precisa da MESMA
// régua — nunca monte uma paralela.
//
// Contrato de erro: chave inválida vira AVISO + descarte, nunca erro duro
// (mesmo padrão de `quickFilters`/`tab` no validador). Um widget bom não se
// perde porque um enum veio errado; o resto do quadro sobrevive.
import {
  KANBAN_AGG_LABELS,
  KANBAN_DATE_BUCKET_LABELS,
  KANBAN_MAX_BADGES,
  KANBAN_MAX_COLUMNS,
  KANBAN_METRIC_KIND_LABELS,
  KANBAN_MODE_LABELS,
  type KanbanCardSettings,
  type KanbanColumnOverride,
  type KanbanMetricSpec,
  type KanbanSettings,
} from "@/lib/kanban/types";
import { AGENDA_VIEW_LABELS, type AgendaSettings } from "@/lib/agenda/types";

/** Teto de refs no corpo do card (espelha o `.slice(0, 4)` do widget-builder). */
export const KANBAN_MAX_EXTRA_FIELDS = 4;

/**
 * Chaves de `KanbanSettings` que referenciam ENTIDADES LOCAIS do quadro —
 * `allocationFieldKey` aponta um `field_definitions` criado por AQUELE quadro
 * e `taskBoardId` um uuid de `dashboards`. Nenhuma das duas sobrevive a um
 * import-como-novo (mesma razão de `settings.pages`), então o export as remove
 * e o import as descarta; o apply in-place as PRESERVA do settings existente.
 */
export const KANBAN_LOCAL_KEYS = [
  "allocationFieldKey",
  "taskBoardId",
] as const satisfies readonly (keyof KanbanSettings)[];

/** Dependências injetadas pelo chamador (validador ou core de IA). */
export interface SanitizeDeps {
  /** Valida um ref de campo; registra o erro por conta própria. */
  checkRef: (ref: string, where: string) => boolean;
  /** Keys de Base/Sub-base conhecidas. */
  knownSources: ReadonlySet<string>;
  /** Keys de Base RAIZ (métrica `linked` só aceita raiz). */
  rootSources: ReadonlySet<string>;
  /** Prefixo das mensagens (ex.: `widgets[2] ("Funil")`). */
  where: string;
  /** Avisos acumulados do chamador. */
  warnings: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function inMap(v: unknown, labels: Record<string, unknown>): boolean {
  return typeof v === "string" && Object.hasOwn(labels, v);
}

/** Lista de opções para a mensagem de aviso ("weekday | month_name | …"). */
function optionsOf(labels: Record<string, unknown>): string {
  return Object.keys(labels).join(" | ");
}

function dropEnum(
  obj: Record<string, unknown>,
  key: string,
  labels: Record<string, unknown>,
  deps: SanitizeDeps,
  path: string
): void {
  if (obj[key] === undefined) return;
  if (inMap(obj[key], labels)) return;
  deps.warnings.push(
    `${deps.where}: ${path} inválido ("${String(obj[key])}") — removido. Válidos: ${optionsOf(labels)}.`
  );
  delete obj[key];
}

/** Uma métrica de kanban (cabeçalho da coluna ou badge do card). */
function sanitizeMetricSpec(
  raw: unknown,
  deps: SanitizeDeps,
  path: string
): KanbanMetricSpec | null {
  if (!isRecord(raw)) {
    deps.warnings.push(`${deps.where}: ${path} não é um objeto — removido.`);
    return null;
  }
  const kind = raw.kind;
  if (!inMap(kind, KANBAN_METRIC_KIND_LABELS)) {
    deps.warnings.push(
      `${deps.where}: ${path}.kind inválido ("${String(kind)}") — removido. Válidos: ${optionsOf(KANBAN_METRIC_KIND_LABELS)}.`
    );
    return null;
  }
  if (kind === "age") return { kind: "age" };
  if (kind === "field") {
    const ref = asString(raw.ref);
    if (!ref || !deps.checkRef(ref, `${deps.where}.${path}.ref`)) return null;
    return { kind: "field", ref };
  }
  if (kind === "linked") {
    const source = asString(raw.source);
    // `linked` conta registros CASADOS de uma Base RAIZ — sub-base compartilha
    // o record_type da pai e nunca casa (mesma regra dos refs `match:`).
    if (!source || !deps.rootSources.has(source)) {
      deps.warnings.push(
        `${deps.where}: ${path}.source precisa ser uma Base raiz conhecida ("${source}") — métrica removida.`
      );
      return null;
    }
    return { kind: "linked", source };
  }
  const metric = raw.metric;
  if (metric !== "open" && metric !== "overdue") {
    deps.warnings.push(
      `${deps.where}: ${path}.metric inválido ("${String(metric)}") — removido. Válidos: open | overdue.`
    );
    return null;
  }
  return { kind: "tasks", metric };
}

function sanitizeColumns(
  raw: unknown,
  deps: SanitizeDeps
): KanbanColumnOverride[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    deps.warnings.push(
      `${deps.where}: settings.kanban.columns precisa ser uma lista — removido.`
    );
    return undefined;
  }
  const out: KanbanColumnOverride[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (!isRecord(c)) continue;
    const key = asString(c.key);
    if (!key) {
      deps.warnings.push(
        `${deps.where}: settings.kanban.columns[${i}] sem "key" — coluna removida.`
      );
      continue;
    }
    if (seen.has(key)) {
      deps.warnings.push(
        `${deps.where}: settings.kanban.columns[${i}] repete a key "${key}" — coluna removida.`
      );
      continue;
    }
    seen.add(key);
    const col: KanbanColumnOverride = { key };
    const label = asString(c.label);
    if (label) col.label = label;
    const color = asString(c.color);
    if (color) col.color = color;
    if (c.hidden === true) col.hidden = true;
    if (typeof c.wipLimit === "number" && Number.isFinite(c.wipLimit) && c.wipLimit > 0) {
      col.wipLimit = Math.floor(c.wipLimit);
    }
    if (c.completesTask === true) col.completesTask = true;
    out.push(col);
  }
  if (out.length > KANBAN_MAX_COLUMNS) {
    deps.warnings.push(
      `${deps.where}: settings.kanban.columns tem ${out.length} colunas — cortado no teto de ${KANBAN_MAX_COLUMNS}.`
    );
    out.length = KANBAN_MAX_COLUMNS;
  }
  return out;
}

function sanitizeCard(
  raw: unknown,
  deps: SanitizeDeps
): KanbanCardSettings | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    deps.warnings.push(
      `${deps.where}: settings.kanban.card precisa ser um objeto — removido.`
    );
    return undefined;
  }
  const card: KanbanCardSettings = {};
  const title = asString(raw.titleField);
  if (title && deps.checkRef(title, `${deps.where}.settings.kanban.card.titleField`)) {
    card.titleField = title;
  }
  if (Array.isArray(raw.extraFields)) {
    const extras = raw.extraFields
      .map((r) => asString(r))
      .filter(
        (r, i) =>
          r !== "" &&
          deps.checkRef(r, `${deps.where}.settings.kanban.card.extraFields[${i}]`)
      );
    if (extras.length > KANBAN_MAX_EXTRA_FIELDS) {
      deps.warnings.push(
        `${deps.where}: settings.kanban.card.extraFields tem ${extras.length} campos — cortado no teto de ${KANBAN_MAX_EXTRA_FIELDS}.`
      );
    }
    if (extras.length > 0) {
      card.extraFields = extras.slice(0, KANBAN_MAX_EXTRA_FIELDS);
    }
  }
  const color = asString(raw.colorField);
  if (color && deps.checkRef(color, `${deps.where}.settings.kanban.card.colorField`)) {
    card.colorField = color;
  }
  // `badges` ausente = badge legado de tarefas abertas; `[]` explícito = sem
  // badges. A distinção é semântica (lib/kanban/metrics.ts) — preserve as duas.
  if (Array.isArray(raw.badges)) {
    const badges: KanbanMetricSpec[] = [];
    for (let i = 0; i < raw.badges.length; i++) {
      const spec = sanitizeMetricSpec(
        raw.badges[i],
        deps,
        `settings.kanban.card.badges[${i}]`
      );
      if (spec) badges.push(spec);
    }
    if (badges.length > KANBAN_MAX_BADGES) {
      deps.warnings.push(
        `${deps.where}: settings.kanban.card.badges tem ${badges.length} indicadores — cortado no teto de ${KANBAN_MAX_BADGES}.`
      );
    }
    card.badges = badges.slice(0, KANBAN_MAX_BADGES);
  }
  return Object.keys(card).length > 0 ? card : undefined;
}

/**
 * Sanea `settings.kanban`. Devolve o objeto novo (nunca muta a entrada) ou
 * `undefined` quando não sobrou config utilizável. `appearance` e `tasks`
 * passam adiante como estão: são cosméticos/numéricos sem ref nem id, e o
 * consumidor já os lê com defaults.
 */
export function sanitizeKanbanSettings(
  raw: unknown,
  deps: SanitizeDeps
): KanbanSettings | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    deps.warnings.push(
      `${deps.where}: "settings.kanban" precisa ser um objeto — removido.`
    );
    return undefined;
  }
  const k = { ...raw } as Record<string, unknown>;

  // Chaves LOCAIS do quadro: um id vindo de JSON aponta para o campo/board de
  // OUTRO quadro. Descartar aqui é o que impede a escrita cruzada da 24.
  for (const key of KANBAN_LOCAL_KEYS) {
    if (k[key] === undefined) continue;
    delete k[key];
    deps.warnings.push(
      `${deps.where}: "settings.kanban.${key}" é gerida pelo sistema (vínculo local do quadro) e foi removida do JSON.`
    );
  }

  if (!inMap(k.mode, KANBAN_MODE_LABELS)) {
    deps.warnings.push(
      `${deps.where}: settings.kanban.mode inválido ("${String(k.mode)}") — assumido "registros". Válidos: ${optionsOf(KANBAN_MODE_LABELS)}.`
    );
    k.mode = "registros";
  }

  dropEnum(k, "dateBucket", KANBAN_DATE_BUCKET_LABELS, deps, "settings.kanban.dateBucket");
  if (k.columnSource !== undefined && k.columnSource !== "custom") {
    deps.warnings.push(
      `${deps.where}: settings.kanban.columnSource inválido ("${String(k.columnSource)}") — removido. Único valor: "custom".`
    );
    delete k.columnSource;
  }

  if (k.mode === "registros") {
    const source = asString(k.source);
    if (!source || !deps.knownSources.has(source)) {
      deps.warnings.push(
        `${deps.where}: settings.kanban.source precisa ser uma Base conhecida ("${source}") — o quadro fica sem config.`
      );
      return undefined;
    }
    k.source = source;

    const isCustom = k.columnSource === "custom";
    const groupField = asString(k.groupField);
    const dateField = asString(k.dateField);
    if (!isCustom) {
      // Ou agrupa por VALOR de campo, ou por BUCKET de data — nunca os dois.
      if (k.dateBucket) {
        if (!dateField || !deps.checkRef(dateField, `${deps.where}.settings.kanban.dateField`)) {
          deps.warnings.push(
            `${deps.where}: settings.kanban.dateBucket exige um "dateField" válido — o quadro fica sem config.`
          );
          return undefined;
        }
        k.dateField = dateField;
        delete k.groupField;
      } else {
        if (!groupField || !deps.checkRef(groupField, `${deps.where}.settings.kanban.groupField`)) {
          deps.warnings.push(
            `${deps.where}: settings.kanban precisa de "groupField" (colunas por valor de campo), de "dateField"+"dateBucket" (colunas por período) ou de "columnSource":"custom" — o quadro fica sem config.`
          );
          return undefined;
        }
        k.groupField = groupField;
        delete k.dateField;
      }
    } else {
      delete k.groupField;
      delete k.dateField;
      delete k.dateBucket;
    }

    const metric = asString(k.metric);
    if (metric && !deps.checkRef(metric, `${deps.where}.settings.kanban.metric`)) {
      delete k.metric;
    }
    if (k.columnMetric !== undefined) {
      const cm = isRecord(k.columnMetric) ? { ...k.columnMetric } : null;
      const spec = cm
        ? sanitizeMetricSpec(cm.spec, deps, "settings.kanban.columnMetric.spec")
        : null;
      if (!spec) {
        delete k.columnMetric;
      } else {
        const next: Record<string, unknown> = { spec };
        if (cm && cm.agg !== undefined) {
          if (inMap(cm.agg, KANBAN_AGG_LABELS)) next.agg = cm.agg;
          else
            deps.warnings.push(
              `${deps.where}: settings.kanban.columnMetric.agg inválido ("${String(cm.agg)}") — usando o padrão do indicador. Válidos: ${optionsOf(KANBAN_AGG_LABELS)}.`
            );
        }
        k.columnMetric = next;
      }
    }

    const card = sanitizeCard(k.card, deps);
    if (card) k.card = card;
    else delete k.card;

    if (k.writeBack !== undefined) k.writeBack = k.writeBack === true;
  } else {
    // Modo tarefas: fases em `columns`; nada de fonte/campo de registro.
    for (const key of [
      "source",
      "columnSource",
      "groupField",
      "dateField",
      "dateBucket",
      "metric",
      "columnMetric",
      "card",
      "writeBack",
    ]) {
      delete k[key];
    }
  }

  const columns = sanitizeColumns(k.columns, deps);
  if (columns && columns.length > 0) k.columns = columns;
  else delete k.columns;

  return k as unknown as KanbanSettings;
}

/** Sanea `settings.agenda`. Mesma doutrina: aviso + descarte, nunca erro duro. */
export function sanitizeAgendaSettings(
  raw: unknown,
  deps: SanitizeDeps
): AgendaSettings | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    deps.warnings.push(
      `${deps.where}: "settings.agenda" precisa ser um objeto — removido.`
    );
    return undefined;
  }
  const a = { ...raw } as Record<string, unknown>;

  const source = asString(a.source);
  if (source && !deps.knownSources.has(source)) {
    deps.warnings.push(
      `${deps.where}: settings.agenda.source desconhecido ("${source}") — o calendário fica só com tarefas e anotações.`
    );
    delete a.source;
    delete a.dateField;
  } else if (source) {
    a.source = source;
    // Sem campo de data o registro não tem dia onde pousar — a fonte cai fora.
    const dateField = asString(a.dateField);
    if (!dateField || !deps.checkRef(dateField, `${deps.where}.settings.agenda.dateField`)) {
      deps.warnings.push(
        `${deps.where}: settings.agenda.source exige um "dateField" válido (o campo que aloca o registro no dia) — fonte removida.`
      );
      delete a.source;
      delete a.dateField;
    } else {
      a.dateField = dateField;
    }
  } else {
    delete a.source;
    delete a.dateField;
  }

  dropEnum(a, "defaultView", AGENDA_VIEW_LABELS, deps, "settings.agenda.defaultView");
  for (const key of ["showTasks", "showNotes"]) {
    if (a[key] !== undefined) a[key] = a[key] === true;
  }

  return a as unknown as AgendaSettings;
}

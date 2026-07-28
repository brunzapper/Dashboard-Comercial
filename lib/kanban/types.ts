// Versão: 1.4 | Data: 28/07/2026
// v1.4 (28/07/2026): KanbanSettings.allocationFieldKey — alocação do quadro
//   "Personalizar" exposta como CAMPO do registro (fase filtrável fora do
//   kanban; ver lib/kanban/allocation-field.ts e invariante 24).
// v1.3 (28/07/2026): métricas expandidas — KanbanMetricSpec (campo | conectados
//   de uma base raiz "Leads vinculados" | tarefas abertas/atrasadas | idade),
//   columnMetric (agregação escolhível no cabeçalho; vence `metric` legado) e
//   card.badges (até 3 indicadores por card). Normalização/compat em
//   lib/kanban/metrics.ts — nada disso exige migração de dados.
// v1.2 (17/07/2026): KanbanAppearance (aparência do quadro/colunas/cards/
//   seletor de visão — compartilhada entre widget e página dedicada) e
//   columnSource "custom" (fases "Personalizar" no modo registros: colunas
//   100% do usuário; posição do card em kanban_placements, 0067).
// v1.1 (16/07/2026): KanbanSettings.writeBack — write-back opcional por quadro
//   (mover card grava de volta no Bitrix; default off = edição local, base do
//   fluxo "fases em campo local que nunca vem da Sync, sem tocar no original").
// Tipos do Kanban — compartilhados entre a PÁGINA dedicada (dashboards.kind
// 'kanban', config em dashboards.settings.kanban) e o WIDGET de dashboard
// (widgets.settings.kanban). Sem imports de lib/widgets p/ evitar ciclos (o
// types.ts de widgets importa daqui).

/** Overrides de uma coluna (ordem do array = ordem das colunas). */
export interface KanbanColumnOverride {
  key: string; // chave estável (valor do campo, key do bucket ou fase)
  label?: string;
  color?: string; // cor do cabeçalho/da faixa
  hidden?: boolean;
  wipLimit?: number;
  // Modo tarefas: soltar o card nesta coluna CONCLUI a tarefa.
  completesTask?: boolean;
}

export type KanbanMode = "registros" | "tarefas";

/** Buckets de data suportados como colunas (mover realoca a data — D9). */
export type KanbanDateBucket = "weekday" | "month_name" | "month_year";

// ---- Métricas do kanban (28/07/2026) ----
// Espelho ESTRUTURAL de Aggregation (lib/widgets/types.ts) — sem import daqui
// para não criar ciclo (o types.ts de widgets importa deste módulo).
export type KanbanAgg = "sum" | "count" | "avg" | "min" | "max";

/**
 * Uma métrica de kanban: valor de campo numérico, contagem de registros
 * CONECTADOS de uma base raiz ("Leads vinculados" — record_matches nas duas
 * direções + gêmeo related_lead_id quando a base é de leads), tarefas abertas/
 * atrasadas do registro ou idade em dias (abertura; fallback criação na
 * origem). Resolvida 100% no engine (lib/kanban/data.ts) — RPCs intocados.
 */
export type KanbanMetricSpec =
  | { kind: "field"; ref: string } // 'value' | 'mrr' | 'custom:<key>' …
  | { kind: "linked"; source: string } // key de base RAIZ do catálogo
  | { kind: "tasks"; metric: "open" | "overdue" }
  | { kind: "age" };

/** Métrica do cabeçalho da coluna, com agregação escolhível. */
export interface KanbanColumnMetricSettings {
  spec: KanbanMetricSpec;
  // Ausente = default do kind (age → 'avg'; demais → 'sum').
  agg?: KanbanAgg;
}

// Teto de indicadores (badges) por card.
export const KANBAN_MAX_BADGES = 3;

export interface KanbanCardSettings {
  // Ref do título (default 'title'). Core ou 'custom:<key>'.
  titleField?: string;
  // Até ~4 refs extras exibidos no corpo do card.
  extraFields?: string[];
  // Campo cujo valor pinta a faixa lateral do card (categórico).
  colorField?: string;
  // Até KANBAN_MAX_BADGES indicadores no rodapé do card. AUSENTE = badge
  // legado de tarefas abertas; [] explícito = sem badges (a distinção é da
  // normalização — lib/kanban/metrics.ts).
  badges?: KanbanMetricSpec[];
}

export interface KanbanTasksSettings {
  // Tarefas criadas neste board nascem travadas (só admin/gestor exclui).
  lockByDefault?: boolean;
  // Dias de antecedência p/ "vence em breve" (default 3).
  dueSoonDays?: number;
}

/** Aparência do kanban (quadro, colunas, cards e seletor de visão). Tudo
 *  opcional — ausente = visual padrão (classes atuais como fallback). */
export interface KanbanAppearance {
  /** Fundo da área do quadro (atrás das colunas). */
  boardBg?: string;
  column?: {
    bg?: string;
    border?: string;
    /** Raio das colunas, em px. */
    radius?: number;
    headerBg?: string;
    headerColor?: string;
  };
  card?: {
    bg?: string;
    text?: string;
    border?: string;
    /** Raio dos cards, em px. */
    radius?: number;
    /** Tamanho da fonte do card, em px. */
    fontSize?: number;
    /** Faixa lateral colorida (colorField). Default true. */
    showStripe?: boolean;
  };
  /** Badge de contagem no cabeçalho da coluna. */
  counter?: { bg?: string; color?: string };
  /** Cor da métrica somada no cabeçalho da coluna. */
  metricColor?: string;
  /** Seletor de visão (Quadro/Lista/Agenda — as "abas" do kanban). */
  switcher?: {
    activeBg?: string;
    activeText?: string;
    inactiveBg?: string;
    inactiveText?: string;
  };
}

/** Config completa de um kanban (página ou widget). */
export interface KanbanSettings {
  mode: KanbanMode;
  // ---- modo registros ----
  source?: string; // key da fonte (data_sources)
  // Colunas "Personalizar" (modo registros): fases 100% definidas pelo usuário
  // em `columns`; a coluna de cada card é dado da VISÃO (kanban_placements,
  // por widget/board), não do registro. Ausente = derivação por campo/data.
  columnSource?: "custom";
  // Agrupar por VALOR de campo: 'stage' | 'pipeline' | ... | 'custom:<key>'.
  groupField?: string;
  // OU agrupar por BUCKET de data de um campo: dateField + dateBucket.
  dateField?: string; // 'closed_at' | 'opened_at' | 'source_created_at' | 'custom:<key>'
  dateBucket?: KanbanDateBucket;
  // LEGADO: métrica somada no cabeçalho ('value' | 'mrr' | 'custom:<key>').
  // Linhas novas gravam `columnMetric`; leitura normalizada em
  // lib/kanban/metrics.ts (columnMetric vence quando presente).
  metric?: string;
  // Métrica do cabeçalho da coluna com agregação escolhível (28/07/2026).
  columnMetric?: KanbanColumnMetricSettings;
  card?: KanbanCardSettings;
  // Alocação como campo (colunas "Personalizar"): field_key do campo de
  // seleção criado por setKanbanAllocationField (lib/kanban/allocation-actions)
  // e mantido pelo reconcile (lib/kanban/allocation-*.ts) com o RÓTULO da
  // coluna atual de cada card. Presença = ligado. Guarda a KEY (não o rótulo):
  // renomear o quadro não orfana o vínculo. ATENÇÃO: o widget-builder
  // RECONSTRÓI settings.kanban no save — esta chave é re-emitida explicitamente
  // lá (branch isCustomCols); createWidget/duplicações fazem STRIP (uma cópia
  // nunca herda o vínculo — escreveria no campo do quadro original).
  allocationFieldKey?: string;
  // Write-back (modo registros, agrupamento por VALOR): quando true, mover um
  // card ENFILEIRA a mudança de volta ao Bitrix (só surte efeito em registros de
  // Sync — source_system 'bitrix' com source_id — e em campos mapeados/marcados
  // com write_back; para os demais é no-op). Ausente/false = edição LOCAL apenas:
  // mover NÃO altera o registro na origem. É o "criar fases sem afetar o original"
  // — basta agrupar por um campo local (que nunca vem da Sync) e deixar isto off.
  writeBack?: boolean;
  // ---- ambos os modos ----
  columns?: KanbanColumnOverride[];
  appearance?: KanbanAppearance;
  // ---- modo tarefas ----
  tasks?: KanbanTasksSettings;
  // Widget kanban de tarefas: aponta p/ um kanban dedicado (dashboards.kind
  // 'kanban' modo tarefas) — mostra as tasks daquele board (fases dele).
  // Ausente = "minhas tarefas" (todas as visíveis, fases default).
  taskBoardId?: string;
}

// Chaves ESPECIAIS de coluna.
export const KANBAN_NO_VALUE_KEY = "__sem__"; // sem valor / sem data
export const KANBAN_OVERFLOW_KEY = "__outros__"; // estouro do teto de colunas

// Teto de colunas derivadas de valores distintos (texto livre, ex.: stage).
export const KANBAN_MAX_COLUMNS = 30;

/** Fases default de um kanban de tarefas (seed de settings.columns). */
export const DEFAULT_TASK_PHASES: KanbanColumnOverride[] = [
  { key: "a_fazer", label: "A fazer" },
  { key: "em_andamento", label: "Em andamento" },
  { key: "concluida", label: "Concluída", completesTask: true },
];

/** Fases default do modo "Personalizar" (registros, seed de settings.columns). */
export const DEFAULT_CUSTOM_COLUMNS: KanbanColumnOverride[] = [
  { key: "novo", label: "Novo" },
  { key: "andamento", label: "Em andamento" },
  { key: "feito", label: "Concluído" },
];

/** Coluna já derivada/resolvida (colunas visíveis do quadro). */
export interface KanbanColumn {
  key: string;
  label: string;
  color?: string;
  wipLimit?: number;
  completesTask?: boolean;
  // Coluna que não aceita drop (ex.: "Outros" do estouro).
  noDrop?: boolean;
}

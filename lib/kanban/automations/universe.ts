// Versão: 1.0 | Data: 08/09/2026
// O UNIVERSO de uma rodada de automação: quais registros a regra vai avaliar.
//
// É a única coisa que era específica de kanban no motor 0109. `decideActions`
// (evaluate.ts) usa a coluna só para validar o alvo de `move_to_column`, e as
// condições de tempo `field_changed`/`created` já são de REGISTRO — o resto do
// pipeline (fatos, decisão, execução de `set_field`) nunca soube o que é um
// quadro. Extrair isto daqui é o que permite uma automação sobre uma BASE
// inteira sem duplicar motor, parse ou tabela.
//
// Duas origens:
//  - quadro (widget/board): `runKanban`, como sempre — o ramo é byte-idêntico
//    ao que estava embutido no engine, e um teste pina isso;
//  - base (`source`): `runRecordList` sobre a Base, com `columnKey` vazio e
//    sem colunas. Sem colunas, `decideActions` já recusa qualquer
//    `move_to_column` pelo caminho que hoje trata "coluna removida" —
//    nenhuma guarda nova precisou ser inventada.
import type { SupabaseClient } from "@supabase/supabase-js";

import { runKanban } from "@/lib/kanban/data";
import type { KanbanColumn, KanbanSettings } from "@/lib/kanban/types";
import type { RecordRow } from "@/lib/records/types";
import type { WidgetConfig } from "@/lib/widgets/types";
import { runRecordList } from "@/lib/widgets/record-list";

import type { AutomationOwner } from "./types";
import type { KanbanServiceContext } from "./engine";

/** Um registro candidato da rodada, já com o que os fatos vão precisar. */
export interface AutomationCard {
  id: string;
  record: RecordRow;
  isMock: boolean;
  openTasks: number;
  /** Coluna atual; string vazia no escopo de Base (não há colunas). */
  columnKey: string;
}

export interface AutomationUniverse {
  cards: AutomationCard[];
  /** Colunas visíveis do quadro; [] no escopo de Base. */
  columns: KanbanColumn[];
  /** Config do quadro; null no escopo de Base (o executor de moves não roda). */
  settings: KanbanSettings | null;
  /** Devolver a escrita ao CRM. Sem quadro não há toggle: fica desligado. */
  writeBack: boolean;
  /** Campo espelho da alocação (invariante 24) — nunca alvo de set_field. */
  allocationFieldKey: string | null;
}

export interface UniverseInput {
  owner: AutomationOwner;
  /** Config do quadro; ausente/null = escopo de Base. */
  settings: KanbanSettings | null;
  orgId: string | null;
  service: KanbanServiceContext;
}

/**
 * Monta o universo da rodada. String de retorno = erro FATAL legível (a
 * mesma convenção de loadKanbanOwnerContext) — nunca silêncio.
 */
export async function loadAutomationUniverse(
  db: SupabaseClient,
  input: UniverseInput
): Promise<AutomationUniverse | string> {
  const { owner, settings, orgId, service } = input;

  if (owner.kind === "source") {
    const source = service.catalog.find((s) => s.key === owner.id);
    if (!source) return `Base "${owner.id}" não existe mais.`;

    // Mesma config mínima que o kanban monta para o modo lista (data.ts):
    // universo = a Base inteira. O recorte da regra são as CONDIÇÕES dela —
    // um filtro fixo aqui seria uma segunda régua sobre a mesma coisa.
    const config = {
      sources: [owner.id],
      dimensions: [],
      metrics: [],
      filters: [],
      settings: {},
    } as unknown as WidgetConfig;

    // period null: a regra vê o dataset inteiro. A barra de período é filtro
    // de VISÃO, e uma automação não tem visão.
    const records = await runRecordList(
      db,
      config,
      undefined,
      service.available,
      service.catalog,
      orgId ? { orgId } : undefined
    );

    return {
      cards: records.map((r) => ({
        id: r.id,
        record: r,
        isMock: Boolean(r.is_mock),
        // Sem quadro não há contagem pré-computada; o engine consulta as
        // tarefas quando alguma condição pedir.
        openTasks: 0,
        columnKey: "",
      })),
      columns: [],
      settings: null,
      writeBack: false,
      allocationFieldKey: null,
    };
  }

  if (!settings) return "Quadro sem configuração de kanban.";

  const board = await runKanban(db, settings, null, service.defs, {}, owner, {
    available: service.available,
    catalog: service.catalog,
    orgId: orgId ?? undefined,
    // O tick só consome cards/colunas/openTasks — pula badges/conectados
    // (os fatos das regras são coletados pelo engine, gateados pelas condições).
    lean: true,
  });

  const cards: AutomationCard[] = board.columns.flatMap((col) =>
    col.cards
      .filter((c) => c.record)
      .map((c) => ({
        id: c.id,
        record: c.record!,
        isMock: c.isMock,
        openTasks: c.openTasks,
        columnKey: col.key,
      }))
  );

  return {
    cards,
    columns: board.columns,
    settings,
    writeBack: Boolean(settings.writeBack),
    allocationFieldKey: settings.allocationFieldKey ?? null,
  };
}

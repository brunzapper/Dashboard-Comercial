// Versão: 1.0 | Data: 12/09/2026
// Os últimos registros criados pela Base de destino de um FORMULÁRIO do
// Workflow — a lista que fica ao lado do formulário de lançamento.
//
// Por que existe: quem lança leads em série não tem como saber se o de agora já
// foi lançado, nem conferir o que acabou de mandar, sem sair da tela e ir a
// /registros. A lista responde as duas coisas onde a pessoa está.
//
// Três decisões que valem explicar:
//
//  - **É genérica, não "a lista de leads".** A Base sai do passo `record.create`
//    habilitado do esquema (`params.sourceKey`), resolvida contra o catálogo
//    vivo — a MESMA resolução que a action de execução faz. Formulário sem passo
//    de registro simplesmente não tem lista.
//  - **Só STRING atravessa para o cliente.** A formatação acontece aqui, e o
//    que sai é `{ id, title, when, responsible, url }`. Nenhum `RecordRow` cruza
//    o boundary, então nenhum valor de campo restrito (`visible_to_roles`) pode
//    vazar no payload RSC — a peneira do `redactRestrictedFields` deixa de ser
//    algo de que alguém precise lembrar (ver docs/seguranca.md).
//  - **O link do CRM é montado no SERVIDOR.** `bitrixEntityUrl` deriva o portal
//    da credencial do webhook, e essa credencial nunca pode atravessar para o
//    cliente — então o que viaja é a URL pronta, nunca o material para montá-la.
//
// A visibilidade é a RLS de `records`: vendedor sem `view_all_records` vê só os
// próprios lançamentos. Nada de service role aqui.
import type { SupabaseClient } from "@supabase/supabase-js";

import { addDaysIso } from "@/lib/date/days";
import { todayBrasiliaIso } from "@/lib/date/today";
import { coreCellValue } from "@/lib/records/detail-fields";
import type { RecordRow } from "@/lib/records/types";
import { bitrixEntityOfSource, type SourceDef } from "@/lib/sources";
import { collectRecordFkLabels } from "@/lib/widgets/fk-labels";
import { runRecordList } from "@/lib/widgets/record-list";
import type { WidgetConfig } from "@/lib/widgets/types";

import { bitrixEntityUrl } from "./steps/bitrix";
import type { WorkflowDefinition } from "./types";

/** Janela da lista, em dias corridos (hoje inclusive). */
export const RECENT_WINDOW_DAYS = 7;

/**
 * Teto de linhas. A janela é curta, mas uma Base movimentada pode ter centenas
 * de lançamentos em 7 dias e a lista é um apoio lateral, não um relatório.
 */
export const RECENT_MAX_ROWS = 20;

/** Uma linha da lista — já formatada; nada de valor cru de registro. */
export interface RecentRecordRow {
  id: string;
  title: string;
  /** Data/hora de criação, já no formato de exibição. */
  when: string;
  /** Nome do responsável, ou string vazia. */
  responsible: string;
  /** Link para a entidade no portal; vazio quando não há par no CRM. */
  url: string;
}

export interface RecentRecordsResult {
  rows: RecentRecordRow[];
  /** Rótulo da Base, para o título do painel. */
  sourceLabel: string;
  /** Dias da janela (o painel diz "últimos N dias"). */
  days: number;
  /** Houve mais registros do que o teto? */
  truncated: boolean;
}

/**
 * Base de destino de um esquema de formulário: o `sourceKey` do passo
 * `record.create` HABILITADO. Espelha a resolução da action de execução
 * (app/(app)/operacao/workflow/actions.ts) — inclusive o gate `manualEntry`,
 * porque uma Base que não aceita criação manual não recebe lançamento nenhum e
 * a lista seria de outra coisa.
 */
export function formTargetSource(
  def: WorkflowDefinition,
  sources: SourceDef[]
): SourceDef | null {
  const step = def.steps.find((s) => s.type === "record.create" && s.enabled);
  if (!step || step.type !== "record.create") return null;
  const found = sources.find((s) => s.key === step.params.sourceKey);
  return found?.manualEntry ? found : null;
}

/**
 * Os registros da Base criados na janela. `webhookUrl` vazio/ausente = sem link
 * (o portal não está configurado nesta instalação) — a lista continua útil.
 */
export async function loadRecentFormRecords(
  supabase: SupabaseClient,
  source: SourceDef,
  sources: SourceDef[],
  webhookUrl: string,
  opts: { orgId?: string; todayIso?: string } = {}
): Promise<RecentRecordsResult> {
  const today = opts.todayIso ?? todayBrasiliaIso();
  const config = {
    sources: [source.key],
    dimensions: [],
    metrics: [],
    filters: [],
    settings: {},
  } as unknown as WidgetConfig;

  // Período pelo caminho canônico (applyPeriodToFilters ancora o bound da
  // coluna do núcleo em -03:00 — invariante 11). `source_created_at` é o
  // carimbo que tanto `createRecord` quanto o passo do formulário gravam.
  const records = (await runRecordList(
    supabase,
    config,
    {
      field: "source_created_at",
      from: addDaysIso(today, -(RECENT_WINDOW_DAYS - 1)),
      to: today,
    },
    [],
    sources,
    opts.orgId ? { orgId: opts.orgId } : undefined
  )) as RecordRow[];

  // runRecordList já ordena por source_created_at desc.
  const truncated = records.length > RECENT_MAX_ROWS;
  const page = records.slice(0, RECENT_MAX_ROWS);
  const fkLabels = await collectRecordFkLabels(supabase, page);
  const entity = bitrixEntityOfSource(source.key, sources);

  // `source_id` (o par no CRM) não vem no select do modo lista — ele não é
  // coluna de exibição. Busca à parte, restrita aos ids da página e pelo mesmo
  // client RLS; sem par no CRM ou sem portal configurado, simplesmente não há
  // link (nunca um href chutado).
  const sourceIds = new Map<string, string>();
  if (entity && webhookUrl && page.length > 0) {
    const { data } = await supabase
      .from("records")
      .select("id, source_id")
      .in(
        "id",
        page.map((r) => r.id)
      )
      .eq("source_system", "bitrix")
      .not("source_id", "is", null);
    for (const row of (data ?? []) as { id: string; source_id: string }[]) {
      sourceIds.set(row.id, row.source_id);
    }
  }

  const rows: RecentRecordRow[] = page.map((r) => {
    const crmId = sourceIds.get(r.id);
    return {
      id: r.id,
      title: r.title?.trim() || "(sem nome)",
      // `labels` vazio de propósito: a data não usa rótulo de FK, e o mapa de
      // `collectRecordFkLabels` é PLANO (id→nome), não a forma `RecordLabels`.
      when: coreCellValue(r, "source_created_at", {}),
      responsible: r.responsible_id ? (fkLabels[r.responsible_id] ?? "") : "",
      url: entity && crmId ? bitrixEntityUrl(webhookUrl, entity, crmId) : "",
    };
  });

  return { rows, sourceLabel: source.label, days: RECENT_WINDOW_DAYS, truncated };
}

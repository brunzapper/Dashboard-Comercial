// Versão: 1.4 | Data: 31/07/2026
// v1.4 (31/07/2026): navegação de mês LEVE — rascunho + commit debounced
//   (useMonthDraft/MonthNav: setas atualizam o rótulo na hora; UMA navegação
//   RSC após a pausa; picker de mês/ano + "Hoje" com commit imediato). Toda
//   navegação passa a router.replace dentro de useNavPending (histórico
//   limpo; Voltar não desfaz mês a mês — intencional) e a grade fica
//   esmaecida + pointer-events-none enquanto dirty/pending (edição de célula
//   durante a troca gravaria no mês ANTIGO com rótulo novo — a trava é
//   correção, não cosmética). A aba vem do SERVER (?aba=plano): o catálogo do
//   editor chega na prop única `editorCatalog` (null na aba Lançamentos —
//   placeholder até a navegação de aba responder). Badge "Apurado sobre
//   <mês>" quando o plano tem config.apuracao = "mes_anterior".
// v1.3 (31/07/2026): o seletor de plano vira PILLS visíveis (nome + nº de
//   membros + inativo) — o combobox discreto fazia parecer que só existia o
//   1º plano (ordem alfabética); todos ficam à vista e o clique segue
//   navegando ?plano= como antes. Contagem pelos MESMOS helpers puros do
//   model (resolveOperationMembers/explicitMemberIds — client nunca importa
//   engine.ts).
// v1.2: repassa targetRates à grade e currencies ao editor — alvos em moeda
// estrangeira.
// v1.1: repassa operations + operationMembersById ao editor e à grade —
// membros por operação.
// Gerência de Remuneração variável (0112) — admin. Topo: seletor de plano +
// navegação de mês (searchParams plano/ano/mes/aba — a page recarrega os
// dados); abas "Lançamentos" (grade mensal) e "Plano" (editor de fatores).
// O detalhamento é 100% derivado no cliente pelo MESMO computeEntry do
// servidor (modelo puro importável) — editar peso/override atualiza a grade
// sem re-consulta; só fórmula/fontes exigem "Recalcular".
"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useNavPending } from "@/components/dashboards/pending-context";
import { MONTH_LABELS } from "@/lib/date/month-labels";
import type { GoalMetricDef } from "@/lib/metas/metrics";
import type { FieldDefinition } from "@/lib/records/types";
import type { SourceDef } from "@/lib/sources";
import type { AvailableField } from "@/lib/widgets/fields";
import {
  apuracaoRef,
  explicitMemberIds,
  parseCompPlanConfig,
  resolveOperationMembers,
} from "@/lib/comp/model";

import { CompGrid } from "./comp-grid";
import { MonthNav, useMonthDraft } from "./month-nav";
import { PlanEditor } from "./plan-editor";

export interface CompPlanClientRow {
  id: string;
  name: string;
  active: boolean;
  base_amount_default: number | null;
  config: unknown;
  updated_at: string;
}

export interface CompEntryClientRow {
  id: string;
  responsible_id: string;
  base_amount: number | null;
  inputs: unknown;
  computed: unknown;
  total: number | null;
  mirror_record_id: string | null;
  published_at: string | null;
  updated_at: string;
}

// Catálogo do editor de planos — SÓ chega na aba Plano (?aba=plano); a aba
// Lançamentos navega o mês sem pagar estas queries/payload.
export interface CompEditorCatalog {
  // Moedas habilitadas (editor: moeda do alvo do fator).
  currencies: { value: string; label: string }[];
  metrics: GoalMetricDef[];
  // Insumos do catálogo de fórmulas agregadas (mesmos do widget-builder).
  available: AvailableField[];
  allFields: FieldDefinition[];
  sources: SourceDef[];
}

export interface RemuneracaoManagerProps {
  plans: CompPlanClientRow[];
  selectedPlanId: string | null;
  // Aba decidida no SERVER (?aba=plano; sem planos força "plano").
  aba: "grade" | "plano";
  year: number;
  month: number;
  entries: CompEntryClientRow[];
  // Responsáveis ATIVOS canônicos (apelidos colapsados) — linhas da grade e
  // opções de membro do editor.
  responsibles: { id: string; label: string }[];
  // Alvos do mês (goals) por responsável canônico → factorId → alvo.
  targets: Record<string, Record<string, number | null>>;
  // Moeda do alvo → R$/unidade no trimestre (plano selecionado).
  targetRates: Record<string, number | null>;
  editorCatalog: CompEditorCatalog | null;
  // Operações da org (opções do picker; inativas com sufixo) + membros por
  // operação (id CANÔNICO, já resolvidos no server via loadOperationScopes).
  operations: { id: string; name: string; active: boolean }[];
  operationMembersById: Record<string, string[]>;
}

export function RemuneracaoManager(props: RemuneracaoManagerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { pending, run } = useNavPending();
  // "Novo plano" abre o editor vazio sem perder o plano selecionado na URL.
  const [creating, setCreating] = useState(props.plans.length === 0);
  // Aba efetiva: server decide (?aba); "criando" força o editor localmente
  // enquanto a navegação de aba não responde.
  const tab: "grade" | "plano" = creating ? "plano" : props.aba;

  const plan =
    props.plans.find((p) => p.id === props.selectedPlanId) ??
    props.plans[0] ??
    null;
  const config = useMemo(
    () => (plan ? parseCompPlanConfig(plan.config) : null),
    [plan]
  );

  // ÚNICO construtor de URL da tela (plano/ano/mes/aba sempre juntos).
  // replace + transition compartilhada (padrão period-controls): histórico
  // limpo e `pending` acende o dim da grade.
  const navigate = (
    planId: string | null,
    year: number,
    month: number,
    aba: "grade" | "plano" = props.aba
  ) => {
    const q = new URLSearchParams();
    if (planId) q.set("plano", planId);
    q.set("ano", String(year));
    q.set("mes", String(month));
    if (aba === "plano") q.set("aba", "plano");
    run(() => router.replace(`${pathname}?${q.toString()}`, { scroll: false }));
  };
  const draft = useMonthDraft(props.year, props.month, (y, m) =>
    navigate(plan?.id ?? null, y, m)
  );
  const busy = draft.dirty || pending;

  // Pills de plano: nº de membros EFETIVOS (manuais ∪ operações; lista
  // explícita ausente = todos os ativos) — mesmo cálculo da grade.
  const planPills = useMemo(
    () =>
      props.plans.map((p) => {
        const cfg = parseCompPlanConfig(p.config);
        let members: number | null = null;
        if (cfg) {
          const opMembers = resolveOperationMembers(
            cfg.memberOperationIds,
            props.operationMembersById
          );
          const explicit = explicitMemberIds(cfg, opMembers);
          members = explicit ? explicit.length : props.responsibles.length;
        }
        return { id: p.id, name: p.name, active: p.active, members };
      }),
    [props.plans, props.operationMembersById, props.responsibles.length]
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {planPills.length > 0 ? (
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="tablist"
            aria-label="Planos de remuneração"
          >
            {planPills.map((p) => {
              const selected = !creating && p.id === plan?.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
                    selected
                      ? "border-primary bg-primary/10 font-medium"
                      : "text-muted-foreground hover:bg-accent border-border"
                  }`}
                  onClick={() => {
                    setCreating(false);
                    // Leva o mês EFETIVO (rascunho) e cancela o commit
                    // agendado — senão o timer renavegaria p/ o plano antigo.
                    draft.cancel();
                    navigate(p.id, draft.year, draft.month);
                  }}
                >
                  <span>
                    {p.name}
                    {!p.active ? " (inativo)" : ""}
                  </span>
                  {p.members != null ? (
                    <span
                      className="bg-muted text-muted-foreground rounded-full px-1.5 text-xs tabular-nums"
                      title={`${p.members} membro(s)`}
                    >
                      {p.members}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setCreating(true);
            draft.cancel();
            // Navega p/ ?aba=plano — o catálogo do editor vem nessa resposta.
            navigate(plan?.id ?? null, draft.year, draft.month, "plano");
          }}
        >
          <Plus className="size-4" /> Novo plano
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {config?.apuracao === "mes_anterior" ? (
            <ApuracaoBadge year={props.year} month={props.month} />
          ) : null}
          <MonthNav draft={draft} pending={pending} />
        </div>
      </div>

      {plan || creating ? (
        <div className="flex gap-1 border-b">
          {(
            [
              ["grade", "Lançamentos"],
              ["plano", creating ? "Novo plano" : "Plano"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`border-b-2 px-3 py-1.5 text-sm ${
                tab === key
                  ? "border-primary font-medium"
                  : "text-muted-foreground border-transparent"
              }`}
              onClick={() => {
                if (key === "grade") setCreating(false);
                draft.cancel();
                navigate(plan?.id ?? null, draft.year, draft.month, key);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {tab === "plano" || !plan ? (
        props.editorCatalog ? (
          <PlanEditor
            key={creating ? "novo" : (plan?.id ?? "novo")}
            plan={creating ? null : plan}
            config={creating ? null : config}
            metrics={props.editorCatalog.metrics}
            responsibles={props.responsibles}
            available={props.editorCatalog.available}
            allFields={props.editorCatalog.allFields}
            sources={props.editorCatalog.sources}
            operations={props.operations}
            operationMembersById={props.operationMembersById}
            currencies={props.editorCatalog.currencies}
            onSaved={(planId) => {
              setCreating(false);
              navigate(planId, draft.year, draft.month, "grade");
            }}
            onDeleted={() => {
              setCreating(false);
              navigate(null, draft.year, draft.month, "grade");
            }}
          />
        ) : (
          // Janela da soft navigation p/ ?aba=plano (catálogo ainda no server).
          <p className="text-muted-foreground text-sm">Carregando editor…</p>
        )
      ) : config ? (
        // Trava OBRIGATÓRIA durante a troca de mês: com rótulo novo e dados
        // antigos em tela, uma célula editada gravaria no mês ERRADO.
        <div
          className={busy ? "pointer-events-none opacity-60" : undefined}
          aria-busy={busy}
        >
          <CompGrid
            plan={plan}
            config={config}
            year={props.year}
            month={props.month}
            entries={props.entries}
            responsibles={props.responsibles}
            targets={props.targets}
            targetRates={props.targetRates}
            operationMembersById={props.operationMembersById}
          />
        </div>
      ) : (
        <p className="text-destructive text-sm">
          Configuração do plano inválida — reabra a aba Plano e salve novamente.
        </p>
      )}
    </div>
  );
}

/** Badge "Apurado sobre <mês>" — plano com apuração no mês anterior. */
export function ApuracaoBadge(props: { year: number; month: number }) {
  const ref = apuracaoRef(props.year, props.month, {
    apuracao: "mes_anterior",
  });
  return (
    <span
      className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs"
      title="Este plano apura o realizado e as metas sobre o mês anterior ao do lançamento."
    >
      Apurado sobre {MONTH_LABELS[ref.month - 1]}/{ref.year}
    </span>
  );
}

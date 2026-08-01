// Versão: 1.5 | Data: 01/08/2026
// v1.5: o card do plano foi EXTRAÍDO para comp-plan-card.tsx (CompPlanCard —
// agora compartilhado com a Visão geral do admin, junto de OverrideDot/
// fmtMoneyIn/ApuracaoBadge); este arquivo fica só com a casca do vendedor
// (gate de vínculo + navegação de mês + lista de cards).
// Versão: 1.4 | Data: 01/08/2026
// v1.4: memória de cálculo da comissão via commissionMemory
// (lib/comp/commission-label — MESMO helper da grade do gestor, nunca texto
// duplicado): linha do bloco mostra a multiplicação + faixa/gatilho e o
// sufixo "faixas do membro"; Valor de fator com peso 0 sem override exibe
// "—" (consistência com a grade).
// Versão: 1.3 | Data: 31/07/2026
// v1.3: navegação de mês LEVE (useMonthDraft/MonthNav — rascunho + commit
// debounced, picker de mês/ano + "Hoje", replace/useNavPending; cards
// esmaecidos durante a troca) e badge "Apurado sobre <mês>" em plano com
// config.apuracao = "mes_anterior".
// v1.2: comissão multi-bloco (uma linha por bloco + soma quando há override)
// e alvo em moeda própria (exibe na moeda digitada + convertido; cotação
// ausente = aviso, atingimento vazio) via targetRatesByPlan do server.
// "Minha remuneração" (0112) — visão READ-ONLY do vendedor: a RLS de
// comp_entries entrega só as linhas do PRÓPRIO grupo canônico; o detalhamento
// é derivado pelo MESMO computeEntry do gestor (transparência: célula com
// override manual mostra o ponto âmbar; v1.1: linha de Comissão com a faixa
// aplicada — o responsible_id da entry seleciona a tabela do membro). Nada é
// editável; sem Recalcular/Publicar. Navegação de mês via searchParams.
"use client";

import { usePathname, useRouter } from "next/navigation";

import { useNavPending } from "@/components/dashboards/pending-context";
import { CompPlanCard } from "./comp-plan-card";
import type {
  CompEntryClientRow,
  CompPlanClientRow,
} from "./remuneracao-manager";
import { MonthNav, useMonthDraft } from "./month-nav";

export interface MyCompViewProps {
  plans: CompPlanClientRow[];
  // Entries do PRÓPRIO usuário (RLS já filtrou), qualquer plano do mês.
  entries: (CompEntryClientRow & { plan_id: string })[];
  // Alvos do mês por plano → factorId (já dobrados p/ o canônico).
  targetsByPlan: Record<string, Record<string, number | null>>;
  // Moeda do alvo → R$/unidade no trimestre, por plano (server).
  targetRatesByPlan: Record<string, Record<string, number | null>>;
  year: number;
  month: number;
  linked: boolean; // usuário tem responsável vinculado?
}

export function MyCompView(props: MyCompViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { pending, run } = useNavPending();
  const draft = useMonthDraft(props.year, props.month, (y, m) =>
    run(() =>
      router.replace(`${pathname}?ano=${y}&mes=${m}`, { scroll: false })
    )
  );
  const busy = draft.dirty || pending;

  if (!props.linked) {
    return (
      <p className="text-muted-foreground text-sm">
        Seu usuário não está vinculado a um responsável — fale com um
        administrador (Configurações → Responsáveis).
      </p>
    );
  }

  const entryByPlan = new Map(props.entries.map((e) => [e.plan_id, e]));
  const cards = props.plans
    .filter((p) => p.active)
    .map((plan) => ({ plan, entry: entryByPlan.get(plan.id) ?? null }))
    .filter((c) => c.entry != null);

  return (
    <div className="flex flex-col gap-4">
      <MonthNav draft={draft} pending={pending} />

      <div
        className={busy ? "pointer-events-none opacity-60" : undefined}
        aria-busy={busy}
      >
        {cards.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nenhum lançamento de remuneração para você neste mês.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {cards.map(({ plan, entry }) => (
              <CompPlanCard
                key={plan.id}
                plan={plan}
                entry={entry!}
                year={props.year}
                month={props.month}
                targets={props.targetsByPlan[plan.id] ?? {}}
                targetRates={props.targetRatesByPlan[plan.id] ?? {}}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

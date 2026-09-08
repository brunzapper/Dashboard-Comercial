// Versão: 1.8 | Data: 16/08/2026
// v1.8: o botão "Google Planilhas" SAIU desta tela (o export é agora exclusivo
// da Visão geral do admin): a RLS de `records` do vendedor não alcança os
// registros de fator casado por memberField, e as abas de detalhamento sairiam
// silenciosamente parciais. CSV e PDF do próprio demonstrativo seguem aqui,
// inalterados.
// Versão: 1.7 | Data: 02/08/2026
// v1.7: botão "Google Planilhas" (SheetsExportButton, 0115) — planilha
// "Minha remuneração" na conta Google do próprio vendedor; sem config aqui
// (admin configura na Visão geral; vendedor sem config não vê o botão).
// Versão: 1.6 | Data: 02/08/2026
// v1.6: exportação CSV/PDF do próprio demonstrativo — mesma dupla da Visão
// geral do admin (builder puro lib/export/comp.ts + CompReportPrint via
// impressão do navegador), 100% client-derived das props (RLS já recortou);
// memberLabel vazio no CSV (a page não carrega o display_name — tradeoff
// documentado). Plano com config inválida é pulado (paridade CompPlanCard).
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

import { Download, Printer } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { useNavPending } from "@/components/dashboards/pending-context";
import { Button } from "@/components/ui/button";
import { parseCompPlanConfig } from "@/lib/comp/model";
import { MONTH_LABELS } from "@/lib/date/month-labels";
import { compReportCsv, type CompStatementInput } from "@/lib/export/comp";
import { buildCsv, csvFilename, downloadCsv } from "@/lib/export/csv";
import { CompPlanCard } from "./comp-plan-card";
import { CompReportPrint } from "./comp-report-print";
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
  const [printing, setPrinting] = useState(false);
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

  // Statements do próprio demonstrativo (memberLabel vazio: a page não
  // carrega o display_name; plano com config inválida sai — CompPlanCard
  // renderiza null). Reusado pelo CSV e pelo export ao Google Planilhas.
  const buildStatements = () =>
    cards.flatMap<CompStatementInput>(({ plan, entry }) => {
      const config = parseCompPlanConfig(plan.config);
      if (!config) return [];
      return [
        {
          planName: plan.name,
          memberLabel: "",
          config,
          baseAmountDefault: plan.base_amount_default,
          entry,
          targets: props.targetsByPlan[plan.id] ?? {},
          targetRates: props.targetRatesByPlan[plan.id] ?? {},
        },
      ];
    });

  const exportCsv = () => {
    const { headers, rows } = compReportCsv(buildStatements());
    downloadCsv(csvFilename("minha-remuneracao"), buildCsv(headers, rows));
  };

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
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={exportCsv}
              >
                <Download className="size-4" /> Exportar CSV
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                title="Abre a impressão do navegador — salve como PDF."
                onClick={() => setPrinting(true)}
              >
                <Printer className="size-4" /> Exportar PDF
              </Button>
            </div>
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

      {printing ? (
        <CompReportPrint
          title={`Minha remuneração — ${MONTH_LABELS[props.month - 1]} de ${props.year}`}
          sections={[
            {
              key: "me",
              cards: cards.map(({ plan, entry }) => ({
                key: plan.id,
                plan,
                entry,
                targets: props.targetsByPlan[plan.id] ?? {},
                targetRates: props.targetRatesByPlan[plan.id] ?? {},
              })),
            },
          ]}
          year={props.year}
          month={props.month}
          onDone={() => setPrinting(false)}
        />
      ) : null}
    </div>
  );
}

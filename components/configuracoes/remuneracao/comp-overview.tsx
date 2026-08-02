// Versão: 1.1 | Data: 02/08/2026
// v1.1: exportação CSV/PDF — 100% client-derived dos MESMOS dados das props:
// CSV pelo builder puro lib/export/comp.ts (compReportCsv, convenções de
// lib/export/csv.ts) e "PDF" pela impressão do navegador (CompReportPrint,
// portal [data-print-root] + @media print de globals.css). Botões no toolbar
// (relatório inteiro no agrupamento corrente) e por pessoa no agrupamento
// "Por pessoa" (demonstrativo individual). Nada de action/RPC — read-only.
// Versão: 1.0 | Data: 01/08/2026
// Visão geral da Remuneração (admin) — memória de cálculo de TODOS os membros
// de TODOS os planos ATIVOS do mês, SOMENTE LEITURA (sem Recalcular/Publicar/
// overrides: ajustes ficam nas abas dos planos). Agrupamento "por plano"
// (seção por plano → card por membro) ou "por pessoa" (seção por responsável
// → card por plano), com preferência do usuário em localStorage
// (`comp-overview:group` — chrome de UI por usuário, nunca dado; SSR
// determinístico "por-plano" + leitura pós-mount, padrão use-panel-width).
// Tudo derivado no cliente pelo MESMO computeEntry (totais saem da derivação,
// nunca de entry.total — que pode estar stale vs. overrides recém-editados);
// membros esperados por plano usam a MESMA resolução da grade
// (explicitMemberIds ∪ operações; membro inativo com entry fica fora —
// intencional, consistente com a grade). Card único: CompPlanCard.
"use client";

import { Download, Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { fmtMoneyBRL as fmtMoney } from "@/lib/comp/commission-label";
import {
  computeEntry,
  explicitMemberIds,
  parseCompEntryInputs,
  parseCompPlanConfig,
  resolveOperationMembers,
  type CompComputedRaw,
  type CompPlanConfig,
} from "@/lib/comp/model";
import { MONTH_LABELS } from "@/lib/date/month-labels";
import { compReportCsv, type CompStatementInput } from "@/lib/export/comp";
import { buildCsv, csvFilename, downloadCsv } from "@/lib/export/csv";
import { CompPlanCard } from "./comp-plan-card";
import {
  CompReportPrint,
  type CompReportCard,
  type CompReportSection,
} from "./comp-report-print";
import type {
  CompEntryClientRow,
  CompPlanClientRow,
} from "./remuneracao-manager";

const GROUP_PREF_KEY = "comp-overview:group";
type OverviewGroup = "por-plano" | "por-pessoa";

// Alvo do "Exportar PDF": relatório inteiro (agrupamento corrente) ou o
// demonstrativo de UMA pessoa (botão da seção no agrupamento por pessoa).
type PrintTarget = { kind: "geral" } | { kind: "pessoa"; memberId: string };

export interface CompOverviewProps {
  plans: CompPlanClientRow[]; // todas; o componente filtra as ativas
  entries: (CompEntryClientRow & { plan_id: string })[];
  // plano → membro → factorId → alvo (server, já dobrado p/ canônicos).
  targetsByPlan: Record<string, Record<string, Record<string, number | null>>>;
  targetRatesByPlan: Record<string, Record<string, number | null>>;
  responsibles: { id: string; label: string }[];
  operationMembersById: Record<string, string[]>;
  year: number;
  month: number;
}

// Uma célula plano×membro esperado (entry pode faltar — "sem lançamento").
interface OverviewCell {
  plan: CompPlanClientRow;
  config: CompPlanConfig;
  member: { id: string; label: string };
  entry: (CompEntryClientRow & { plan_id: string }) | null;
  total: number | null;
}

function useGroupPref() {
  // Estado único {ativo, salvo}: um só setState na leitura pós-mount.
  const [pref, setPref] = useState<{ group: OverviewGroup; saved: OverviewGroup }>(
    { group: "por-plano", saved: "por-plano" }
  );
  // SSR determinístico ("por-plano"); a preferência entra pós-mount —
  // flicker de um frame aceito (mesmo tradeoff do use-panel-width; ler no
  // initializer causaria hydration mismatch).
  useEffect(() => {
    let v: string | null = null;
    try {
      v = window.localStorage.getItem(GROUP_PREF_KEY);
    } catch {
      return; // Modo privado/sem storage: fica no default.
    }
    if (v !== "por-pessoa" && v !== "por-plano") return;
    // Leitura pós-mount do localStorage (padrão use-panel-width): no
    // initializer causaria hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPref({ group: v, saved: v });
  }, []);
  const setGroup = (group: OverviewGroup) =>
    setPref((cur) => ({ ...cur, group }));
  const saveDefault = () => {
    // Side effect FORA do updater (StrictMode roda updaters 2×).
    try {
      window.localStorage.setItem(GROUP_PREF_KEY, pref.group);
    } catch {
      // Sem storage: o clique não persiste — estado local ainda reflete.
    }
    setPref((cur) => ({ ...cur, saved: cur.group }));
  };
  return { group: pref.group, setGroup, saved: pref.saved, saveDefault };
}

export function CompOverview(props: CompOverviewProps) {
  const { group, setGroup, saved, saveDefault } = useGroupPref();
  const [printTarget, setPrintTarget] = useState<PrintTarget | null>(null);

  const { cells, invalidPlans } = useMemo(() => {
    const byId = new Map(props.responsibles.map((r) => [r.id, r]));
    const entryByKey = new Map(
      props.entries.map((e) => [`${e.plan_id}:${e.responsible_id}`, e])
    );
    const out: OverviewCell[] = [];
    const invalid: CompPlanClientRow[] = [];
    for (const plan of props.plans.filter((p) => p.active)) {
      const config = parseCompPlanConfig(plan.config);
      if (!config) {
        invalid.push(plan);
        continue;
      }
      const explicit = explicitMemberIds(
        config,
        resolveOperationMembers(
          config.memberOperationIds,
          props.operationMembersById
        )
      );
      const members = (
        explicit === null
          ? props.responsibles
          : explicit
              .map((id) => byId.get(id))
              .filter((r): r is { id: string; label: string } => Boolean(r))
      )
        .slice()
        .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
      for (const member of members) {
        const entry = entryByKey.get(`${plan.id}:${member.id}`) ?? null;
        let total: number | null = null;
        if (entry) {
          const computed = (entry.computed ?? null) as CompComputedRaw | null;
          total = computeEntry(
            config,
            entry.base_amount ?? plan.base_amount_default,
            parseCompEntryInputs(entry.inputs),
            computed?.realized ?? {},
            props.targetsByPlan[plan.id]?.[member.id] ?? {},
            member.id,
            props.targetRatesByPlan[plan.id] ?? {}
          ).total;
        }
        out.push({ plan, config, member, entry, total });
      }
    }
    return { cells: out, invalidPlans: invalid };
  }, [
    props.plans,
    props.entries,
    props.responsibles,
    props.operationMembersById,
    props.targetsByPlan,
    props.targetRatesByPlan,
  ]);

  const grandTotal = cells.reduce((a, c) => a + (c.total ?? 0), 0);
  const activePlans = props.plans.filter((p) => p.active);

  // Agrupamentos derivados da MESMA matriz.
  const byPlan = activePlans
    .map((plan) => {
      const list = cells.filter((c) => c.plan.id === plan.id);
      return {
        plan,
        cells: list,
        subtotal: list.reduce((a, c) => a + (c.total ?? 0), 0),
      };
    })
    .filter((s) => s.cells.length > 0);
  const byPerson = useMemo(() => {
    const map = new Map<string, { member: { id: string; label: string }; cells: OverviewCell[] }>();
    for (const c of cells) {
      const cur = map.get(c.member.id) ?? { member: c.member, cells: [] };
      cur.cells.push(c);
      map.set(c.member.id, cur);
    }
    return [...map.values()]
      .map((p) => ({
        ...p,
        subtotal: p.cells.reduce((a, c) => a + (c.total ?? 0), 0),
      }))
      .sort((a, b) => a.member.label.localeCompare(b.member.label, "pt-BR"));
  }, [cells]);

  // ---- Exportação (CSV/impressão) — 100% derivada da MESMA matriz. ----
  const monthLabel = `${MONTH_LABELS[props.month - 1]} de ${props.year}`;

  const toStatement = (c: OverviewCell): CompStatementInput => ({
    planName: c.plan.name,
    memberLabel: c.member.label,
    config: c.config,
    baseAmountDefault: c.plan.base_amount_default,
    entry: c.entry,
    targets: props.targetsByPlan[c.plan.id]?.[c.member.id] ?? {},
    targetRates: props.targetRatesByPlan[c.plan.id] ?? {},
  });

  // Síncrono (padrão "export displayed" do widget-card): dados já em props.
  const exportCsv = (member?: { id: string; label: string }) => {
    const list = member
      ? cells.filter((c) => c.member.id === member.id)
      : cells;
    const { headers, rows } = compReportCsv(list.map(toStatement));
    downloadCsv(
      csvFilename(
        member ? `remuneracao-${member.label}` : "remuneracao-visao-geral"
      ),
      buildCsv(headers, rows)
    );
  };

  const toCard = (c: OverviewCell, title: string): CompReportCard => ({
    key: `${c.plan.id}:${c.member.id}`,
    title,
    plan: c.plan,
    entry: c.entry,
    targets: props.targetsByPlan[c.plan.id]?.[c.member.id] ?? {},
    targetRates: props.targetRatesByPlan[c.plan.id] ?? {},
  });

  // Seções de impressão espelham o card() de cada agrupamento.
  const printSections = (target: PrintTarget): CompReportSection[] => {
    if (target.kind === "pessoa") {
      return byPerson
        .filter((p) => p.member.id === target.memberId)
        .map((p) => ({
          key: p.member.id,
          heading: p.member.label,
          cards: p.cells.map((c) => toCard(c, c.plan.name)),
        }));
    }
    return group === "por-plano"
      ? byPlan.map((s) => ({
          key: s.plan.id,
          heading: s.plan.name,
          cards: s.cells.map((c) => toCard(c, c.member.label)),
        }))
      : byPerson.map((p) => ({
          key: p.member.id,
          heading: p.member.label,
          cards: p.cells.map((c) => toCard(c, c.plan.name)),
        }));
  };

  const printTitle = (target: PrintTarget): string => {
    if (target.kind === "pessoa") {
      const label = byPerson.find((p) => p.member.id === target.memberId)
        ?.member.label;
      return `Remuneração — ${label ?? ""} — ${monthLabel}`;
    }
    return `Remuneração — ${monthLabel}`;
  };

  const card = (c: OverviewCell, title: string) =>
    c.entry ? (
      <CompPlanCard
        key={`${c.plan.id}:${c.member.id}`}
        plan={c.plan}
        entry={c.entry}
        year={props.year}
        month={props.month}
        targets={props.targetsByPlan[c.plan.id]?.[c.member.id] ?? {}}
        targetRates={props.targetRatesByPlan[c.plan.id] ?? {}}
        title={title}
      />
    ) : (
      <div
        key={`${c.plan.id}:${c.member.id}`}
        className="text-muted-foreground rounded-md border border-dashed p-4 text-sm"
      >
        <span className="text-foreground font-medium">{title}</span> — sem
        lançamento no mês (use Recalcular na aba do plano).
      </div>
    );

  if (activePlans.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nenhum plano ativo neste mês.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Agrupamento da visão geral"
          className="flex items-center gap-1.5"
        >
          {(
            [
              ["por-plano", "Por plano"],
              ["por-pessoa", "Por pessoa"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={group === key}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                group === key
                  ? "border-primary bg-primary/10 font-medium"
                  : "text-muted-foreground hover:bg-accent border-border"
              }`}
              onClick={() => setGroup(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saved === group}
          onClick={saveDefault}
        >
          {saved === group ? "Padrão" : "Usar como padrão"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => exportCsv()}
        >
          <Download className="size-4" /> Exportar CSV
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          title="Abre a impressão do navegador — salve como PDF."
          onClick={() => setPrintTarget({ kind: "geral" })}
        >
          <Printer className="size-4" /> Exportar PDF
        </Button>
        <span className="text-muted-foreground ml-auto text-sm">
          Total do mês:{" "}
          <span className="text-foreground font-semibold">
            {fmtMoney(grandTotal)}
          </span>
        </span>
      </div>

      {invalidPlans.map((p) => (
        <p key={p.id} className="text-destructive text-sm">
          {p.name}: configuração do plano inválida — reabra a aba Plano e salve
          novamente.
        </p>
      ))}

      {group === "por-plano"
        ? byPlan.map((s) => (
            <section key={s.plan.id} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-1">
                <h2 className="text-lg font-medium">{s.plan.name}</h2>
                <span className="text-muted-foreground text-sm">
                  Subtotal:{" "}
                  <span className="text-foreground font-semibold">
                    {fmtMoney(s.subtotal)}
                  </span>
                </span>
              </div>
              <div className="grid items-start gap-4 xl:grid-cols-2">
                {s.cells.map((c) => card(c, c.member.label))}
              </div>
            </section>
          ))
        : byPerson.map((p) => (
            <section key={p.member.id} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-1">
                <h2 className="text-lg font-medium">{p.member.label}</h2>
                <span className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Exportar CSV de ${p.member.label}`}
                    title={`Exportar CSV de ${p.member.label}`}
                    onClick={() => exportCsv(p.member)}
                  >
                    <Download className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Imprimir demonstrativo de ${p.member.label}`}
                    title={`Imprimir demonstrativo de ${p.member.label} — salve como PDF.`}
                    onClick={() =>
                      setPrintTarget({ kind: "pessoa", memberId: p.member.id })
                    }
                  >
                    <Printer className="size-3.5" />
                  </Button>
                  <span className="text-muted-foreground text-sm">
                    Subtotal:{" "}
                    <span className="text-foreground font-semibold">
                      {fmtMoney(p.subtotal)}
                    </span>
                  </span>
                </span>
              </div>
              <div className="grid items-start gap-4 xl:grid-cols-2">
                {p.cells.map((c) => card(c, c.plan.name))}
              </div>
            </section>
          ))}

      {printTarget ? (
        <CompReportPrint
          title={printTitle(printTarget)}
          groupingLabel={
            printTarget.kind === "geral"
              ? group === "por-plano"
                ? "Agrupado por plano"
                : "Agrupado por pessoa"
              : undefined
          }
          sections={printSections(printTarget)}
          year={props.year}
          month={props.month}
          onDone={() => setPrintTarget(null)}
        />
      ) : null}
    </div>
  );
}

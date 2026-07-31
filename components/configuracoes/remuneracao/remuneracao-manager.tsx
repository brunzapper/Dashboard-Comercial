// Versão: 1.1 | Data: 31/07/2026 (v1.1: repassa operations +
// operationMembersById ao editor e à grade — membros por operação)
// Gerência de Remuneração variável (0112) — admin. Topo: seletor de plano +
// navegação de mês (searchParams plano/ano/mes — a page recarrega os dados);
// abas "Lançamentos" (grade mensal) e "Plano" (editor de fatores/fórmulas).
// O detalhamento é 100% derivado no cliente pelo MESMO computeEntry do
// servidor (modelo puro importável) — editar peso/override atualiza a grade
// sem re-consulta; só fórmula/fontes exigem "Recalcular".
"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import type { GoalMetricDef } from "@/lib/metas/metrics";
import type { FieldDefinition } from "@/lib/records/types";
import type { SourceDef } from "@/lib/sources";
import type { AvailableField } from "@/lib/widgets/fields";
import { parseCompPlanConfig } from "@/lib/comp/model";

import { CompGrid } from "./comp-grid";
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

export const MONTH_LABELS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export interface RemuneracaoManagerProps {
  plans: CompPlanClientRow[];
  selectedPlanId: string | null;
  year: number;
  month: number;
  entries: CompEntryClientRow[];
  // Responsáveis ATIVOS canônicos (apelidos colapsados) — linhas da grade e
  // opções de membro do editor.
  responsibles: { id: string; label: string }[];
  // Alvos do mês (goals) por responsável canônico → factorId → alvo.
  targets: Record<string, Record<string, number | null>>;
  metrics: GoalMetricDef[];
  // Insumos do catálogo de fórmulas agregadas (mesmos do widget-builder).
  available: AvailableField[];
  allFields: FieldDefinition[];
  sources: SourceDef[];
  // Operações da org (opções do picker; inativas com sufixo) + membros por
  // operação (id CANÔNICO, já resolvidos no server via loadOperationScopes).
  operations: { id: string; name: string; active: boolean }[];
  operationMembersById: Record<string, string[]>;
}

export function RemuneracaoManager(props: RemuneracaoManagerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<"grade" | "plano">(
    props.plans.length === 0 ? "plano" : "grade"
  );
  // "Novo plano" abre o editor vazio sem perder o plano selecionado na URL.
  const [creating, setCreating] = useState(props.plans.length === 0);

  const plan =
    props.plans.find((p) => p.id === props.selectedPlanId) ??
    props.plans[0] ??
    null;
  const config = useMemo(
    () => (plan ? parseCompPlanConfig(plan.config) : null),
    [plan]
  );

  const navigate = (planId: string | null, year: number, month: number) => {
    const q = new URLSearchParams();
    if (planId) q.set("plano", planId);
    q.set("ano", String(year));
    q.set("mes", String(month));
    router.push(`${pathname}?${q.toString()}`);
  };
  const shiftMonth = (delta: number) => {
    const d = new Date(Date.UTC(props.year, props.month - 1 + delta, 1));
    navigate(plan?.id ?? null, d.getUTCFullYear(), d.getUTCMonth() + 1);
  };

  const planOptions: ComboboxOption[] = props.plans.map((p) => ({
    value: p.id,
    label: p.active ? p.name : `${p.name} (inativo)`,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {props.plans.length > 0 ? (
          <div className="w-56">
            <Combobox
              options={planOptions}
              value={plan?.id ?? ""}
              onValueChange={(v) => {
                setCreating(false);
                navigate(v || null, props.year, props.month);
              }}
              placeholder="Plano…"
            />
          </div>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setCreating(true);
            setTab("plano");
          }}
        >
          <Plus className="size-4" /> Novo plano
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Mês anterior"
            onClick={() => shiftMonth(-1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-36 text-center text-sm font-medium">
            {MONTH_LABELS[props.month - 1]}/{props.year}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Próximo mês"
            onClick={() => shiftMonth(1)}
          >
            <ChevronRight className="size-4" />
          </Button>
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
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {tab === "plano" || !plan ? (
        <PlanEditor
          key={creating ? "novo" : (plan?.id ?? "novo")}
          plan={creating ? null : plan}
          config={creating ? null : config}
          metrics={props.metrics}
          responsibles={props.responsibles}
          available={props.available}
          allFields={props.allFields}
          sources={props.sources}
          operations={props.operations}
          operationMembersById={props.operationMembersById}
          onSaved={(planId) => {
            setCreating(false);
            setTab("grade");
            navigate(planId, props.year, props.month);
          }}
          onDeleted={() => {
            setCreating(false);
            navigate(null, props.year, props.month);
          }}
        />
      ) : config ? (
        <CompGrid
          plan={plan}
          config={config}
          year={props.year}
          month={props.month}
          entries={props.entries}
          responsibles={props.responsibles}
          targets={props.targets}
          operationMembersById={props.operationMembersById}
        />
      ) : (
        <p className="text-destructive text-sm">
          Configuração do plano inválida — reabra a aba Plano e salve novamente.
        </p>
      )}
    </div>
  );
}

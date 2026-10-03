// Versão: 2.0 | Data: 03/10/2026
// v2.0 (03/10/2026): tela redesenhada — ABAS por tarefa (Lançamentos ·
//   Métricas · Divisões) no lugar da página única que empilhava chips com
//   referências internas, a grade de declaração, o formulário de linha, a
//   tabela de todos os meses e uma "Conferência" presa ao mês do formulário.
//   * vocabulário de tela Métrica/Divisão/Opção (lib/manual-base/vocabulary.ts);
//   * toda peça é editável no lugar (renomear, reordenar, contagem padrão);
//   * estado otimista de TODAS as peças em `useManualBaseStore`, e `onChanged`
//     para o host que guarda estado por action (⋮ do dashboard, widget) — antes
//     o que se criava ali não aparecia até reabrir;
//   * conferência contextual, só com divergência no mês em foco.
//   Partes: manual-entries-tab / manual-series-tab / manual-divisions-tab.
// v1.1 (02/10/2026): `initialMonth`/`initialSpread` — o widget "Base do
//   Dashboard" semeia a linha nova com o mês e a distribuição configurados no
//   construtor (`baseManual.defaultMonth`/`defaultSpread`, antes gravados e
//   nunca lidos).
// Versão: 1.0 | Data: 17/09/2026
// O gestor da BASE MANUAL (0142) — UM componente para TRÊS superfícies:
// Registros → Base manual, o ⋮ do dashboard e o widget "Base do Dashboard".
// Três editores seriam a régua paralela que a invariante 25 proíbe, e com três
// telas a divergência apareceria no primeiro ajuste.
//
// O que muda entre elas é só o que se mostra (`compact` mostra só os
// lançamentos; `onlySeries` recorta as colunas) — o caminho de escrita é o
// mesmo, sempre pelas actions de app/(app)/registros/base-manual.
//
// Save OTIMISTA em background (lib/feedback/use-background-save.ts): o valor
// aparece na hora, a action roda com `{ revalidate: false }` e o refresh
// debounced reconcilia. É o refresh que faz os widgets do dashboard
// recalcularem — o carimbo da base entra no fingerprint deferido, então eles
// re-buscam mostrando "Atualizando…".
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import type { ManualFamily, ManualFamilyMember } from "@/lib/manual-base/families";
import type { ManualEntry, ManualSeries, ManualSpread } from "@/lib/manual-base/types";
import { MANUAL_TERMS } from "@/lib/manual-base/vocabulary";

import { ManualDivisionsTab } from "./manual-divisions-tab";
import { ManualEntriesTab, type ManualBaseOption } from "./manual-entries-tab";
import { ManualSeriesTab } from "./manual-series-tab";
import { manualColumns } from "./rows";
import { useManualBaseStore } from "./use-manual-base-store";

export type { ManualBaseOption };

export interface ManualBaseManagerProps {
  series: ManualSeries[];
  entries: ManualEntry[];
  responsibles: ManualBaseOption[];
  operations: ManualBaseOption[];
  /** Os EIXOS cadastrados (0143). Vazio = base plana, a tela da 0142. */
  families?: ManualFamily[];
  members?: ManualFamilyMember[];
  /** `series_id` → chaves de família declaradas. */
  declarations?: Record<string, string[]>;
  canEdit: boolean;
  /** Widget: só os lançamentos, com um atalho para a gestão completa. */
  compact?: boolean;
  /** Recorta as colunas (chaves de métrica). Vazio = todas. */
  onlySeries?: string[];
  /** v1.1: mês (AAAA-MM) em foco ao abrir; ausente = o mês corrente. */
  initialMonth?: string;
  /** v1.1: distribuição semeada na linha nova. */
  initialSpread?: ManualSpread;
  /** Assistente de IA, injetado pela superfície que o hospeda (o widget não o
   *  hospeda). Fica aqui para o gestor não importar o painel e, com ele, todo
   *  o caminho de IA em telas que não o usam. */
  assistant?: React.ReactNode;
  /** v2.0: chamado após um save ESTRUTURAL com sucesso — o host que guarda o
   *  estado por action recarrega (o router.refresh não chega até ele). */
  onChanged?: () => void;
}

type Tab = "lancamentos" | "metricas" | "divisoes";

const EMPTY_FAMILIES: ManualFamily[] = [];
const EMPTY_MEMBERS: ManualFamilyMember[] = [];
const EMPTY_DECLARATIONS: Record<string, string[]> = {};

export function ManualBaseManager({
  series,
  entries,
  responsibles,
  operations,
  families = EMPTY_FAMILIES,
  members = EMPTY_MEMBERS,
  declarations = EMPTY_DECLARATIONS,
  canEdit,
  compact,
  onlySeries,
  assistant,
  initialMonth,
  initialSpread,
  onChanged,
}: ManualBaseManagerProps) {
  const store = useManualBaseStore(
    { series, entries, families, members, declarations },
    onChanged
  );
  const [tab, setTab] = useState<Tab>("lancamentos");

  const columns = useMemo(
    () => manualColumns(store.series, onlySeries),
    [store.series, onlySeries]
  );

  const entriesTab = (
    <ManualEntriesTab
      store={store}
      columns={columns}
      responsibles={responsibles}
      operations={operations}
      canEdit={canEdit}
      initialMonth={initialMonth}
      initialSpread={initialSpread}
      assistant={compact ? undefined : assistant}
      onManageMetrics={compact ? undefined : () => setTab("metricas")}
    />
  );

  if (compact) {
    return (
      <div className="flex flex-col gap-2">
        {entriesTab}
        <Link
          href="/registros/base-manual"
          className="text-muted-foreground self-start text-xs underline-offset-2 hover:underline"
        >
          Gerenciar métricas e divisões
        </Link>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "lancamentos", label: MANUAL_TERMS.entryPlural },
    { key: "metricas", label: MANUAL_TERMS.metricPlural, count: store.series.length },
    { key: "divisoes", label: MANUAL_TERMS.divisionPlural, count: store.families.length },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex flex-wrap items-center gap-1.5 border-b pb-2"
        role="tablist"
        aria-label="Base manual"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              tab === t.key
                ? "border-primary bg-primary/10 font-medium"
                : "text-muted-foreground hover:bg-accent border-border"
            }`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.count != null ? (
              <span className="text-muted-foreground ml-1 text-xs">{t.count}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={tabs.find((t) => t.key === tab)?.label}>
        {/* Lançamentos fica MONTADO (só escondido): o mês em foco e as linhas
            ainda sem valor sobrevivem a uma ida à aba de métricas. */}
        <div hidden={tab !== "lancamentos"}>{entriesTab}</div>
        {tab === "metricas" ? (
          <ManualSeriesTab
            store={store}
            canEdit={canEdit}
            onManageDivisions={() => setTab("divisoes")}
          />
        ) : null}
        {tab === "divisoes" ? <ManualDivisionsTab store={store} canEdit={canEdit} /> : null}
      </div>
    </div>
  );
}

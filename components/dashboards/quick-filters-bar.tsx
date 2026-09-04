// Versão: 1.5 | Data: 04/09/2026
// v1.5 (04/09/2026): a gravação SOBREVIVE ao desmonte do card. A troca de aba
// do dashboard é client-side e desmonta os widgets da aba anterior — o cleanup
// do debounce (400ms) matava o timer e o filtro recém-aplicado/limpo nunca era
// gravado ("preciso ficar parado um bom tempo na tela para trocar de aba").
// Agora o payload pendente vive em pendingRef e o cleanup o FLUSHA (padrão do
// CalculatorWidget), e um cache de MÓDULO guarda o valor otimista com o
// serverKey de baseline, para o chip não piscar o valor antigo ao voltar à aba
// antes de o refresh de reconciliação aterrissar (que agora também sobrevive —
// lib/use-debounced-refresh v1.2).
// v1.4 (01/09/2026): o popover de multi-seleção saiu daqui para
// components/filters/multi-select-popover.tsx (controle ÚNICO, agora também
// usado pelo widget "Filtro por campo"); MultiQuickFilter virou o wrapper que
// mapeia QuickFilterValue ↔ string[]. Marcação e comportamento inalterados.
// v1.3 (07/08/2026): persistência OTIMISTA em background (useBackgroundSave):
// o chip responde na hora, a action roda com revalidate:false e a
// reconciliação vem do refresh debounced do hook; erro → toast + revert do
// chip. O transition global (useNavPending) ficou SÓ para o modo snapshot
// (navegação de URL real). Guard hasPending: o reseed por props é pulado com
// save em voo (eco stale não clobbera o otimista).
// v1.2 (22/07/2026): entry.hiddenOptions oculta opções do dropdown de
// multi-seleção (só exibição — visibleOptions com `keep` = valores
// selecionados, p/ o rótulo do chip resolver e dar para desmarcar).
// v1.1 (21/07/2026): intervalo personalizado do filtro de período em RASCUNHO
// (PeriodRangeDraft) — escolher "Personalizado" não emite mais valor (não
// apaga o preset persistido) e digitar as datas não grava/consulta: o commit
// (onChange → persist debounced) sai com o intervalo completo ou pelo
// "Aplicar" (intervalo aberto deliberado).
// Barra de filtros rápidos de um widget: dropdowns lado a lado no card (onde
// fica a barra de busca das tabelas, ou no topo dos gráficos/KPI/calculado).
// - Responsável/Operação/data com formato → Popover com multi-seleção.
// - Data no formato PADRÃO → dropdown de período (mesmas opções da barra
//   global) + intervalo personalizado.
// Ao contrário da barra de busca (URL), a seleção é PERSISTIDA no servidor
// (dashboard_table_cells '__qf__', via saveQuickFilterValue) — compartilhada
// entre usuários e sobrevive a reloads. Estado otimista + debounce; o save
// roda em background (revalidate:false) e o refresh debounced reconcilia.
// EXCEÇÃO — modo snapshot (viewer público /s/<token>): a seleção é POR
// VISITANTE e vai para a URL (qf_<widget>_<entry>, mesma técnica da
// TableFilterBar); nada é gravado no servidor.
"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { MultiSelectPopover } from "@/components/filters/multi-select-popover";
import { cn } from "@/lib/utils";
import type { AvailableField } from "@/lib/widgets/fields";
import { fieldLabel } from "@/lib/widgets/fields";
import {
  PERIOD_ALL,
  PERIOD_PRESETS,
  type PeriodPresetKey,
} from "@/lib/widgets/period";
import {
  hasQuickValue,
  isPeriodEntry,
  type QuickFilterValue,
  type WidgetQuickFilters,
} from "@/lib/widgets/quick-filters";
import { visibleOptions } from "@/lib/widgets/hidden-options";
import { TRANSFORM_LABELS, type QuickFilterEntry } from "@/lib/widgets/types";
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import { saveQuickFilterValue } from "@/app/(app)/dashboards/actions";
import { useSnapshotMode } from "@/components/snapshots/snapshot-mode";
import { useNavPending } from "./pending-context";
import { PeriodRangeDraft } from "./period-range-inputs";

// Valores otimistas por widget, vivos enquanto a página está aberta: a troca de
// aba desmonta o card e o remonta com as props RSC do último render, que ainda
// são as ANTIGAS enquanto o refresh de reconciliação não aterrissa. `baseline` é
// o serverKey no instante da escrita — a entrada é descartada assim que o
// servidor passa dele (nossa gravação chegou, ou outro usuário mudou o valor),
// então nada fica pinado em valor stale. Mesmo padrão do exprCache do
// CalculatorWidget.
const optimisticCache = new Map<
  string,
  { values: Record<string, QuickFilterValue>; baseline: string }
>();

const CUSTOM = "__custom__";

// Rótulo do chip: nome configurado > rótulo do campo (+ formato quando houver).
function entryLabel(entry: QuickFilterEntry, available: AvailableField[]): string {
  if (entry.label?.trim()) return entry.label.trim();
  const base = fieldLabel(entry.field, available);
  const t = entry.transform;
  return t && t !== "none" ? `${base} (${TRANSFORM_LABELS[t]})` : base;
}

export function QuickFiltersBar({
  dashboardId,
  widgetId,
  qf,
  available,
  className,
}: {
  dashboardId: string;
  widgetId: string;
  qf: WidgetQuickFilters;
  available: AvailableField[];
  className?: string;
}) {
  const { run } = useNavPending();
  const { save, hasPending } = useBackgroundSave();
  const { snapshot } = useSnapshotMode();
  const router = useRouter();
  const pathname = usePathname();

  // Estado otimista, ressincronizado quando o servidor manda valores novos
  // (outro usuário mudou / sync da barra global) — padrão seedKey do app.
  // Guard hasPending (espelho do skipNextData do kanban-board): com save em
  // voo o eco de props é stale (renderizou antes do commit) — ADOTA a key sem
  // aplicar (consome o eco; aplicá-lo no drain clobberaria o otimista); o
  // refresh do hook traz o valor gravado numa key nova e o reseed normal
  // reconcilia.
  const serverKey = JSON.stringify(qf.values);
  const cacheKey = `${dashboardId}:${widgetId}`;
  const cached = optimisticCache.get(cacheKey);
  // Entrada obsoleta: o servidor já passou do baseline dela. Descarta (idempotente).
  if (cached && cached.baseline !== serverKey) optimisticCache.delete(cacheKey);
  const [seedKey, setSeedKey] = useState(serverKey);
  const [values, setValues] = useState<Record<string, QuickFilterValue>>(
    cached && cached.baseline === serverKey ? cached.values : qf.values
  );
  // Espelho do estado (padrão exprRef do CalculatorWidget): setValue monta o
  // próximo mapa a partir dele, então duas escritas no MESMO tick (dois chips)
  // não se sobrescrevem — e o cache de módulo recebe o objeto resultante sem
  // efeito colateral dentro de um updater (que o StrictMode duplicaria).
  const valuesRef = useRef(values);
  if (seedKey !== serverKey) {
    setSeedKey(serverKey);
    if (!hasPending) setValues(qf.values);
  }
  // Espelho sincronizado APÓS o commit (ref não se escreve em render). setValue
  // só roda em evento do usuário, sempre depois deste effect, então nunca lê
  // um mapa defasado.
  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  // Debounce por entry: agrupa cliques rápidos numa única gravação. O payload
  // pendente fica em pendingRef; o timer o CONSOME e o desmonte o FLUSHA — sem
  // isso, trocar de aba dentro dos 400ms descartava a gravação inteira.
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingRef = useRef<Record<string, () => void>>({});
  // Já drenou? O React destrói a subárvore de cima para baixo, então um filho
  // (o rascunho de intervalo personalizado) pode commitar DEPOIS do dreno deste
  // componente — o persist resultante precisa gravar na hora, senão arma um
  // timer que ninguém mais dispara.
  const flushedRef = useRef(false);
  useEffect(() => {
    flushedRef.current = false; // remontagem (StrictMode) volta ao normal
    const timers = timersRef.current;
    const pending = pendingRef.current;
    return () => {
      flushedRef.current = true;
      for (const t of Object.values(timers)) clearTimeout(t);
      // Vazio na montagem — o StrictMode do dev (monta → desmonta → monta) roda
      // este cleanup sem nada pendente, então nunca dispara save espúrio.
      for (const id of Object.keys(pending)) {
        const pendingRun = pending[id];
        delete pending[id];
        pendingRun();
      }
    };
  }, []);

  const persist = (entryId: string, value: QuickFilterValue | null) => {
    clearTimeout(timersRef.current[entryId]);
    const dispatch = () => {
      // Modo snapshot: seleção por visitante na URL; o RSC público a lê e
      // recomputa sobre o dataset congelado. Nada persiste no servidor.
      if (snapshot) {
        // URL lida de window.location, nunca do `searchParams` capturado: este
        // dispatch pode rodar no flush do DESMONTE, depois de a troca de aba
        // ter escrito ?tab= por replaceState — o snapshot velho apagaria isso.
        const params = new URLSearchParams(window.location.search);
        const key = `qf_${widgetId}_${entryId}`;
        if (value) params.set(key, JSON.stringify(value));
        else params.delete(key);
        const qs = params.toString();
        run(() =>
          router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
        );
        return;
      }
      // Save otimista em background: o chip já mostra o valor novo; a action
      // volta logo após o upsert (revalidate:false) e o refresh debounced do
      // hook reconcilia os widgets. Erro → toast + chip volta ao último valor
      // confirmado pelo servidor (props deste render).
      const prev = qf.values[entryId] ?? null;
      save({
        key: entryId,
        context: "Não foi possível salvar o filtro",
        action: () =>
          saveQuickFilterValue(dashboardId, widgetId, entryId, value, {
            revalidate: false,
          }),
        revert: () => {
          // O otimista morreu: o cache não pode ressuscitá-lo numa remontagem.
          optimisticCache.delete(cacheKey);
          const next = { ...valuesRef.current };
          if (prev == null) delete next[entryId];
          else next[entryId] = prev;
          valuesRef.current = next;
          setValues(next);
        },
      });
    };
    pendingRef.current[entryId] = dispatch;
    if (flushedRef.current) {
      // Commit tardio de um filho, já com o card desmontado: grava agora.
      delete pendingRef.current[entryId];
      dispatch();
      return;
    }
    timersRef.current[entryId] = setTimeout(() => {
      // Só o agendamento VIGENTE dispara (um persist mais novo já o substituiu).
      if (pendingRef.current[entryId] !== dispatch) return;
      delete pendingRef.current[entryId];
      dispatch();
    }, 400);
  };

  const setValue = (entryId: string, value: QuickFilterValue | null) => {
    const next = { ...valuesRef.current };
    if (value == null) delete next[entryId];
    else next[entryId] = value;
    valuesRef.current = next;
    setValues(next);
    // Sobrevive à remontagem por troca de aba até o servidor confirmar.
    optimisticCache.set(cacheKey, { values: next, baseline: serverKey });
    persist(entryId, value);
  };

  if (qf.entries.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {qf.entries.map((entry) =>
        isPeriodEntry(entry, available) ? (
          <PeriodQuickFilter
            key={entry.id}
            label={entryLabel(entry, available)}
            value={values[entry.id]}
            onChange={(v) => setValue(entry.id, v)}
          />
        ) : (
          <MultiQuickFilter
            key={entry.id}
            label={entryLabel(entry, available)}
            options={visibleOptions(
              qf.options[entry.id] ?? [],
              entry.hiddenOptions,
              values[entry.id]?.kind === "options"
                ? (values[entry.id] as { values: string[] }).values
                : []
            )}
            value={values[entry.id]}
            onChange={(v) => setValue(entry.id, v)}
          />
        )
      )}
    </div>
  );
}

// Dropdown de multi-seleção (responsável / operação / bucket de data): mapeia
// QuickFilterValue ↔ string[] sobre o controle compartilhado (seleção vazia =
// valor nulo, ou seja, "todos" — nada persistido).
function MultiQuickFilter({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value?: QuickFilterValue;
  onChange: (v: QuickFilterValue | null) => void;
}) {
  return (
    <MultiSelectPopover
      label={label}
      options={options}
      values={value?.kind === "options" ? value.values : []}
      onChange={(next) =>
        onChange(next.length > 0 ? { kind: "options", values: next } : null)
      }
    />
  );
}

// Dropdown de período (data no formato padrão): mesmas opções da barra global
// (Todo o período / presets / Personalizado), persistidas em vez de irem à URL.
function PeriodQuickFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: QuickFilterValue;
  onChange: (v: QuickFilterValue | null) => void;
}) {
  const sel = value?.kind === "period" ? value : undefined;
  const preset = sel?.preset ?? "";
  const isCustom = !preset && Boolean(sel?.de || sel?.ate);
  const [customOpen, setCustomOpen] = useState(isCustom);
  const mode = isCustom || customOpen ? CUSTOM : preset === PERIOD_ALL ? "" : preset;

  const modeOptions: ComboboxOption[] = [
    { value: "", label: "Todo o período" },
    ...(Object.keys(PERIOD_PRESETS) as PeriodPresetKey[]).map((k) => ({
      value: k,
      label: PERIOD_PRESETS[k],
    })),
    { value: CUSTOM, label: "Personalizado" },
  ];

  function onModeChange(v: string) {
    if (v === CUSTOM) {
      // Só abre os inputs de rascunho — nada é emitido/persistido até o
      // commit do intervalo (o valor anterior segue filtrando).
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    if (v === "") {
      // "Todo o período" explícito: sentinel (sobrepõe o período geral quando o
      // campo é o mesmo; limpar de vez = mesma coisa com menos estado, mas o
      // sentinel preserva a intenção após o sync da barra).
      onChange(hasQuickValue(sel) ? { kind: "period", preset: PERIOD_ALL } : null);
      return;
    }
    onChange({ kind: "period", preset: v });
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-muted-foreground max-w-40 truncate text-xs">
        {label}:
      </span>
      <Combobox
        options={modeOptions}
        value={mode}
        onValueChange={onModeChange}
        searchable={false}
        className="h-8 w-auto min-w-36 text-xs"
        aria-label={`Período — ${label}`}
      />
      {mode === CUSTOM ? (
        // Rascunho: digitar não emite; o commit emite UMA vez (intervalo
        // completo auto, ou aberto via "Aplicar") e o persist do pai grava.
        <PeriodRangeDraft
          compact
          de={sel?.de ?? ""}
          ate={sel?.ate ?? ""}
          ariaPrefix={label}
          onCommit={({ de, ate }) =>
            onChange({ kind: "period", preset: "", de, ate })
          }
        />
      ) : null}
    </div>
  );
}

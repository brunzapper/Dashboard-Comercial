// Versão: 3.2 | Data: 19/08/2026
// v3.2 (19/08/2026): com escopo POR ABA, a engrenagem configura a ABA ATIVA —
//   período padrão, campo primário, campo por Base e visibilidade da barra vão
//   para `periodBar.byTab[<aba>]` (herança do global resolvida em
//   `effectivePeriodBar`). O escopo em si segue sendo chave do board inteiro.
//   Ocultar a barra numa aba FIXA o período padrão dela para todos os usuários
//   (ver lib/widgets/period-resolve.ts) — deixou de significar "todo o período".
// v3.1 (26/07/2026): PASTAS (0107) — "Campo de data por base" agrupado por
//   pasta, com as subs logo abaixo da própria pai (↳).
// Barra de período do dashboard: filtra todos os widgets não cobertos por um
// widget de filtro. Editores configuram (engrenagem) o período/campo padrão, o
// escopo (global x por aba) e podem ocultá-la (persistido em dashboards.settings).
// Usa o controle reutilizável PeriodControls. v3.0: escopo por aba — as chaves de
// URL passam a ser namespadas por id da aba ativa (periodo__<tabId>…).
"use client";

import { useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarDays, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { AvailableField } from "@/lib/widgets/fields";
import {
  defaultPeriodFieldBySource,
  subSourcesOf,
  type SourceKey,
} from "@/lib/sources";
import {
  groupSourcesByFolder,
  IMPLICIT_FOLDER_LABEL,
} from "@/lib/source-folders";
import { useSourceFolders } from "@/components/source-folders-context";
import {
  DEFAULT_PERIOD_FIELD,
  effectivePeriodBar,
  PERIOD_PRESETS,
  periodKeys,
  type EffectivePeriodBar,
  type PeriodPresetKey,
  type PeriodScope,
  type PeriodSelection,
  type SavedPeriod,
} from "@/lib/widgets/period";
import type { DashboardSettings } from "@/lib/widgets/types";
import { sourceChips, toFieldOptions } from "@/lib/widgets/filter-ops";
import { useSourceLabels } from "@/components/source-labels-context";
import { useSources } from "@/components/sources-context";
import {
  saveLastPeriod,
  syncGlobalPeriodQuickFilters,
  updateDashboardSettings,
} from "@/app/(app)/dashboards/actions";
import { PeriodControls } from "./period-controls";

type PeriodBar = NonNullable<DashboardSettings["periodBar"]>;

export function PeriodFilter({
  available,
  canEdit,
  dashboardId,
  settings,
  periodBar,
  activeBar,
  periodScope,
  activeTabId,
  tabName,
  firstTabId = "",
  hasTabs,
  periodDefaultsByTab,
  periodDefaultFieldByTab,
}: {
  available: AvailableField[];
  canEdit: boolean;
  dashboardId: string;
  settings: DashboardSettings;
  periodBar?: PeriodBar;
  // Config EFETIVA do bucket ativo (global ← byTab[aba]), resolvida pelo
  // servidor. Ausente = derivada aqui pelo MESMO helper.
  activeBar?: EffectivePeriodBar;
  periodScope?: PeriodScope;
  activeTabId: string;
  // Nome da aba ativa — só rotula o popover no escopo por aba.
  tabName?: string;
  // Id da 1ª aba (widgets sem etiqueta pertencem a ela) — usado pelo sync dos
  // filtros rápidos no escopo por aba.
  firstTabId?: string;
  hasTabs: boolean;
  periodDefaultsByTab?: Record<string, PeriodSelection>;
  periodDefaultFieldByTab?: Record<string, string>;
}) {
  const sp = useSearchParams();
  // Campos elegíveis como coluna de período: exclui sintéticos (displayOnly,
  // ex.: "Data atual" — não existe no banco) e `match:` (subconsulta do registro
  // casado — o RPC não a aceita como coluna do `@period`). `unified:` fica: o
  // servidor o resolve no membro concreto de cada fonte.
  const dateFields = available.filter(
    (f) => f.isDate && !f.displayOnly && !f.field.startsWith("match:")
  );

  // Escopo e "bucket" ativo: no modo por aba a barra opera sobre a aba ativa
  // (chaves de URL namespadas); no modo global, sobre o bucket único "".
  const scope: PeriodScope = periodScope === "tab" ? "tab" : "global";
  const bucket = scope === "tab" ? activeTabId : "";
  const keys = periodKeys(scope, bucket);

  // Config efetiva deste bucket (global ← byTab[aba]): o servidor já resolveu a
  // herança; o fallback usa o MESMO helper p/ os dois lados nunca divergirem.
  const bar = activeBar ?? effectivePeriodBar(periodBar, scope, bucket);
  // Default (URL vazia): usa o que o servidor resolveu para este bucket (último
  // período do usuário > config do dashboard > default), p/ UI e dados baterem.
  // Num bucket com a barra oculta o servidor já descarta a preferência.
  const periodDefaults = periodDefaultsByTab?.[bucket] ?? {
    preset: bar.defaultPreset ?? "",
  };
  const defaultField =
    periodDefaultFieldByTab?.[bucket] || bar.field || DEFAULT_PERIOD_FIELD;
  const field = sp.get(keys.campo) || defaultField;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
      <CalendarDays className="text-muted-foreground size-4 shrink-0" />
      <PeriodControls
        // `key` força o controle a reidratar (estado interno) ao trocar de aba.
        key={bucket}
        keys={{ preset: keys.preset, de: keys.de, ate: keys.ate }}
        defaults={periodDefaults}
        persist={(sel: SavedPeriod) => {
          // Salva o último período consultado deste usuário/dashboard (por aba
          // no modo "tab"; global caso contrário). Best-effort: falha não pode
          // virar unhandled rejection (a consulta em tela já navegou).
          void saveLastPeriod(
            dashboardId,
            sel,
            scope === "tab" && bucket ? bucket : undefined
          ).catch(() => {});
          // Sync UNIDIRECIONAL barra → filtros rápidos de período dos widgets
          // com o MESMO campo (persistido p/ todos). O inverso não acontece:
          // mudar o filtro do widget nunca altera a barra.
          void syncGlobalPeriodQuickFilters(
            dashboardId,
            sel.campo || defaultField,
            { preset: sel.periodo ?? "", de: sel.de ?? "", ate: sel.ate ?? "" },
            scope === "tab" && bucket
              ? { tabId: bucket, isFirst: bucket === firstTabId }
              : undefined
          ).catch(() => {});
        }}
        fieldControl={{
          paramKey: keys.campo,
          value: field,
          defaultValue: defaultField,
          options: dateFields,
        }}
      />
      {canEdit ? (
        <PeriodBarConfig
          // Reidrata o estado interno ao trocar de aba (mesmo motivo do `key`
          // do PeriodControls): sem isso o popover mostraria — e salvaria — os
          // valores da aba anterior.
          key={bucket}
          dashboardId={dashboardId}
          settings={settings}
          dateFields={dateFields}
          periodBar={periodBar}
          effective={bar}
          scope={scope}
          bucket={bucket}
          tabName={tabName}
          hasTabs={hasTabs}
        />
      ) : null}
    </div>
  );
}

// Popover de configuração da barra (editores): período/campo padrão, escopo e
// ocultar. Com escopo POR ABA tudo (menos o escopo, que é do board) vale para a
// ABA ATIVA e é gravado em periodBar.byTab[<aba>]; a caixa "Usar a configuração
// global" REMOVE a chave da aba, devolvendo-a à herança.
function PeriodBarConfig({
  dashboardId,
  settings,
  dateFields,
  periodBar,
  effective,
  scope: currentScope,
  bucket,
  tabName,
  hasTabs,
}: {
  dashboardId: string;
  settings: DashboardSettings;
  dateFields: AvailableField[];
  periodBar?: PeriodBar;
  effective: EffectivePeriodBar;
  scope: PeriodScope;
  bucket: string;
  tabName?: string;
  hasTabs: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Override JÁ salvo desta aba, lido pelo escopo VIGENTE (é o que está no
  // banco). A caixa "usar o global" governa os VALORES (período padrão, campo,
  // campo por Base) — a visibilidade é dos botões Ocultar/Mostrar, então uma
  // aba pode esconder a barra e ainda herdar os valores.
  const tabOverride =
    currentScope === "tab" && bucket ? periodBar?.byTab?.[bucket] : undefined;
  const [inherit, setInherit] = useState(
    !(
      tabOverride &&
      (tabOverride.defaultPreset !== undefined ||
        tabOverride.field !== undefined ||
        tabOverride.fieldBySource !== undefined)
    )
  );
  const [preset, setPreset] = useState(effective.defaultPreset ?? "");
  const [field, setField] = useState(effective.field ?? DEFAULT_PERIOD_FIELD);
  const [scope, setScope] = useState<PeriodScope>(currentScope);
  // Editando a config DA ABA? Usa o escopo PENDENTE (o do combobox): trocar
  // para global no popover faz o Salvar gravar as chaves de topo.
  const perTab = scope === "tab" && Boolean(bucket);
  // Campo de data por fonte (secundária/terciária/…): a mesma seleção de
  // calendário filtra cada fonte pela sua coluna. Default por fonte quando não
  // configurado (ex.: Estudo → Data de criação).
  const catalog = useSources();
  const [fieldBySource, setFieldBySource] = useState<
    Partial<Record<SourceKey, string>>
  >(() => ({
    ...defaultPeriodFieldBySource(catalog),
    ...(effective.fieldBySource ?? {}),
  }));
  // PASTAS (0107): lista "Campo de data por base" agrupada por pasta (heading
  // só quando há pasta) e cada raiz seguida das PRÓPRIAS subs. Puro visual —
  // fieldBySource segue chaveado por key.
  const folders = useSourceFolders();
  const catalogGroups = groupSourcesByFolder(folders, catalog);
  const showFolderHeadings = catalogGroups.some((g) => g.folder != null);

  const presetOptions: ComboboxOption[] = [
    { value: "", label: "Todo o período" },
    ...(Object.keys(PERIOD_PRESETS) as PeriodPresetKey[]).map((k) => ({
      value: k,
      label: PERIOD_PRESETS[k],
    })),
  ];
  const sourceLabels = useSourceLabels();
  const fieldSourceChips = sourceChips(sourceLabels);
  const fieldOptions: ComboboxOption[] = toFieldOptions(
    dateFields,
    sourceLabels
  );
  const scopeOptions: ComboboxOption[] = [
    { value: "global", label: "Global (todas as abas)" },
    { value: "tab", label: "Por aba" },
  ];
  // Editando a aba mas herdando do global: os controles abaixo são só leitura
  // (mostram o valor herdado) — desmarcar a caixa os libera.
  const locked = perTab && inherit;

  function persist(next: PeriodBar) {
    startTransition(async () => {
      // `updateDashboardSettings` sobrescreve o jsonb inteiro — enviar o
      // `settings` completo para não apagar tabs/background/canvas.
      await updateDashboardSettings(dashboardId, { ...settings, periodBar: next });
      setOpen(false);
    });
  }

  // Grava os overrides DESTA aba preservando as demais (e o global). Passar
  // `null` remove a chave da aba = volta a herdar. Trocar o escopo nunca apaga
  // o `byTab`: o editor pode ir e voltar sem perder o que configurou.
  function persistTab(over: NonNullable<PeriodBar["byTab"]>[string] | null) {
    const byTab = { ...(periodBar?.byTab ?? {}) };
    if (over) byTab[bucket] = over;
    else delete byTab[bucket];
    const next: PeriodBar = { ...periodBar, scope };
    if (Object.keys(byTab).length > 0) next.byTab = byTab;
    else delete next.byTab;
    persist(next);
  }

  // "Salvar": no escopo por aba escreve o override da aba (ou o remove, se
  // marcada a herança); no global, as chaves de topo, como sempre.
  function save() {
    if (perTab) {
      // Herdando: some com os valores da aba, PRESERVANDO a visibilidade dela.
      persistTab(
        inherit
          ? tabOverride?.enabled !== undefined
            ? { enabled: tabOverride.enabled }
            : null
          : {
              ...(tabOverride?.enabled !== undefined
                ? { enabled: tabOverride.enabled }
                : {}),
              defaultPreset: preset,
              field,
              fieldBySource,
            }
      );
      return;
    }
    persist({
      ...periodBar,
      enabled: true,
      defaultPreset: preset,
      field,
      scope,
      fieldBySource,
    });
  }

  // "Ocultar barra": no escopo por aba esconde só a ABA ATIVA. Herdando o
  // global, grava SÓ `enabled: false` — congelar preset/campo aqui faria a aba
  // parar de acompanhar mudanças futuras do dashboard sem o editor pedir.
  function hideBar() {
    if (perTab) {
      persistTab(
        inherit
          ? { ...(tabOverride ?? {}), enabled: false }
          : {
              ...(tabOverride ?? {}),
              enabled: false,
              defaultPreset: preset,
              field,
              fieldBySource,
            }
      );
      return;
    }
    persist({ ...periodBar, enabled: false });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          aria-label="Configurar barra de período"
        >
          <Settings2 className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex flex-col gap-3">
        {hasTabs ? (
          <div className="flex flex-col gap-1.5">
            <Label>Escopo do período</Label>
            <Combobox
              options={scopeOptions}
              value={scope}
              onValueChange={(v) => setScope(v as PeriodScope)}
              searchable={false}
              aria-label="Escopo do período"
            />
            <p className="text-muted-foreground text-xs">
              Vale para o dashboard inteiro.
            </p>
          </div>
        ) : null}
        {perTab ? (
          <div className="flex flex-col gap-1.5 rounded-md border p-2">
            <p className="text-xs font-medium">
              Configurações da aba{tabName ? ` “${tabName}”` : ""}
            </p>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={inherit}
                onChange={(e) => setInherit(e.target.checked)}
                aria-label="Usar a configuração global"
              />
              Usar a configuração global do dashboard
            </label>
            <p className="text-muted-foreground text-xs">
              {inherit
                ? "Esta aba segue o período padrão e os campos definidos abaixo para o dashboard."
                : "O período padrão e os campos abaixo valem só nesta aba."}
            </p>
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label>Período padrão</Label>
          <Combobox
            options={presetOptions}
            value={preset}
            onValueChange={setPreset}
            searchable={false}
            disabled={locked}
            aria-label="Período padrão"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Campo de data primário (visível)</Label>
          <Combobox
            options={fieldOptions}
            chips={fieldSourceChips}
            value={field}
            onValueChange={setField}
            disabled={locked}
            aria-label="Campo de data primário"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Campo de data por base</Label>
          <p className="text-muted-foreground text-xs">
            A mesma seleção do calendário filtra cada base pela sua coluna de
            data (ex.: negócios por assinatura e Estudo por Created At).
          </p>
          {catalogGroups.map((g) => (
            <div
              key={g.folder?.id ?? "__sem_pasta__"}
              className="flex flex-col gap-2"
            >
              {showFolderHeadings ? (
                <p className="text-muted-foreground text-xs font-medium uppercase">
                  {g.folder?.label ?? IMPLICIT_FOLDER_LABEL}
                </p>
              ) : null}
              {g.roots
                .flatMap((root) => [root, ...subSourcesOf(root.key, catalog)])
                .map((s) => (
                  <div key={s.key} className="flex items-center gap-2">
                    <span className="text-muted-foreground w-32 shrink-0 text-xs">
                      {s.parentKey ? "↳ " : ""}
                      {s.label}
                    </span>
                    <Combobox
                      options={fieldOptions}
                      chips={fieldSourceChips}
                      value={fieldBySource[s.key] ?? s.defaultPeriodField}
                      onValueChange={(v) =>
                        setFieldBySource((prev) => ({ ...prev, [s.key]: v }))
                      }
                      disabled={locked}
                      aria-label={`Campo de data — ${s.label}`}
                    />
                  </div>
                ))}
            </div>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          Com a barra oculta, o período padrão acima continua valendo — e vale
          igual para todos os usuários{perTab ? " desta aba" : ""}. Para não
          filtrar por período, escolha “Todo o período”.
        </p>
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={hideBar}
          >
            {perTab ? "Ocultar nesta aba" : "Ocultar barra"}
          </Button>
          <Button size="sm" disabled={pending} onClick={save}>
            Salvar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

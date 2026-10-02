// Versão: 2.13 | Data: 02/10/2026
// v2.13 (02/10/2026): Tabela Livre — seção "Metas": visual de tabela de slide
//   (o da antiga Tabela de metas), densidade, atingimento, realizado vazio,
//   unidade, etiqueta, nota e o comportamento das células de meta (mostrar
//   realizado/atingimento, admin edita a meta). Antes essas chaves só
//   existiam no JSON do preset. Vivem em settings.quickTable.display/goals.
// Versão: 2.12 | Data: 02/10/2026
// v2.12 (02/10/2026): seção "Tree" — o que os cartões mostram AO APRESENTAR
//   (tipo, +, "Agendar próxima", concluir, avisos; padrão = oculto) e o fundo
//   do canvas da Root (cor + trama), que antes só existiam no JSON do preset.
//   Ambos vivem DENTRO de settings.tree (merge no save, config preservada).
// Versão: 2.11 | Data: 02/10/2026
// v2.11 (02/10/2026): seção "Destaque e anotações" (destacar categorias,
//   anotações com filete, rótulo direto e área nas linhas) e, no Card, "Número
//   em escala" (kpiCompact).
// Versão: 2.10 | Data: 02/10/2026
// v2.10 (02/10/2026): controles do ESTILO DE APRESENTAÇÃO — "Kicker" (rótulo
//   acima do título-conclusão) em Título e borda; na Nota, o papel do bloco
//   (post-it / texto / comentário / rodapé), alinhamento, posição vertical,
//   respiro e a cola do markdown leve; nos gráficos, a técnica do destaque
//   (uma série em cor, o resto em cinza).
// v2.9 (06/09/2026): Tabela Livre — caixa "Barra de fórmula e régua A/B/C"
//   (appearance.table.formulaBar; ausente = visível p/ quem pode digitar).
// v2.8 (07/08/2026): "Aplicar" OTIMISTA em background (useBackgroundSave): o
//   sheet fecha na hora, updateWidget roda com revalidate:false e o refresh
//   debounced traz a aparência aplicada (antes: await revalidate + refresh =
//   2 renders RSC completos com o painel travado em "Salvando…"); erro →
//   toast (a aparência antiga permanece).
// v2.7 (28/07/2026): seção "Agenda" (AgendaAppearanceSection) — aparência do
//   calendário vive DENTRO de settings.agenda.appearance (merge no save
//   preservando a config; espelho do arranjo do kanban). Agenda entrou no
//   canStyle do widget-card.
// v2.6 (26/07/2026): select tri-state do selo "Nº dia útil"
//   (appearance.hideBusinessDayBadge — herda o padrão do dashboard / oculta /
//   mostra) na seção "Título e borda", p/ Card e gráficos.
// v2.5 (25/07/2026): posição do rótulo em barra HORIZONTAL vira "Fora"/
//   "Dentro" (valores salvos inalterados; "Acima" era wording de barra
//   vertical) + hint do auto-flip; novos controles "Espessura das barras"
//   (barFillPct) e "Margem interna do gráfico" (chartInset); seção "Filtro"
//   (fundo/borda/abinha — appearance.filter) p/ filtro/filtro_campo, que
//   passam a ter aparência (canStyle no widget-card); isShape/isLineShape
//   reconhecem o novo tipo 'linha_divisoria'.
// v2.4 (17/07/2026): painel (SheetContent) com bg-muted — cards internos
//   (regras de formatação condicional etc.) se destacam em branco.
// v2.3 (17/07/2026): todas as seções recolhíveis abrem fechadas (sem
//   defaultValue no Accordion) — expandir sob demanda; badges seguem resumindo.
// v2.2 (15/07/2026): seções de cores dos widgets calculadora (card/visor/
//   teclas), nota (papel/texto/links/fonte/sem moldura) e forma (preenchimento/
//   contorno/texto). "Título e borda" fica oculto na forma (sem cromo).
// v2.1 (13/07/2026): UX — controles organizados em seções recolhíveis
//   (Accordion, mesmo padrão do construtor). Seções raras abrem fechadas;
//   as já configuradas (rótulos/legenda) abrem expandidas. Sem mudança de
//   comportamento/salvamento.
// Editor de APARÊNCIA de um widget (Sheet), aberto pelo menu "⋮" do card.
// v2.0 (Fase 10.1): a reordenação, a ordenação e as cores por coluna/linha/
// célula/categoria passaram a ser feitas IN-LOCO (direto na tabela/gráfico). Este
// painel mantém os ajustes globais: fundo, grade, preenchimento, cores de série,
// eixos, rótulos, legenda, paleta de pizza, cores globais da tabela e o card KPI.
"use client";

import { useState } from "react";

import { useBackgroundSave } from "@/lib/feedback/use-background-save";

import { Accordion } from "@/components/ui/accordion";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BuilderSection } from "@/components/dashboards/widget-builder-rows";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ResizableSheetContent } from "@/components/ui/resizable-sheet-content";
import { ColorField } from "./appearance-controls";
import { KanbanAppearanceSection } from "@/components/kanban/kanban-appearance-section";
import { AgendaAppearanceSection } from "@/components/agenda/agenda-appearance-section";
import type { AgendaAppearance } from "@/lib/agenda/types";
import {
  TREE_PRESENTATION_LABELS,
  type TreePresentationSettings,
} from "@/lib/tree/display";
import { fieldLabel, type AvailableField } from "@/lib/widgets/fields";
import type { ComboboxOption } from "@/components/ui/combobox";
import { ConditionalFormatSection } from "@/components/dashboards/conditional-format-section";
import {
  orderCategories,
  recordListMetricKey,
  topWithOther,
} from "@/lib/widgets/appearance";
import { isChronoDim } from "@/lib/widgets/comparison";
import { AGG_LABELS } from "@/lib/widgets/types";
import type { KanbanAppearance } from "@/lib/kanban/types";
import { PALETTES } from "@/lib/widgets/palettes";
import type {
  AppearanceSettings,
  AxisSide,
  GridLines,
  TableAlign,
  QuickTableGoalDisplay,
  TreeSettings,
  Widget,
  WidgetData,
  WidgetSettings,
} from "@/lib/widgets/types";
import type { WidgetInput } from "@/app/(app)/dashboards/actions";
import { updateWidget } from "@/app/(app)/dashboards/actions";

// Opções da seção "Texto": Auto (default do elemento × escala do dashboard)
// ou px fixo (absoluto — não multiplica pela escala).
const FONT_SIZE_OPTIONS = [
  { value: "auto", label: "Auto" },
  ...[10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64].map((n) => ({
    value: String(n),
    label: `${n} px`,
  })),
];
const fontValue = (px: number | undefined): string =>
  px != null ? String(px) : "auto";
const fontPx = (v: string): number | undefined =>
  v === "auto" ? undefined : Number(v);

export function WidgetAppearanceSheet({
  dashboardId,
  widget,
  data,
  available,
  open,
  onOpenChange,
}: {
  dashboardId: string;
  widget: Widget;
  data: WidgetData;
  available: AvailableField[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { save: backgroundSave } = useBackgroundSave();
  const [ap, setAp] = useState<AppearanceSettings>(
    widget.settings?.appearance ?? {}
  );
  // Aparência do kanban vive DENTRO de settings.kanban (compartilhada com a
  // página dedicada) — estado separado, merge no save.
  const [kap, setKap] = useState<KanbanAppearance>(
    widget.settings?.kanban?.appearance ?? {}
  );
  // Aparência da agenda: mesmo arranjo, dentro de settings.agenda.
  const [aap, setAap] = useState<AgendaAppearance>(
    widget.settings?.agenda?.appearance ?? {}
  );

  // v2.12: exibição da Tree ao apresentar + canvas — dentro de settings.tree.
  const [tpres, setTpres] = useState<TreePresentationSettings>(
    widget.settings?.tree?.presentation ?? {}
  );
  const [tcanvas, setTcanvas] = useState<NonNullable<TreeSettings["canvas"]>>(
    widget.settings?.tree?.canvas ?? {}
  );

  // v2.13: metas da Tabela Livre (display/goals dentro de settings.quickTable).
  const [qtDisplayOn, setQtDisplayOn] = useState(widget.settings?.quickTable?.display != null);
  const [qtDisplay, setQtDisplay] = useState<QuickTableGoalDisplay>(
    widget.settings?.quickTable?.display ?? {}
  );
  const [qtGoals, setQtGoals] = useState<NonNullable<NonNullable<WidgetSettings["quickTable"]>["goals"]>>(
    widget.settings?.quickTable?.goals ?? {}
  );
  const qtHasGoals = (widget.settings?.quickTable?.columns ?? []).some((c) => c.kind === "goal");

  const vt = widget.visual_type;
  const isTree = vt === "tree";
  const isBar = vt === "barra" || vt === "barra_horizontal";
  const isChart = isBar || vt === "linha";
  const isPie = vt === "pizza" || vt === "funil";
  // A Tabela Livre reusa a seção de tabela (cores globais/grade/alinhamento).
  const isTable = vt === "tabela" || vt === "tabela_editavel";
  const isQuickTable = vt === "tabela_editavel";
  const isKpi = vt === "kpi";
  const isCalculator = vt === "calculadora";
  const isNote = vt === "nota";
  // 'linha_divisoria' compartilha o formato/aparência da forma (shape).
  const isShape = vt === "forma" || vt === "linha_divisoria";
  // Linha (camada livre): só traço — sem preenchimento. Cobre o tipo próprio
  // (0100) e a forma legada (forma + shape.kind "linha", ex.: snapshot).
  const isLineShape =
    vt === "linha_divisoria" ||
    (isShape && widget.settings?.shape?.kind === "linha");
  const isKanban = vt === "kanban";
  const isAgenda = vt === "agenda";
  const isFilter = vt === "filtro" || vt === "filtro_campo";

  const metrics = data.metrics;
  const dimKey = data.dimensions[0]?.key;
  // v2.11: categorias do gráfico (como aparecem no eixo) — alvo de destaque e
  // de anotação.
  const catOptions = dimKey
    ? Array.from(new Set(data.rows.map((r) => String(r[dimKey] ?? "—"))))
    : [];
  // Fatias na MESMA ordem do chart (orderCategories compartilhado) — senão os
  // índices de sliceColors apontariam p/ fatias trocadas.
  const slicesBase =
    isPie && dimKey && metrics[0]
      ? topWithOther(data.rows, dimKey, metrics[0].key, ap.categoryLimit)
      : [];
  const slices =
    ap.categorySort && ap.categorySort.dir !== "color"
      ? (orderCategories(slicesBase, ap.categorySort, {
          dimKey: "name",
          valueKey: "value",
        }) as typeof slicesBase)
      : slicesBase;
  // Eixo cronológico (1ª dimensão com transform de data): segue cronológico —
  // a UI não oferece ordenação por valor (sort salvo explícito ainda vale).
  const dimChrono = Boolean(
    widget.dimensions?.[0] && isChronoDim(widget.dimensions[0])
  );

  // Alvos da formatação condicional (ver lib/widgets/conditional.ts): tabela
  // agregada/gráficos usam as chaves de data (dim_n/metric_n, + Δ quando a
  // comparação está em coluna exclusiva); modo lista usa o field da coluna;
  // Card/calculado usam a chave especial "value".
  const isRecordListW = vt === "tabela" && widget.settings?.rowMode === "records";
  const cmpColumns =
    widget.settings?.comparison?.enabled &&
    widget.settings.comparison.tablePlacement === "column";
  const listColumns = widget.settings?.columns ?? [];
  // Métricas do modo registros como alvo (chave sintética compartilhada com o
  // render — MESMO filtro/índice do metricList do RecordListTable). Lista de
  // entidades (rowSource ≠ records) não renderiza métricas.
  const listMetricTargets: ComboboxOption[] =
    isRecordListW && (widget.settings?.rowSource ?? "records") === "records"
      ? (widget.metrics ?? [])
          .filter((m) => m.field)
          .map((m, mi) => ({
            value: recordListMetricKey(m, mi),
            label:
              m.label?.trim() ||
              `${AGG_LABELS[m.agg]} · ${fieldLabel(m.field, available)}`,
          }))
      : [];
  const condTargets: ComboboxOption[] =
    vt === "calculado" || isKpi
      ? [
          { value: "value", label: "Valor do card" },
          ...data.dimensions.map((d) => ({ value: d.key, label: d.label })),
          ...data.metrics.map((m) => ({ value: m.key, label: m.label })),
        ]
      : isRecordListW
        ? [
            ...listColumns.map((c) => ({
              value: c.field,
              label: c.label?.trim() || fieldLabel(c.field, available),
            })),
            ...listMetricTargets,
          ]
        : vt === "tabela" || isChart || isPie
          ? [
              ...data.dimensions.map((d) => ({ value: d.key, label: d.label })),
              ...data.metrics.flatMap((m) => [
                { value: m.key, label: m.label },
                ...(cmpColumns
                  ? [{ value: `${m.key}__var`, label: `Δ ${m.label}` }]
                  : []),
              ]),
            ]
          : [];
  const condNumericTargets: ComboboxOption[] = isRecordListW
    ? [
        ...listColumns
          .filter(
            (c) => available.find((a) => a.field === c.field)?.isNumeric
          )
          .map((c) => ({
            value: c.field,
            label: c.label?.trim() || fieldLabel(c.field, available),
          })),
        ...listMetricTargets,
      ]
    : condTargets.filter(
        (t) => typeof t.value === "string" && t.value.startsWith("metric_")
      );

  const patch = (p: Partial<AppearanceSettings>) =>
    setAp((prev) => ({ ...prev, ...p }));
  // Tamanhos de fonte por elemento (fonts): undefined = Auto (o JSON do save
  // descarta chaves undefined).
  const patchFonts = (
    k: keyof NonNullable<AppearanceSettings["fonts"]>,
    v: number | undefined
  ) => setAp((prev) => ({ ...prev, fonts: { ...prev.fonts, [k]: v } }));
  const fontsCustom = Object.values(ap.fonts ?? {}).some((v) => v != null);
  const patchRecord = (
    field: "seriesColors" | "sliceColors" | "seriesAxis",
    key: string | number,
    value: string | AxisSide | undefined
  ) =>
    setAp((prev) => {
      const next = { ...(prev[field] as Record<string, unknown>) };
      if (value == null || value === "") delete next[key];
      else next[key] = value;
      return { ...prev, [field]: next };
    });
  const patchTable = (p: Partial<NonNullable<AppearanceSettings["table"]>>) =>
    setAp((prev) => ({ ...prev, table: { ...prev.table, ...p } }));

  // Ordenação das categorias/fatias (categorySort) como valor único do select.
  // "Por cor" só é criada nos chips (janela "Por cor") — aqui aparece como
  // opção corrente e é desfeita ao escolher outra.
  const sortChoice = !ap.categorySort
    ? "none"
    : ap.categorySort.dir === "color"
      ? "color"
      : `${ap.categorySort.by === "value" ? "value" : "label"}_${ap.categorySort.dir}`;
  const setSortChoice = (v: string) => {
    if (v === "color") return;
    if (v === "none") {
      patch({ categorySort: undefined });
      return;
    }
    const [by, dir] = v.split("_") as ["label" | "value", "asc" | "desc"];
    // Mutuamente exclusivo com a ordem manual (mesma regra dos chips).
    patch({
      categorySort: {
        dir,
        by,
        metric: by === "value" ? ap.categorySort?.metric : undefined,
      },
      categoryOrder: undefined,
    });
  };
  const sortOptions = [
    { value: "none", label: "Padrão (sem ordenação)" },
    { value: "label_asc", label: "Crescente (A→Z)" },
    { value: "label_desc", label: "Decrescente (Z→A)" },
    { value: "value_desc", label: "Maior → menor (valor)" },
    { value: "value_asc", label: "Menor → maior (valor)" },
    ...(sortChoice === "color"
      ? [{ value: "color", label: "Por cor (definida nos chips)" }]
      : []),
  ];

  function save() {
    const input: WidgetInput = {
      title: widget.title,
      visual_type: widget.visual_type,
      sources: widget.sources,
      splitBySource: widget.split_by_source,
      dimensions: widget.dimensions,
      metrics: widget.metrics,
      filters: widget.filters,
      settings: {
        ...widget.settings,
        appearance: ap,
        // Kanban: aparência dentro de settings.kanban (config preservada).
        ...(isKanban && widget.settings?.kanban
          ? { kanban: { ...widget.settings.kanban, appearance: kap } }
          : {}),
        // Agenda: idem, dentro de settings.agenda (guard p/ widget antigo sem
        // o objeto — a aparência não pode se perder nem apagar a config).
        ...(isAgenda
          ? { agenda: { ...widget.settings?.agenda, appearance: aap } }
          : {}),
        // v2.13: Tabela Livre — exibição/comportamento das metas.
        ...(vt === "tabela_editavel" && widget.settings?.quickTable
          ? {
              quickTable: {
                ...widget.settings.quickTable,
                display: qtDisplayOn ? qtDisplay : undefined,
                goals: Object.keys(qtGoals).length > 0 ? qtGoals : undefined,
              },
            }
          : {}),
        // v2.12: Tree — exibição e canvas dentro de settings.tree.
        ...(isTree && widget.settings?.tree
          ? {
              tree: {
                ...widget.settings.tree,
                presentation: Object.keys(tpres).length > 0 ? tpres : undefined,
                canvas: Object.keys(tcanvas).length > 0 ? tcanvas : undefined,
              },
            }
          : {}),
      },
    };
    // Otimista: fecha o sheet JÁ — o save roda em background (revalidate:
    // false) e o refresh debounced do hook traz a aparência aplicada; erro →
    // toast (a aparência antiga permanece na tela).
    onOpenChange(false);
    backgroundSave({
      key: widget.id,
      context: "Não foi possível salvar a aparência",
      action: () =>
        updateWidget(widget.id, dashboardId, input, { revalidate: false }),
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <ResizableSheetContent
        storageKey="panel-w:widget-appearance"
        defaultWidth={448}
        className="bg-muted overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>Aparência</SheetTitle>
          <SheetDescription>
            {widget.title ?? "Widget"} — ajustes visuais. Reordenar, ordenar e
            colorir colunas/linhas é feito direto na tabela/gráfico
            (arraste/duplo-clique).
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-8">
          {/* Seções recolhíveis: todas abrem fechadas — o usuário expande sob
              demanda; os badges resumem o que está configurado (nada some). */}
          <Accordion type="multiple" className="-mt-2">
          {/* ---------- Kanban (quadro/colunas/cards/abas de visão) ---------- */}
          {isKanban ? (
            <BuilderSection value="kanban" title="Kanban">
              <KanbanAppearanceSection value={kap} onChange={setKap} />
            </BuilderSection>
          ) : null}
          {/* ---------- Agenda (cabeçalho/células/chips) ---------- */}
          {isAgenda ? (
            <BuilderSection value="agenda" title="Agenda">
              <AgendaAppearanceSection value={aap} onChange={setAap} />
            </BuilderSection>
          ) : null}
          {/* ---------- Formatação condicional (valor→estilo + heatmap) ---------- */}
          {condTargets.length > 0 ? (
            <ConditionalFormatSection
              value={ap.conditional}
              onChange={(v) => patch({ conditional: v })}
              targets={condTargets}
              numericTargets={condNumericTargets}
              hasComparison={Boolean(widget.settings?.comparison?.enabled)}
              showScope={vt === "tabela"}
            />
          ) : null}
          {/* ---------- Números (casas decimais do widget inteiro) ---------- */}
          {isTable || isChart || isPie || isKpi || vt === "calculado" ? (
            <BuilderSection
              value="numeros"
              title="Números"
              badge={ap.decimals != null ? String(ap.decimals) : null}
            >
              <p className="text-muted-foreground text-xs">
                Casas decimais de todos os números do widget (tabelas, moeda,
                percentual, rótulos). Nas tabelas dá para refinar por
                coluna/linha/célula com duplo-clique na própria tabela.
              </p>
              <SelectRow
                label="Casas decimais"
                value={ap.decimals != null ? String(ap.decimals) : "auto"}
                onChange={(v) =>
                  patch({ decimals: v === "auto" ? undefined : Number(v) })
                }
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "0", label: "0" },
                  { value: "1", label: "1" },
                  { value: "2", label: "2" },
                  { value: "3", label: "3" },
                  { value: "4", label: "4" },
                ]}
              />
            </BuilderSection>
          ) : null}
          {/* ---------- Texto (tamanho da fonte por elemento) ---------- */}
          {!isShape ? (
            <BuilderSection
              value="texto"
              title="Texto"
              badge={fontsCustom ? "Personalizado" : null}
            >
              <p className="text-muted-foreground text-xs">
                Tamanhos em px. Auto acompanha a escala de fonte do dashboard
                (menu do dashboard ▸ Aparência); um valor fixo não é afetado
                pela escala.
              </p>
              <SelectRow
                label="Título do widget"
                value={fontValue(ap.fonts?.title)}
                onChange={(v) => patchFonts("title", fontPx(v))}
                options={FONT_SIZE_OPTIONS}
              />
              {isKpi || vt === "calculado" ? (
                <SelectRow
                  label="Valor (número grande)"
                  value={fontValue(ap.fonts?.value)}
                  onChange={(v) => patchFonts("value", fontPx(v))}
                  options={FONT_SIZE_OPTIONS}
                />
              ) : null}
              {isKpi ? (
                <SelectRow
                  label="Rótulos"
                  value={fontValue(ap.fonts?.labels)}
                  onChange={(v) => patchFonts("labels", fontPx(v))}
                  options={FONT_SIZE_OPTIONS}
                />
              ) : null}
              {isChart || isPie ? (
                <SelectRow
                  label="Textos do gráfico"
                  value={fontValue(ap.fonts?.chart)}
                  onChange={(v) => patchFonts("chart", fontPx(v))}
                  options={FONT_SIZE_OPTIONS}
                />
              ) : null}
              {isTable ? (
                <SelectRow
                  label="Corpo da tabela"
                  value={fontValue(ap.fonts?.table)}
                  onChange={(v) => patchFonts("table", fontPx(v))}
                  options={FONT_SIZE_OPTIONS}
                />
              ) : null}
            </BuilderSection>
          ) : null}
          {/* ---------- Título e borda (todos os tipos com cromo) ---------- */}
          {!isShape ? (
          <BuilderSection value="titulo" title="Título e borda">
            {/* Some SÓ a barra (borda/corpo ficam); em edição o card ganha
                grip flutuante + ⋮ em hover. Grava só quando true. */}
            <CheckRow
              label="Ocultar barra de título"
              checked={ap.title?.hidden === true}
              onChange={(c) =>
                patch({ title: { ...ap.title, hidden: c ? true : undefined } })
              }
            />
            <ColorField
              label="Cor do texto do título"
              value={ap.title?.color}
              onChange={(v) => patch({ title: { ...ap.title, color: v } })}
              onClear={() => patch({ title: { ...ap.title, color: undefined } })}
            />
            <ColorField
              label="Fundo da barra de título"
              value={ap.title?.bg}
              onChange={(v) => patch({ title: { ...ap.title, bg: v } })}
              onClear={() => patch({ title: { ...ap.title, bg: undefined } })}
            />
            <ColorField
              label="Cor da borda / contorno"
              value={ap.title?.border}
              onChange={(v) => patch({ title: { ...ap.title, border: v } })}
              onClear={() => patch({ title: { ...ap.title, border: undefined } })}
            />
            {/* v2.10: rótulo pequeno em caixa-alta acima do título (só nos
                estilos com título-conclusão). */}
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Kicker (rótulo acima do título)</Label>
              <input
                type="text"
                maxLength={60}
                value={ap.title?.kicker ?? ""}
                placeholder="Ex.: RECEITA"
                onChange={(e) =>
                  patch({
                    title: { ...ap.title, kicker: e.target.value || undefined },
                  })
                }
                className="border-input h-8 rounded-md border bg-transparent px-2 text-xs outline-none"
                aria-label="Kicker"
              />
              <p className="text-muted-foreground text-xs">
                Aparece nos estilos Editorial e Executivo (⋮ do dashboard →
                Estilo e apresentação).
              </p>
            </div>
            {isKpi || isChart ? (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Selo &quot;Nº dia útil&quot;</Label>
                <Select
                  value={
                    ap.hideBusinessDayBadge == null
                      ? "inherit"
                      : ap.hideBusinessDayBadge
                        ? "hide"
                        : "show"
                  }
                  onValueChange={(v) =>
                    patch({
                      hideBusinessDayBadge:
                        v === "inherit" ? undefined : v === "hide",
                    })
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">Padrão do dashboard</SelectItem>
                    <SelectItem value="hide">Ocultar</SelectItem>
                    <SelectItem value="show">Sempre mostrar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </BuilderSection>
          ) : null}

          {/* ---------- Calculadora ---------- */}
          {isCalculator ? (
            <BuilderSection value="calculadora" title="Calculadora">
              <ColorField
                label="Fundo do card"
                value={ap.calculator?.bg}
                onChange={(v) => patch({ calculator: { ...ap.calculator, bg: v } })}
                onClear={() =>
                  patch({ calculator: { ...ap.calculator, bg: undefined } })
                }
              />
              <ColorField
                label="Fundo do visor"
                value={ap.calculator?.displayBg}
                onChange={(v) =>
                  patch({ calculator: { ...ap.calculator, displayBg: v } })
                }
                onClear={() =>
                  patch({ calculator: { ...ap.calculator, displayBg: undefined } })
                }
              />
              <ColorField
                label="Texto do visor"
                value={ap.calculator?.displayText}
                onChange={(v) =>
                  patch({ calculator: { ...ap.calculator, displayText: v } })
                }
                onClear={() =>
                  patch({
                    calculator: { ...ap.calculator, displayText: undefined },
                  })
                }
              />
              <ColorField
                label="Fundo das teclas"
                value={ap.calculator?.keyBg}
                onChange={(v) =>
                  patch({ calculator: { ...ap.calculator, keyBg: v } })
                }
                onClear={() =>
                  patch({ calculator: { ...ap.calculator, keyBg: undefined } })
                }
              />
              <ColorField
                label="Texto das teclas"
                value={ap.calculator?.keyText}
                onChange={(v) =>
                  patch({ calculator: { ...ap.calculator, keyText: v } })
                }
                onClear={() =>
                  patch({ calculator: { ...ap.calculator, keyText: undefined } })
                }
              />
              <ColorField
                label="Fundo das teclas de operação"
                value={ap.calculator?.opKeyBg}
                onChange={(v) =>
                  patch({ calculator: { ...ap.calculator, opKeyBg: v } })
                }
                onClear={() =>
                  patch({ calculator: { ...ap.calculator, opKeyBg: undefined } })
                }
              />
              <ColorField
                label="Texto das teclas de operação"
                value={ap.calculator?.opKeyText}
                onChange={(v) =>
                  patch({ calculator: { ...ap.calculator, opKeyText: v } })
                }
                onClear={() =>
                  patch({ calculator: { ...ap.calculator, opKeyText: undefined } })
                }
              />
            </BuilderSection>
          ) : null}

          {/* ---------- Tree (v2.12) ---------- */}
          {isTree ? (
            <BuilderSection value="tree" title="Tree">
              <p className="text-muted-foreground text-xs">
                Ao apresentar, os cartões mostram só o conteúdo. Marque o que
                deve continuar aparecendo no modo Apresentar (cada cartão
                ainda pode forçar o próprio rótulo de tipo no editor dele).
              </p>
              {(Object.keys(TREE_PRESENTATION_LABELS) as (keyof TreePresentationSettings)[]).map(
                (k) => (
                  <CheckRow
                    key={k}
                    label={TREE_PRESENTATION_LABELS[k]}
                    checked={tpres[k] === true}
                    onChange={(c) =>
                      setTpres((prev) => {
                        const next = { ...prev };
                        if (c) next[k] = true;
                        else delete next[k];
                        return next;
                      })
                    }
                  />
                )
              )}
              <div className="flex flex-col gap-1 pt-2">
                <Label className="text-xs">Trama do fundo (visualização Root)</Label>
                <Select
                  value={tcanvas.pattern ?? "padrao"}
                  onValueChange={(v) =>
                    setTcanvas((prev) => ({
                      ...prev,
                      pattern: v === "padrao" ? undefined : (v as "pontos" | "linhas" | "nenhum"),
                    }))
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="padrao">Padrão do estilo</SelectItem>
                    <SelectItem value="pontos">Pontos</SelectItem>
                    <SelectItem value="linhas">Quadriculado</SelectItem>
                    <SelectItem value="nenhum">Liso</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <ColorField
                label="Cor do fundo (visualização Root)"
                value={tcanvas.bg}
                onChange={(v) => setTcanvas((prev) => ({ ...prev, bg: v }))}
                onClear={() => setTcanvas((prev) => ({ ...prev, bg: undefined }))}
              />
            </BuilderSection>
          ) : null}

          {/* ---------- Nota (post-it) ---------- */}
          {isNote ? (
            <BuilderSection value="nota" title="Nota / texto">
              {/* v2.10: papel do bloco, alinhamento e respiro. */}
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Papel do bloco</Label>
                <Select
                  value={ap.note?.variant ?? "postit"}
                  onValueChange={(v) =>
                    patch({
                      note: {
                        ...ap.note,
                        variant:
                          v === "postit"
                            ? undefined
                            : (v as "texto" | "comentario" | "rodape"),
                      },
                    })
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="postit">Post-it (papel colorido)</SelectItem>
                    <SelectItem value="texto">Texto (sem fundo nem moldura)</SelectItem>
                    <SelectItem value="comentario">Comentário (coluna com filete)</SelectItem>
                    <SelectItem value="rodape">Rodapé (pequeno, filete em cima)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Alinhamento</Label>
                  <Select
                    value={ap.note?.align ?? "left"}
                    onValueChange={(v) =>
                      patch({
                        note: {
                          ...ap.note,
                          align: v === "left" ? undefined : (v as "center" | "right"),
                        },
                      })
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="left">Esquerda</SelectItem>
                      <SelectItem value="center">Centro</SelectItem>
                      <SelectItem value="right">Direita</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Posição vertical</Label>
                  <Select
                    value={ap.note?.valign ?? "top"}
                    onValueChange={(v) =>
                      patch({
                        note: {
                          ...ap.note,
                          valign: v === "top" ? undefined : (v as "center" | "bottom"),
                        },
                      })
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="top">Topo</SelectItem>
                      <SelectItem value="center">Meio</SelectItem>
                      <SelectItem value="bottom">Base</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Respiro interno (px)</Label>
                <input
                  type="number"
                  min={0}
                  max={96}
                  value={ap.note?.padding ?? ""}
                  placeholder="12"
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    patch({
                      note: {
                        ...ap.note,
                        padding:
                          e.target.value === "" || !Number.isFinite(n)
                            ? undefined
                            : Math.max(0, Math.min(96, Math.round(n))),
                      },
                    });
                  }}
                  className="border-input h-8 w-24 rounded-md border bg-transparent px-2 text-xs tabular-nums outline-none"
                  aria-label="Respiro interno"
                />
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Formatação no texto: <code>^^ SEÇÃO</code> (kicker),{" "}
                <code># Título</code>, <code>## Subtítulo</code>,{" "}
                <code>- item</code>, <code>**negrito**</code>,{" "}
                <code>*itálico*</code>, <code>---</code> (filete),{" "}
                <code>[rótulo](https://…)</code> e <code>(( nota do autor ))</code>{" "}
                — esta última só aparece no modo edição.
              </p>
              <ColorField
                label="Fundo do papel"
                value={ap.note?.bg}
                onChange={(v) => patch({ note: { ...ap.note, bg: v } })}
                onClear={() => patch({ note: { ...ap.note, bg: undefined } })}
              />
              <ColorField
                label="Cor do texto"
                value={ap.note?.color}
                onChange={(v) => patch({ note: { ...ap.note, color: v } })}
                onClear={() => patch({ note: { ...ap.note, color: undefined } })}
              />
              <ColorField
                label="Cor dos links"
                value={ap.note?.linkColor}
                onChange={(v) => patch({ note: { ...ap.note, linkColor: v } })}
                onClear={() =>
                  patch({ note: { ...ap.note, linkColor: undefined } })
                }
              />
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Tamanho da fonte (px)</Label>
                <input
                  type="number"
                  min={10}
                  max={48}
                  value={ap.note?.fontSize ?? 14}
                  onChange={(e) =>
                    patch({
                      note: {
                        ...ap.note,
                        fontSize: Number(e.target.value) || undefined,
                      },
                    })
                  }
                  className="border-input h-8 w-24 rounded-md border bg-transparent px-2 text-xs tabular-nums outline-none"
                  aria-label="Tamanho da fonte"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={ap.note?.frameless ?? false}
                  onCheckedChange={(v) =>
                    patch({ note: { ...ap.note, frameless: v === true } })
                  }
                />
                Sem moldura (só o papel)
              </label>
            </BuilderSection>
          ) : null}

          {/* ---------- Forma ---------- */}
          {isShape ? (
            <BuilderSection value="forma" title="Forma">
              {!isLineShape ? (
                <ColorField
                  label="Preenchimento"
                  value={ap.shape?.fill}
                  onChange={(v) => patch({ shape: { ...ap.shape, fill: v } })}
                  onClear={() =>
                    patch({ shape: { ...ap.shape, fill: undefined } })
                  }
                />
              ) : null}
              <ColorField
                label="Contorno"
                value={ap.shape?.stroke}
                onChange={(v) => patch({ shape: { ...ap.shape, stroke: v } })}
                onClear={() =>
                  patch({ shape: { ...ap.shape, stroke: undefined } })
                }
              />
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Espessura do contorno (px)</Label>
                <input
                  type="number"
                  min={0}
                  max={12}
                  value={ap.shape?.strokeWidth ?? 2}
                  onChange={(e) =>
                    patch({
                      shape: {
                        ...ap.shape,
                        strokeWidth: Math.max(0, Number(e.target.value) || 0),
                      },
                    })
                  }
                  className="border-input h-8 w-24 rounded-md border bg-transparent px-2 text-xs tabular-nums outline-none"
                  aria-label="Espessura do contorno"
                />
              </div>
              <ColorField
                label="Cor do texto"
                value={ap.shape?.textColor}
                onChange={(v) => patch({ shape: { ...ap.shape, textColor: v } })}
                onClear={() =>
                  patch({ shape: { ...ap.shape, textColor: undefined } })
                }
              />
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Tamanho da fonte (px)</Label>
                <input
                  type="number"
                  min={10}
                  max={64}
                  value={ap.shape?.fontSize ?? 14}
                  onChange={(e) =>
                    patch({
                      shape: {
                        ...ap.shape,
                        fontSize: Number(e.target.value) || undefined,
                      },
                    })
                  }
                  className="border-input h-8 w-24 rounded-md border bg-transparent px-2 text-xs tabular-nums outline-none"
                  aria-label="Tamanho da fonte da forma"
                />
              </div>
            </BuilderSection>
          ) : null}

          {/* ---------- Gráficos (barra/linha) ---------- */}
          {isChart ? (
            <>
              <BuilderSection value="grafico" title="Gráfico">
                <ColorField
                  label="Fundo do gráfico"
                  value={ap.chartBackground}
                  onChange={(v) => patch({ chartBackground: v })}
                  onClear={() => patch({ chartBackground: undefined })}
                />
                <SelectRow
                  label="Linhas de grade"
                  value={ap.gridLines ?? "default"}
                  onChange={(v) =>
                    patch({ gridLines: v === "default" ? undefined : (v as GridLines) })
                  }
                  options={[
                    { value: "default", label: "Padrão" },
                    { value: "none", label: "Nenhuma" },
                    { value: "horizontal", label: "Horizontais" },
                    { value: "vertical", label: "Verticais" },
                    { value: "both", label: "Ambas" },
                  ]}
                />
                <SelectRow
                  label="Margem interna do gráfico"
                  value={
                    ap.chartInset != null ? String(ap.chartInset) : "auto"
                  }
                  onChange={(v) =>
                    patch({
                      chartInset: v === "auto" ? undefined : Number(v),
                    })
                  }
                  options={[
                    { value: "auto", label: "Auto" },
                    ...[4, 8, 12, 16, 24, 32].map((n) => ({
                      value: String(n),
                      label: `${n} px`,
                    })),
                  ]}
                />
                {isBar ? (
                  <>
                    <SelectRow
                      label="Preenchimento das barras"
                      value={ap.fillMode ?? "solid"}
                      onChange={(v) => patch({ fillMode: v as "solid" | "gradient" })}
                      options={[
                        { value: "solid", label: "Sólido" },
                        { value: "gradient", label: "Gradiente (sutil)" },
                      ]}
                    />
                    <SelectRow
                      label="Espessura das barras"
                      value={
                        ap.barFillPct != null ? String(ap.barFillPct) : "auto"
                      }
                      onChange={(v) =>
                        patch({
                          barFillPct: v === "auto" ? undefined : Number(v),
                        })
                      }
                      options={[
                        { value: "auto", label: "Auto" },
                        ...[30, 40, 50, 60, 70, 80, 90, 100].map((n) => ({
                          value: String(n),
                          label: `${n}%`,
                        })),
                      ]}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-xs">
                        Limite de categorias (Top-N)
                      </Label>
                      <Input
                        type="number"
                        min={1}
                        className="h-8 w-20"
                        value={ap.categoryLimit?.n ?? ""}
                        placeholder="—"
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          patch({
                            categoryLimit:
                              e.target.value === "" || !Number.isFinite(n)
                                ? undefined
                                : { ...ap.categoryLimit, n: Math.max(1, n) },
                          });
                        }}
                      />
                    </div>
                    {ap.categoryLimit?.n != null ? (
                      <CheckRow
                        label={'Agrupar o resto em "Outros"'}
                        checked={ap.categoryLimit?.others ?? true}
                        onChange={(c) =>
                          patch({
                            categoryLimit: { ...ap.categoryLimit, others: c },
                          })
                        }
                      />
                    ) : null}
                    {metrics.length >= 2 ? (
                      <CheckRow
                        label="Empilhar as séries (barras empilhadas)"
                        checked={ap.stacked ?? false}
                        onChange={(c) =>
                          patch({ stacked: c ? true : undefined })
                        }
                      />
                    ) : null}
                  </>
                ) : null}
                {isBar && metrics.length === 1 ? (
                  <>
                    <CheckRow
                      label="Colorir barras por categoria (paleta)"
                      checked={ap.colorByCategory ?? false}
                      onChange={(c) =>
                        patch({ colorByCategory: c ? true : undefined })
                      }
                    />
                    {ap.colorByCategory ? (
                      <SelectRow
                        label="Paleta"
                        value={ap.palette ?? "design"}
                        onChange={(v) => patch({ palette: v })}
                        options={Object.entries(PALETTES).map(([k, p]) => ({
                          value: k,
                          label: p.label,
                        }))}
                      />
                    ) : null}
                  </>
                ) : null}
                {isBar && !dimChrono ? (
                  <>
                    <SelectRow
                      label="Ordenação das categorias"
                      value={sortChoice}
                      onChange={setSortChoice}
                      options={sortOptions}
                    />
                    {metrics.length >= 2 && sortChoice.startsWith("value") ? (
                      <SelectRow
                        label="Métrica da ordenação"
                        value={ap.categorySort?.metric ?? metrics[0].key}
                        onChange={(v) =>
                          patch({
                            categorySort: ap.categorySort
                              ? { ...ap.categorySort, metric: v }
                              : ap.categorySort,
                          })
                        }
                        options={metrics.map((m) => ({
                          value: m.key,
                          label: m.label,
                        }))}
                      />
                    ) : null}
                  </>
                ) : null}
              </BuilderSection>

              <BuilderSection value="series" title="Cores das séries">
                {/* v2.10: técnica do destaque — uma série na cor do estilo,
                    as demais em cinza. */}
                {metrics.length >= 2 ? (
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Destacar uma série</Label>
                    <Select
                      value={ap.highlight?.series ?? "__none__"}
                      onValueChange={(v) =>
                        patch({
                          highlight:
                            v === "__none__"
                              ? undefined
                              : { ...ap.highlight, series: v, categories: undefined },
                        })
                      }
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Nenhuma (cores normais)</SelectItem>
                        {metrics.map((m) => (
                          <SelectItem key={m.key} value={m.key}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-muted-foreground text-xs">
                      As outras séries ficam em cinza — o olhar vai para a que
                      sustenta a conclusão.
                    </p>
                  </div>
                ) : null}
                {metrics.map((m) => (
                  <ColorField
                    key={m.key}
                    label={m.label}
                    value={ap.seriesColors?.[m.key]}
                    onChange={(v) => patchRecord("seriesColors", m.key, v)}
                    onClear={() => patchRecord("seriesColors", m.key, undefined)}
                  />
                ))}
                {isBar ? (
                  <p className="text-muted-foreground text-xs">
                    Dica: para colorir barras individuais, dê duplo-clique na
                    categoria (chips acima do gráfico).
                  </p>
                ) : null}
              </BuilderSection>

              {/* v2.11: o que guia o olhar no slide — destaque de categorias,
                  anotações, rótulo direto e área. */}
              <BuilderSection value="destaque" title="Destaque e anotações">
                {metrics.length === 1 && catOptions.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Destacar categorias</Label>
                    <div className="flex max-h-32 flex-wrap gap-x-3 gap-y-1 overflow-y-auto">
                      {catOptions.map((c) => (
                        <CheckRow
                          key={c}
                          label={c}
                          checked={ap.highlight?.categories?.includes(c) ?? false}
                          onChange={(on) => {
                            const cur = new Set(ap.highlight?.categories ?? []);
                            if (on) cur.add(c);
                            else cur.delete(c);
                            patch({
                              highlight:
                                cur.size > 0
                                  ? { categories: [...cur] }
                                  : undefined,
                            });
                          }}
                        />
                      ))}
                    </div>
                    <p className="text-muted-foreground text-xs">
                      As demais barras ficam em cinza.
                    </p>
                  </div>
                ) : null}
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">Anotações</Label>
                  {(ap.annotations ?? []).map((a, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <Select
                        value={a.x}
                        onValueChange={(x) =>
                          patch({
                            annotations: (ap.annotations ?? []).map((it, j) =>
                              j === i ? { ...it, x } : it
                            ),
                          })
                        }
                      >
                        <SelectTrigger className="h-8 w-32 shrink-0">
                          <SelectValue placeholder="Ponto" />
                        </SelectTrigger>
                        <SelectContent>
                          {catOptions.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <input
                        type="text"
                        maxLength={60}
                        value={a.text}
                        placeholder="Ex.: Greve de transportes"
                        onChange={(e) =>
                          patch({
                            annotations: (ap.annotations ?? []).map((it, j) =>
                              j === i ? { ...it, text: e.target.value } : it
                            ),
                          })
                        }
                        className="border-input h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-xs outline-none"
                        aria-label="Texto da anotação"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        aria-label="Remover anotação"
                        onClick={() => {
                          const next = (ap.annotations ?? []).filter((_, j) => j !== i);
                          patch({ annotations: next.length > 0 ? next : undefined });
                        }}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                  {catOptions.length > 0 && (ap.annotations?.length ?? 0) < 6 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 self-start text-xs"
                      onClick={() =>
                        patch({
                          annotations: [
                            ...(ap.annotations ?? []),
                            { x: catOptions[catOptions.length - 1], text: "" },
                          ],
                        })
                      }
                    >
                      Adicionar anotação
                    </Button>
                  ) : null}
                  <p className="text-muted-foreground text-xs">
                    Um texto curto com um filete até o ponto que explica a
                    conclusão.
                  </p>
                </div>
                {vt === "linha" ? (
                  <>
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs">Nomes das séries</Label>
                      <Select
                        value={ap.legendMode ?? "auto"}
                        onValueChange={(v) =>
                          patch({
                            legendMode:
                              v === "auto" ? undefined : (v as "legenda" | "direto"),
                          })
                        }
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Padrão do estilo</SelectItem>
                          <SelectItem value="direto">
                            Rótulo direto no fim de cada linha
                          </SelectItem>
                          <SelectItem value="legenda">Legenda</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <CheckRow
                      label="Preencher a área sob a linha"
                      checked={ap.area === true}
                      onChange={(c) => patch({ area: c ? true : undefined })}
                    />
                  </>
                ) : null}
              </BuilderSection>

              {metrics.length >= 2 ? (
                <BuilderSection value="eixos" title="Eixo por série (combo)">
                  {metrics.map((m) => (
                    <SelectRow
                      key={m.key}
                      label={m.label}
                      value={ap.seriesAxis?.[m.key] ?? "left"}
                      onChange={(v) => patchRecord("seriesAxis", m.key, v as AxisSide)}
                      options={[
                        { value: "left", label: "Esquerda" },
                        { value: "right", label: "Direita" },
                      ]}
                    />
                  ))}
                </BuilderSection>
              ) : null}

              <DataLabelsSection vt={vt} ap={ap} patch={patch} />

              <BuilderSection
                value="legenda"
                title="Legenda do gráfico (séries)"
                badge={(ap.legend?.show ?? metrics.length > 1) ? "Ativa" : null}
              >
                <CheckRow
                  label="Exibir legenda"
                  checked={ap.legend?.show ?? metrics.length > 1}
                  onChange={(c) => patch({ legend: { ...ap.legend, show: c } })}
                />
                <ColorField
                  label="Cor do texto da legenda"
                  value={ap.legend?.color}
                  onChange={(v) => patch({ legend: { ...ap.legend, color: v } })}
                />
              </BuilderSection>
            </>
          ) : null}

          {/* ---------- Pizza / Funil ---------- */}
          {isPie ? (
            <>
              <BuilderSection value="pizza" title="Paleta e preenchimento">
                <SelectRow
                  label="Paleta"
                  value={ap.palette ?? "design"}
                  onChange={(v) => patch({ palette: v })}
                  options={Object.entries(PALETTES).map(([k, p]) => ({
                    value: k,
                    label: p.label,
                  }))}
                />
                <SelectRow
                  label="Preenchimento"
                  value={ap.fillMode ?? "solid"}
                  onChange={(v) => patch({ fillMode: v as "solid" | "gradient" })}
                  options={[
                    { value: "solid", label: "Sólido" },
                    { value: "gradient", label: "Gradiente (sutil)" },
                  ]}
                />
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">
                    Limite de fatias (Top-N; padrão 5)
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    className="h-8 w-20"
                    value={ap.categoryLimit?.n ?? ""}
                    placeholder="5"
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      patch({
                        categoryLimit:
                          e.target.value === "" || !Number.isFinite(n)
                            ? undefined
                            : { ...ap.categoryLimit, n: Math.max(1, n) },
                      });
                    }}
                  />
                </div>
                {ap.categoryLimit?.n != null ? (
                  <CheckRow
                    label={'Agrupar o resto em "Outros"'}
                    checked={ap.categoryLimit?.others ?? true}
                    onChange={(c) =>
                      patch({
                        categoryLimit: { ...ap.categoryLimit, others: c },
                      })
                    }
                  />
                ) : null}
                {!dimChrono ? (
                  <SelectRow
                    label="Ordenação das fatias"
                    value={sortChoice === "color" ? "none" : sortChoice}
                    onChange={setSortChoice}
                    options={sortOptions.filter((o) => o.value !== "color")}
                  />
                ) : null}
              </BuilderSection>
              <DataLabelsSection vt={vt} ap={ap} patch={patch} />
              {vt === "pizza" ? (
                // Legenda da pizza: default LIGADA (?? true) — pizzas
                // existentes sempre exibiram a legenda (era fixa no chart).
                <BuilderSection
                  value="legenda"
                  title="Legenda do gráfico (fatias)"
                  badge={(ap.legend?.show ?? true) ? "Ativa" : null}
                >
                  <CheckRow
                    label="Exibir legenda"
                    checked={ap.legend?.show ?? true}
                    onChange={(c) =>
                      patch({ legend: { ...ap.legend, show: c } })
                    }
                  />
                  <ColorField
                    label="Cor do texto da legenda"
                    value={ap.legend?.color}
                    onChange={(v) => patch({ legend: { ...ap.legend, color: v } })}
                  />
                </BuilderSection>
              ) : null}
              <BuilderSection value="fatias" title="Cor por fatia">
                {slices.map((s, i) => (
                  <ColorField
                    key={i}
                    label={s.name}
                    value={ap.sliceColors?.[i]}
                    onChange={(v) => patchRecord("sliceColors", i, v)}
                    onClear={() => patchRecord("sliceColors", i, undefined)}
                  />
                ))}
              </BuilderSection>
            </>
          ) : null}

          {/* ---------- Tabela (cores globais + grade) ---------- */}
          {isTable ? (
            <>
              <BuilderSection value="cores" title="Cores globais">
                <ColorField
                  label="Fundo do cabeçalho"
                  value={ap.table?.headerBg}
                  onChange={(v) => patchTable({ headerBg: v })}
                  onClear={() => patchTable({ headerBg: undefined })}
                />
                <ColorField
                  label="Texto do cabeçalho"
                  value={ap.table?.headerColor}
                  onChange={(v) => patchTable({ headerColor: v })}
                  onClear={() => patchTable({ headerColor: undefined })}
                />
                <ColorField
                  label="Fundo do corpo"
                  value={ap.table?.bodyBg}
                  onChange={(v) => patchTable({ bodyBg: v })}
                  onClear={() => patchTable({ bodyBg: undefined })}
                />
                <ColorField
                  label="Texto do corpo"
                  value={ap.table?.bodyColor}
                  onChange={(v) => patchTable({ bodyColor: v })}
                  onClear={() => patchTable({ bodyColor: undefined })}
                />
                <ColorField
                  label="Bordas"
                  value={ap.table?.borderColor}
                  onChange={(v) => patchTable({ borderColor: v })}
                  onClear={() => patchTable({ borderColor: undefined })}
                />
              </BuilderSection>
              <BuilderSection value="grade" title="Grade e texto">
                <SelectRow
                  label="Linhas de grade"
                  value={ap.table?.gridLines ?? "both"}
                  onChange={(v) => patchTable({ gridLines: v as GridLines })}
                  options={[
                    { value: "both", label: "Ambas" },
                    { value: "horizontal", label: "Horizontais" },
                    { value: "vertical", label: "Verticais" },
                    { value: "none", label: "Nenhuma" },
                  ]}
                />
                <SelectRow
                  label="Texto que excede a célula"
                  value={ap.table?.cellText ?? "clip"}
                  onChange={(v) =>
                    patchTable({ cellText: v as "clip" | "wrap" })
                  }
                  options={[
                    { value: "clip", label: "Cortar (…)" },
                    { value: "wrap", label: "Quebrar linha" },
                  ]}
                />
                <SelectRow
                  label="Alinhamento das colunas"
                  value={ap.table?.align ?? "default"}
                  onChange={(v) =>
                    patchTable({
                      align: v === "default" ? undefined : (v as TableAlign),
                    })
                  }
                  options={[
                    { value: "default", label: "Padrão" },
                    { value: "left", label: "Esquerda" },
                    { value: "center", label: "Centro" },
                    { value: "right", label: "Direita" },
                  ]}
                />
                {isQuickTable ? (
                  <>
                    <CheckRow
                      label="Barra de fórmula e régua A/B/C"
                      checked={ap.table?.formulaBar !== false}
                      onChange={(c) =>
                        patchTable({ formulaBar: c ? undefined : false })
                      }
                    />
                    <p className="text-muted-foreground text-xs">
                      A barra mostra o endereço e a fórmula da célula
                      selecionada; a régua exibe as letras/números usados nas
                      contas (=A1+B2). Desligue em tabelas usadas só como
                      layout.
                    </p>
                  </>
                ) : null}
                <p className="text-muted-foreground text-xs">
                  Reordenar colunas/linhas, ordenar e colorir coluna/linha/célula:
                  arraste a alça ou dê duplo-clique direto na tabela.
                </p>
              </BuilderSection>
              {/* v2.13: metas da Tabela Livre. */}
              {isQuickTable ? (
                <BuilderSection value="metas" title="Metas">
                  {!qtHasGoals ? (
                    <p className="text-muted-foreground text-xs">
                      Para mostrar metas, em Editar layout configure uma coluna
                      como “Metas por mês” e ligue as linhas a indicadores (⚙
                      da linha).
                    </p>
                  ) : null}
                  <CheckRow
                    label="Visual de tabela de slide (fora do Editar layout)"
                    checked={qtDisplayOn}
                    onChange={setQtDisplayOn}
                  />
                  {qtDisplayOn ? (
                    <>
                      <SelectRow
                        label="Densidade"
                        value={qtDisplay.density ?? "padrao"}
                        onChange={(v) =>
                          setQtDisplay((d) => ({
                            ...d,
                            density: v === "padrao" ? undefined : (v as QuickTableGoalDisplay["density"]),
                          }))
                        }
                        options={[
                          { value: "padrao", label: "Padrão do estilo" },
                          { value: "preencher", label: "Preencher o card" },
                          { value: "confortavel", label: "Confortável" },
                          { value: "compacta", label: "Compacta" },
                        ]}
                      />
                      <SelectRow
                        label="Atingimento"
                        value={qtDisplay.attainmentStyle ?? "padrao"}
                        onChange={(v) =>
                          setQtDisplay((d) => ({
                            ...d,
                            attainmentStyle:
                              v === "padrao" ? undefined : (v as QuickTableGoalDisplay["attainmentStyle"]),
                          }))
                        }
                        options={[
                          { value: "padrao", label: "Padrão do estilo" },
                          { value: "pilula", label: "Pílula colorida" },
                          { value: "texto", label: "Texto" },
                          { value: "barra", label: "Barrinha" },
                        ]}
                      />
                      <SelectRow
                        label="Mês sem realizado"
                        value={qtDisplay.emptyRealized ?? "padrao"}
                        onChange={(v) =>
                          setQtDisplay((d) => ({
                            ...d,
                            emptyRealized:
                              v === "padrao" ? undefined : (v as QuickTableGoalDisplay["emptyRealized"]),
                          }))
                        }
                        options={[
                          { value: "padrao", label: "Padrão do estilo" },
                          { value: "zero", label: "Zero (R$ 0 · 0%)" },
                          { value: "traco", label: "Traço (—)" },
                        ]}
                      />
                      <SelectRow
                        label="Unidade"
                        value={qtDisplay.unitPlacement ?? "padrao"}
                        onChange={(v) =>
                          setQtDisplay((d) => ({
                            ...d,
                            unitPlacement:
                              v === "padrao" ? undefined : (v as QuickTableGoalDisplay["unitPlacement"]),
                          }))
                        }
                        options={[
                          { value: "padrao", label: "Padrão do estilo" },
                          { value: "celula", label: "Em cada célula" },
                          { value: "rotulo", label: "Só no rótulo" },
                        ]}
                      />
                      <SelectRow
                        label="Etiqueta da linha"
                        value={qtDisplay.levelTags == null ? "padrao" : qtDisplay.levelTags ? "discreta" : "texto"}
                        onChange={(v) =>
                          setQtDisplay((d) => ({
                            ...d,
                            levelTags: v === "padrao" ? undefined : v === "discreta",
                          }))
                        }
                        options={[
                          { value: "padrao", label: "Padrão do estilo" },
                          { value: "discreta", label: "Discreta (à parte)" },
                          { value: "texto", label: "Como texto do rótulo" },
                        ]}
                      />
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs">Nota de rodapé</Label>
                        <Input
                          className="h-8 text-sm"
                          value={qtDisplay.note ?? ""}
                          onChange={(e) =>
                            setQtDisplay((d) => ({ ...d, note: e.target.value || undefined }))
                          }
                          placeholder="Regra de cálculo, donos…"
                        />
                      </div>
                    </>
                  ) : null}
                  <CheckRow
                    label="Mostrar o realizado sob a meta"
                    checked={qtGoals.showRealized !== false}
                    onChange={(c) => setQtGoals((g) => ({ ...g, showRealized: c ? undefined : false }))}
                  />
                  <CheckRow
                    label="Mostrar o atingimento"
                    checked={qtGoals.showAttainment !== false}
                    onChange={(c) => setQtGoals((g) => ({ ...g, showAttainment: c ? undefined : false }))}
                  />
                  <CheckRow
                    label="Administrador edita a meta na célula"
                    checked={qtGoals.editable === true}
                    onChange={(c) => setQtGoals((g) => ({ ...g, editable: c ? true : undefined }))}
                  />
                </BuilderSection>
              ) : null}
            </>
          ) : null}

          {/* ---------- KPI ---------- */}
          {isKpi ? (
            <BuilderSection value="kpi" title="Card">
              {/* v2.11: número em escala ("4,2 mi") — o número-herói. */}
              <CheckRow
                label="Número em escala (4,2 mi · 830 mil)"
                checked={ap.kpiCompact === true}
                onChange={(c) => patch({ kpiCompact: c ? true : undefined })}
              />
              <ColorField
                label="Fundo"
                value={ap.kpi?.bg}
                onChange={(v) => patch({ kpi: { ...ap.kpi, bg: v } })}
                onClear={() => patch({ kpi: { ...ap.kpi, bg: undefined } })}
              />
              <ColorField
                label="Borda"
                value={ap.kpi?.border}
                onChange={(v) => patch({ kpi: { ...ap.kpi, border: v } })}
                onClear={() => patch({ kpi: { ...ap.kpi, border: undefined } })}
              />
              <ColorField
                label="Cor de destaque (abinha)"
                value={ap.kpi?.accent}
                onChange={(v) => patch({ kpi: { ...ap.kpi, accent: v } })}
                onClear={() => patch({ kpi: { ...ap.kpi, accent: undefined } })}
              />
            </BuilderSection>
          ) : null}

          {/* ---------- Filtros (filtro / filtro_campo) ---------- */}
          {isFilter ? (
            <BuilderSection value="filtro" title="Filtro">
              <ColorField
                label="Fundo"
                value={ap.filter?.bg}
                onChange={(v) => patch({ filter: { ...ap.filter, bg: v } })}
                onClear={() =>
                  patch({ filter: { ...ap.filter, bg: undefined } })
                }
              />
              <ColorField
                label="Borda"
                value={ap.filter?.border}
                onChange={(v) => patch({ filter: { ...ap.filter, border: v } })}
                onClear={() =>
                  patch({ filter: { ...ap.filter, border: undefined } })
                }
              />
              <ColorField
                label="Cor de destaque (abinha)"
                value={ap.filter?.accent}
                onChange={(v) => patch({ filter: { ...ap.filter, accent: v } })}
                onClear={() =>
                  patch({ filter: { ...ap.filter, accent: undefined } })
                }
              />
            </BuilderSection>
          ) : null}
          </Accordion>

          <Button onClick={save}>Aplicar</Button>
        </div>
      </ResizableSheetContent>
    </Sheet>
  );
}

// Seção "Legenda de dados" (rótulos de valores) — compartilhada pelos blocos
// de barra/linha (isChart) e pizza/funil (isPie). Opções de posição por tipo
// de gráfico; funil posiciona sempre ao centro (sem select). Valor de posição
// salvo em outro tipo (ex.: "inside" da barra numa linha) exibe o fallback
// "top" — o chart aplica a mesma coerção.
function DataLabelsSection({
  vt,
  ap,
  patch,
}: {
  vt: string;
  ap: AppearanceSettings;
  patch: (p: Partial<AppearanceSettings>) => void;
}) {
  const dl = ap.dataLabels;
  const isBar = vt === "barra" || vt === "barra_horizontal";
  // Modo "total" (só barras): um único rótulo com a SOMA da barra empilhada;
  // a posição é ignorada nele (a soma fica sempre fora da pilha).
  const totalMode = isBar && (dl?.mode ?? "detailed") === "total";
  const positions =
    vt === "linha"
      ? [
          { value: "top", label: "Acima" },
          { value: "bottom", label: "Abaixo" },
        ]
      : vt === "pizza"
        ? [
            { value: "top", label: "Fora" },
            { value: "inside", label: "Dentro" },
          ]
        : vt === "funil"
          ? null
          : vt === "barra_horizontal"
            ? // Na horizontal o rótulo "top" renderiza à DIREITA da barra —
              // o wording certo é "Fora" ("Acima" é coisa de barra vertical).
              [
                { value: "top", label: "Fora" },
                { value: "inside", label: "Dentro" },
              ]
            : [
                { value: "top", label: "Acima" },
                { value: "inside", label: "Dentro" },
              ];
  const position = dl?.position ?? "top";
  return (
    <BuilderSection
      value="rotulos"
      title="Legenda de dados (rótulos de valores)"
      badge={dl?.show ? "Ativos" : null}
    >
      <CheckRow
        label="Exibir valores"
        checked={dl?.show ?? false}
        onChange={(c) => patch({ dataLabels: { ...dl, show: c } })}
      />
      {dl?.show ? (
        <>
          {isBar ? (
            <SelectRow
              label="Modo (barras empilhadas)"
              value={dl?.mode ?? "detailed"}
              onChange={(v) =>
                patch({
                  dataLabels: {
                    ...dl,
                    mode: v as "detailed" | "total",
                  },
                })
              }
              options={[
                { value: "detailed", label: "Detalhado (por segmento)" },
                { value: "total", label: "Total da barra (soma)" },
              ]}
            />
          ) : null}
          <SelectRow
            label="Formato"
            value={dl?.format ?? "value"}
            onChange={(v) =>
              patch({
                dataLabels: {
                  ...dl,
                  format: v as "value" | "percent" | "both",
                },
              })
            }
            options={[
              { value: "value", label: "Valor" },
              { value: "percent", label: "Percentual" },
              { value: "both", label: "Valor + percentual" },
            ]}
          />
          {positions && !totalMode ? (
            <SelectRow
              label="Posição"
              value={
                positions.some((o) => o.value === position) ? position : "top"
              }
              onChange={(v) =>
                patch({
                  dataLabels: {
                    ...dl,
                    position: v as "inside" | "top" | "bottom",
                  },
                })
              }
              options={positions}
            />
          ) : null}
          {vt === "barra_horizontal" && positions && !totalMode ? (
            <p className="text-muted-foreground text-xs">
              Dentro: rótulo que não couber na barra aparece automaticamente
              fora.
            </p>
          ) : null}
          <ColorField
            label="Cor do rótulo"
            value={dl?.color}
            onChange={(v) => patch({ dataLabels: { ...dl, color: v } })}
          />
        </>
      ) : null}
    </BuilderSection>
  );
}

function SelectRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (c: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <Checkbox checked={checked} onCheckedChange={(c) => onChange(c === true)} />
      {label}
    </label>
  );
}

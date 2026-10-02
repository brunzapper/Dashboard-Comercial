"use client";
// Versão: 1.2 | Data: 02/10/2026
// v1.2 (02/10/2026): o que só o preset sabia configurar ganhou controle aqui —
//   (a) TODAS as abas listadas, com "Incluir na apresentação"
//   (presentation.hiddenTabs) e "Fundo da aba" (tabs[].background, a capa
//   escura); (b) cores de papel/superfície/tinta do estilo (style.overrides —
//   antes o save as APAGAVA quando vinham do JSON); (c) data fixa do topo do
//   slide (slide.date); (d) a headline aceita {= … } para números vivos.
// v1.1 (02/10/2026): seção "Esqueleto de slide" — rótulo da seção, rodapé,
//   data, nº do slide e o título-conclusão/kicker por aba-slide (tabs preservam
//   id/nome/cor/fundo).
// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): ⋮ → "Estilo e apresentação". Escolhe o ESTILO do board
//   (lib/dashboards/style.ts) — ou volta a herdar o padrão da organização —,
//   ajusta os poucos overrides permitidos (destaque e par de fontes) e o
//   comportamento do modo Apresentar (palco 16:9 × só altura; entrada suave).
//   Opt-in total e reversível: o estilo é só leitura de tokens, então trocar de
//   volta para o Clássico devolve o visual de antes sem perder nada.
import { useState, useTransition } from "react";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ResizableSheetContent } from "@/components/ui/resizable-sheet-content";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ColorField } from "./appearance-controls";
import {
  DASHBOARD_FONTS,
  DASHBOARD_STYLES,
  DASHBOARD_STYLE_KEYS,
  isDashboardFontKey,
  isDashboardStyleKey,
  normalizeDashboardStyleSetting,
  type DashboardFontKey,
  type DashboardStyleDef,
  type DashboardStyleKey,
} from "@/lib/dashboards/style";
import type { DashboardSettings } from "@/lib/widgets/types";
import { updateDashboardSettings } from "@/app/(app)/dashboards/actions";

const INHERIT = "__org__";
const AUTO = "__auto__";

const HEX = /^#[0-9a-f]{6}$/i;

export function DashboardStyleSheet({
  open,
  onOpenChange,
  dashboardId,
  settings,
  orgStyleKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboardId: string;
  settings: DashboardSettings;
  orgStyleKey?: string | null;
}) {
  const current = normalizeDashboardStyleSetting(settings.style);
  const orgKey: DashboardStyleKey = isDashboardStyleKey(orgStyleKey)
    ? orgStyleKey
    : "classico";
  const [choice, setChoice] = useState<string>(current?.key ?? INHERIT);
  const [accent, setAccent] = useState<string>(
    current?.overrides?.accent ?? ""
  );
  const [fontDisplay, setFontDisplay] = useState<string>(
    current?.overrides?.fontDisplay ?? AUTO
  );
  const [fontBody, setFontBody] = useState<string>(
    current?.overrides?.fontBody ?? AUTO
  );
  const [fit, setFit] = useState<string>(settings.presentation?.fit ?? AUTO);
  const [transition, setTransition] = useState<string>(
    settings.presentation?.transition ?? AUTO
  );
  // v1.1: esqueleto de slide (dashboard) + headline/kicker por aba.
  const [slideKicker, setSlideKicker] = useState(settings.slide?.kicker ?? "");
  const [slideFooter, setSlideFooter] = useState(settings.slide?.footer ?? "");
  const [slideDate, setSlideDate] = useState(settings.slide?.showDate === true);
  const [slideNumber, setSlideNumber] = useState(settings.slide?.showNumber === true);
  // v1.2: data fixa do topo (vazio = hoje).
  const [slideDateFixed, setSlideDateFixed] = useState(settings.slide?.date ?? "");
  // v1.2: cores do estilo (vazio = a do estilo).
  const [page, setPage] = useState(current?.overrides?.page ?? "");
  const [surface, setSurface] = useState(current?.overrides?.surface ?? "");
  const [ink, setInk] = useState(current?.overrides?.ink ?? "");
  // v1.2: abas fora da apresentação e fundo próprio por aba.
  const [hiddenTabs, setHiddenTabs] = useState<Set<string>>(
    () => new Set(settings.presentation?.hiddenTabs ?? [])
  );
  const [tabBg, setTabBg] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (settings.tabs ?? []).flatMap((t) =>
        t.background?.mode === "solid" && t.background.color
          ? [[t.id, t.background.color]]
          : []
      )
    )
  );
  const allTabs = settings.tabs ?? [];
  const [tabText, setTabText] = useState<
    Record<string, { headline: string; kicker: string; noFrame: boolean }>
  >(() =>
    Object.fromEntries(
      (settings.tabs ?? []).map((t) => [
        t.id,
        { headline: t.headline ?? "", kicker: t.kicker ?? "", noFrame: t.frame === false },
      ])
    )
  );
  const [pending, startTransition] = useTransition();

  const effectiveKey: DashboardStyleKey =
    choice === INHERIT || !isDashboardStyleKey(choice) ? orgKey : choice;
  const effective = DASHBOARD_STYLES[effectiveKey];
  const ownChoice = choice !== INHERIT && isDashboardStyleKey(choice);

  function save() {
    let style: DashboardSettings["style"] = undefined;
    if (ownChoice) {
      const overrides: NonNullable<DashboardSettings["style"]>["overrides"] = {};
      if (effective.colors && /^#[0-9a-f]{6}$/i.test(accent)) {
        overrides.accent = accent.toLowerCase();
      }
      // v1.2: papel/superfície/tinta — antes o save as descartava.
      if (effective.colors && HEX.test(page)) overrides.page = page.toLowerCase();
      if (effective.colors && HEX.test(surface)) overrides.surface = surface.toLowerCase();
      if (effective.colors && HEX.test(ink)) overrides.ink = ink.toLowerCase();
      if (isDashboardFontKey(fontDisplay)) overrides.fontDisplay = fontDisplay;
      if (isDashboardFontKey(fontBody)) overrides.fontBody = fontBody;
      style = {
        key: choice as DashboardStyleKey,
        ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
      };
    }
    const hiddenList = allTabs.map((t) => t.id).filter((id) => hiddenTabs.has(id));
    const presentation: DashboardSettings["presentation"] = {
      ...settings.presentation,
      hiddenTabs: hiddenList.length > 0 ? hiddenList : undefined,
      fit: fit === "palco" || fit === "altura" ? fit : undefined,
      transition:
        transition === "suave" || transition === "nenhuma"
          ? transition
          : undefined,
    };
    const slide: DashboardSettings["slide"] = {
      ...(slideKicker.trim() ? { kicker: slideKicker.trim() } : {}),
      ...(slideFooter.trim() ? { footer: slideFooter.trim() } : {}),
      ...(slideDate ? { showDate: true } : {}),
      ...(slideNumber ? { showNumber: true } : {}),
      ...(/^\d{4}-\d{2}-\d{2}$/.test(slideDateFixed) ? { date: slideDateFixed } : {}),
    };
    // Abas: headline/kicker/esqueleto e (v1.2) fundo mudam — id, nome e cor
    // são preservados. Fundo em gradiente vindo do JSON segue intocado
    // enquanto a cor sólida não é editada aqui.
    const tabsNext = settings.tabs?.map((t) => {
      const txt = tabText[t.id];
      const { headline: _h, kicker: _k, frame: _f, background: bg, ...rest } = t;
      void _h;
      void _k;
      void _f;
      const solid = tabBg[t.id];
      const background =
        solid && HEX.test(solid)
          ? { mode: "solid" as const, color: solid.toLowerCase() }
          : bg?.mode === "gradient"
            ? bg
            : undefined;
      return {
        ...rest,
        ...(background ? { background } : {}),
        ...(txt?.headline.trim() ? { headline: txt.headline.trim() } : {}),
        ...(txt?.kicker.trim() ? { kicker: txt.kicker.trim() } : {}),
        ...(txt?.noFrame ? { frame: false } : {}),
      };
    });
    startTransition(async () => {
      await updateDashboardSettings(dashboardId, {
        ...settings,
        style,
        presentation,
        slide: Object.keys(slide).length > 0 ? slide : undefined,
        ...(tabsNext ? { tabs: tabsNext } : {}),
      });
      onOpenChange(false);
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <ResizableSheetContent
        storageKey="panel-w:dashboard-style"
        defaultWidth={420}
        className="overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>Estilo e apresentação</SheetTitle>
          <SheetDescription>
            A linguagem visual do dashboard inteiro — tipografia, cores, blocos,
            tabelas e gráficos. Trocar de estilo não altera a configuração dos
            widgets: voltar ao Clássico devolve o visual de antes.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-8">
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Estilo">
            <StyleOption
              selected={choice === INHERIT}
              onSelect={() => setChoice(INHERIT)}
              def={DASHBOARD_STYLES[orgKey]}
              title={`Padrão da organização (${DASHBOARD_STYLES[orgKey].label})`}
              subtitle="Acompanha o estilo escolhido em Configurações → Interface."
            />
            {DASHBOARD_STYLE_KEYS.map((key) => (
              <StyleOption
                key={key}
                selected={choice === key}
                onSelect={() => setChoice(key)}
                def={DASHBOARD_STYLES[key]}
                title={DASHBOARD_STYLES[key].label}
                subtitle={DASHBOARD_STYLES[key].description}
              />
            ))}
          </div>

          {ownChoice && effective.colors ? (
            <div className="flex flex-col gap-3 border-t pt-3">
              <Label className="text-xs">Ajustes deste dashboard</Label>
              <ColorField
                label="Cor de destaque"
                value={accent || effective.colors.accent}
                onChange={setAccent}
              />
              <FontSelect
                label="Fonte dos títulos"
                value={fontDisplay}
                onChange={setFontDisplay}
                fallback={effective.fonts.display}
              />
              <FontSelect
                label="Fonte do texto"
                value={fontBody}
                onChange={setFontBody}
                fallback={effective.fonts.body}
              />
              {/* v1.2: papel, superfície e tinta (vazio = do estilo). */}
              <ColorField
                label="Papel (fundo da página)"
                value={page || effective.colors.page}
                onChange={setPage}
                onClear={page ? () => setPage("") : undefined}
              />
              <ColorField
                label="Superfície (blocos)"
                value={surface || effective.colors.surface}
                onChange={setSurface}
                onClear={surface ? () => setSurface("") : undefined}
              />
              <ColorField
                label="Tinta (texto)"
                value={ink || effective.colors.ink}
                onChange={setInk}
                onClear={ink ? () => setInk("") : undefined}
              />
              {accent ? (
                <button
                  type="button"
                  className="text-muted-foreground self-start text-xs underline"
                  onClick={() => setAccent("")}
                >
                  Usar o destaque do estilo
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 border-t pt-3">
            <Label className="text-xs">Modo Apresentar</Label>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">Enquadramento</span>
              <Select value={fit} onValueChange={setFit}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO}>
                    Padrão do estilo ({effective.colors ? "palco 16:9" : "só a altura"})
                  </SelectItem>
                  <SelectItem value="palco">
                    Palco 16:9 — o slide inteiro escala à tela, sem rolagem
                  </SelectItem>
                  <SelectItem value="altura">
                    Só a altura — as linhas se esticam até o rodapé
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">Entrada do slide</span>
              <Select value={transition} onValueChange={setTransition}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO}>
                    Padrão do estilo ({effective.colors ? "suave" : "nenhuma"})
                  </SelectItem>
                  <SelectItem value="suave">
                    Suave — os blocos entram em sequência
                  </SelectItem>
                  <SelectItem value="nenhuma">Nenhuma</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* v1.1: ESQUELETO DE SLIDE — o mesmo topo e rodapé em todas as
              abas-slide; o título-conclusão é por aba. */}
          <div className="flex flex-col gap-3 border-t pt-3">
            <Label className="text-xs">Esqueleto de slide</Label>
            <p className="text-muted-foreground text-xs">
              Topo com o rótulo da seção e a data, título-conclusão de cada aba e
              rodapé com a fonte e o número do slide — sempre nas mesmas
              posições.
            </p>
            <TextField
              label="Rótulo da seção (kicker)"
              value={slideKicker}
              onChange={setSlideKicker}
              placeholder="Ex.: Comercial · 4T26"
            />
            <TextField
              label="Rodapé (fonte dos dados)"
              value={slideFooter}
              onChange={setSlideFooter}
              placeholder="Ex.: Fonte: CRM e planilha de metas"
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={slideDate} onCheckedChange={(v) => setSlideDate(v === true)} />
              Data no topo
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={slideNumber}
                onCheckedChange={(v) => setSlideNumber(v === true)}
              />
              Número do slide no rodapé
            </label>
            {slideDate ? (
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">
                  Data exibida (vazio = o dia em que se apresenta)
                </span>
                <input
                  type="date"
                  value={slideDateFixed}
                  onChange={(e) => setSlideDateFixed(e.target.value)}
                  className="border-input h-8 w-44 rounded-md border bg-transparent px-2 text-xs outline-none"
                  aria-label="Data exibida no topo do slide"
                />
              </label>
            ) : null}
            {allTabs.length > 0 ? (
              <div className="flex flex-col gap-2">
                <span className="text-muted-foreground text-xs">
                  Por aba: se entra na apresentação, o título-conclusão (a frase
                  que o slide defende) e o fundo. No título, {"{= … }"} traz um
                  número vivo — as mesmas expressões da Nota (ex.:{" "}
                  {"{= [Meta: MRR novo] }"}).
                </span>
                {allTabs.map((t) => (
                  <div key={t.id} className="flex flex-col gap-1 rounded-md border p-2">
                    <span className="text-xs font-medium">{t.name}</span>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={!hiddenTabs.has(t.id)}
                        onCheckedChange={(v) =>
                          setHiddenTabs((prev) => {
                            const next = new Set(prev);
                            if (v === true) next.delete(t.id);
                            else next.add(t.id);
                            return next;
                          })
                        }
                      />
                      Incluir na apresentação (desmarcada = aba de trabalho)
                    </label>
                    <ColorField
                      label="Fundo da aba"
                      value={tabBg[t.id] ?? ""}
                      onChange={(v) => setTabBg((prev) => ({ ...prev, [t.id]: v }))}
                      onClear={
                        tabBg[t.id]
                          ? () =>
                              setTabBg((prev) => {
                                const next = { ...prev };
                                delete next[t.id];
                                return next;
                              })
                          : undefined
                      }
                    />
                    <input
                      type="text"
                      maxLength={140}
                      value={tabText[t.id]?.headline ?? ""}
                      placeholder="Ex.: MRR final chega a R$ 585 mil em dezembro"
                      onChange={(e) =>
                        setTabText((prev) => ({
                          ...prev,
                          [t.id]: {
                            headline: e.target.value,
                            kicker: prev[t.id]?.kicker ?? "",
                            noFrame: prev[t.id]?.noFrame ?? false,
                          },
                        }))
                      }
                      className="border-input h-8 rounded-md border bg-transparent px-2 text-xs outline-none"
                      aria-label={`Título-conclusão — ${t.name}`}
                    />
                    <input
                      type="text"
                      maxLength={60}
                      value={tabText[t.id]?.kicker ?? ""}
                      placeholder="Rótulo próprio desta aba (opcional)"
                      onChange={(e) =>
                        setTabText((prev) => ({
                          ...prev,
                          [t.id]: {
                            kicker: e.target.value,
                            headline: prev[t.id]?.headline ?? "",
                            noFrame: prev[t.id]?.noFrame ?? false,
                          },
                        }))
                      }
                      className="border-input h-8 rounded-md border bg-transparent px-2 text-xs outline-none"
                      aria-label={`Kicker — ${t.name}`}
                    />
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={tabText[t.id]?.noFrame ?? false}
                        onCheckedChange={(v) =>
                          setTabText((prev) => ({
                            ...prev,
                            [t.id]: {
                              headline: prev[t.id]?.headline ?? "",
                              kicker: prev[t.id]?.kicker ?? "",
                              noFrame: v === true,
                            },
                          }))
                        }
                      />
                      Sem esqueleto nesta aba (capa, divisória)
                    </label>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <Button onClick={save} disabled={pending} className="self-start">
            {pending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </ResizableSheetContent>
    </Sheet>
  );
}

function FontSelect({
  label,
  value,
  onChange,
  fallback,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  fallback: DashboardFontKey;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO}>
            Do estilo ({DASHBOARD_FONTS[fallback].label})
          </SelectItem>
          {(Object.keys(DASHBOARD_FONTS) as DashboardFontKey[]).map((k) => (
            <SelectItem key={k} value={k}>
              <span style={{ fontFamily: DASHBOARD_FONTS[k].stack }}>
                {DASHBOARD_FONTS[k].label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// Miniatura do estilo: página, título na fonte display, um filete e uma barra
// de destaque entre barras apagadas — a técnica que o estilo ensina.
function StyleOption({
  selected,
  onSelect,
  def,
  title,
  subtitle,
}: {
  selected: boolean;
  onSelect: () => void;
  def: DashboardStyleDef;
  title: string;
  subtitle: string;
}) {
  const c = def.colors;
  const page = c?.page ?? "var(--card)";
  const ink = c?.ink ?? "var(--foreground)";
  const rule = c?.rule ?? "var(--border)";
  const dim = c?.dim ?? "var(--muted-foreground)";
  const accent = c?.accent ?? "var(--chart-1)";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex items-stretch gap-3 rounded-md border p-2 text-left transition-colors",
        selected ? "border-primary ring-primary/30 ring-2" : "hover:bg-muted/50"
      )}
    >
      <div
        className="flex w-24 shrink-0 flex-col justify-between overflow-hidden rounded-sm border p-2"
        style={{ background: page, color: ink, borderColor: rule }}
        aria-hidden
      >
        <span
          className="text-base leading-none"
          style={{ fontFamily: DASHBOARD_FONTS[def.fonts.display].stack }}
        >
          Aa
        </span>
        <div className="h-px w-full" style={{ background: rule }} />
        <div className="flex h-6 items-end gap-1">
          {[0.45, 0.7, 1, 0.55].map((h, i) => (
            <div
              key={i}
              className="w-2"
              style={{
                height: `${h * 100}%`,
                background: i === 2 ? accent : dim,
                borderRadius: def.chart.barRadius,
              }}
            />
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
        <span className="flex items-center gap-1 text-sm font-medium">
          {title}
          {selected ? <Check className="size-3.5" /> : null}
        </span>
        <span className="text-muted-foreground text-xs">{subtitle}</span>
      </div>
    </button>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <input
        type="text"
        maxLength={160}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="border-input h-8 rounded-md border bg-transparent px-2 text-xs outline-none"
        aria-label={label}
      />
    </div>
  );
}

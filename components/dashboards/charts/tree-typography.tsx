// Versão: 1.1 | Data: 11/10/2026
// v1.1 (11/10/2026): o provider passa a carregar o CARTÃO inteiro —
//   tipografia + ajuste (texto que não cabe) + formato de números, todos
//   resolvidos widget → cartão (`TreeCardProvider`; `TreeTextProvider` segue
//   como nome antigo). Novos: `FitNumber` (mostra a 1ª forma do número que cabe
//   na célula — lib/tree/card-fit.ts dá as formas), `ShrinkToFit` (modo
//   "Diminuir o texto"), coluna de COR no editor de tipografia e o
//   `TreeCardStyleEditor` (cores do cartão, ajuste e números), editor ÚNICO da
//   Aparência e da "Exibição do cartão".
// Versão: 1.0 | Data: 11/10/2026
// v1.0 (11/10/2026): TIPOGRAFIA dos cartões da Tree no cliente.
//   * `TreeTextProvider` resolve, por cartão, o padrão do widget + o do cartão
//     (lib/tree/typography.ts — o cartão vence por propriedade) e as peças do
//     cartão (título, corpo do indicador/plano/ritual, data, progresso) leem
//     o papel delas com `useTreeText`. Fora do provider (ou sem nada
//     configurado) o hook devolve undefined e a classe de sempre decide.
//   * `TreeTypographyEditor` é o editor ÚNICO — usado na Aparência do widget
//     (padrão) e na "Exibição do cartão" (individual).
"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { DASHBOARD_FONTS, isDashboardFontKey } from "@/lib/dashboards/style";
import { normalizeHexColor } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { estimateTextWidth } from "@/lib/widgets/measure-text";
import {
  normalizeTreeTextSize,
  resolveTreeTypography,
  TREE_TEXT_MAX_PX,
  TREE_TEXT_MIN_PX,
  TREE_TEXT_ROLE_LABELS,
  TREE_TEXT_ROLES,
  treeTextStyle,
  type TreeTextRole,
  type TreeTextStyle,
  type TreeTypography,
} from "@/lib/tree/typography";
import {
  DEFAULT_CARD_FIT,
  DEFAULT_NUMBER_FORMAT,
  numberCandidates,
  resolveCardFit,
  resolveNumberFormat,
  TREE_ABBREVIATE_LABELS,
  TREE_ABBREVIATE_MODES,
  TREE_FIT_MAX_WIDTH_MAX,
  TREE_FIT_MAX_WIDTH_MIN,
  TREE_FIT_MODE_LABELS,
  TREE_FIT_MODES,
  TREE_FIT_PADDING_MAX,
  TREE_NUMBER_DECIMALS_MAX,
  TREE_NUMBER_STYLE_LABELS,
  TREE_NUMBER_STYLES,
  type ResolvedCardFit,
  type ResolvedNumberFormat,
  type TreeAbbreviateMode,
  type TreeCardFit,
  type TreeFitMode,
  type TreeNumberFormat,
  type TreeNumberStyle,
} from "@/lib/tree/card-fit";
import { TREE_TONE_LABELS, TREE_TONES, type TreeCardColors, type TreeTone } from "@/lib/tree/display";
import { ColorField } from "../appearance-controls";

interface TreeCardContextValue {
  typography: TreeTypography;
  fit: ResolvedCardFit;
  numbers: ResolvedNumberFormat;
}

const TreeCardContext = createContext<TreeCardContextValue | null>(null);

/** v1.1: tudo o que o CARTÃO resolve (widget → cartão, por propriedade). */
export function TreeCardProvider({
  widget,
  node,
  children,
}: {
  widget: { typography?: TreeTypography | null; fit?: TreeCardFit | null; numbers?: TreeNumberFormat | null } | null | undefined;
  node: { typography?: TreeTypography | null; fit?: TreeCardFit | null; numbers?: TreeNumberFormat | null } | null | undefined;
  children: ReactNode;
}) {
  const wt = widget?.typography;
  const nt = node?.typography;
  const wf = widget?.fit;
  const nf = node?.fit;
  const wn = widget?.numbers;
  const nn = node?.numbers;
  const value = useMemo(
    () => ({
      typography: resolveTreeTypography(wt, nt),
      fit: resolveCardFit(wf, nf),
      numbers: resolveNumberFormat(wn, nn),
    }),
    [wt, nt, wf, nf, wn, nn]
  );
  return <TreeCardContext.Provider value={value}>{children}</TreeCardContext.Provider>;
}

/** v1.0: só tipografia (mantido para quem já usa). */
export function TreeTextProvider({
  widget,
  node,
  children,
}: {
  widget: TreeTypography | null | undefined;
  node: TreeTypography | null | undefined;
  children: ReactNode;
}) {
  return (
    <TreeCardProvider widget={{ typography: widget }} node={{ typography: node }}>
      {children}
    </TreeCardProvider>
  );
}

/** `style` do papel no cartão corrente (undefined = classe de sempre). */
export function useTreeText(role: TreeTextRole): CSSProperties | undefined {
  return treeTextStyle(useContext(TreeCardContext)?.typography, role);
}

/**
 * Selos (`Badge`) têm altura fixa (h-4) para a escala pequena; com tamanho
 * próprio a altura acompanha o texto.
 */
export function useTreeBadgeText(role: TreeTextRole): CSSProperties | undefined {
  const s = useTreeText(role);
  return s?.fontSize ? { ...s, height: "auto" } : s;
}

/** v1.1: ajuste do cartão corrente (fora do provider = o padrão). */
export function useTreeCardFit(): ResolvedCardFit {
  return useContext(TreeCardContext)?.fit ?? DEFAULT_CARD_FIT;
}

/** v1.1: formato de número do cartão corrente (fora do provider = o padrão). */
export function useTreeNumberFormat(): ResolvedNumberFormat {
  return useContext(TreeCardContext)?.numbers ?? DEFAULT_NUMBER_FORMAT;
}

// ------------------------------------------------------------ FitNumber

let measureCtx: CanvasRenderingContext2D | null | undefined;

function textWidthIn(text: string, el: HTMLElement): number {
  const cs = getComputedStyle(el);
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement("canvas").getContext("2d");
    } catch {
      measureCtx = null;
    }
  }
  if (measureCtx) {
    try {
      measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const w = measureCtx.measureText(text).width;
      if (Number.isFinite(w) && w > 0) return w;
    } catch {
      // cai na estimativa
    }
  }
  return estimateTextWidth(text, parseFloat(cs.fontSize) || 11);
}

/**
 * v1.1: um número que se ADAPTA à célula. `candidates` vem de
 * `numberCandidates` (do mais longo ao mais curto); aparece o 1º que cabe na
 * largura disponível. Com o cartão crescendo ("Ajustar o cartão") a célula
 * não aperta, então o completo sempre cabe — nada a medir.
 */
export function FitNumber({
  candidates,
  className,
  style,
  title,
}: {
  candidates: string[];
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  const fit = useTreeCardFit();
  const ref = useRef<HTMLSpanElement>(null);
  const [idx, setIdx] = useState(0);
  const measure = fit.overflow !== "cartao" && candidates.length > 1;
  const key = candidates.join("\u0000");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!measure || !el || typeof ResizeObserver === "undefined") return;
    const list = key.split("\u0000");
    // A largura DISPONÍVEL é a da célula (o número é inline-block e encolhe
    // com o próprio texto — medir ele mesmo diria sempre "cabe").
    const host = el.closest("td") ?? el.parentElement ?? el;
    const pick = () => {
      const cs = getComputedStyle(el);
      const own =
        (parseFloat(cs.paddingLeft) || 0) +
        (parseFloat(cs.paddingRight) || 0) +
        (parseFloat(cs.borderLeftWidth) || 0) +
        (parseFloat(cs.borderRightWidth) || 0);
      const avail = host.clientWidth - own;
      if (avail <= 0) return;
      let i = 0;
      while (i < list.length - 1 && textWidthIn(list[i], el) > avail + 0.5) i++;
      setIdx(i);
    };
    const ro = new ResizeObserver(pick);
    ro.observe(host);
    return () => ro.disconnect();
  }, [key, measure]);
  const text = measure ? candidates[Math.min(idx, candidates.length - 1)] : candidates[0];
  return (
    <span
      ref={ref}
      className={cn(
        "inline-block max-w-full overflow-hidden text-ellipsis whitespace-nowrap align-bottom",
        className
      )}
      style={style}
      title={
        text !== candidates[0] ? (title ? `${candidates[0]} · ${title}` : candidates[0]) : title
      }
    >
      {text}
    </span>
  );
}

/** Atalho: as formas do número pelo formato do cartão corrente. */
export function useNumberCandidates() {
  const fmt = useTreeNumberFormat();
  return (value: number | null | undefined, unit: Parameters<typeof numberCandidates>[1], withUnit = true) =>
    numberCandidates(value, unit, fmt, withUnit);
}

// ------------------------------------------------------------ ShrinkToFit

const SHRINK_MIN = 0.5;

/**
 * v1.1: modo "Diminuir o texto" — o miolo do cartão é ESCALADO até caber na
 * caixa (piso 50%; abaixo disso, corta). Desligado = os filhos sem invólucro
 * nenhum (o layout de sempre).
 */
export function ShrinkToFit({
  enabled,
  children,
  className,
}: {
  enabled: boolean;
  children: ReactNode;
  className?: string;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!enabled || !o || !i || typeof ResizeObserver === "undefined") return;
    const calc = () => {
      const ch = o.clientHeight;
      const cw = o.clientWidth;
      if (!ch || !cw) return;
      setScale((cur) => {
        const h = i.scrollHeight;
        let next = h > 0 ? Math.min(1, (ch / (h * cur)) * cur) : 1;
        const sw = i.scrollWidth;
        const iw = i.clientWidth;
        if (sw > iw + 1 && iw > 0) next = Math.min(next, (iw / sw) * cur);
        next = Math.max(SHRINK_MIN, Math.min(1, next));
        // Amortecido: subir pouco não vale um novo ciclo (evita oscilar).
        if (Math.abs(next - cur) < 0.02 || (next > cur && next - cur < 0.05)) return cur;
        return next;
      });
    };
    const ro = new ResizeObserver(calc);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, [enabled]);
  if (!enabled) return <>{children}</>;
  const s = scale;
  return (
    <div ref={outer} className={cn("relative min-h-0 flex-1 overflow-hidden", className)}>
      <div
        ref={inner}
        className="flex flex-col gap-1"
        style={
          s < 1
            ? {
                width: `${100 / s}%`,
                transform: `scale(${s})`,
                transformOrigin: "top left",
              }
            : { minHeight: "100%" }
        }
      >
        {children}
      </div>
    </div>
  );
}

/** Editor: fonte + tamanho + cor (v1.1) por tipo de texto. Vazio = herda. */
export function TreeTypographyEditor({
  value,
  onChange,
  inheritLabel,
}: {
  value: TreeTypography | null | undefined;
  onChange: (next: TreeTypography | undefined) => void;
  /** O que "vazio" significa aqui ("Padrão do widget" / "Padrão"). */
  inheritLabel: string;
}) {
  const typo = value ?? {};
  // Rascunho do tamanho por papel: "1" a caminho de "14" não pode ser
  // descartado no meio da digitação.
  const [drafts, setDrafts] = useState<Partial<Record<TreeTextRole, string>>>({});

  const setRole = (role: TreeTextRole, patch: Partial<TreeTextStyle>) => {
    const cur: TreeTextStyle = { ...(typo[role] ?? {}), ...patch };
    if (cur.font === undefined) delete cur.font;
    if (cur.size === undefined) delete cur.size;
    if (cur.color === undefined) delete cur.color;
    const next: TreeTypography = { ...typo };
    if (Object.keys(cur).length > 0) next[role] = cur;
    else delete next[role];
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };

  const hasAny = Object.keys(typo).length > 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-muted-foreground grid grid-cols-[minmax(0,1fr)_7rem_4rem_3.25rem] items-center gap-x-2 text-xs">
        <span>Texto</span>
        <span>Fonte</span>
        <span>Tamanho (px)</span>
        <span>Cor</span>
      </div>
      {TREE_TEXT_ROLES.map((role) => {
        const s = typo[role];
        const draft = drafts[role];
        return (
          <div
            key={role}
            className="grid grid-cols-[minmax(0,1fr)_7rem_4rem_3.25rem] items-center gap-x-2"
          >
            <span className="min-w-0 text-xs leading-tight">{TREE_TEXT_ROLE_LABELS[role]}</span>
            <select
              aria-label={`Fonte — ${TREE_TEXT_ROLE_LABELS[role]}`}
              className="border-input h-8 min-w-0 rounded-md border bg-transparent px-1 text-xs"
              value={s?.font ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setRole(role, { font: isDashboardFontKey(v) ? v : undefined });
              }}
            >
              <option value="">{inheritLabel}</option>
              {Object.entries(DASHBOARD_FONTS).map(([k, f]) => (
                <option key={k} value={k}>
                  {f.label}
                </option>
              ))}
            </select>
            <input
              aria-label={`Tamanho — ${TREE_TEXT_ROLE_LABELS[role]}`}
              type="number"
              inputMode="decimal"
              min={TREE_TEXT_MIN_PX}
              max={TREE_TEXT_MAX_PX}
              step={0.5}
              placeholder="—"
              className="border-input h-8 min-w-0 rounded-md border bg-transparent px-1.5 text-xs"
              value={draft ?? (s?.size != null ? String(s.size) : "")}
              onChange={(e) => {
                const raw = e.target.value;
                setDrafts((d) => ({ ...d, [role]: raw }));
                if (raw.trim() === "") return setRole(role, { size: undefined });
                const size = normalizeTreeTextSize(raw);
                if (size != null) setRole(role, { size });
              }}
              onBlur={() =>
                setDrafts((d) => {
                  const next = { ...d };
                  delete next[role];
                  return next;
                })
              }
            />
            {/* v1.1: cor do texto (vazio = a cor de sempre). */}
            <span className="flex items-center gap-0.5">
              <input
                type="color"
                aria-label={`Cor — ${TREE_TEXT_ROLE_LABELS[role]}`}
                value={normalizeHexColor(s?.color) ?? "#000000"}
                onChange={(e) => setRole(role, { color: normalizeHexColor(e.target.value) ?? undefined })}
                className={cn(
                  "border-input h-8 w-7 cursor-pointer rounded-md border bg-transparent p-0.5",
                  !s?.color && "opacity-40"
                )}
              />
              {s?.color ? (
                <button
                  type="button"
                  aria-label={`Limpar cor — ${TREE_TEXT_ROLE_LABELS[role]}`}
                  title="Limpar cor"
                  className="text-muted-foreground hover:text-foreground text-xs"
                  onClick={() => setRole(role, { color: undefined })}
                >
                  ×
                </button>
              ) : null}
            </span>
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          Tamanho entre {TREE_TEXT_MIN_PX} e {TREE_TEXT_MAX_PX} px (na Root, o zoom multiplica). Cor esmaecida = a de sempre. Vazio ={" "}
          {inheritLabel.toLowerCase()}.
        </p>
        {hasAny ? (
          <button
            type="button"
            className="text-primary shrink-0 text-xs underline"
            onClick={() => {
              setDrafts({});
              onChange(undefined);
            }}
          >
            Limpar
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ cartão

/** O que o editor de cartão mexe (widget: settings.tree; cartão: display). */
export interface TreeCardStyleValue {
  colors?: TreeCardColors;
  fit?: TreeCardFit;
  numbers?: TreeNumberFormat;
}

const SELECT =
  "border-input h-8 min-w-0 rounded-md border bg-transparent px-1.5 text-xs";
const NUM_INPUT =
  "border-input h-8 w-20 rounded-md border bg-transparent px-1.5 text-xs";

function compact<T extends object>(o: T): T | undefined {
  const out = { ...o } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return Object.keys(out).length > 0 ? (out as T) : undefined;
}

/**
 * v1.1: editor ÚNICO das cores do cartão, do "texto que não cabe" e dos
 * números grandes — na Aparência (padrão do widget) e na "Exibição do
 * cartão" (individual; vazio = o do widget).
 */
export function TreeCardStyleEditor({
  value,
  onChange,
  inheritLabel,
  showColors = true,
}: {
  value: TreeCardStyleValue;
  onChange: (next: TreeCardStyleValue) => void;
  inheritLabel: string;
  /** O editor do cartão já tem o seletor de tom próprio. */
  showColors?: boolean;
}) {
  const colors = value.colors ?? {};
  const fit = value.fit ?? {};
  const nums = value.numbers ?? {};
  const setColors = (patch: Partial<TreeCardColors>) =>
    onChange({ ...value, colors: compact({ ...colors, ...patch }) });
  const setFit = (patch: Partial<TreeCardFit>) => onChange({ ...value, fit: compact({ ...fit, ...patch }) });
  const setNums = (patch: Partial<TreeNumberFormat>) =>
    onChange({ ...value, numbers: compact({ ...nums, ...patch }) });
  const effFit = resolveCardFit(null, fit);
  const effNums = resolveNumberFormat(null, nums);
  const sample = numberCandidates(125430, "quantidade", { ...effNums, abbreviate: "sempre" });
  const sampleMoney = numberCandidates(30000, "moeda", { ...effNums, abbreviate: "sempre" });

  return (
    <div className="flex flex-col gap-3">
      {showColors ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium">Cor dos cartões</p>
          <label className="flex flex-col gap-1 text-xs">
            Tom
            <select
              className={SELECT}
              value={colors.tone ?? "padrao"}
              onChange={(e) => {
                const v = e.target.value as TreeTone;
                setColors({ tone: v === "padrao" ? undefined : v });
              }}
            >
              {TREE_TONES.map((t) => (
                <option key={t} value={t}>
                  {t === "padrao" ? inheritLabel : TREE_TONE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <ColorField
            label="Borda (cor livre — vence o tom)"
            value={colors.borderColor}
            onChange={(v) => setColors({ borderColor: v })}
            onClear={() => setColors({ borderColor: undefined })}
          />
          <ColorField
            label="Fundo (cor livre — vence o tom)"
            value={colors.bgColor}
            onChange={(v) => setColors({ bgColor: v })}
            onClear={() => setColors({ bgColor: undefined })}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium">Quando o texto não cabe</p>
        <select
          aria-label="Quando o texto não cabe"
          className={SELECT}
          value={fit.overflow ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            setFit({ overflow: (TREE_FIT_MODES as readonly string[]).includes(v) ? (v as TreeFitMode) : undefined });
          }}
        >
          <option value="">{inheritLabel}</option>
          {TREE_FIT_MODES.map((m) => (
            <option key={m} value={m}>
              {TREE_FIT_MODE_LABELS[m]}
            </option>
          ))}
        </select>
        {effFit.overflow === "cartao" || fit.overflow === undefined ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs">
              Distância das bordas (px)
              <input
                type="number"
                min={0}
                max={TREE_FIT_PADDING_MAX}
                placeholder={String(DEFAULT_CARD_FIT.padding)}
                className={NUM_INPUT}
                value={fit.padding ?? ""}
                onChange={(e) => {
                  const n = e.target.value === "" ? undefined : Math.round(Number(e.target.value));
                  setFit({
                    padding: n != null && Number.isFinite(n) && n >= 0 && n <= TREE_FIT_PADDING_MAX ? n : undefined,
                  });
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Largura máxima (px)
              <input
                type="number"
                min={TREE_FIT_MAX_WIDTH_MIN}
                max={TREE_FIT_MAX_WIDTH_MAX}
                step={20}
                placeholder={String(DEFAULT_CARD_FIT.maxWidth)}
                className={NUM_INPUT}
                value={fit.maxWidth ?? ""}
                onChange={(e) => {
                  const n = e.target.value === "" ? undefined : Math.round(Number(e.target.value));
                  setFit({
                    maxWidth:
                      n != null && Number.isFinite(n) && n >= TREE_FIT_MAX_WIDTH_MIN && n <= TREE_FIT_MAX_WIDTH_MAX
                        ? n
                        : undefined,
                  });
                }}
              />
            </label>
          </div>
        ) : null}
        <p className="text-muted-foreground text-xs">
          “Ajustar o cartão” faz o cartão crescer só o necessário para caber, mantendo a distância
          das bordas escolhida (padrão {DEFAULT_CARD_FIT.padding} px). O tamanho arrastado pela alça vira o mínimo.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium">Números grandes</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs">
            Abreviar
            <select
              className={SELECT}
              value={nums.abbreviate ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setNums({
                  abbreviate: (TREE_ABBREVIATE_MODES as readonly string[]).includes(v)
                    ? (v as TreeAbbreviateMode)
                    : undefined,
                });
              }}
            >
              <option value="">{inheritLabel}</option>
              {TREE_ABBREVIATE_MODES.map((m) => (
                <option key={m} value={m}>
                  {TREE_ABBREVIATE_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Formato
            <select
              className={SELECT}
              value={nums.style ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setNums({
                  style: (TREE_NUMBER_STYLES as readonly string[]).includes(v) ? (v as TreeNumberStyle) : undefined,
                });
              }}
            >
              <option value="">{inheritLabel}</option>
              {TREE_NUMBER_STYLES.map((m) => (
                <option key={m} value={m}>
                  {TREE_NUMBER_STYLE_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Casas decimais (máx.)
            <select
              className={SELECT}
              value={nums.decimals ?? ""}
              onChange={(e) =>
                setNums({ decimals: e.target.value === "" ? undefined : Number(e.target.value) })
              }
            >
              <option value="">{inheritLabel}</option>
              {Array.from({ length: TREE_NUMBER_DECIMALS_MAX + 1 }, (_, d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>
        {effNums.style === "custom" ? (
          <div className="flex flex-wrap items-end gap-2">
            {(["mil", "mi", "bi"] as const).map((k) => (
              <label key={k} className="flex flex-col gap-1 text-xs">
                {k === "mil" ? "Milhar" : k === "mi" ? "Milhão" : "Bilhão"}
                <input
                  className="border-input h-8 w-16 rounded-md border bg-transparent px-1.5 text-xs"
                  maxLength={8}
                  placeholder={effNums.suffixes[k]}
                  value={nums.suffixes?.[k] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setNums({ suffixes: compact({ ...nums.suffixes, [k]: v || undefined }) });
                  }}
                />
              </label>
            ))}
            <label className="flex items-center gap-1.5 pb-2 text-xs">
              <input
                type="checkbox"
                checked={effNums.space}
                onChange={(e) => setNums({ space: e.target.checked })}
              />
              Espaço antes do sufixo
            </label>
          </div>
        ) : null}
        <p className="text-muted-foreground text-xs">
          Exemplo: 125.430 → {sample.slice(0, 1).join("")} · R$ 30.000 → {sampleMoney[0]}.
          {effNums.abbreviate === "auto"
            ? " Só abrevia quando o número não cabe; as casas decimais caem uma a uma até caber."
            : null}
        </p>
      </div>
    </div>
  );
}

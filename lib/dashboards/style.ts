// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): ESTILO DO DASHBOARD — um conjunto de tokens semânticos
//   (cor, tipografia, forma dos cards, tabela e gráfico) escolhido POR
//   DASHBOARD, com padrão da ORGANIZAÇÃO e o Clássico como padrão do app.
//
// Por que existe: a interface era de EDIÇÃO, não de apresentação. Cada widget
// trazia o próprio chrome e as próprias cores em classes Tailwind soltas, e
// personalizar widget a widget nunca dava um resultado coerente. O estilo é a
// linguagem visual do board inteiro; os widgets LEEM os tokens.
//
// Regras (invariante 43 em docs/arquitetura.md):
// - `classico` é o visual histórico BYTE-IDÊNTICO: não emite variável nenhuma
//   e os widgets seguem pelo ramo antigo. Voltar ao Clássico desfaz tudo,
//   porque o estilo NUNCA reescreve a config dos widgets.
// - Cascata ÚNICA (resolveDashboardStyle): escolha do board → padrão da org →
//   Clássico. Sem camada de usuário: o estilo do board é o mesmo para todos que
//   o veem (é a cara do trabalho, não uma preferência pessoal).
// - Tokens são aplicados no CONTÊINER do board (data-ds), nunca no <html>: não
//   vazam para o resto do app nem para os portais de edição.
// - WHITELIST: nome de variável sai só deste módulo e valor de cor só passa por
//   normalizeHexColor — na entrada (parse) E na saída (dashboardStyleVars),
//   mesmo trato do themeTokenStyle. Fonte é CHAVE de catálogo, nunca string
//   livre (string livre em font-family é CSS vindo do banco).
//
// Módulo PURO e client-safe (molde de lib/theme.ts): consumido pela page, pelo
// viewer de snapshot, pelo editor de estilo e pelos widgets.
import { normalizeHexColor } from "@/lib/theme";

export const DASHBOARD_STYLE_KEYS = [
  "classico",
  "editorial",
  "editorial_escuro",
  "executivo",
] as const;

export type DashboardStyleKey = (typeof DASHBOARD_STYLE_KEYS)[number];

export const DEFAULT_DASHBOARD_STYLE: DashboardStyleKey = "classico";

export function isDashboardStyleKey(v: unknown): v is DashboardStyleKey {
  return (
    typeof v === "string" &&
    (DASHBOARD_STYLE_KEYS as readonly string[]).includes(v)
  );
}

// ---------------------------------------------------------------------------
// Catálogo FECHADO de fontes. As duas variáveis vêm de @fontsource (servidas
// pelo app, importadas em globals.css — o navegador só baixa o arquivo quando
// um texto realmente usa a família).

export const DASHBOARD_FONTS = {
  newsreader: {
    label: "Newsreader (serifa editorial)",
    stack: "'Newsreader Variable', 'Iowan Old Style', Charter, Georgia, serif",
  },
  inter: {
    label: "Inter (sans neutra)",
    stack:
      "'Inter Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  serif_sistema: {
    label: "Serifa do sistema",
    stack: "'Iowan Old Style', Charter, Georgia, 'Times New Roman', serif",
  },
  sistema: {
    label: "Sans do sistema",
    stack:
      "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
} as const;

export type DashboardFontKey = keyof typeof DASHBOARD_FONTS;

export function isDashboardFontKey(v: unknown): v is DashboardFontKey {
  return (
    typeof v === "string" &&
    Object.prototype.hasOwnProperty.call(DASHBOARD_FONTS, v)
  );
}

// ---------------------------------------------------------------------------
// Definição de um estilo

export interface DashboardStyleColors {
  /** Fundo da página do board (off-white quente no editorial). */
  page: string;
  /** Superfície dos blocos (um nível só, levemente diferente da página). */
  surface: string;
  /** Texto principal (quase-preto com tom). */
  ink: string;
  /** Texto secundário (cinza tingido na temperatura do fundo). */
  muted: string;
  /** Filetes e divisórias (1px de baixo contraste). */
  rule: string;
  /** Faixa sutil (zebra, hover). */
  wash: string;
  /** Cor de destaque — a que sustenta a conclusão. */
  accent: string;
  /** Cinza da técnica do destaque (tudo apagado menos o destaque). */
  dim: string;
  good: string;
  bad: string;
  warn: string;
  /** Rampa de UM tom, claro → escuro (séries múltiplas sem arco-íris). */
  seq: readonly [string, string, string, string, string, string];
}

/** Forma dos blocos. */
export type CardVariant = "moldura" | "superficie" | "nenhum";
/** Título do bloco: faixa com divisória (atual) ou título-conclusão limpo. */
export type TitleVariant = "faixa" | "conclusao";

export interface DashboardStyleDef {
  key: DashboardStyleKey;
  label: string;
  description: string;
  /** null = Clássico: nenhuma variável, widgets no ramo histórico. */
  colors: DashboardStyleColors | null;
  scheme: "light" | "dark";
  fonts: { display: DashboardFontKey; body: DashboardFontKey };
  card: CardVariant;
  title: TitleVariant;
  /** Raio dos blocos em px (o Clássico usa o rounded-lg do tema). */
  radius: number;
  table: {
    /** "faixa" = fundo no cabeçalho (atual); "linha" = rótulo pequeno em
     * caixa-alta com filete de 1px embaixo. */
    header: "faixa" | "linha";
    /** "preencher" reparte a altura do card entre as linhas (atual). */
    density: "preencher" | "confortavel";
    zebra: boolean;
  };
  chart: {
    /** Linha de grade sólida (true) ou tracejada (Clássico). */
    solidGrid: boolean;
    /** Linha do eixo visível. */
    axisLine: boolean;
    /** Raio do topo da barra em px. */
    barRadius: number;
    /** Paleta padrão das séries quando o widget não escolheu cor. */
    palette: "tema" | "mono";
  };
  /** Pesos permitidos (dois, por disciplina). */
  weights: { regular: number; strong: number };
  /** Multiplicadores dos tamanhos de fonte padrão dos widgets (FONT_DEFAULTS). */
  fontScale: {
    title: number;
    value: number;
    labels: number;
    table: number;
    chart: number;
  };
}

const UNIT_SCALE = { title: 1, value: 1, labels: 1, table: 1, chart: 1 };

export const DASHBOARD_STYLES: Record<DashboardStyleKey, DashboardStyleDef> = {
  classico: {
    key: "classico",
    label: "Clássico",
    description: "O visual de sempre: blocos com moldura e faixa de título.",
    colors: null,
    scheme: "light",
    fonts: { display: "sistema", body: "sistema" },
    card: "moldura",
    title: "faixa",
    radius: 10,
    table: { header: "faixa", density: "preencher", zebra: false },
    chart: { solidGrid: false, axisLine: true, barRadius: 4, palette: "tema" },
    weights: { regular: 400, strong: 600 },
    fontScale: UNIT_SCALE,
  },
  editorial: {
    key: "editorial",
    label: "Editorial",
    description:
      "Papel off-white quente, títulos em serifa, divisórias finas e um único destaque de cor.",
    colors: {
      page: "#f7f5f0",
      surface: "#fbfaf7",
      ink: "#1c1b19",
      muted: "#6b665e",
      rule: "#e3dfd6",
      wash: "#f1eee7",
      accent: "#b4532a",
      dim: "#cbc5b9",
      good: "#3f7d58",
      bad: "#b3412e",
      warn: "#a8741c",
      seq: ["#ecdcd0", "#dcb9a1", "#c99372", "#b4532a", "#8c3f20", "#5e2a16"],
    },
    scheme: "light",
    fonts: { display: "newsreader", body: "inter" },
    card: "nenhum",
    title: "conclusao",
    radius: 4,
    table: { header: "linha", density: "confortavel", zebra: false },
    chart: { solidGrid: true, axisLine: false, barRadius: 2, palette: "mono" },
    weights: { regular: 400, strong: 600 },
    fontScale: { title: 1.35, value: 1.3, labels: 1.05, table: 1.1, chart: 1.1 },
  },
  editorial_escuro: {
    key: "editorial_escuro",
    label: "Editorial escuro",
    description:
      "Quase-preto quente com texto a ~90% de brilho — para projetor e capas.",
    colors: {
      page: "#1c1b19",
      surface: "#232220",
      ink: "#ebe7e0",
      muted: "#a29d94",
      rule: "#3a3833",
      wash: "#2a2926",
      accent: "#e38b5f",
      dim: "#56524b",
      good: "#86bd98",
      bad: "#e2806a",
      warn: "#d9a74e",
      seq: ["#4a3328", "#6b4632", "#8f5c40", "#b5744f", "#d79068", "#f0b791"],
    },
    scheme: "dark",
    fonts: { display: "newsreader", body: "inter" },
    card: "nenhum",
    title: "conclusao",
    radius: 4,
    table: { header: "linha", density: "confortavel", zebra: false },
    chart: { solidGrid: true, axisLine: false, barRadius: 2, palette: "mono" },
    weights: { regular: 400, strong: 600 },
    fontScale: { title: 1.35, value: 1.3, labels: 1.05, table: 1.1, chart: 1.1 },
  },
  executivo: {
    key: "executivo",
    label: "Executivo",
    description:
      "Sans neutra, superfícies brancas de um nível sobre cinza frio, destaque azul-petróleo.",
    colors: {
      page: "#f4f5f4",
      surface: "#ffffff",
      ink: "#191c1b",
      muted: "#636a67",
      rule: "#e1e4e2",
      wash: "#f2f4f3",
      accent: "#1f5f6b",
      dim: "#c3c9c6",
      good: "#2f7a52",
      bad: "#b03a2e",
      warn: "#a26e14",
      seq: ["#d5e4e6", "#a9c8cd", "#79a8b0", "#4a8792", "#1f5f6b", "#123c44"],
    },
    scheme: "light",
    fonts: { display: "inter", body: "inter" },
    card: "superficie",
    title: "conclusao",
    radius: 6,
    table: { header: "linha", density: "confortavel", zebra: true },
    chart: { solidGrid: true, axisLine: false, barRadius: 2, palette: "mono" },
    weights: { regular: 400, strong: 600 },
    fontScale: { title: 1.25, value: 1.25, labels: 1.05, table: 1.05, chart: 1.05 },
  },
};

// ---------------------------------------------------------------------------
// Config gravada em DashboardSettings.style

/** Overrides permitidos — whitelist CURTA de propósito (o estilo é um todo). */
export interface DashboardStyleOverrides {
  accent?: string;
  page?: string;
  surface?: string;
  ink?: string;
  fontDisplay?: DashboardFontKey;
  fontBody?: DashboardFontKey;
}

export interface DashboardStyleSetting {
  key: DashboardStyleKey;
  overrides?: DashboardStyleOverrides;
}

const COLOR_OVERRIDES = ["accent", "page", "surface", "ink"] as const;

/** Parse fail-safe de DashboardSettings.style (inválido ⇒ null = herda). */
export function normalizeDashboardStyleSetting(
  v: unknown
): DashboardStyleSetting | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const raw = v as { key?: unknown; overrides?: unknown };
  if (!isDashboardStyleKey(raw.key)) return null;
  const ovRaw =
    raw.overrides && typeof raw.overrides === "object" && !Array.isArray(raw.overrides)
      ? (raw.overrides as Record<string, unknown>)
      : {};
  const overrides: DashboardStyleOverrides = {};
  for (const k of COLOR_OVERRIDES) {
    const hex = normalizeHexColor(ovRaw[k]);
    if (hex) overrides[k] = hex;
  }
  if (isDashboardFontKey(ovRaw.fontDisplay)) overrides.fontDisplay = ovRaw.fontDisplay;
  if (isDashboardFontKey(ovRaw.fontBody)) overrides.fontBody = ovRaw.fontBody;
  return Object.keys(overrides).length > 0
    ? { key: raw.key, overrides }
    : { key: raw.key };
}

/** Estilo EFETIVO: definição do registry com os overrides aplicados. */
export interface ResolvedDashboardStyle extends DashboardStyleDef {
  /** De onde veio a escolha (para o editor dizer "padrão da organização"). */
  origin: "board" | "org" | "app";
}

/**
 * Cascata ÚNICA: escolha do board ?? padrão da org ?? Clássico. Overrides só
 * valem para a escolha do PRÓPRIO board (o padrão da org é só a chave).
 */
export function resolveDashboardStyle(
  boardSetting: unknown,
  orgDefault: unknown
): ResolvedDashboardStyle {
  const board = normalizeDashboardStyleSetting(boardSetting);
  if (board) {
    const def = DASHBOARD_STYLES[board.key];
    return { ...applyOverrides(def, board.overrides), origin: "board" };
  }
  if (isDashboardStyleKey(orgDefault)) {
    return { ...DASHBOARD_STYLES[orgDefault], origin: "org" };
  }
  return { ...DASHBOARD_STYLES[DEFAULT_DASHBOARD_STYLE], origin: "app" };
}

function applyOverrides(
  def: DashboardStyleDef,
  ov: DashboardStyleOverrides | undefined
): DashboardStyleDef {
  if (!ov) return def;
  const fonts = {
    display: ov.fontDisplay ?? def.fonts.display,
    body: ov.fontBody ?? def.fonts.body,
  };
  // Clássico não tem paleta própria — overrides de cor não se aplicam (ele é o
  // visual histórico; cor no Clássico continua sendo a do tema do sistema).
  if (!def.colors) return { ...def, fonts };
  const colors: DashboardStyleColors = {
    ...def.colors,
    accent: ov.accent ?? def.colors.accent,
    page: ov.page ?? def.colors.page,
    surface: ov.surface ?? def.colors.surface,
    ink: ov.ink ?? def.colors.ink,
  };
  return { ...def, fonts, colors };
}

export function isClassicStyle(s: DashboardStyleDef): boolean {
  return s.colors === null;
}

/** Títulos em serifa ficam em peso regular (serifa em negrito pesa). */
export function isSerifDisplay(s: DashboardStyleDef): boolean {
  return s.fonts.display === "newsreader" || s.fonts.display === "serif_sistema";
}

/**
 * Variáveis CSS do estilo, prontas para o `style` do CONTÊINER do board.
 * Clássico ⇒ {} (render byte-idêntico).
 *
 * Além dos tokens `--ds-*`, o estilo REDEFINE localmente as variáveis do tema
 * shadcn (--card, --foreground, --border, --chart-n…) dentro do board: assim
 * todo componente que já usa `bg-card`/`text-muted-foreground`/`var(--chart-1)`
 * herda o estilo sem precisar ser tocado. Portais (menus, popovers) montam em
 * document.body, fora do contêiner, e seguem no tema do sistema — de propósito.
 */
export function dashboardStyleVars(
  s: DashboardStyleDef
): Record<string, string> {
  const c = s.colors;
  if (!c) return {};
  const out: Record<string, string> = {};
  const put = (name: string, value: string | null | undefined) => {
    // Re-valida na SAÍDA: último ponto antes do DOM.
    const hex = normalizeHexColor(value);
    if (hex) out[name] = hex;
  };
  put("--ds-page", c.page);
  put("--ds-surface", c.surface);
  put("--ds-ink", c.ink);
  put("--ds-muted", c.muted);
  put("--ds-rule", c.rule);
  put("--ds-wash", c.wash);
  put("--ds-accent", c.accent);
  put("--ds-dim", c.dim);
  put("--ds-good", c.good);
  put("--ds-bad", c.bad);
  put("--ds-warn", c.warn);
  c.seq.forEach((hex, i) => put(`--ds-seq-${i + 1}`, hex));

  // Tema shadcn redefinido dentro do board.
  put("--background", c.page);
  put("--foreground", c.ink);
  put("--card", c.surface);
  put("--card-foreground", c.ink);
  put("--muted", c.wash);
  put("--muted-foreground", c.muted);
  put("--border", c.rule);
  put("--input", c.rule);
  put("--primary", c.ink);
  put("--primary-foreground", c.page);
  put("--accent", c.wash);
  put("--accent-foreground", c.ink);
  put("--brand", c.accent);
  put("--destructive", c.bad);
  // Gráficos: o destaque primeiro, depois a rampa do mesmo tom (escuro → claro),
  // em vez da paleta arco-íris do tema.
  put("--chart-1", c.accent);
  put("--chart-2", c.seq[4]);
  put("--chart-3", c.seq[2]);
  put("--chart-4", c.seq[5]);
  put("--chart-5", c.seq[1]);

  // Fontes: valor sai do CATÁLOGO, nunca de string gravada.
  out["--ds-font-display"] = DASHBOARD_FONTS[s.fonts.display].stack;
  out["--ds-font-body"] = DASHBOARD_FONTS[s.fonts.body].stack;
  out["--ds-radius"] = `${clampInt(s.radius, 0, 24)}px`;
  out["--ds-w-regular"] = String(s.weights.regular);
  out["--ds-w-strong"] = String(s.weights.strong);
  return out;
}

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** Rótulos para o editor — donos únicos do texto. */
export const DASHBOARD_STYLE_OPTIONS = DASHBOARD_STYLE_KEYS.map((key) => ({
  value: key,
  label: DASHBOARD_STYLES[key].label,
  description: DASHBOARD_STYLES[key].description,
}));

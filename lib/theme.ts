// Versão: 1.2 | Data: 12/09/2026
// v1.2 (12/09/2026): TOKENS DE TEMA (0141). Além da cor de destaque, um
//   conjunto CURADO de superfícies do sistema passa a ser configurável —
//   fundo, texto, cartão, silenciado, borda e as três cores da barra lateral —
//   com valores INDEPENDENTES para claro e escuro. Literais por modo: o
//   usuário informa os dois, então não há por que clarear via color-mix como
//   o --brand faz no escuro (ali existe uma cor só).
//   A whitelist é a muralha: nome de token fora de THEME_TOKENS e valor fora
//   de normalizeHexColor NUNCA chegam a um style/script, venham de cookie,
//   do banco ou do cliente.
// Tema visual (claro/escuro/sistema) + cor de destaque (--brand-base) + cor
// do Ponteiro Laser (modo apresentação do dashboard).
// Fonte ÚNICA de: defaults, nomes de cookie, sanitização e resolução de
// precedência (usuário ?? org ?? padrão do app). Módulo PURO (sem
// server-only): importado pelo root layout, pelas actions e pelo client.
//
// Os cookies guardam os valores EFETIVOS já resolvidos — o root layout os lê
// para aplicar tema/cor no <html> ANTES do paint, sem tocar no banco. Quando
// o padrão da org muda, o ThemeSync (layout autenticado) reconcilia cookie ×
// banco no próximo render. NUNCA injete valor de cookie cru em style/script:
// passe SEMPRE por normalizeThemeMode/normalizeHexColor (whitelists).

export const DEFAULT_ACCENT = "#7431B3";
// Cor padrão do Ponteiro Laser (vermelho). Preferência PESSOAL — sem padrão
// de org e sem cookie (só a página do dashboard a lê, via SSR autenticado).
export const DEFAULT_LASER = "#dc2626";
export const THEME_COOKIE = "theme_mode";
export const ACCENT_COOKIE = "theme_accent";
// Cookie ÚNICO com os tokens dos dois modos (JSON). Um cookie por token seriam
// 18 cabeçalhos em toda request; o payload aqui é pequeno e já sanitizado.
export const TOKENS_COOKIE = "theme_tokens";

export type ThemeMode = "light" | "dark" | "system";

export interface OrgThemeDefault {
  mode?: ThemeMode;
  accentColor?: string;
  /** Tokens padrão da org (0141) — mesma precedência campo a campo. */
  tokens?: ThemeTokens;
}

/** Whitelist do modo de tema; qualquer outra coisa ⇒ null. */
export function normalizeThemeMode(v: unknown): ThemeMode | null {
  return v === "light" || v === "dark" || v === "system" ? v : null;
}

/** Só aceita #RRGGBB (6 dígitos hex); devolve minúsculo ou null. */
export function normalizeHexColor(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
}

/** Normaliza o jsonb organizations.theme ({} ⇒ sem padrão). */
export function normalizeOrgTheme(v: unknown): OrgThemeDefault | null {
  if (v == null || typeof v !== "object") return null;
  const raw = v as { mode?: unknown; accentColor?: unknown; tokens?: unknown };
  const mode = normalizeThemeMode(raw.mode) ?? undefined;
  const accentColor = normalizeHexColor(raw.accentColor) ?? undefined;
  const tokens = normalizeThemeTokens(
    (raw as { tokens?: unknown }).tokens
  );
  const hasTokens = hasThemeTokens(tokens);
  if (!mode && !accentColor && !hasTokens) return null;
  return { mode, accentColor, tokens: hasTokens ? tokens : undefined };
}

/**
 * Superfícies do sistema que o usuário pode recolorir. É uma WHITELIST fechada:
 * o valor vira `--<token>` no style do <html>, então aceitar nome arbitrário
 * seria deixar o banco escrever CSS. Conjunto curado de propósito — expor os
 * ~28 tokens do shadcn convida combinações ilegíveis (texto igual ao fundo)
 * sem ganho real.
 */
export const THEME_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "muted",
  "muted-foreground",
  "border",
  "sidebar",
  "sidebar-foreground",
  "sidebar-accent",
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];

/** Rótulos pt-BR — donos únicos do texto do editor de tema. */
export const THEME_TOKEN_LABELS: Record<ThemeToken, string> = {
  background: "Fundo da janela",
  foreground: "Texto",
  card: "Fundo dos cartões",
  "card-foreground": "Texto dos cartões",
  muted: "Fundo silenciado",
  "muted-foreground": "Texto secundário",
  border: "Bordas e divisórias",
  sidebar: "Fundo da barra lateral",
  "sidebar-foreground": "Texto da barra lateral",
  "sidebar-accent": "Destaque da barra lateral",
};

export type ThemeTokenMap = Partial<Record<ThemeToken, string>>;

/** Tokens por MODO — o mesmo token tem cores diferentes no claro e no escuro. */
export interface ThemeTokens {
  light: ThemeTokenMap;
  dark: ThemeTokenMap;
}

export const EMPTY_THEME_TOKENS: ThemeTokens = { light: {}, dark: {} };

const TOKEN_SET = new Set<string>(THEME_TOKENS);

function normalizeTokenMap(v: unknown): ThemeTokenMap {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: ThemeTokenMap = {};
  for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
    if (!TOKEN_SET.has(key)) continue;
    const hex = normalizeHexColor(value);
    if (hex) out[key as ThemeToken] = hex;
  }
  return out;
}

/**
 * Parse fail-safe dos tokens (linha do banco OU cookie — a MESMA função nos
 * dois caminhos, de propósito). Token fora da whitelist e valor que não é
 * #RRGGBB somem; o resto sobrevive.
 */
export function normalizeThemeTokens(v: unknown): ThemeTokens {
  if (typeof v === "string") {
    try {
      return normalizeThemeTokens(JSON.parse(v));
    } catch {
      return EMPTY_THEME_TOKENS;
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return EMPTY_THEME_TOKENS;
  const raw = v as { light?: unknown; dark?: unknown };
  return {
    light: normalizeTokenMap(raw.light),
    dark: normalizeTokenMap(raw.dark),
  };
}

/** Há alguma cor definida? (cookie/style só existem quando sim.) */
export function hasThemeTokens(t: ThemeTokens): boolean {
  return (
    Object.keys(t.light).length > 0 || Object.keys(t.dark).length > 0
  );
}

/**
 * Precedência TOKEN A TOKEN, dentro de cada modo: usuário ?? org ?? padrão do
 * app (o padrão é a ausência — o CSS de globals.css manda). Espelha a regra do
 * accent: sobrepor só o fundo e herdar o resto tem de funcionar.
 */
export function resolveThemeTokens(
  user: unknown,
  org: unknown
): ThemeTokens {
  const u = normalizeThemeTokens(user);
  const o = normalizeThemeTokens(org);
  return {
    light: { ...o.light, ...u.light },
    dark: { ...o.dark, ...u.dark },
  };
}

/** Variáveis CSS de um modo, prontas para o style do <html>. */
export function themeTokenStyle(map: ThemeTokenMap): Record<string, string> {
  const style: Record<string, string> = {};
  for (const token of THEME_TOKENS) {
    const value = map[token];
    // Re-valida na SAÍDA também: este é o último ponto antes do style, e
    // depender só de quem chamou é como um vazamento entra.
    const hex = normalizeHexColor(value);
    if (hex) style[`--${token}`] = hex;
  }
  return style;
}

export interface ResolvedTheme {
  mode: ThemeMode;
  accent: string;
}

/**
 * Precedência: escolha do USUÁRIO (user_settings) ?? padrão da ORG
 * (organizations.theme) ?? padrão do app (claro + #7431B3). Campos são
 * independentes (usuário pode sobrepor só o modo e herdar a cor, e vice-versa).
 */
export function resolveTheme(
  user: { theme?: string | null; accentColor?: string | null } | null,
  org: OrgThemeDefault | null
): ResolvedTheme {
  const mode =
    normalizeThemeMode(user?.theme) ?? normalizeThemeMode(org?.mode) ?? "light";
  const accent =
    normalizeHexColor(user?.accentColor) ??
    normalizeHexColor(org?.accentColor) ??
    DEFAULT_ACCENT;
  return { mode, accent };
}

/** Cor do Ponteiro Laser: escolha do USUÁRIO ?? padrão do app (vermelho). */
export function resolveLaserColor(
  user: { laserColor?: string | null } | null
): string {
  return normalizeHexColor(user?.laserColor) ?? DEFAULT_LASER;
}

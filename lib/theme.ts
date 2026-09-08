// Versão: 1.1 | Data: 03/08/2026
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

export type ThemeMode = "light" | "dark" | "system";

export interface OrgThemeDefault {
  mode?: ThemeMode;
  accentColor?: string;
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
  const raw = v as { mode?: unknown; accentColor?: unknown };
  const mode = normalizeThemeMode(raw.mode) ?? undefined;
  const accentColor = normalizeHexColor(raw.accentColor) ?? undefined;
  if (!mode && !accentColor) return null;
  return { mode, accentColor };
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

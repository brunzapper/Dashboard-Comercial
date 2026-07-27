// Versão: 1.0 | Data: 27/07/2026
// Server Actions da aba Configurações → Tema.
// - saveThemePreferences: preferência PESSOAL (user_settings.settings.theme/
//   accentColor; null = volta a herdar o padrão da org). Grava também os
//   cookies theme_mode/theme_accent com os valores EFETIVOS resolvidos
//   (resolveTheme) — a próxima request já sai correta do SSR.
// - saveOrgThemeDefault: padrão da ORGANIZAÇÃO (organizations.theme, 0108) —
//   só org_admin (RLS organizations_update é a muralha). Também atualiza os
//   cookies do PRÓPRIO admin (a escolha individual dele, se houver, prevalece
//   na resolução).
// Sanitização SEMPRE por lib/theme.ts (whitelists) — nada cru vai ao banco
// nem aos cookies.
"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrg } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import {
  ACCENT_COOKIE,
  THEME_COOKIE,
  normalizeHexColor,
  normalizeThemeMode,
  resolveTheme,
  type OrgThemeDefault,
  type ThemeMode,
} from "@/lib/theme";
import type { UserAppSettings } from "@/app/(app)/dashboards/actions";

export interface ThemeActionState {
  ok?: boolean;
  message?: string;
}

const YEAR = 60 * 60 * 24 * 365;

async function setEffectiveCookies(
  user: { theme?: string | null; accentColor?: string | null },
  org: OrgThemeDefault | null
): Promise<void> {
  const effective = resolveTheme(user, org);
  const store = await cookies();
  store.set(THEME_COOKIE, effective.mode, {
    path: "/",
    maxAge: YEAR,
    sameSite: "lax",
  });
  store.set(ACCENT_COOKIE, effective.accent, {
    path: "/",
    maxAge: YEAR,
    sameSite: "lax",
  });
}

/**
 * Preferência pessoal. `theme`/`accentColor` null = limpa (herda o padrão da
 * org); valor inválido é tratado como null (whitelist).
 */
export async function saveThemePreferences(input: {
  theme?: string | null;
  accentColor?: string | null;
}): Promise<ThemeActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };

  const theme = normalizeThemeMode(input.theme);
  const accentColor = normalizeHexColor(input.accentColor);

  const supabase = await createClient();
  const { data } = await supabase
    .from("user_settings")
    .select("settings")
    .eq("user_id", session.user.id)
    .maybeSingle();
  const current = (data?.settings as UserAppSettings | null) ?? {};
  const { error } = await supabase.from("user_settings").upsert(
    {
      user_id: session.user.id,
      settings: { ...current, theme, accentColor },
    },
    { onConflict: "user_id" }
  );
  if (error) return { ok: false, message: error.message };

  const org = await getActiveOrg();
  await setEffectiveCookies({ theme, accentColor }, org?.theme ?? null);
  revalidatePath("/", "layout");
  return { ok: true, message: "Tema salvo." };
}

/**
 * Padrão da organização (org_admin). `mode`/`accentColor` null = sem padrão
 * naquele campo (vale o padrão do app para quem não escolheu nada).
 */
export async function saveOrgThemeDefault(input: {
  mode?: string | null;
  accentColor?: string | null;
}): Promise<ThemeActionState> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, message: "Organização não encontrada." };
  if (!org.isOrgAdmin) {
    return { ok: false, message: "Apenas o Administrador de Organização." };
  }

  const mode = normalizeThemeMode(input.mode);
  const accentColor = normalizeHexColor(input.accentColor);
  const theme: Record<string, string> = {};
  if (mode) theme.mode = mode;
  if (accentColor) theme.accentColor = accentColor;

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ theme })
    .eq("id", org.id);
  if (error) return { ok: false, message: error.message };

  // Cookies do próprio admin: a preferência individual dele segue na frente.
  const session = await getSessionInfo();
  if (session) {
    const { data } = await supabase
      .from("user_settings")
      .select("settings")
      .eq("user_id", session.user.id)
      .maybeSingle();
    const own = (data?.settings as UserAppSettings | null) ?? {};
    await setEffectiveCookies(own, {
      mode: (mode ?? undefined) as ThemeMode | undefined,
      accentColor: accentColor ?? undefined,
    });
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Padrão da organização salvo." };
}

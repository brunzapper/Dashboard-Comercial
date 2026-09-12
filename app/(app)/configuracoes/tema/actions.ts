// Versão: 1.2 | Data: 12/09/2026
// v1.2 (12/09/2026): TOKENS DE TEMA (0141) — o trio passou a quarteto: as duas
//   actions gravam também o conjunto curado de cores por modo, e o cookie
//   theme_tokens carrega os valores EFETIVOS (usuário ?? org), token a token,
//   para o root layout aplicar sem consultar o banco.
//   E as PREFERÊNCIAS DE INTERFACE da organização: saveOrgUiPrefs (padrão +
//   travas por chave) e propagateUiPrefs, que APAGA o override dos membros —
//   ver o comentário da própria função para por que apagar e não escrever.
// Server Actions da aba Configurações → Tema.
// - saveThemePreferences: preferência PESSOAL (user_settings.settings.theme/
//   accentColor/laserColor; null = volta a herdar o padrão da org — laser
//   herda direto o padrão do app, vermelho). Grava também os cookies
//   theme_mode/theme_accent com os valores EFETIVOS resolvidos (resolveTheme)
//   — a próxima request já sai correta do SSR. A cor do laser NÃO tem cookie
//   (só a página do dashboard a lê, no SSR autenticado).
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
import { createServiceClient } from "@/lib/supabase/service";
import {
  ACCENT_COOKIE,
  THEME_COOKIE,
  TOKENS_COOKIE,
  hasThemeTokens,
  normalizeHexColor,
  normalizeThemeMode,
  normalizeThemeTokens,
  resolveTheme,
  resolveThemeTokens,
  type OrgThemeDefault,
  type ThemeMode,
  type ThemeTokens,
} from "@/lib/theme";
import {
  UI_PREF_KEYS,
  normalizeOrgUiPrefs,
  normalizeUiPrefs,
  type UiPrefKey,
  type UiPrefs,
} from "@/lib/config/ui-prefs";
import type { UserAppSettings } from "@/app/(app)/dashboards/actions";

export interface ThemeActionState {
  ok?: boolean;
  message?: string;
}

const YEAR = 60 * 60 * 24 * 365;

async function setEffectiveCookies(
  user: {
    theme?: string | null;
    accentColor?: string | null;
    themeTokens?: unknown;
  },
  org: OrgThemeDefault | null
): Promise<void> {
  const effective = resolveTheme(user, org);
  const tokens = resolveThemeTokens(user.themeTokens, org?.tokens);
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
  // Cookie de tokens só existe quando há cor definida — quem nunca mexeu não
  // carrega payload nenhum, e limpar tudo tem de APAGAR o cookie (não gravar
  // "{}", que continuaria sendo lido a cada request).
  if (hasThemeTokens(tokens)) {
    store.set(TOKENS_COOKIE, JSON.stringify(tokens), {
      path: "/",
      maxAge: YEAR,
      sameSite: "lax",
    });
  } else {
    store.delete(TOKENS_COOKIE);
  }
}

/**
 * Preferência pessoal. `theme`/`accentColor`/`laserColor` null = limpa (herda
 * o padrão da org; laser volta ao vermelho padrão do app); valor inválido é
 * tratado como null (whitelist). As três chaves são sobrescritas a cada save —
 * o form envia SEMPRE o trio.
 */
export async function saveThemePreferences(input: {
  theme?: string | null;
  accentColor?: string | null;
  laserColor?: string | null;
  /** Tokens por modo (0141); ausente/vazio = herda a org. */
  themeTokens?: unknown;
}): Promise<ThemeActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };

  const theme = normalizeThemeMode(input.theme);
  const accentColor = normalizeHexColor(input.accentColor);
  const laserColor = normalizeHexColor(input.laserColor);
  const parsedTokens = normalizeThemeTokens(input.themeTokens);
  const themeTokens: ThemeTokens | null = hasThemeTokens(parsedTokens)
    ? parsedTokens
    : null;

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
      settings: { ...current, theme, accentColor, laserColor, themeTokens },
    },
    { onConflict: "user_id" }
  );
  if (error) return { ok: false, message: error.message };

  const org = await getActiveOrg();
  await setEffectiveCookies({ theme, accentColor, themeTokens }, org?.theme ?? null);
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
  themeTokens?: unknown;
}): Promise<ThemeActionState> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, message: "Organização não encontrada." };
  if (!org.isOrgAdmin) {
    return { ok: false, message: "Apenas o Administrador de Organização." };
  }

  const mode = normalizeThemeMode(input.mode);
  const accentColor = normalizeHexColor(input.accentColor);
  const parsedTokens = normalizeThemeTokens(input.themeTokens);
  const theme: Record<string, unknown> = {};
  if (mode) theme.mode = mode;
  if (accentColor) theme.accentColor = accentColor;
  if (hasThemeTokens(parsedTokens)) theme.tokens = parsedTokens;

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
      tokens: hasThemeTokens(parsedTokens) ? parsedTokens : undefined,
    });
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Padrão da organização salvo." };
}

// ---------------------------------------------------------------------------
// Preferências de INTERFACE da organização (0141)

/**
 * Padrão da org + TRAVAS por chave. Só org_admin (a RLS de organizations é a
 * muralha). A trava não apaga o override de ninguém: enquanto ela existe o
 * resolver ignora a escolha pessoal, e destravar devolve cada um à sua.
 */
export async function saveOrgUiPrefs(input: {
  values?: unknown;
  locked?: unknown;
  operacaoDescriptions?: unknown;
}): Promise<ThemeActionState> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, message: "Organização não encontrada." };
  if (!org.isOrgAdmin) {
    return { ok: false, message: "Apenas o Administrador de Organização." };
  }

  // Reparse pelo mesmo normalizador do resolver: chave desconhecida e valor
  // inválido somem ANTES do banco, nunca na leitura.
  const parsed = normalizeOrgUiPrefs({
    values: input.values,
    locked: input.locked,
    operacaoDescriptions: input.operacaoDescriptions,
  });

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({
      ui_prefs: {
        values: parsed.values,
        locked: [...parsed.locked],
        operacaoDescriptions: parsed.operacaoDescriptions,
      },
    })
    .eq("id", org.id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true, message: "Padrão da organização salvo." };
}

/**
 * "Aplicar a todos": APAGA o override dos membros da org para as chaves
 * indicadas, em vez de escrever o valor em cada linha.
 *
 * Por que apagar: o efeito visível é o mesmo (todo mundo passa a ver o valor da
 * org), mas quem apaga não precisa reescrever N linhas a cada mudança futura do
 * padrão — e o usuário volta a poder escolher depois, o que gravar o valor na
 * linha dele não permitiria distinguir de uma escolha própria.
 *
 * `user_settings` é own-row na RLS e não tem organization_id, então a limpeza
 * roda com service role e o escopo vem EXPLICITAMENTE de organization_members
 * da org ativa — nunca de uma varredura global.
 */
export async function propagateUiPrefs(
  keys: UiPrefKey[]
): Promise<ThemeActionState & { affected?: number }> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, message: "Organização não encontrada." };
  if (!org.isOrgAdmin) {
    return { ok: false, message: "Apenas o Administrador de Organização." };
  }
  const valid = keys.filter((k) => UI_PREF_KEYS.includes(k));
  if (valid.length === 0) {
    return { ok: false, message: "Nenhuma preferência selecionada." };
  }

  const service = createServiceClient();
  const { data: members, error: memberErr } = await service
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", org.id);
  if (memberErr) return { ok: false, message: memberErr.message };
  const userIds = (members ?? []).map((m) => m.user_id as string);
  if (userIds.length === 0) return { ok: true, affected: 0 };

  const { data: rows, error: rowsErr } = await service
    .from("user_settings")
    .select("user_id, settings")
    .in("user_id", userIds);
  if (rowsErr) return { ok: false, message: rowsErr.message };

  let affected = 0;
  for (const row of rows ?? []) {
    const settings = (row.settings as UserAppSettings | null) ?? {};
    // A chave legada `sidebarPinned` mora na RAIZ; limpar só o bloco `uiPrefs`
    // a deixaria mandando para sempre em quem nunca abriu a tela nova.
    const current: UiPrefs = normalizeUiPrefs(settings.uiPrefs, settings);
    const next: UiPrefs = { ...current };
    let changed = false;
    for (const key of valid) {
      if (next[key] !== undefined) {
        delete next[key];
        changed = true;
      }
    }
    const rootLegacy =
      valid.includes("sidebarPinned") && settings.sidebarPinned !== undefined;
    if (!changed && !rootLegacy) continue;
    const nextSettings: UserAppSettings = { ...settings, uiPrefs: next };
    if (rootLegacy) delete nextSettings.sidebarPinned;
    const { error } = await service
      .from("user_settings")
      .update({ settings: nextSettings })
      .eq("user_id", row.user_id as string);
    if (error) return { ok: false, message: error.message };
    affected += 1;
  }

  revalidatePath("/", "layout");
  return {
    ok: true,
    affected,
    message:
      affected === 0
        ? "Ninguém tinha escolha própria nessas preferências."
        : `Aplicado a ${affected} pessoa(s).`,
  };
}

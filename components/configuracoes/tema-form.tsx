// Versão: 1.2 | Data: 12/09/2026
// v1.2 (12/09/2026): editor dos TOKENS DE TEMA (0141) — o conjunto curado de
//   superfícies (fundo, texto, cartão, silenciado, borda e as três da barra
//   lateral), com colunas separadas para CLARO e ESCURO: são cores diferentes
//   para o mesmo papel, e um valor só não serve aos dois. Prévia ao vivo pelo
//   mesmo caminho do accent (o script do layout não re-roda em navegação
//   client). O estado do form virou um objeto único: a action sobrescreve
//   todas as chaves a cada save, então todo save precisa levar o conjunto
//   inteiro — com quatro variáveis soltas, esquecer uma apagaria a escolha.
// Forms da aba Configurações → Tema.
// - TemaForm: preferência PESSOAL (modo claro/escuro/sistema + cor de
//   destaque + cor do Ponteiro Laser). Aplica AO VIVO no documentElement
//   (classe .dark + --brand-base) e persiste via saveThemePreferences
//   (debounce nas cores) — scripts inline do layout não re-rodam em navegação
//   client, então o form é responsável pelo apply imediato. A cor do laser
//   não tem apply vivo (só a página do dashboard a usa).
// - OrgThemeDefaultForm: padrão da ORGANIZAÇÃO (org_admin) — salvar explícito;
//   router.refresh() propaga (cookies do admin saem da action).
// Sem preferência escolhida, o rótulo indica de onde o valor efetivo herda.
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  DEFAULT_ACCENT,
  DEFAULT_LASER,
  EMPTY_THEME_TOKENS,
  THEME_TOKENS,
  THEME_TOKEN_LABELS,
  normalizeHexColor,
  resolveTheme,
  resolveThemeTokens,
  themeTokenStyle,
  type OrgThemeDefault,
  type ThemeMode,
  type ThemeToken,
  type ThemeTokenMap,
  type ThemeTokens,
} from "@/lib/theme";
import {
  saveOrgThemeDefault,
  saveThemePreferences,
  type ThemeActionState,
} from "@/app/(app)/configuracoes/tema/actions";

const MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
  { value: "system", label: "Sistema" },
];

const MODE_LABELS: Record<ThemeMode, string> = {
  light: "Claro",
  dark: "Escuro",
  system: "Sistema",
};

/** Aplica modo+cor+tokens no <html> (mesma lógica do script do root layout). */
function applyThemeClient(
  mode: ThemeMode,
  accent: string,
  tokens: ThemeTokens = EMPTY_THEME_TOKENS
) {
  const el = document.documentElement;
  const dark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  el.classList.toggle("dark", dark);
  if (accent === DEFAULT_ACCENT) el.style.removeProperty("--brand-base");
  else el.style.setProperty("--brand-base", accent);
  // Aplica o modo vigente e LIMPA o que era do outro: sem isso uma cor
  // definida só no claro sobreviveria à troca para o escuro.
  const on = themeTokenStyle(dark ? tokens.dark : tokens.light);
  const off = themeTokenStyle(dark ? tokens.light : tokens.dark);
  for (const key of Object.keys(off)) {
    if (!(key in on)) el.style.removeProperty(key);
  }
  for (const [key, value] of Object.entries(on)) {
    el.style.setProperty(key, value);
  }
}

/**
 * Editor de um conjunto de tokens (uma coluna por modo). Componente único —
 * serve à preferência pessoal e ao padrão da organização, que editam o MESMO
 * formato.
 */
function TokenEditor({
  idPrefix,
  tokens,
  onChange,
  /** Cor que o campo mostra quando o token não foi definido naquele modo. */
  placeholders,
}: {
  idPrefix: string;
  tokens: ThemeTokens;
  onChange: (next: ThemeTokens) => void;
  placeholders?: { light?: ThemeTokenMap; dark?: ThemeTokenMap };
}) {
  const setToken = (
    mode: "light" | "dark",
    token: ThemeToken,
    value: string | null
  ) => {
    const map: ThemeTokenMap = { ...tokens[mode] };
    if (value === null) delete map[token];
    else map[token] = value;
    onChange({ ...tokens, [mode]: map });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-muted-foreground grid grid-cols-[1fr_auto_auto] items-center gap-x-3 text-xs">
        <span />
        <span className="w-28 text-center">Claro</span>
        <span className="w-28 text-center">Escuro</span>
      </div>
      {THEME_TOKENS.map((token) => (
        <div
          key={token}
          className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3"
        >
          <Label htmlFor={`${idPrefix}-${token}-light`} className="text-xs">
            {THEME_TOKEN_LABELS[token]}
          </Label>
          {(["light", "dark"] as const).map((mode) => {
            const value = tokens[mode][token];
            const fallback = placeholders?.[mode]?.[token];
            return (
              <div key={mode} className="flex w-28 items-center gap-1">
                <input
                  id={`${idPrefix}-${token}-${mode}`}
                  type="color"
                  value={value ?? fallback ?? "#ffffff"}
                  onChange={(e) => {
                    const hex = normalizeHexColor(e.target.value);
                    if (hex) setToken(mode, token, hex);
                  }}
                  aria-label={`${THEME_TOKEN_LABELS[token]} — modo ${
                    mode === "light" ? "claro" : "escuro"
                  }`}
                  className="h-8 w-12 cursor-pointer rounded-md border bg-transparent p-1"
                />
                <button
                  type="button"
                  onClick={() => setToken(mode, token, null)}
                  disabled={value === undefined}
                  title="Voltar ao padrão"
                  aria-label={`Restaurar ${THEME_TOKEN_LABELS[token]} no modo ${
                    mode === "light" ? "claro" : "escuro"
                  }`}
                  className="text-muted-foreground hover:text-foreground text-xs disabled:opacity-30"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ModePicker({
  value,
  onPick,
  allowClear,
}: {
  value: ThemeMode | null;
  onPick: (mode: ThemeMode | null) => void;
  allowClear?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {MODE_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onPick(active && allowClear ? null : opt.value)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm transition-colors",
              active
                ? "border-brand bg-brand text-brand-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

interface UserThemePrefs {
  theme: ThemeMode | null;
  accent: string | null;
  laser: string | null;
  tokens: ThemeTokens;
}

export function TemaForm({
  userTheme,
  userAccent,
  userLaser,
  userTokens = EMPTY_THEME_TOKENS,
  orgTheme,
}: {
  userTheme: ThemeMode | null;
  userAccent: string | null;
  userLaser: string | null;
  userTokens?: ThemeTokens;
  orgTheme: OrgThemeDefault | null;
}) {
  // Estado ÚNICO: a action sobrescreve todas as chaves a cada save, então todo
  // save precisa carregar o conjunto inteiro.
  const [prefs, setPrefs] = useState<UserThemePrefs>({
    theme: userTheme,
    accent: userAccent,
    laser: userLaser,
    tokens: userTokens,
  });
  const { theme, accent, laser, tokens } = prefs;
  const [hexDraft, setHexDraft] = useState<string>(userAccent ?? "");
  const [laserHexDraft, setLaserHexDraft] = useState<string>(userLaser ?? "");
  const [state, setState] = useState<ThemeActionState>({});
  const [, startTransition] = useTransition();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effective = resolveTheme(
    { theme, accentColor: accent },
    orgTheme
  );
  // O que a org define serve de placeholder: o campo mostra a cor que VALE
  // hoje, mesmo quando este usuário não escolheu nada.
  const orgTokens = resolveThemeTokens(null, orgTheme?.tokens);
  const effectiveLaser = laser ?? DEFAULT_LASER;

  // Modo "sistema": segue trocas do SO ao vivo enquanto a página está aberta.
  useEffect(() => {
    if (effective.mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () =>
      document.documentElement.classList.toggle("dark", mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [effective.mode]);

  // A action sobrescreve TODAS as chaves a cada save — envia sempre o conjunto.
  const persist = (next: UserThemePrefs) => {
    startTransition(async () => {
      const res = await saveThemePreferences({
        theme: next.theme,
        accentColor: next.accent,
        laserColor: next.laser,
        themeTokens: next.tokens,
      });
      setState(res);
    });
  };

  const update = (patch: Partial<UserThemePrefs>, debounce = false) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    const eff = resolveTheme(
      { theme: next.theme, accentColor: next.accent },
      orgTheme
    );
    applyThemeClient(
      eff.mode,
      eff.accent,
      resolveThemeTokens(next.tokens, orgTheme?.tokens)
    );
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (debounce) {
      saveTimer.current = setTimeout(() => persist(next), 400);
    } else {
      persist(next);
    }
  };

  const herdaModo = theme == null;
  const herdaCor = accent == null;
  const origemModo = orgTheme?.mode
    ? `padrão da organização (${MODE_LABELS[orgTheme.mode]})`
    : "padrão do app (Claro)";
  const origemCor = orgTheme?.accentColor
    ? `padrão da organização (${orgTheme.accentColor})`
    : `padrão do app (${DEFAULT_ACCENT})`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label className="text-xs">Modo</Label>
        <ModePicker
          value={theme}
          allowClear
          onPick={(mode) => update({ theme: mode })}
        />
        {herdaModo ? (
          <p className="text-muted-foreground text-xs">
            Herdando o {origemModo}.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="tema-accent" className="text-xs">
          Cor de destaque
        </Label>
        <p className="text-muted-foreground text-xs">
          Usada em detalhes sutis (abas ativas, seleções, foco, barras de
          progresso). Prefira cores escuras o suficiente para manter o
          contraste.
        </p>
        <div className="flex items-center gap-2">
          <input
            id="tema-accent"
            type="color"
            value={effective.accent}
            onChange={(e) => {
              const hex = normalizeHexColor(e.target.value);
              if (!hex) return;
              setHexDraft(hex);
              update({ accent: hex }, true);
            }}
            className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
          />
          <Input
            value={hexDraft}
            onChange={(e) => {
              setHexDraft(e.target.value);
              const hex = normalizeHexColor(e.target.value);
              if (hex) update({ accent: hex }, true);
            }}
            placeholder={effective.accent}
            maxLength={7}
            className="h-9 w-28 font-mono text-sm"
          />
        </div>
        {herdaCor ? (
          <p className="text-muted-foreground text-xs">
            Herdando o {origemCor}.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="tema-laser" className="text-xs">
          Ponteiro laser (apresentação)
        </Label>
        <p className="text-muted-foreground text-xs">
          Cor do rastro do Ponteiro Laser no dashboard (clique direito sobre um
          widget para ativar).
        </p>
        <div className="flex items-center gap-2">
          <input
            id="tema-laser"
            type="color"
            value={effectiveLaser}
            onChange={(e) => {
              const hex = normalizeHexColor(e.target.value);
              if (!hex) return;
              setLaserHexDraft(hex);
              update({ laser: hex }, true);
            }}
            className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
          />
          <Input
            value={laserHexDraft}
            onChange={(e) => {
              setLaserHexDraft(e.target.value);
              const hex = normalizeHexColor(e.target.value);
              if (hex) update({ laser: hex }, true);
            }}
            placeholder={effectiveLaser}
            maxLength={7}
            className="h-9 w-28 font-mono text-sm"
          />
        </div>
        {laser == null ? (
          <p className="text-muted-foreground text-xs">
            Padrão do app ({DEFAULT_LASER} — vermelho).
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 border-t pt-6">
        <Label className="text-xs">Cores do sistema</Label>
        <p className="text-muted-foreground text-xs">
          Superfícies do app inteiro — fundo, textos, cartões, bordas e a barra
          lateral. Claro e escuro são cores diferentes para o mesmo papel, por
          isso cada um tem a sua coluna. O ✕ devolve o token ao padrão.
        </p>
        <TokenEditor
          idPrefix="tema-user"
          tokens={tokens}
          onChange={(next) => update({ tokens: next }, true)}
          placeholders={{ light: orgTokens.light, dark: orgTokens.dark }}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setHexDraft("");
            setLaserHexDraft("");
            update({ theme: null, accent: null, laser: null, tokens: EMPTY_THEME_TOKENS });
          }}
        >
          Restaurar padrão
        </Button>
        {state.message ? (
          <p
            className={cn(
              "text-xs",
              state.ok ? "text-muted-foreground" : "text-destructive"
            )}
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function OrgThemeDefaultForm({
  orgMode,
  orgAccent,
  orgTokens = EMPTY_THEME_TOKENS,
}: {
  orgMode: ThemeMode | null;
  orgAccent: string | null;
  orgTokens?: ThemeTokens;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<ThemeMode | null>(orgMode);
  const [accent, setAccentState] = useState<string | null>(orgAccent);
  const [tokens, setTokens] = useState<ThemeTokens>(orgTokens);
  const [hexDraft, setHexDraft] = useState<string>(orgAccent ?? "");
  const [state, setState] = useState<ThemeActionState>({});
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      const res = await saveOrgThemeDefault({
        mode,
        accentColor: accent,
        themeTokens: tokens,
      });
      setState(res);
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label className="text-xs">Modo padrão</Label>
        <ModePicker value={mode} allowClear onPick={setMode} />
        {mode == null ? (
          <p className="text-muted-foreground text-xs">
            Sem padrão — vale o padrão do app (Claro).
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="org-accent" className="text-xs">
          Cor de destaque padrão
        </Label>
        <div className="flex items-center gap-2">
          <input
            id="org-accent"
            type="color"
            value={accent ?? DEFAULT_ACCENT}
            onChange={(e) => {
              const hex = normalizeHexColor(e.target.value);
              if (!hex) return;
              setHexDraft(hex);
              setAccentState(hex);
            }}
            className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
          />
          <Input
            value={hexDraft}
            onChange={(e) => {
              setHexDraft(e.target.value);
              const hex = normalizeHexColor(e.target.value);
              if (hex) setAccentState(hex);
            }}
            placeholder={DEFAULT_ACCENT}
            maxLength={7}
            className="h-9 w-28 font-mono text-sm"
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setHexDraft("");
              setAccentState(null);
            }}
          >
            Limpar cor
          </Button>
        </div>
        {accent == null ? (
          <p className="text-muted-foreground text-xs">
            Sem cor padrão — vale a do app ({DEFAULT_ACCENT}).
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label className="text-xs">Cores do sistema (padrão)</Label>
        <p className="text-muted-foreground text-xs">
          Valem para quem não escolheu a própria cor naquele token. Salvar é
          explícito — diferente da preferência pessoal, que aplica ao vivo.
        </p>
        <TokenEditor
          idPrefix="org-token"
          tokens={tokens}
          onChange={setTokens}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" disabled={pending} onClick={save}>
          Salvar padrão da organização
        </Button>
        {state.message ? (
          <p
            className={cn(
              "text-xs",
              state.ok ? "text-muted-foreground" : "text-destructive"
            )}
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

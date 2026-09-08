// Versão: 1.1 | Data: 03/08/2026
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
  normalizeHexColor,
  resolveTheme,
  type OrgThemeDefault,
  type ThemeMode,
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

/** Aplica modo+cor no <html> (mesma lógica do script inline do root layout). */
function applyThemeClient(mode: ThemeMode, accent: string) {
  const el = document.documentElement;
  const dark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  el.classList.toggle("dark", dark);
  if (accent === DEFAULT_ACCENT) el.style.removeProperty("--brand-base");
  else el.style.setProperty("--brand-base", accent);
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

export function TemaForm({
  userTheme,
  userAccent,
  userLaser,
  orgTheme,
}: {
  userTheme: ThemeMode | null;
  userAccent: string | null;
  userLaser: string | null;
  orgTheme: OrgThemeDefault | null;
}) {
  const [theme, setTheme] = useState<ThemeMode | null>(userTheme);
  const [accent, setAccent] = useState<string | null>(userAccent);
  const [hexDraft, setHexDraft] = useState<string>(userAccent ?? "");
  const [laser, setLaser] = useState<string | null>(userLaser);
  const [laserHexDraft, setLaserHexDraft] = useState<string>(userLaser ?? "");
  const [state, setState] = useState<ThemeActionState>({});
  const [, startTransition] = useTransition();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effective = resolveTheme(
    { theme, accentColor: accent },
    orgTheme
  );
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

  // A action sobrescreve as TRÊS chaves a cada save — envia sempre o trio.
  const persist = (next: {
    theme: ThemeMode | null;
    accent: string | null;
    laser: string | null;
  }) => {
    startTransition(async () => {
      const res = await saveThemePreferences({
        theme: next.theme,
        accentColor: next.accent,
        laserColor: next.laser,
      });
      setState(res);
    });
  };

  const update = (
    next: {
      theme: ThemeMode | null;
      accent: string | null;
      laser: string | null;
    },
    debounce = false
  ) => {
    setTheme(next.theme);
    setAccent(next.accent);
    setLaser(next.laser);
    const eff = resolveTheme(
      { theme: next.theme, accentColor: next.accent },
      orgTheme
    );
    applyThemeClient(eff.mode, eff.accent);
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
          onPick={(mode) => update({ theme: mode, accent, laser })}
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
              update({ theme, accent: hex, laser }, true);
            }}
            className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
          />
          <Input
            value={hexDraft}
            onChange={(e) => {
              setHexDraft(e.target.value);
              const hex = normalizeHexColor(e.target.value);
              if (hex) update({ theme, accent: hex, laser }, true);
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
              update({ theme, accent, laser: hex }, true);
            }}
            className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
          />
          <Input
            value={laserHexDraft}
            onChange={(e) => {
              setLaserHexDraft(e.target.value);
              const hex = normalizeHexColor(e.target.value);
              if (hex) update({ theme, accent, laser: hex }, true);
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

      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setHexDraft("");
            setLaserHexDraft("");
            update({ theme: null, accent: null, laser: null });
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
}: {
  orgMode: ThemeMode | null;
  orgAccent: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<ThemeMode | null>(orgMode);
  const [accent, setAccentState] = useState<string | null>(orgAccent);
  const [hexDraft, setHexDraft] = useState<string>(orgAccent ?? "");
  const [state, setState] = useState<ThemeActionState>({});
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      const res = await saveOrgThemeDefault({ mode, accentColor: accent });
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

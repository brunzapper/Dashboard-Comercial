// Versão: 1.0 | Data: 12/09/2026
// Padrão de INTERFACE da organização (0141) — só org_admin.
//
// Três coisas distintas, que a tela precisa manter distintas:
//  1. DEFINIR o padrão: vale para quem nunca escolheu nada.
//  2. TRAVAR uma chave: enquanto travada, o valor da org vence a escolha
//     pessoal de todo mundo. Não apaga nada — destravar devolve cada um à sua.
//  3. APLICAR A TODOS: apaga o override dos membros naquelas chaves. É a única
//     das três que não tem volta, então fica atrás de confirmação.
//
// O admin que quiser só ajustar a PRÓPRIA visão usa os controles do hub, como
// qualquer pessoa — nada aqui toca a visão dos outros sem ele pedir.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  MAX_HUB_COLUMNS,
  MIN_HUB_COLUMNS,
  UI_PREF_DEFAULTS,
  UI_PREF_KEYS,
  UI_PREF_LABELS,
  type UiPrefKey,
  type UiPrefs,
} from "@/lib/config/ui-prefs";
import {
  propagateUiPrefs,
  saveOrgUiPrefs,
  type ThemeActionState,
} from "@/app/(app)/configuracoes/tema/actions";

const LAYOUT_KEYS = new Set<UiPrefKey>(["hubLayout", "operacaoLayout"]);
const NUMBER_KEYS = new Set<UiPrefKey>(["hubColumns", "operacaoColumns"]);

export function OrgUiPrefsForm({
  initialValues,
  initialLocked,
}: {
  initialValues: UiPrefs;
  initialLocked: UiPrefKey[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<UiPrefs>(initialValues);
  const [locked, setLocked] = useState<Set<UiPrefKey>>(
    () => new Set(initialLocked)
  );
  const [state, setState] = useState<ThemeActionState>({});
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const setValue = <K extends UiPrefKey>(key: K, value: UiPrefs[K] | undefined) =>
    setValues((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });

  const toggleLock = (key: UiPrefKey) =>
    setLocked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const save = () => {
    startTransition(async () => {
      const res = await saveOrgUiPrefs({
        values,
        locked: [...locked],
      });
      setState(res);
      if (res.ok) router.refresh();
    });
  };

  const propagate = () => {
    startTransition(async () => {
      // Propaga só o que a org realmente define — apagar o override de uma
      // chave sem padrão jogaria todo mundo no padrão do app sem querer.
      const keys = UI_PREF_KEYS.filter((k) => values[k] !== undefined);
      const res = await propagateUiPrefs(keys);
      setState(res);
      if (res.ok) router.refresh();
    });
  };

  const definedCount = UI_PREF_KEYS.filter(
    (k) => values[k] !== undefined
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {UI_PREF_KEYS.map((key) => {
          const value = values[key];
          const defined = value !== undefined;
          const effective = value ?? UI_PREF_DEFAULTS[key];
          return (
            <div
              key={key}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b py-1.5"
            >
              <Label className="text-sm font-normal">
                {UI_PREF_LABELS[key]}
                {!defined ? (
                  <span className="text-muted-foreground ml-2 text-xs">
                    sem padrão
                  </span>
                ) : null}
              </Label>

              <div className="w-40">
                {LAYOUT_KEYS.has(key) ? (
                  <select
                    value={defined ? String(effective) : ""}
                    onChange={(e) =>
                      setValue(
                        key,
                        e.target.value === ""
                          ? undefined
                          : (e.target.value as UiPrefs[typeof key])
                      )
                    }
                    className="border-input h-8 w-full rounded-md border bg-transparent px-2 text-sm"
                  >
                    <option value="">Sem padrão</option>
                    <option value="grid">Grade</option>
                    <option value="list">Lista</option>
                  </select>
                ) : NUMBER_KEYS.has(key) ? (
                  <select
                    value={defined ? String(effective) : ""}
                    onChange={(e) =>
                      setValue(
                        key,
                        e.target.value === ""
                          ? undefined
                          : (Number(e.target.value) as UiPrefs[typeof key])
                      )
                    }
                    className="border-input h-8 w-full rounded-md border bg-transparent px-2 text-sm"
                  >
                    <option value="">Sem padrão</option>
                    {Array.from(
                      { length: MAX_HUB_COLUMNS - MIN_HUB_COLUMNS + 1 },
                      (_, i) => MIN_HUB_COLUMNS + i
                    ).map((n) => (
                      <option key={n} value={n}>
                        {n} coluna{n > 1 ? "s" : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={defined ? (effective ? "sim" : "nao") : ""}
                    onChange={(e) =>
                      setValue(
                        key,
                        e.target.value === ""
                          ? undefined
                          : ((e.target.value === "sim") as UiPrefs[typeof key])
                      )
                    }
                    className="border-input h-8 w-full rounded-md border bg-transparent px-2 text-sm"
                  >
                    <option value="">Sem padrão</option>
                    <option value="sim">Sim</option>
                    <option value="nao">Não</option>
                  </select>
                )}
              </div>

              <label className="flex w-24 items-center gap-1.5">
                <Checkbox
                  checked={locked.has(key)}
                  onCheckedChange={() => toggleLock(key)}
                />
                <span className="text-muted-foreground text-xs">Travar</span>
              </label>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={pending} onClick={save}>
          Salvar padrão da organização
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || definedCount === 0}
          onClick={() => setConfirmOpen(true)}
        >
          Aplicar a todos
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
      <p className="text-muted-foreground text-xs">
        Travar mantém a escolha pessoal de cada um guardada — destravar a
        devolve. &quot;Aplicar a todos&quot; APAGA essas escolhas: quem tinha
        preferência própria passa a ver a da organização, e não há como
        recuperar o que ele havia escolhido.
      </p>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar a todos?</AlertDialogTitle>
            <AlertDialogDescription>
              As escolhas pessoais das {definedCount} preferência(s) que a
              organização define serão apagadas para todos os membros. Cada um
              poderá escolher de novo depois, mas o que estava escolhido não
              volta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setConfirmOpen(false);
                propagate();
              }}
            >
              Aplicar a todos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

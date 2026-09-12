// Versão: 1.0 | Data: 12/09/2026
// Estado de EXIBIÇÃO do hub (formato, colunas, altura do card, descrição,
// nível de acesso) no CLIENTE.
//
// Por que um contexto e não props do servidor: os cards são renderizados pelo
// RSC, então mudar um controle só aparecia depois de um `router.refresh()` —
// e o refresh reentregava o valor ANTIGO (a gravação corre por fora), o que
// desmarcava a caixa que a pessoa acabara de marcar. Agora o estado é do
// cliente, a tela responde no mesmo frame e a gravação vai em segundo plano
// SEM refresh: o servidor só precisa estar certo no próximo carregamento.
//
// A chave de preferência de cada controle vem em `keys` porque as duas
// famílias (Painéis e Operação) guardam em chaves diferentes e o resto do
// componente é idêntico.
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import { saveUiPrefs } from "@/app/(app)/dashboards/actions";
import type { HubLayout, UiPrefKey, UiPrefs } from "@/lib/config/ui-prefs";

export interface HubDisplay {
  layout: HubLayout;
  columns: number;
  /** Altura mínima do card em px; 0 = automática. */
  cardHeight: number;
  showDescription: boolean;
  showAccess: boolean;
}

/** Em qual chave de preferência cada campo desta família é gravado. */
export interface HubDisplayKeys {
  layout: UiPrefKey;
  columns: UiPrefKey;
  cardHeight: UiPrefKey;
  showDescription: UiPrefKey;
  showAccess: UiPrefKey;
}

interface HubDisplayValue {
  display: HubDisplay;
  keys: HubDisplayKeys;
  locked: ReadonlySet<UiPrefKey>;
  isLocked: (field: keyof HubDisplay) => boolean;
  set: (patch: Partial<HubDisplay>) => void;
  saving: boolean;
}

const Ctx = createContext<HubDisplayValue | null>(null);

export function useHubDisplay(): HubDisplayValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useHubDisplay precisa de <HubDisplayProvider>");
  }
  return ctx;
}

export function HubDisplayProvider({
  initial,
  keys,
  locked,
  children,
}: {
  initial: HubDisplay;
  keys: HubDisplayKeys;
  locked: UiPrefKey[];
  children: ReactNode;
}) {
  const [display, setDisplay] = useState(initial);
  const { save, pendingKeys } = useBackgroundSave();
  const lockedSet = useMemo(() => new Set(locked), [locked]);

  const isLocked = useCallback(
    (field: keyof HubDisplay) => lockedSet.has(keys[field]),
    [lockedSet, keys]
  );

  const set = useCallback(
    (patch: Partial<HubDisplay>) => {
      const entries = (Object.keys(patch) as (keyof HubDisplay)[]).filter(
        // Chave travada pela organização não é gravada nem aplicada: o
        // controle já vem desabilitado, isto é o cinto de segurança.
        (field) => !lockedSet.has(keys[field]) && patch[field] !== undefined
      );
      if (entries.length === 0) return;

      const before = { ...display };
      setDisplay((prev) => ({ ...prev, ...patch }));

      const prefPatch: UiPrefs = {};
      for (const field of entries) {
        (prefPatch as Record<string, unknown>)[keys[field]] = patch[field];
      }
      save({
        key: entries.map((f) => keys[f]).join(","),
        context: "Não foi possível salvar a preferência de exibição",
        action: () => saveUiPrefs(prefPatch),
        revert: () => setDisplay(before),
        // SEM refresh: o recorte já está aplicado no cliente, e um
        // router.refresh() aqui reentregaria o valor antigo do servidor por
        // cima do que a pessoa acabou de escolher.
        reconcile: false,
      });
    },
    [display, keys, lockedSet, save]
  );

  const value = useMemo<HubDisplayValue>(
    () => ({
      display,
      keys,
      locked: lockedSet,
      isLocked,
      set,
      saving: pendingKeys.size > 0,
    }),
    [display, keys, lockedSet, isLocked, set, pendingKeys]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Versão: 1.0 | Data: 12/07/2026
// Histórico de Desfazer/Refazer do dashboard (em memória, por sessão — máx. 10).
// A unidade é um SNAPSHOT completo do estado (nome + settings + widgets +
// células); desfazer = gravar de volta um snapshot anterior via server action.
//
// Como quase toda mutação revalida as props do RSC, o snapshot recomputado no
// servidor chega como a prop `seed` a cada render — então observamos a MUDANÇA
// dessa prop e registramos automaticamente qualquer alteração (inclusive tipos
// futuros), sem instrumentar cada botão. As poucas ações que não revalidam
// (arrastar layout via saveLayout) chamam `captureNow()` explicitamente.
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import {
  captureDashboardSnapshot,
  restoreDashboardSnapshot,
} from "@/app/(app)/dashboards/actions";
import type { DashboardSnapshot } from "@/lib/widgets/history";

const MAX_HISTORY = 10;

interface HistoryApi {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  isRestoring: boolean;
  // Captura o estado atual do servidor e registra uma entrada. Para as mudanças
  // que não revalidam as props (ex.: layout arrastado).
  captureNow: () => void;
}

const noop = () => {};
const HistoryContext = createContext<HistoryApi>({
  undo: noop,
  redo: noop,
  canUndo: false,
  canRedo: false,
  isRestoring: false,
  captureNow: noop,
});

export function useDashboardHistory(): HistoryApi {
  return useContext(HistoryContext);
}

export function DashboardHistoryProvider({
  dashboardId,
  seed,
  children,
}: {
  dashboardId: string;
  seed: DashboardSnapshot;
  children: ReactNode;
}) {
  const router = useRouter();

  // Pilhas e baseline vivem em refs (não precisam re-renderizar); só as flags
  // dos botões são estado.
  const pastRef = useRef<DashboardSnapshot[]>([]);
  const futureRef = useRef<DashboardSnapshot[]>([]);
  const baselineRef = useRef<DashboardSnapshot>(seed);
  const baselineJsonRef = useRef<string>(JSON.stringify(seed));

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  function syncFlags() {
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(futureRef.current.length > 0);
  }

  // Registra `snap` como novo estado atual. Ignora se for igual à baseline (ex.:
  // a prop que reflete o nosso próprio restore, ou um re-render sem mudança).
  function recordSnapshot(snap: DashboardSnapshot) {
    const j = JSON.stringify(snap);
    if (j === baselineJsonRef.current) return;
    pastRef.current = [...pastRef.current, baselineRef.current].slice(-MAX_HISTORY);
    futureRef.current = [];
    baselineRef.current = snap;
    baselineJsonRef.current = j;
    syncFlags();
  }

  // Observer: só re-executa quando o CONTEÚDO do seed muda (dep = string), então
  // uma captura explícita (que não mexe na prop) nunca dispara aqui por engano.
  const seedJson = JSON.stringify(seed);
  useEffect(() => {
    recordSnapshot(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedJson]);

  function captureNow() {
    void captureDashboardSnapshot(dashboardId).then((snap) => {
      if (snap) recordSnapshot(snap);
    });
  }

  async function applyRestore(target: DashboardSnapshot) {
    // Baseline otimista = alvo: quando a prop revalidada chegar igual ao alvo, o
    // observer a reconhece como baseline e não registra uma nova entrada.
    baselineRef.current = target;
    baselineJsonRef.current = JSON.stringify(target);
    syncFlags();
    setIsRestoring(true);
    try {
      await restoreDashboardSnapshot(dashboardId, target);
      router.refresh();
    } finally {
      setIsRestoring(false);
    }
  }

  function undo() {
    if (isRestoring || pastRef.current.length === 0) return;
    const target = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [...futureRef.current, baselineRef.current].slice(-MAX_HISTORY);
    void applyRestore(target);
  }

  function redo() {
    if (isRestoring || futureRef.current.length === 0) return;
    const target = futureRef.current[futureRef.current.length - 1];
    futureRef.current = futureRef.current.slice(0, -1);
    pastRef.current = [...pastRef.current, baselineRef.current].slice(-MAX_HISTORY);
    void applyRestore(target);
  }

  return (
    <HistoryContext.Provider
      value={{ undo, redo, canUndo, canRedo, isRestoring, captureNow }}
    >
      {children}
    </HistoryContext.Provider>
  );
}

// Versão: 1.0 | Data: 07/09/2026
// Contexto do SUB-ESCOPO da conversa com a IA da Operação. O painel vive no
// layout de /operacao (é isso que dá "uma janela própria quando se está dentro
// da Operação"), mas o recorte da conversa — qual domínio de mapeamento, qual
// plano de remuneração — é estado das TELAS. Em Mapeamentos o domínio ativo é
// `useState` local do manager e não está na URL, então só um contexto resolve;
// nas telas cujo recorte está na URL o manager publica dali. Mecanismo único
// para as duas, e o painel nunca precisa conhecer os query params de ninguém.
//
// O provider aceita telas que NÃO publicam nada: `target` fica vazio e o
// painel pede para escolher o item na tela antes do primeiro turno.
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

interface AiScopeValue {
  /** Alvo atual (domainKey, planId…) — "" quando a tela ainda não publicou. */
  target: string;
  /** Rótulo humano do alvo, exibido no cabeçalho do painel. */
  targetLabel: string;
  setTarget: (target: string, targetLabel: string) => void;
}

const Ctx = createContext<AiScopeValue | null>(null);

export function OperacaoAiScopeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [target, setTargetState] = useState("");
  const [targetLabel, setTargetLabel] = useState("");

  const setTarget = useCallback((next: string, label: string) => {
    setTargetState(next);
    setTargetLabel(label);
  }, []);

  const value = useMemo(
    () => ({ target, targetLabel, setTarget }),
    [target, targetLabel, setTarget]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Leitura (painel). Fora do provider devolve alvo vazio — nunca quebra. */
export function useOperacaoAiScope(): AiScopeValue {
  return (
    useContext(Ctx) ?? {
      target: "",
      targetLabel: "",
      setTarget: () => {},
    }
  );
}

/**
 * Publicação (telas). Mantém o alvo em dia sem que a tela precise saber que o
 * painel existe: basta chamar com o item selecionado. Fora do provider é
 * no-op, então o manager funciona igual em qualquer rota.
 */
export function usePublishOperacaoAiTarget(
  target: string,
  targetLabel: string
): void {
  const { setTarget } = useOperacaoAiScope();
  useEffect(() => {
    setTarget(target, targetLabel);
  }, [target, targetLabel, setTarget]);
}

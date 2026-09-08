// Versão: 1.0 | Data: 07/09/2026
// Monta o painel de IA da Operação conforme a SUB-ÁREA aberta. Precisa ser
// client porque o escopo sai do pathname — o layout de /operacao é um RSC e
// não re-renderiza a cada navegação entre sub-abas.
//
// A lista de escopos PERMITIDOS vem por prop do layout (que resolveu os gates
// no servidor): este componente só escolhe qual deles casa com a rota atual.
// Escopo sem entrada no registry ⇒ nenhum painel.
"use client";

import { usePathname } from "next/navigation";

import { AiOperacaoPanel } from "@/components/operacao/ai-operacao-panel";
import { scopeForPath, type OperacaoAiScopeMeta } from "@/lib/ai/operacao/scopes";

export function OperacaoAiPanelMount({
  scopes,
  ai,
}: {
  scopes: OperacaoAiScopeMeta[];
  ai: { provider: string; model: string; hasKey: boolean } | null;
}) {
  const pathname = usePathname();
  const scope = scopeForPath(pathname ?? "", scopes);
  if (!scope) return null;
  // `key` por escopo: trocar de sub-aba REMONTA o painel — conversa nova,
  // estado novo, e a carga da sessão continua sendo um evento (abrir), sem
  // precisar de um efeito que reagisse à mudança de escopo.
  return <AiOperacaoPanel key={scope.key} scope={scope} ai={ai} />;
}

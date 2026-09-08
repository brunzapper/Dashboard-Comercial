// Versão: 1.0 | Data: 05/08/2026
// Índice de /operacao: redireciona à primeira sub-aba visível (espelho do
// índice de Configurações). Sempre resolve — Agenda/Tarefas são cards padrão
// de toda org (sem gate de área); o fallback "/" é só cinto de segurança.
import { redirect } from "next/navigation";

import { allowedOperacaoCards } from "@/lib/operacao/cards";

export default async function OperacaoIndex() {
  const cards = await allowedOperacaoCards();
  redirect(cards[0]?.href ?? "/");
}

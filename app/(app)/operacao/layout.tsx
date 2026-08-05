// Versão: 1.0 | Data: 05/08/2026
// Área "Operação" (05/08/2026): agrupa como sub-abas os módulos de operação do
// dia a dia — Agenda e Tarefas (padrões de toda org; ex-itens do nav lateral) e
// Remuneração (org-específico; ex-aba de Configurações). As sub-abas espelham
// os CARDS de Operação do hub Workspace (aba "Operação" de /): catálogo único
// em lib/operacao/cards.ts — card/aba org-específico aparece só com
// checkSettingsArea(area) ok (feature-off > deny > allow > papel); as pages
// seguem autoprotegidas (requireSettingsArea/RLS) — aqui só se decide o que
// mostrar. Sem entrada própria no nav lateral: o acesso é pelo Workspace.
// ATENÇÃO à cadeia de altura: o calendário da Agenda depende de
// flex h-full min-h-0 até o wrapper dos children (não copiar o layout de
// Configurações verbatim — ele colapsaria a altura).
import { redirect } from "next/navigation";

import { getSessionInfo } from "@/lib/auth/session";
import { allowedOperacaoCards } from "@/lib/operacao/cards";
import { SettingsTabs } from "@/components/configuracoes/settings-tabs";

export default async function OperacaoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionInfo();
  if (!session) redirect("/login");

  const cards = await allowedOperacaoCards();

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <h1 className="text-2xl font-semibold">Operação</h1>
      <SettingsTabs
        tabs={cards.map(({ href, label }) => ({ href, label }))}
      />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

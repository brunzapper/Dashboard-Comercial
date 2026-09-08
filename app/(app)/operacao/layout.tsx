// Versão: 1.1 | Data: 08/09/2026
// v1.1 (08/09/2026): monta a JANELA DE IA DA OPERAÇÃO — um painel lateral
//   persistido, escopado pela sub-área aberta. Vive AQUI (e não nas pages)
//   porque é isso que o torna "a janela da Operação": ele acompanha a troca
//   de sub-aba. O layout resolve no SERVIDOR quais escopos o usuário pode
//   ver (mesma régua dos cards: checkSettingsArea + papel de escrita) e o
//   mount client só escolhe qual casa com a rota atual. O provider de
//   sub-escopo embrulha os children para que a TELA publique o item
//   selecionado (domínio, plano) ao painel.
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
import { checkSettingsArea } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { loadOrgAiConfigPublic } from "@/lib/ai/config";
import { OPERACAO_AI_SCOPES } from "@/lib/ai/operacao/scopes";
import { allowedOperacaoCards } from "@/lib/operacao/cards";
import { SettingsTabs } from "@/components/configuracoes/settings-tabs";
import { OperacaoAiScopeProvider } from "@/components/operacao/ai-scope-context";
import { OperacaoAiPanelMount } from "@/components/operacao/ai-panel-mount";

export default async function OperacaoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionInfo();
  if (!session) redirect("/login");

  const isAdmin = session.roles.includes("admin");
  const [cards, ai, scopeVerdicts] = await Promise.all([
    allowedOperacaoCards(),
    loadOrgAiConfigPublic(await getActiveOrgId()),
    // Escopos de IA que ESTE usuário pode usar. A régua é a mesma dos cards
    // (checkSettingsArea embute feature-off > deny > allow > papel), mais o
    // papel de escrita: a área `remuneracao` não tem gate de papel e a page
    // ramifica para "Minha remuneração", então sem este filtro um vendedor
    // veria um painel de ESCRITA que o servidor recusaria a cada turno.
    Promise.all(
      OPERACAO_AI_SCOPES.map(async (scope) =>
        (!scope.adminOnly || isAdmin) && (await checkSettingsArea(scope.key))
          ? scope
          : null
      )
    ),
  ]);
  const aiScopes = scopeVerdicts.filter((s) => s !== null);

  return (
    <OperacaoAiScopeProvider>
      <div className="flex h-full min-h-0 flex-col gap-6">
        <h1 className="text-2xl font-semibold">Operação</h1>
        <SettingsTabs
          tabs={cards.map(({ href, label }) => ({ href, label }))}
        />
        <div className="min-h-0 flex-1">{children}</div>
      </div>
      {aiScopes.length > 0 ? (
        <OperacaoAiPanelMount scopes={aiScopes} ai={ai} />
      ) : null}
    </OperacaoAiScopeProvider>
  );
}

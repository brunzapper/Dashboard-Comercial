// Versão: 1.0 | Data: 09/09/2026
// A TELA DE CONSTRUÇÃO de um esquema — o destino de clicar numa linha da lista.
//
// O parâmetro é o id que o CATÁLOGO já emite, com namespace: `schema:<uuid>`
// ou `rule:<uuid>` (lib/workflow/catalog.ts). Não inventamos chave nova, e o
// namespace já desambigua os dois tipos sem consultar as duas tabelas.
//
// Por que uma tela e não um card que expande: montar um fluxo (campos, passos,
// conexões) ou uma automação (condições, ação) é trabalho longo, e fazê-lo
// dentro de uma linha de lista espremia o construtor entre os vizinhos. Além
// disso, uma automação de BASE não tinha porta nenhuma — o único caminho de
// edição era "abrir o quadro", que ela não tem.
import { notFound, redirect } from "next/navigation";

import { requireSettingsArea } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { loadSources } from "@/lib/config/sources";
import { createClient } from "@/lib/supabase/server";
import {
  WORKFLOW_CONNECTION_KEYS,
  workflowConnectionStatus,
} from "@/lib/workflow/connections";
import { loadOrgAutomations } from "@/lib/workflow/automations-overview";
import { loadWorkflowSchemas } from "@/lib/workflow/schemas";
import { WorkflowRuleScreen } from "@/components/operacao/workflow-rule-screen";
import { WorkflowSchemaScreen } from "@/components/operacao/workflow-schema-screen";

export const metadata = { title: "Esquema" };

export default async function WorkflowItemPage({
  params,
}: {
  params: Promise<{ item: string }>;
}) {
  const session = await requireSettingsArea("workflow");
  const orgId = await getActiveOrgId();
  if (!orgId) return null;
  if (!session.roles.includes("admin")) redirect("/?aba=operacao");

  const { item } = await params;
  const [kind, ...rest] = decodeURIComponent(item).split(":");
  const id = rest.join(":");
  if (!id) notFound();

  const supabase = await createClient();

  if (kind === "rule") {
    const rows = await loadOrgAutomations(supabase, orgId);
    const row = rows.find((r) => r.id === id);
    // Regra que sumiu (excluída no quadro, por exemplo) não vira tela vazia.
    if (!row) notFound();
    // jsonb que não passou no parse fail-closed: abrir o construtor com uma
    // regra que não existe daria um formulário em branco que, ao salvar,
    // SOBRESCREVERIA o que está lá. A lista já sinaliza a quebra.
    if (!row.rule) {
      return (
        <div className="flex flex-col gap-3">
          <h1 className="text-lg font-semibold">{row.name || "Sem nome"}</h1>
          <p className="text-destructive text-sm">
            A configuração desta automação está inválida e não pôde ser lida.
            Ela não roda, e o construtor não a abre para não sobrescrever o que
            está gravado — um administrador precisa revisá-la no banco.
          </p>
        </div>
      );
    }
    return (
      <WorkflowRuleScreen
        row={{
          id: row.id,
          name: row.name,
          enabled: row.enabled,
          position: row.position,
          rule: row.rule,
          last_run_at: row.lastRunAt,
          last_error: row.lastError,
          last_moved_count: row.lastActionCount,
        }}
        owner={row.owner}
        // Sem quadro (dono de Base) as opções que exigem posição aparecem
        // desabilitadas com motivo — quem monta a tela é que sabe disso.
        columns={[]}
        isCustomColumns={false}
        ownerLabel={row.ownerLabel}
      />
    );
  }

  if (kind === "schema") {
    const [schemas, sources] = await Promise.all([
      loadWorkflowSchemas(supabase, orgId),
      loadSources(supabase, orgId),
    ]);
    const schema = schemas.find((s) => s.id === id);
    if (!schema) notFound();
    return (
      <WorkflowSchemaScreen
        schema={schema}
        connections={WORKFLOW_CONNECTION_KEYS.map(
          (k) => workflowConnectionStatus(k)!
        )}
        sources={sources
          .filter((s) => !s.parentKey)
          .map((s) => ({ key: s.key, label: s.label, manualEntry: s.manualEntry }))}
      />
    );
  }

  // `system:` é descrição de fluxo do código — não há o que construir.
  notFound();
}

// Versão: 2.0 | Data: 08/09/2026
// v2.0 (08/09/2026): a página deixa de EXECUTAR. O Workflow é a FÁBRICA — cria,
//   configura, liga/desliga e mostra onde cada esquema foi parar. O que ele
//   produz vive fora dele: um formulário tem página própria
//   (/operacao/f/<chave>, URL copiável) e card em Operação. Antes o formulário
//   era renderizado aqui, no meio da configuração — quem só queria lançar um
//   lead atravessava a oficina para chegar à ferramenta.
// v1.0 (08/09/2026): versão inicial (0125).
//
// Só admin: configurar é administração. Quem apenas LANÇA nunca precisa desta
// página — chega pelo card ou pelo link.
import { redirect } from "next/navigation";

import { requireSettingsArea } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import {
  WORKFLOW_CONNECTION_KEYS,
  workflowConnectionStatus,
} from "@/lib/workflow/connections";
import { loadWorkflowSchemas } from "@/lib/workflow/schemas";
import { ensureDefaultWorkflowSchemas } from "@/lib/workflow/schemas";
import { SYSTEM_FLOWS } from "@/lib/workflow/system-schemas";
import { WorkflowSchemasManager } from "@/components/operacao/workflow-schemas-manager";

export const metadata = { title: "Workflow" };

export default async function WorkflowPage() {
  const session = await requireSettingsArea("workflow");
  const orgId = await getActiveOrgId();
  if (!orgId) return null;

  // Não-admin não tem o que fazer aqui: a página é só configuração. Manda para
  // o hub, onde estão os cards dos formulários que ele PODE usar.
  if (!session.roles.includes("admin")) redirect("/?aba=operacao");

  const supabase = await createClient();
  await ensureDefaultWorkflowSchemas(supabase, orgId);
  const schemas = await loadWorkflowSchemas(supabase, orgId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Workflow</h2>
        <p className="text-muted-foreground text-sm">
          Onde os fluxos são montados. Cada um tem um gatilho e um
          comportamento: os que uma pessoa dispara viram formulário com página
          própria; os automáticos rodam sozinhos, sem tela.
        </p>
      </div>

      <WorkflowSchemasManager
        schemas={schemas.map((s) => ({
          id: s.id,
          key: s.key,
          label: s.label,
          description: s.description,
          enabled: s.enabled,
          triggerKind: s.triggerKind,
          showCard: s.showCard,
          definition: s.definition,
        }))}
        connections={WORKFLOW_CONNECTION_KEYS.map(
          (k) => workflowConnectionStatus(k)!
        )}
        systemFlows={SYSTEM_FLOWS}
      />
    </div>
  );
}

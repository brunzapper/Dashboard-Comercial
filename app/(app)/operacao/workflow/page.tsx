// Versão: 1.0 | Data: 08/09/2026
// Página Operação → Workflow (esquemas de automação, 0125).
//
// Ramifica por papel, como a de Remuneração: a área não tem gate de papel
// (AREA_GATES.workflow = {}), então quem tem acesso vê o FORMULÁRIO; a
// configuração dos esquemas aparece só para admin. As actions revalidam as
// duas coisas — a page decide o que MOSTRAR, nunca o que autorizar.
//
// O seed de fábrica roda aqui, na abertura: é ensure-if-absent por chave e
// nunca sobrescreve o que o admin já configurou.
import { requireSettingsArea } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { WORKFLOW_CONNECTION_KEYS, workflowConnectionStatus } from "@/lib/workflow/connections";
import { loadWorkflowOptions } from "@/lib/workflow/options";
import {
  ensureDefaultWorkflowSchemas,
  loadWorkflowSchemas,
} from "@/lib/workflow/schemas";
import { SYSTEM_FLOWS } from "@/lib/workflow/system-schemas";
import { visibleFields } from "@/lib/workflow/types";
import { WorkflowRunner } from "@/components/operacao/workflow-runner";
import { WorkflowSchemasManager } from "@/components/operacao/workflow-schemas-manager";

export const metadata = { title: "Workflow" };
// Uma execução encadeia várias chamadas ao sistema externo, em série.
export const maxDuration = 120;

export default async function WorkflowPage() {
  const session = await requireSettingsArea("workflow");
  const orgId = await getActiveOrgId();
  if (!orgId) return null;
  const supabase = await createClient();

  await ensureDefaultWorkflowSchemas(supabase, orgId);
  const schemas = await loadWorkflowSchemas(supabase, orgId);
  const isAdmin = session.roles.includes("admin");

  // Executáveis: ligados e com definição válida. Opções carregadas por esquema
  // (o formulário nunca chama o sistema externo para montar um dropdown).
  const runnable = schemas.filter((s) => s.enabled && s.definition);
  const optionsBySchema = await Promise.all(
    runnable.map((s) => loadWorkflowOptions(supabase, orgId, s.definition!))
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Workflow</h2>
        <p className="text-muted-foreground text-sm">
          Formulários que lançam dados em sistemas externos. Cada um é um
          esquema: os campos que você preenche e os passos que o sistema executa
          com eles.
        </p>
      </div>

      {runnable.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nenhum esquema ativo.
          {isAdmin ? " Ative um abaixo, em Esquemas." : ""}
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {runnable.map((schema, i) => (
            <WorkflowRunner
              key={schema.id}
              schemaKey={schema.key}
              schemaLabel={schema.label}
              description={schema.description}
              fields={visibleFields(schema.definition!)}
              options={optionsBySchema[i]}
            />
          ))}
        </div>
      )}

      {isAdmin ? (
        <div className="flex flex-col gap-3 border-t pt-6">
          <h3 className="text-base font-semibold">Configuração</h3>
          <WorkflowSchemasManager
            schemas={schemas.map((s) => ({
              id: s.id,
              key: s.key,
              label: s.label,
              description: s.description,
              enabled: s.enabled,
              definition: s.definition,
            }))}
            connections={WORKFLOW_CONNECTION_KEYS.map(
              (k) => workflowConnectionStatus(k)!
            )}
            systemFlows={SYSTEM_FLOWS}
          />
        </div>
      ) : null}
    </div>
  );
}

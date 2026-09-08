// Versão: 1.0 | Data: 08/09/2026
// Página de UM formulário do Workflow (0126) — a superfície que o esquema
// produz, fora da fábrica que o criou.
//
// É deliberadamente MAGRA: só o formulário. Sem lista de esquemas, sem
// configuração, sem os fluxos do sistema. É a URL que o gestor copia e manda
// para o time ("cole o link e lance o lead"), e quem abre precisa ver o que
// preencher, não o mecanismo por trás.
//
// A rota vive sob /operacao/f/ e não sob /operacao/<chave> de propósito: a
// chave é escolhida pelo usuário e colidiria com uma sub-área futura do
// produto (um formulário chamado "agenda" sequestraria a Agenda).
import { notFound } from "next/navigation";

import { requireSettingsArea } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadWorkflowOptions } from "@/lib/workflow/options";
import { loadWorkflowSchemaByKey } from "@/lib/workflow/schemas";
import { visibleFields } from "@/lib/workflow/types";
import { WorkflowRunner } from "@/components/operacao/workflow-runner";

// Uma execução encadeia várias chamadas ao sistema externo, em série.
export const maxDuration = 120;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ chave: string }>;
}) {
  const { chave } = await params;
  const orgId = await getActiveOrgId();
  if (!orgId) return { title: "Formulário" };
  const supabase = await createClient();
  const schema = await loadWorkflowSchemaByKey(supabase, orgId, chave);
  return { title: schema?.label ?? "Formulário" };
}

export default async function FormularioPage({
  params,
}: {
  params: Promise<{ chave: string }>;
}) {
  // O gate é da ÁREA, não do formulário: quem tem Workflow lança qualquer um
  // (decisão de produto — visibilidade por formulário ficou fora do escopo).
  await requireSettingsArea("workflow");
  const { chave } = await params;
  const orgId = await getActiveOrgId();
  if (!orgId) return null;
  const supabase = await createClient();

  const schema = await loadWorkflowSchemaByKey(supabase, orgId, chave);
  // Inexistente, desligado, de outro gatilho ou com definição inválida: a
  // página não existe. Melhor um 404 honesto que um formulário vazio que
  // aceita envio e falha no servidor.
  if (
    !schema ||
    !schema.enabled ||
    schema.triggerKind !== "form" ||
    !schema.definition
  ) {
    notFound();
  }

  const options = await loadWorkflowOptions(supabase, orgId, schema.definition);

  return (
    <div className="flex flex-col gap-6">
      <WorkflowRunner
        schemaKey={schema.key}
        schemaLabel={schema.label}
        description={schema.description}
        fields={visibleFields(schema.definition)}
        options={options}
      />
    </div>
  );
}

// Versão: 1.0 | Data: 07/08/2026
// Página Operação → Mapeamentos (de-para de valores, 0117): gerencia as
// entradas de classificação (Cargos → Área/Nível; Segmentos → categoria),
// mostra as PENDÊNCIAS (valores sem classificação nos registros) e reaplica
// o de-para aos registros. Card org-específico do hub (feature "mapeamentos",
// habilitada só via /owner); gate de admin via requireSettingsArea.
import { requireSettingsArea } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadOrgAiConfigPublic } from "@/lib/ai/config";
import { loadMappingOverview } from "@/lib/mappings/overview";
import { MappingsManager } from "@/components/operacao/mappings-manager";

export const metadata = { title: "Mapeamentos" };
// Turno do assistente de IA tem orçamento de 240s (AI_LOOP_TURN_BUDGET_MS).
export const maxDuration = 300;

export default async function MapeamentosPage() {
  await requireSettingsArea("mapeamentos");
  const orgId = await getActiveOrgId();
  if (!orgId) return null;
  const supabase = await createClient();
  const [overview, ai] = await Promise.all([
    loadMappingOverview(supabase, orgId),
    loadOrgAiConfigPublic(orgId),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Mapeamentos de valores</h2>
        <p className="text-muted-foreground text-sm">
          De-para de classificação aplicado aos registros: cargos viram Área e
          Nível hierárquico; segmentos viram a categoria padronizada. Valores
          sem classificação ficam como &quot;Não Classificado&quot; e geram uma
          tarefa de pendência no sino.
        </p>
      </div>
      <MappingsManager overview={overview} ai={ai} />
    </div>
  );
}

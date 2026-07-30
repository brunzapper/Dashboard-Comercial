// Versão: 1.1 | Data: 30/07/2026
// Registros → Importar CSV (admin): wizard de import em massa — cria fontes e
// campos a partir do arquivo e insere/atualiza registros de forma idempotente
// (source_system='csv'). Parsing no browser; dados sobem em chunks JSON para
// as Server Actions de app/(app)/registros/importar/actions.ts.
// v1.1 (30/07/2026): prop `ai` (config pública 0096) habilita o botão
//   "Sugerir com IA" do passo de mapeamento; maxDuration 60→300 (turno da IA).
import Link from "next/link";

import { requireRole } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { loadOrgAiConfigPublic } from "@/lib/ai/config";
import { createClient } from "@/lib/supabase/server";
import { isCoreDef } from "@/lib/records/core-defs";
import { loadSources } from "@/lib/config/sources";
import { Button } from "@/components/ui/button";
import {
  ImportWizard,
  type ImportFieldOption,
} from "@/components/importacao/import-wizard";

// Rede de segurança p/ as Server Actions desta página. 300 cobre o turno da
// sugestão de mapeamento por IA (laço com orçamento de 240s); no plano
// gratuito o teto real segue ~60s.
export const maxDuration = 300;

// Título da aba (template do layout completa "— {appName}").
export const metadata = { title: "Importar CSV" };

export default async function ImportarPage() {
  await requireRole("admin");
  const supabase = await createClient();
  const sources = await loadSources(supabase);
  const orgId = await getActiveOrgId();
  const ai = orgId ? await loadOrgAiConfigPublic(orgId) : null;

  // Campos que podem RECEBER valores (calculados são materializados, não
  // importados) — oferecidos como destino de reuso no mapeamento.
  const { data } = await supabase
    .from("field_definitions")
    .select("field_key, label, data_type, applies_to, source_system")
    .not("data_type", "in", "(calculado,calculado_agg)")
    .order("label");
  // Linhas core (0086) fora dos destinos de reuso: import grava em
  // custom_fields, e a key core apontaria para a coluna núcleo homônima.
  const fields: ImportFieldOption[] = (data ?? [])
    .filter((f) => !isCoreDef(f))
    .map((f) => ({
      key: f.field_key as string,
      label: (f.label as string) ?? (f.field_key as string),
      dataType: (f.data_type as string) ?? "texto",
      appliesTo: (f.applies_to as string[] | null) ?? [],
    }));

  return (
    <div className="flex flex-col gap-6">
      {/* pr-8: afasta o botão do sino fixo (TaskBell, topo-direito) */}
      <div className="flex items-start justify-between gap-4 pr-8">
        <div>
          <h1 className="text-2xl font-semibold">Importar CSV</h1>
          <p className="text-muted-foreground text-sm">
            Importe dados em massa para uma base existente ou crie uma base
            nova a partir do arquivo. Re-importar o mesmo arquivo atualiza em
            vez de duplicar, e edições feitas no app são preservadas.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/registros">Voltar a Registros</Link>
        </Button>
      </div>
      <ImportWizard sources={sources} fields={fields} ai={ai} />
    </div>
  );
}

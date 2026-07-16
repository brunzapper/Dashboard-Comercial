// Versão: 2.0 | Data: 16/07/2026
// Configurações → Fontes (admin).
// v2.0 (16/07/2026): fontes DINÂMICAS — CRUD do catálogo (data_sources):
//   criar/editar/excluir fontes, nome curto por fonte e campo de período;
//   mantém o rótulo dos campos "gerais" (sync_config).
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import { loadSourceLabels } from "@/lib/config/source-labels";
import { SourcesManager } from "@/components/configuracoes/sources-manager";
import { SourceLabelsManager } from "@/components/configuracoes/source-labels-manager";

export default async function FontesPage() {
  await requireRole("admin");
  const supabase = await createClient();
  const sources = await loadSources(supabase);
  const labels = await loadSourceLabels(supabase, sources);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Fontes</h1>
        <p className="text-muted-foreground text-sm">
          Catálogo das fontes de dados do produto: as internas (Bitrix e
          planilha do Estudo) e as personalizadas, criadas aqui ou pelo import
          de CSV em Registros.
        </p>
      </div>
      <SourcesManager sources={sources} />
      <div>
        <h2 className="text-lg font-semibold">Rótulos</h2>
        <p className="text-muted-foreground text-sm">
          O nome curto de cada fonte é editado na própria fonte, acima.
        </p>
      </div>
      <SourceLabelsManager geral={labels.geral} />
    </div>
  );
}

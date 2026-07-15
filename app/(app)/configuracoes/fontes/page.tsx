// Versão: 1.0 | Data: 15/07/2026
// Configurações → Fontes (admin): nomes CURTOS de exibição das fontes, usados
// como prefixo ("Fonte · Campo") e chips de navegação nos dropdowns de campo,
// além do rótulo dos campos "gerais" (presentes em todas as fontes).
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadSourceLabels } from "@/lib/config/source-labels";
import { SourceLabelsManager } from "@/components/configuracoes/source-labels-manager";

export default async function FontesPage() {
  await requireRole("admin");
  const supabase = await createClient();
  const labels = await loadSourceLabels(supabase);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Fontes</h1>
        <p className="text-muted-foreground text-sm">
          Nomes curtos exibidos nos dropdowns de campo (prefixo
          &quot;Fonte&nbsp;·&nbsp;Campo&quot; e chips de filtro) e o rótulo dos
          campos gerais — os que existem em todas as fontes. Não altera os nomes
          completos das fontes nem os dados.
        </p>
      </div>
      <SourceLabelsManager labels={labels} />
    </div>
  );
}

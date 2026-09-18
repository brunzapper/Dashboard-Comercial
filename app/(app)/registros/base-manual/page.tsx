// Versão: 1.0 | Data: 17/09/2026
// Registros → Base manual (0142): os números DIGITADOS que se misturam aos
// registros nas fórmulas dos dashboards.
//
// A page RAMIFICA por permissão em vez de barrar: quem tem
// `edit_record_values` edita; os demais só veem os números que alimentam os
// dashboards deles. É o mesmo desenho de /operacao/remuneracao — e o gate de
// área (`base_manual`, sem papel) existe para o `deny` individual de Acessos
// esconder a tela inteira quando for o caso.
//
// O gestor aqui é o MESMO componente do ⋮ do dashboard e do widget "Base do
// Dashboard" — ver components/manual-base/manual-base-manager.tsx.
import { requireSettingsArea } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadManualBase, loadManualDeclarations } from "@/lib/manual-base/load";
import { ManualBaseManager } from "@/components/manual-base/manual-base-manager";
import { ManualBaseAssistant } from "@/components/manual-base/manual-base-assistant";
import { BackLink } from "@/components/ui/back-link";

export const metadata = { title: "Base manual" };

export default async function BaseManualPage() {
  const session = await requireSettingsArea("base_manual");
  const canEdit = session.permissions.includes("edit_record_values");
  const supabase = await createClient();
  const orgId = await getActiveOrgId();

  const [base, declarations, { data: respData }, { data: opData }] =
    await Promise.all([
    loadManualBase(supabase, orgId),
    loadManualDeclarations(supabase, orgId),
    supabase
      .from("responsibles")
      .select("id, display_name")
      .eq("active", true)
      .order("display_name"),
    supabase.from("operations").select("id, name").eq("active", true).order("name"),
  ]);

  const responsibles = (respData ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.display_name ?? ""),
  }));
  const operations = (opData ?? []).map((o) => ({
    id: String(o.id),
    name: String(o.name ?? ""),
  }));

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <BackLink fallback="/registros" fallbackLabel="Registros" />
        <h1 className="text-xl font-semibold">Base manual</h1>
        <p className="text-muted-foreground max-w-3xl text-sm">
          Números que você digita em vez de cadastrar registro por registro —
          mensagens enviadas, contas alcançadas, investimento de mídia. Cada
          dado vira um operando das fórmulas dos dashboards, e pode ser dividido
          por qualquer métrica que venha do Sync. Os mesmos números aparecem no
          menu ⋮ de qualquer dashboard e no widget “Base do Dashboard”.
        </p>
      </div>

      <ManualBaseManager
        series={base.series}
        entries={base.entries}
        responsibles={responsibles}
        operations={operations}
        families={base.families}
        members={base.members}
        declarations={declarations}
        canEdit={canEdit}
        assistant={canEdit ? <ManualBaseAssistant /> : null}
      />
    </div>
  );
}

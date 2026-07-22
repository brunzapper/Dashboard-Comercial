// Versão: 1.0 | Data: 20/07/2026
// Configurações → Presets (admin): gerar/atualizar os dashboards preset do
// catálogo (lib/presets/definitions.ts) via applyPreset/generatePresets
// (aplicação idempotente — ver docs/arquitetura.md §4.7). O estado por preset
// sai do marcador dashboards.settings.preset dos dashboards DESTE usuário.
import { redirect } from "next/navigation";

import { getSessionInfo, requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PRESETS } from "@/lib/presets/definitions";
import type { DashboardSettings } from "@/lib/widgets/types";
import {
  PresetsManager,
  type PresetRow,
} from "@/components/configuracoes/presets-manager";

export default async function PresetsPage() {
  await requireRole("admin");
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  const supabase = await createClient();

  const { data } = await supabase
    .from("dashboards")
    .select("id, name, settings")
    .eq("owner_user_id", session.user.id)
    .eq("kind", "dashboard");
  const dashboards = (data ?? []) as {
    id: string;
    name: string;
    settings: DashboardSettings | null;
  }[];

  const rows: PresetRow[] = PRESETS.map((p) => {
    const applied = dashboards.find(
      (d) => d.settings?.preset?.key === p.presetKey
    );
    // Sem marcador mas com o mesmo nome: o aplicador ADOTA este dashboard ao
    // gerar (carimba o marcador em vez de duplicar) — informativo na UI.
    const adoptable = applied
      ? undefined
      : dashboards.find((d) => d.name === p.name && !d.settings?.preset);
    return {
      presetKey: p.presetKey,
      name: p.name,
      version: p.version,
      widgetCount: p.widgets.length,
      tabCount: p.settings?.tabs?.length ?? 0,
      appliedVersion: applied?.settings?.preset?.version ?? null,
      dashboardId: applied?.id ?? null,
      willAdopt: Boolean(adoptable),
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Presets de dashboard</h1>
        <p className="text-muted-foreground text-sm">
          Dashboards pré-montados do catálogo. Gerar cria o dashboard (com
          abas, widgets e dependências — campos e sub-bases ausentes);
          atualizar reaplica a definição sobre o dashboard já gerado:
          sobrescreve os widgets DO preset (mantendo os ids — conectores e
          links sobrevivem) e nunca toca widgets que você adicionou à mão.
        </p>
      </div>
      <PresetsManager rows={rows} />
    </div>
  );
}

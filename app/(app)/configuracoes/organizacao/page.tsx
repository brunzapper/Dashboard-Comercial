// Versão: 1.0 | Data: 23/07/2026
// Configurações → Organização (multi-org, 0089): branding editável — nome do
// sistema e da empresa exibidos no topo do painel esquerdo. Gate org_admin
// (redirect na page + RLS organizations_update como barreira).
import { redirect } from "next/navigation";

import { getActiveOrg } from "@/lib/auth/org";
import { OrgBrandingForm } from "@/components/configuracoes/org-branding-form";

export default async function OrganizacaoPage() {
  const org = await getActiveOrg();
  if (!org?.isOrgAdmin) redirect("/configuracoes");

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">Organização</h2>
        <p className="text-muted-foreground text-sm">
          Nomes exibidos no topo do painel esquerdo e no título da aba.
        </p>
      </div>
      <OrgBrandingForm appName={org.appName} name={org.name} />
    </div>
  );
}

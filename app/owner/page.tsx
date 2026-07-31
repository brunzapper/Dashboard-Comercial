// Versão: 1.1 | Data: 31/07/2026
// Console do OWNER (multi-org, 0089/0093): lista as organizações do sistema
// com criar/excluir. Rota fora do grupo (app) — chrome mínimo próprio; o
// guard requireOwner() roda AQUI e em toda action (nunca só num layout).
// v1.1 (31/07/2026): recursos SOB DEMANDA (org_features, 0114) — toggle por
// org (hoje: Remuneração variável). A escrita é service-role-only; este
// console é a ÚNICA superfície que habilita/desabilita.
import Link from "next/link";

import { requireOwner } from "@/lib/auth/owner";
import { createServiceClient } from "@/lib/supabase/service";
import {
  normalizeOrgFeatures,
  ORG_FEATURES,
} from "@/lib/config/org-features";
import { logoutAction } from "@/app/(auth)/login/actions";
import { Button } from "@/components/ui/button";
import { OwnerOrgsConsole, type OwnerOrgRow } from "./orgs-console";

export const metadata = { title: "Owner — Organizações" };

export default async function OwnerPage() {
  const session = await requireOwner();

  const service = createServiceClient();
  const [{ data: orgRows }, { data: memberRows }, { data: featureRows }] =
    await Promise.all([
      service
        .from("organizations")
        .select("id, name, app_name, created_at")
        .order("created_at", { ascending: true }),
      service
        .from("organization_members")
        .select("organization_id, user_id, is_org_admin"),
      service.from("org_features").select("organization_id, features"),
    ]);
  const featuresByOrg = new Map(
    (featureRows ?? []).map((r) => [
      r.organization_id as string,
      normalizeOrgFeatures(r.features),
    ])
  );

  // Email do org_admin de cada org (exibição).
  const adminIdByOrg = new Map<string, string>();
  const countByOrg = new Map<string, number>();
  for (const m of memberRows ?? []) {
    const oid = m.organization_id as string;
    countByOrg.set(oid, (countByOrg.get(oid) ?? 0) + 1);
    if (m.is_org_admin) adminIdByOrg.set(oid, m.user_id as string);
  }
  const adminIds = [...new Set(adminIdByOrg.values())];
  const emailById = new Map<string, string>();
  if (adminIds.length > 0) {
    const { data: usersData } = await service.auth.admin.listUsers({
      perPage: 1000,
    });
    for (const u of usersData?.users ?? []) {
      emailById.set(u.id, u.email ?? "—");
    }
  }

  const orgs: OwnerOrgRow[] = (orgRows ?? []).map((o) => ({
    id: o.id as string,
    name: o.name as string,
    appName: (o.app_name as string) || "Dashboard Comercial",
    adminEmail: emailById.get(adminIdByOrg.get(o.id as string) ?? "") ?? "—",
    members: countByOrg.get(o.id as string) ?? 0,
    features:
      featuresByOrg.get(o.id as string) ?? normalizeOrgFeatures(null),
  }));

  // Catálogo dos recursos sob demanda (dados puros p/ o client — o módulo
  // usa cache() de RSC e não deve ser importado no bundle client).
  const featureDefs = ORG_FEATURES.map((f) => ({
    key: f.key,
    label: f.label,
    description: f.description,
  }));

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Organizações</h1>
          <p className="text-muted-foreground text-sm">
            Modo Owner — {session.user.email}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/escolher-organizacao">Trocar contexto</Link>
          </Button>
          <form action={logoutAction}>
            <Button type="submit" variant="ghost" size="sm">
              Sair
            </Button>
          </form>
        </div>
      </div>
      <OwnerOrgsConsole orgs={orgs} featureDefs={featureDefs} />
    </main>
  );
}

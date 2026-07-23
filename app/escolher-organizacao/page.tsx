// Versão: 1.0 | Data: 23/07/2026
// Tela pós-login de escolha de contexto (multi-org, 0089): cards das
// organizações onde o usuário é membro + o card "Owner" (só para o dono do
// sistema — guard fail-closed em lib/auth/owner.ts). Usuário comum (1 org)
// nem passa por aqui (o login/layout resolvem direto). Fora do grupo (app)
// de propósito: o layout autenticado redireciona multi-org SEM escolha para
// cá — dentro dele haveria loop.
import { redirect } from "next/navigation";

import { requireSession } from "@/lib/auth/session";
import { getMemberships } from "@/lib/auth/org";
import { getIsOwner } from "@/lib/auth/owner";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { logoutAction } from "@/app/(auth)/login/actions";
import { enterOwnerModeAction, selectOrgAction } from "./actions";

export const metadata = { title: "Escolher organização" };

export default async function EscolherOrganizacaoPage() {
  const session = await requireSession();
  const [memberships, isOwner] = await Promise.all([
    getMemberships(),
    getIsOwner(),
  ]);

  // Sem escolha a fazer: usuário comum entra direto na única org (ou na home,
  // pré-migração).
  if (!isOwner && memberships.length <= 1) redirect("/");

  const supabase = await createClient();
  const { data: orgRows } = await supabase
    .from("organizations")
    .select("id, name, app_name")
    .in(
      "id",
      memberships.map((m) => m.organization_id)
    )
    .order("name");
  const adminOf = new Set(
    memberships.filter((m) => m.is_org_admin).map((m) => m.organization_id)
  );

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold">Como você quer entrar?</h1>
          <p className="text-muted-foreground text-sm">{session.user.email}</p>
        </div>

        {isOwner ? (
          <form action={enterOwnerModeAction}>
            <button type="submit" className="w-full text-left">
              <Card className="hover:border-primary cursor-pointer transition-colors">
                <CardHeader>
                  <CardTitle className="text-base">Owner</CardTitle>
                  <CardDescription>
                    Gerir organizações do sistema (criar e excluir).
                  </CardDescription>
                </CardHeader>
              </Card>
            </button>
          </form>
        ) : null}

        {(orgRows ?? []).map((org) => (
          <form
            key={org.id as string}
            action={selectOrgAction.bind(null, org.id as string)}
          >
            <button type="submit" className="w-full text-left">
              <Card className="hover:border-primary cursor-pointer transition-colors">
                <CardHeader>
                  <CardTitle className="text-base">
                    {org.name as string}
                  </CardTitle>
                  <CardDescription>
                    {(org.app_name as string) || "Dashboard Comercial"}
                    {adminOf.has(org.id as string)
                      ? " — Administrador de Organização"
                      : ""}
                  </CardDescription>
                </CardHeader>
              </Card>
            </button>
          </form>
        ))}

        <form action={logoutAction}>
          <Button type="submit" variant="ghost" size="sm">
            Sair
          </Button>
        </form>
      </div>
    </main>
  );
}

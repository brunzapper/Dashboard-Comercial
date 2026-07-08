// Versão: 2.0 | Data: 05/07/2026
// Home = lista de dashboards (Fase 6A). Antes era placeholder.
import Link from "next/link";
import { Trash2 } from "lucide-react";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ROLE_LABELS, type RoleKey } from "@/lib/auth/roles";
import { NewDashboardForm } from "@/components/dashboards/new-dashboard-form";
import { deleteDashboard } from "@/app/(app)/dashboards/actions";

interface DashboardRow {
  id: string;
  name: string;
  owner_user_id: string | null;
  visible_to_roles: string[];
}

export default async function HomePage() {
  const session = await getSessionInfo();
  const canCreate = session?.permissions.includes("create_dashboards") ?? false;

  const supabase = await createClient();
  const { data } = await supabase
    .from("dashboards")
    .select("id, name, owner_user_id, visible_to_roles")
    .order("created_at", { ascending: false });
  const dashboards = (data ?? []) as DashboardRow[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboards</h1>
        <p className="text-muted-foreground text-sm">
          Crie dashboards e monte widgets a partir dos seus registros.
        </p>
      </div>

      {canCreate ? <NewDashboardForm /> : null}

      {dashboards.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nenhum dashboard ainda.
          {canCreate ? " Crie o primeiro acima." : ""}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {dashboards.map((d) => {
            const isOwner = d.owner_user_id === session?.user.id;
            return (
              <Card key={d.id} className="relative">
                <CardHeader>
                  <CardTitle>
                    <Link href={`/dashboards/${d.id}`} className="hover:underline">
                      {d.name}
                    </Link>
                  </CardTitle>
                  <CardDescription>
                    {d.visible_to_roles.length > 0
                      ? `Compartilhado: ${d.visible_to_roles
                          .map((r) => ROLE_LABELS[r as RoleKey] ?? r)
                          .join(", ")}`
                      : "Pessoal"}
                  </CardDescription>
                </CardHeader>
                {isOwner ? (
                  <form action={deleteDashboard} className="absolute top-3 right-3">
                    <input type="hidden" name="id" value={d.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon"
                      aria-label="Excluir dashboard"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </form>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

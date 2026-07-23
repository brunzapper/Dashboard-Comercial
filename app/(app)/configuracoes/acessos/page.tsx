// Versão: 1.0 | Data: 23/07/2026
// Configurações → Acessos (0094): acessos customizados por usuário,
// independentes do nível — o admin CONCEDE além do papel ou REVOGA o que o
// papel daria (override vence). Três seções por usuário: áreas de
// Configurações (allow/deny), bases (deny) e dashboards/kanbans
// (Ver/Editar/Bloqueado — board_access, 0088).
import { requireSettingsArea } from "@/lib/auth/access";
import { getActiveOrg } from "@/lib/auth/org";
import { AREA_LABELS } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadSources } from "@/lib/config/sources";
import { AccessMatrix } from "@/components/configuracoes/access-matrix";

export default async function AcessosPage() {
  const session = await requireSettingsArea("acessos");
  const org = await getActiveOrg();

  const supabase = await createClient();
  const service = createServiceClient();
  const [usersRes, { data: memberRows }, sources, { data: boardRows }] =
    await Promise.all([
      service.auth.admin.listUsers({ perPage: 1000 }),
      org
        ? service
            .from("organization_members")
            .select("user_id")
            .eq("organization_id", org.id)
        : Promise.resolve({ data: null }),
      loadSources(supabase, org?.id),
      supabase
        .from("dashboards")
        .select("id, name, kind, owner_user_id")
        .neq("status", "trashed")
        .order("name"),
    ]);

  const memberIds = memberRows
    ? new Set((memberRows ?? []).map((m) => m.user_id as string))
    : null;
  const users = (usersRes.data?.users ?? [])
    .filter((u) => !memberIds || memberIds.has(u.id))
    .map((u) => ({ id: u.id, email: u.email ?? "—" }))
    .sort((a, b) => a.email.localeCompare(b.email));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Acessos</h1>
        <p className="text-muted-foreground text-sm">
          Acesso individual por usuário, independente do nível: conceda além
          do papel ou revogue o que o papel daria — o ajuste individual sempre
          vence.
        </p>
      </div>
      <AccessMatrix
        users={users}
        currentUserId={session.user.id}
        areas={Object.entries(AREA_LABELS).map(([key, label]) => ({
          key,
          label,
        }))}
        sources={sources.map((s) => ({
          key: s.key,
          label: s.label,
          sub: Boolean(s.parentKey),
        }))}
        boards={(boardRows ?? []).map((b) => ({
          id: b.id as string,
          name: b.name as string,
          kanban: (b.kind as string) === "kanban",
          owner: b.owner_user_id as string,
        }))}
      />
    </div>
  );
}

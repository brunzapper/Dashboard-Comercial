// Versão: 1.1 | Data: 26/07/2026
// Configurações → Acessos (0094): acessos customizados por usuário,
// independentes do nível — o admin CONCEDE além do papel ou REVOGA o que o
// papel daria (override vence). Três seções por usuário: áreas de
// Configurações (allow/deny), bases (deny) e dashboards/kanbans
// (Ver/Editar/Bloqueado — board_access, 0088).
// v1.1 (26/07/2026): PASTAS (0107) — a seção Bases vai agrupada por pasta
//   (heading só quando há pasta) e as subs entram logo abaixo da própria pai.
// v1.2 (31/07/2026): áreas de recurso SOB DEMANDA desligado (0114) saem da
//   matriz — feature-off vence qualquer override, então a linha seria inerte.
import { requireSettingsArea } from "@/lib/auth/access";
import { getActiveOrg } from "@/lib/auth/org";
import { AREA_FEATURES, AREA_LABELS } from "@/lib/auth/access";
import { loadOrgFeatures } from "@/lib/config/org-features";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadSources } from "@/lib/config/sources";
import { loadSourceFolders } from "@/lib/config/source-folders";
import {
  groupSourcesByFolder,
  IMPLICIT_FOLDER_LABEL,
} from "@/lib/source-folders";
import { subSourcesOf } from "@/lib/sources";
import { AccessMatrix } from "@/components/configuracoes/access-matrix";

// Título da aba (template do layout completa "— {appName}").
export const metadata = { title: "Acessos" };

export default async function AcessosPage() {
  const session = await requireSettingsArea("acessos");
  const org = await getActiveOrg();

  const supabase = await createClient();
  const service = createServiceClient();
  const [usersRes, { data: memberRows }, sources, folders, { data: boardRows }] =
    await Promise.all([
      service.auth.admin.listUsers({ perPage: 1000 }),
      org
        ? service
            .from("organization_members")
            .select("user_id")
            .eq("organization_id", org.id)
        : Promise.resolve({ data: null }),
      loadSources(supabase, org?.id),
      loadSourceFolders(supabase, org?.id),
      supabase
        .from("dashboards")
        .select("id, name, kind, owner_user_id")
        .neq("status", "trashed")
        .order("name"),
    ]);

  // Bases agrupadas por pasta (0107), cada raiz seguida das PRÓPRIAS subs.
  // Sem pasta criada: um único grupo sem heading (label null).
  const folderGroups = groupSourcesByFolder(folders, sources);
  const showFolders = folderGroups.some((g) => g.folder != null);
  const sourceGroups = folderGroups.map((g) => ({
    label: showFolders ? (g.folder?.label ?? IMPLICIT_FOLDER_LABEL) : null,
    sources: g.roots.flatMap((root) => [
      { key: root.key, label: root.label, sub: false },
      ...subSourcesOf(root.key, sources).map((s) => ({
        key: s.key,
        label: s.label,
        sub: true,
      })),
    ]),
  }));

  // Recursos sob demanda (0114): área com feature desligado sai da matriz.
  const orgFeatures = await loadOrgFeatures(supabase, org?.id ?? null);
  const areas = Object.entries(AREA_LABELS)
    .filter(([key]) => {
      const feature = AREA_FEATURES[key];
      return !feature || orgFeatures[feature];
    })
    .map(([key, label]) => ({ key, label }));

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
        areas={areas}
        sourceGroups={sourceGroups}
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

// Versão: 2.1 | Data: 23/07/2026
// Tela de Usuários (admin): provisionamento de contas, papéis, reset/desativação
// e mapeamento Bitrix (bitrix_user_map). Só quem tem manage_users_roles.
// A lista de contas vem do Auth via service role (auth.users não é listável pelo
// client autenticado); papéis/mapeamentos vêm por RLS.
// v2.1 (23/07/2026): multi-org (0089) — lista SÓ os membros da org ATIVA (o
//   service role enxerga todas as contas; a interseção com
//   organization_members faz o recorte).
import { requireSettingsArea } from "@/lib/auth/access";
import { getActiveOrg } from "@/lib/auth/org";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  UsersManager,
  type BitrixCandidate,
  type RoleOption,
  type UserRow,
} from "@/components/admin/users-manager";

function isDisabled(bannedUntil: string | null | undefined): boolean {
  if (!bannedUntil) return false;
  const until = new Date(bannedUntil);
  return !Number.isNaN(until.getTime()) && until.getTime() > Date.now();
}

export default async function UsuariosPage() {
  const session = await requireSettingsArea("usuarios");
  const org = await getActiveOrg();

  const supabase = await createClient();
  const service = createServiceClient();

  const [usersRes, { data: roleRows }, { data: userRoles }, { data: maps }, { data: resps }, { data: memberRows }] =
    await Promise.all([
      service.auth.admin.listUsers({ perPage: 1000 }),
      supabase.from("roles").select("key, label").order("key"),
      supabase.from("user_roles").select("user_id, role_key"),
      supabase.from("bitrix_user_map").select("bitrix_id, user_id, name"),
      supabase
        .from("responsibles")
        .select("display_name, bitrix_user_id")
        .not("bitrix_user_id", "is", null),
      org
        ? service
            .from("organization_members")
            .select("user_id")
            .eq("organization_id", org.id)
        : Promise.resolve({ data: null }),
    ]);
  // Recorte da org ativa: sem membership (pré-migração) mostra todas as contas.
  const memberIds = memberRows
    ? new Set((memberRows ?? []).map((m) => m.user_id as string))
    : null;

  // Papéis por usuário.
  const rolesByUser = new Map<string, string[]>();
  for (const ur of userRoles ?? []) {
    const uid = ur.user_id as string;
    const arr = rolesByUser.get(uid) ?? [];
    arr.push(ur.role_key as string);
    rolesByUser.set(uid, arr);
  }

  const users: UserRow[] = (usersRes.data?.users ?? [])
    .filter((u) => !memberIds || memberIds.has(u.id))
    .map((u) => ({
      id: u.id,
      email: u.email ?? "—",
      createdAt: u.created_at ?? null,
      lastSignInAt: u.last_sign_in_at ?? null,
      disabled: isDisabled(
        (u as { banned_until?: string | null }).banned_until
      ),
      roles: rolesByUser.get(u.id) ?? [],
    }))
    .sort((a, b) => a.email.localeCompare(b.email));

  const roles: RoleOption[] = (roleRows ?? []).map((r) => ({
    key: r.key as string,
    label: (r.label as string) ?? ROLE_LABELS[r.key as keyof typeof ROLE_LABELS] ?? (r.key as string),
  }));

  // Candidatos de mapeamento Bitrix: união de responsáveis (com bitrix_user_id)
  // e linhas já existentes em bitrix_user_map.
  const candMap = new Map<string, { name: string; mappedUserId: string | null }>();
  for (const r of resps ?? []) {
    const bid = r.bitrix_user_id as string | null;
    if (!bid) continue;
    candMap.set(bid, { name: (r.display_name as string) ?? "", mappedUserId: null });
  }
  for (const m of maps ?? []) {
    const bid = m.bitrix_id as string;
    const existing = candMap.get(bid);
    candMap.set(bid, {
      name: existing?.name || (m.name as string) || "",
      mappedUserId: (m.user_id as string) ?? null,
    });
  }
  const bitrixCandidates: BitrixCandidate[] = Array.from(candMap.entries())
    .map(([bitrixId, v]) => ({ bitrixId, name: v.name, mappedUserId: v.mappedUserId }))
    .sort((a, b) => (a.name || a.bitrixId).localeCompare(b.name || b.bitrixId));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Usuários</h1>
        <p className="text-muted-foreground text-sm">
          Crie contas de acesso, defina papéis, redefina senhas e vincule
          responsáveis do Bitrix aos usuários do sistema.
        </p>
      </div>
      <UsersManager
        users={users}
        roles={roles}
        bitrixCandidates={bitrixCandidates}
        currentUserId={session.user.id}
      />
    </div>
  );
}

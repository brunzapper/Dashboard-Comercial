// Versão: 1.1 | Data: 23/07/2026
// Tipos e constantes de papéis e permissões (espelham as tabelas roles,
// permissions, role_permissions e user_roles no Postgres).
// v1.1 (23/07/2026): SPECIAL_ROLE_LABELS — rótulos dos "papéis" de nível de
//   SISTEMA (multi-org, 0089): org_admin vive em
//   organization_members.is_org_admin e owner em app_owner — NUNCA são linhas
//   de roles/user_roles (vazariam nos checkboxes de compartilhamento e
//   cruzariam orgs). Use só para badges/exibição.

export type RoleKey = "admin" | "gestor" | "vendedor";

export const ROLE_LABELS: Record<RoleKey, string> = {
  admin: "Administrador",
  gestor: "Gestor",
  vendedor: "Vendedor",
};

// Níveis de sistema (fora de user_roles) — exibição apenas.
export const SPECIAL_ROLE_LABELS = {
  org_admin: "Administrador de Organização",
  owner: "Owner",
} as const;

export type PermissionKey =
  | "edit_record_values"
  | "manage_field_definitions"
  | "manage_users_roles"
  | "create_dashboards"
  | "view_all_records"
  | "view_forecast_all";

/** Verdadeiro se qualquer um dos papéis do usuário estiver em `allowed`. */
export function hasAnyRole(
  userRoles: string[] | undefined | null,
  allowed: RoleKey[]
): boolean {
  if (!userRoles) return false;
  return userRoles.some((r) => allowed.includes(r as RoleKey));
}

export function isAdmin(userRoles: string[] | undefined | null): boolean {
  return hasAnyRole(userRoles, ["admin"]);
}

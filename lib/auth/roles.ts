// Versão: 1.0 | Data: 04/07/2026
// Tipos e constantes de papéis e permissões (espelham as tabelas roles,
// permissions, role_permissions e user_roles no Postgres).

export type RoleKey = "admin" | "gestor" | "vendedor";

export const ROLE_LABELS: Record<RoleKey, string> = {
  admin: "Administrador",
  gestor: "Gestor",
  vendedor: "Vendedor",
};

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

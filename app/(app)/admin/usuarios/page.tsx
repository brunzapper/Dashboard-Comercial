// Versão: 1.0 | Data: 04/07/2026
// Placeholder de Usuários (provisionamento + bitrix_user_map). Só admin.
import { requirePermission } from "@/lib/auth/session";

export default async function UsuariosPage() {
  await requirePermission("manage_users_roles");
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Usuários</h1>
      <p className="text-muted-foreground text-sm">
        Criação de usuários, atribuição de papéis e mapeamento com o Bitrix
        (bitrix_user_map) serão implementados aqui.
      </p>
    </div>
  );
}

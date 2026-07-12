// Versão: 1.0 | Data: 12/07/2026
// Configurações → Conta: dados da própria conta e troca de senha. Visível a
// qualquer autenticado (admin/gestor/vendedor).
import { requireSession } from "@/lib/auth/session";
import { ROLE_LABELS, type RoleKey } from "@/lib/auth/roles";
import { ChangePasswordForm } from "@/components/configuracoes/change-password-form";

export default async function ContaPage() {
  const session = await requireSession();
  const roleLabel = session.roles
    .map((r) => ROLE_LABELS[r as RoleKey] ?? r)
    .join(", ");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Conta</h2>
        <p className="text-muted-foreground text-sm">
          {session.user.email}
          {roleLabel ? ` · ${roleLabel}` : ""}
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Alterar senha</h3>
        <ChangePasswordForm />
      </div>
    </div>
  );
}

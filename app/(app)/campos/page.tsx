// Versão: 1.0 | Data: 04/07/2026
// Placeholder de Campos (gestão de field_definitions — Fase 5). Só admin.
import { requirePermission } from "@/lib/auth/session";

export default async function CamposPage() {
  await requirePermission("manage_field_definitions");
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Campos</h1>
      <p className="text-muted-foreground text-sm">
        Criação e gestão de colunas dinâmicas chegam na Fase 5.
      </p>
    </div>
  );
}

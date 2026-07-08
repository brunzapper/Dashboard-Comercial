// Versão: 1.0 | Data: 05/07/2026
// Tela de Operações (admin) — Fase 6B.
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  OperationsManager,
  type OperationRow,
} from "@/components/admin/operations-manager";

export default async function OperacoesPage() {
  await requireRole("admin");
  const supabase = await createClient();
  const { data } = await supabase
    .from("operations")
    .select("id, name, active, parent_operation_id")
    .order("name");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Operações</h1>
        <p className="text-muted-foreground text-sm">
          Crie operações e organize-as em árvore (operação dentro de operação).
        </p>
      </div>
      <OperationsManager operations={(data ?? []) as OperationRow[]} />
    </div>
  );
}

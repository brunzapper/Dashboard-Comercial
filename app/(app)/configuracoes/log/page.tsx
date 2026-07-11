// Versão: 1.0 | Data: 11/07/2026
// Configurações → Log: fila de write-back do Bitrix (o que foi/está sendo enviado
// de volta ao CRM e o que falhou). Só admin. Foca nos erros, mas lista os itens
// recentes de todos os status para acompanhamento.
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  WritebackLog,
  type WritebackLogRow,
} from "@/components/configuracoes/writeback-log";

export default async function LogPage() {
  await requireRole("admin");
  const supabase = await createClient();

  const { data } = await supabase
    .from("bitrix_writeback_queue")
    .select(
      "id, entity, source_id, field_key, label, new_value, status, attempts, last_error, created_at, processed_at, records(title)"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const rows: WritebackLogRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    entity: r.entity as WritebackLogRow["entity"],
    sourceId: r.source_id as string,
    fieldKey: r.field_key as string,
    label: (r.label as string) ?? null,
    recordTitle: (r.records as { title?: string } | null)?.title ?? null,
    newValue: r.new_value ?? null,
    status: r.status as WritebackLogRow["status"],
    attempts: (r.attempts as number) ?? 0,
    lastError: (r.last_error as string) ?? null,
    createdAt: r.created_at as string,
    processedAt: (r.processed_at as string) ?? null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Log de sincronização (write-back)</h2>
        <p className="text-muted-foreground text-sm">
          Alterações de campos marcados para &quot;sincronizar de volta&quot; ao
          Bitrix. Itens com erro podem ser reenfileirados para nova tentativa.
        </p>
      </div>
      <WritebackLog rows={rows} />
    </div>
  );
}

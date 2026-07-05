// Versão: 1.1 | Data: 05/07/2026
// Registros. Listagem/edição completas chegam na Fase 4; nesta fase (2) a
// página já hospeda o painel de sincronização do Bitrix (só admin).
// v1.1 (05/07/2026): adicionado SyncPanel (Fase 2).
import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { SyncPanel } from "@/components/sync/sync-panel";

export default async function RegistrosPage() {
  const session = await getSessionInfo();
  const isAdmin = session?.roles.includes("admin") ?? false;

  let lastSyncedAt: string | null = null;
  if (isAdmin) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("records")
      .select("last_synced_at")
      .not("last_synced_at", "is", null)
      .order("last_synced_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    lastSyncedAt = (data?.last_synced_at as string | undefined) ?? null;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Registros</h1>
        <p className="text-muted-foreground text-sm">
          Listagem, filtros e edição de leads/negócios chegam na Fase 4.
        </p>
      </div>
      {isAdmin ? <SyncPanel lastSyncedAt={lastSyncedAt} /> : null}
    </div>
  );
}

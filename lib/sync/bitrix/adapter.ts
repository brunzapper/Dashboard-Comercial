// Versão: 1.0 | Data: 05/07/2026
// Adapter Bitrix: implementa o contrato SyncAdapter usando o service client
// (bypassa RLS — writes de sync) e o BitrixClient (webhook de entrada via env).
import { createServiceClient } from "@/lib/supabase/service";
import type { SyncAdapter, SyncResult } from "@/lib/sync/adapter";
import { BitrixClient } from "./client";
import { runBackfill, runReconcile } from "./sync";

export const bitrixAdapter: SyncAdapter = {
  name: "bitrix",

  async backfill(): Promise<SyncResult> {
    const db = createServiceClient();
    return runBackfill(db, new BitrixClient());
  },

  async reconcile(days: number): Promise<SyncResult> {
    const db = createServiceClient();
    return runReconcile(db, new BitrixClient(), days);
  },
};

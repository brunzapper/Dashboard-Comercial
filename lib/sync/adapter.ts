// Versão: 1.0 | Data: 05/07/2026
// Interface comum de adaptadores de sincronização (um adapter por fonte).
// A camada de sync é plugável: novas fontes implementam este contrato.
import type { SyncResult } from "./bitrix/sync";

export type { SyncResult };

export interface SyncAdapter {
  name: string;
  /** Importação inicial completa. */
  backfill(): Promise<SyncResult>;
  /** Reconciliação incremental (últimos N dias). */
  reconcile(days: number): Promise<SyncResult>;
}

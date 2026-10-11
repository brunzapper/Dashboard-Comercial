// Versão: 1.0 | Data: 11/10/2026
// Tipos do contrato da TRIAGEM de novas Bases de Sync (0155). Vivem fora do
// arquivo de actions porque num arquivo "use server" até um `export type` é
// registrado como export de valor e quebra a avaliação do módulo em runtime.
import type { SpaRequestConfig } from "./spa-config";

export type SpaCandidateStatus = "none" | "pending" | "approved" | "rejected";

export interface SpaCandidate {
  entityTypeId: number;
  title: string;
  total: number | null;
  status: SpaCandidateStatus;
  requestId: string | null;
  /** Base já criada (aprovada). */
  sourceKey: string | null;
}

export interface SpaRequestRow {
  id: string;
  entityTypeId: number;
  title: string;
  status: SpaCandidateStatus;
  config: SpaRequestConfig;
  note: string | null;
  sourceKey: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export type TriageResult<T> = { ok: true; data: T } | { ok: false; message: string };

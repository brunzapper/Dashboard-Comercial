// Versão: 1.0 | Data: 16/07/2026
// Server Actions do Kanban. Mover card de REGISTRO reaproveita updateRecordField
// (permissão edit_record_values, coerção, field_modified_at, recomputo de
// fórmulas, audit_log e revalidate vêm de graça — mover card É uma edição de
// campo). Sem write-back: a edição fica local (fontes de Sync divergem do
// Bitrix de propósito — ver plano/risco; fontes manuais não têm write-back).
// Mock (0051): congelado no produto — bloqueamos o move aqui com mensagem
// amigável (o trigger do banco só reverteria silenciosamente alguns campos).
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { todayBrasiliaIso } from "@/lib/date/today";
import {
  updateRecordField,
  type EditActionState,
} from "@/lib/records/actions";
import { computeDateOnMove } from "./date-move";
import {
  KANBAN_NO_VALUE_KEY,
  KANBAN_OVERFLOW_KEY,
  type KanbanDateBucket,
} from "./types";

export interface MoveRecordCardInput {
  recordId: string;
  // Agrupamento por VALOR: ref do campo ('stage' | 'custom:<key>' | ...).
  groupField?: string;
  // OU bucket de DATA: campo + bucket + valor atual do card (p/ preservar
  // semana/dia — regras D9 em date-move.ts).
  dateField?: string;
  dateBucket?: KanbanDateBucket;
  currentDateValue?: string | null;
  // Coluna destino (valor do campo, key do bucket ou KANBAN_NO_VALUE_KEY).
  targetKey: string;
}

/** Move um card de registro: grava o novo valor do campo de agrupamento. */
export async function moveRecordCard(
  input: MoveRecordCardInput
): Promise<EditActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (input.targetKey === KANBAN_OVERFLOW_KEY) {
    return { ok: false, message: "A coluna \"Outros\" não recebe cards." };
  }

  // Guarda de mock: congelado no produto (0051) — não move.
  const supabase = await createClient();
  const { data: rec } = await supabase
    .from("records")
    .select("id, is_mock")
    .eq("id", input.recordId)
    .maybeSingle();
  if (!rec) return { ok: false, message: "Registro não encontrado." };
  if (rec.is_mock) {
    return {
      ok: false,
      message: "Registros de demonstração são congelados e não podem ser movidos.",
    };
  }

  // Bucket de data: calcula a data concreta do destino e grava no campo.
  if (input.dateBucket && input.dateField) {
    const next = computeDateOnMove(
      input.currentDateValue ?? null,
      input.dateBucket,
      input.targetKey,
      todayBrasiliaIso()
    );
    const value = next ?? "";
    if (input.dateField.startsWith("custom:")) {
      return updateRecordField(input.recordId, input.dateField.slice(7), value, {
        kind: "custom",
        // O campo foi eleito pelo dono do board — mover libera a edição p/ quem
        // tem edit_record_values (mesma semântica do allowEdit dos dashboards).
        allowEdit: true,
      });
    }
    return updateRecordField(input.recordId, input.dateField, value, {
      kind: "core",
    });
  }

  // Valor de campo: destino "Sem valor" limpa o campo.
  const field = input.groupField || "stage";
  const value = input.targetKey === KANBAN_NO_VALUE_KEY ? "" : input.targetKey;
  if (field.startsWith("custom:")) {
    return updateRecordField(input.recordId, field.slice("custom:".length), value, {
      kind: "custom",
      allowEdit: true,
    });
  }
  return updateRecordField(input.recordId, field, value, { kind: "core" });
}

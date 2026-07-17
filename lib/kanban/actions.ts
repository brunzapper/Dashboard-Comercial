// Versão: 1.1 | Data: 17/07/2026
// Server Actions do Kanban. Mover card de REGISTRO reaproveita updateRecordField
// (permissão edit_record_values, coerção, field_modified_at, recomputo de
// fórmulas, audit_log e revalidate vêm de graça — mover card É uma edição de
// campo). Write-back OPCIONAL por quadro (settings.kanban.writeBack): desligado
// (default) a edição fica LOCAL (bom p/ fases em campo local que nunca vem da
// Sync); ligado, mover ENFILEIRA a mudança de volta ao Bitrix (só surte efeito
// em registros de Sync e campos mapeados/marcados; fontes manuais são no-op).
// Mock (0051): congelado no produto — bloqueamos o move aqui com mensagem
// amigável (o trigger do banco só reverteria silenciosamente alguns campos).
// v1.1 (17/07/2026): colunas "Personalizar" (input.custom) — o move grava um
//   POSICIONAMENTO da visão (kanban_placements, 0067; RLS = visualizador do
//   dashboard) e NÃO toca no registro; a guarda de mock permanece (UX
//   consistente entre modos).
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
  // Quando true, a edição é ENFILEIRADA de volta ao Bitrix (write-back). Só surte
  // efeito em registros de Sync e campos mapeados/marcados; caso contrário é
  // no-op. Default (ausente/false) = edição local, não altera a origem.
  writeBack?: boolean;
  // Colunas "Personalizar": posiciona o card na VISÃO (kanban_placements) em
  // vez de editar o registro. ownerKind/ownerId = widget kanban ou board.
  custom?: { ownerKind: "widget" | "board"; ownerId: string };
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

  // Colunas "Personalizar": upsert do posicionamento da visão (não toca no
  // registro; a RLS de kanban_placements decide — visualizador do dashboard).
  if (input.custom) {
    const ownerCol =
      input.custom.ownerKind === "widget" ? "widget_id" : "board_id";
    const { data, error } = await supabase
      .from("kanban_placements")
      .upsert(
        {
          [ownerCol]: input.custom.ownerId,
          record_id: input.recordId,
          column_key: input.targetKey,
          // Fracionária: movido vai ao topo da coluna destino.
          position: -Date.now(),
          updated_by: session.user.id,
        },
        { onConflict: `${ownerCol},record_id` }
      )
      .select("id");
    if (error) return { ok: false, message: error.message };
    if (!data || data.length === 0) {
      return { ok: false, message: "Sem permissão para mover neste quadro." };
    }
    return { ok: true };
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
        writeBack: input.writeBack,
      });
    }
    return updateRecordField(input.recordId, input.dateField, value, {
      kind: "core",
      writeBack: input.writeBack,
    });
  }

  // Valor de campo: destino "Sem valor" limpa o campo.
  const field = input.groupField || "stage";
  const value = input.targetKey === KANBAN_NO_VALUE_KEY ? "" : input.targetKey;
  if (field.startsWith("custom:")) {
    return updateRecordField(input.recordId, field.slice("custom:".length), value, {
      kind: "custom",
      allowEdit: true,
      writeBack: input.writeBack,
    });
  }
  return updateRecordField(input.recordId, field, value, {
    kind: "core",
    writeBack: input.writeBack,
  });
}

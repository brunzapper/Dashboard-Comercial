// Versão: 1.0 | Data: 09/09/2026
// QUANDO ESTE CAMPO MUDOU PELA ÚLTIMA VEZ — o fato que a série e as condições
// de tempo do motor precisam, lido da tabela CERTA.
//
// A história dessa correção importa, porque a armadilha é convidativa:
// `records.field_modified_at` PARECE ser "quando o campo mudou". Não é. No
// sync, aquele jsonb é o marcador de "editado localmente DEPOIS do último
// sync — não sobrescreva" (`isProtected`, lib/sync/shared.ts), e só o app
// escreve nele. Para qualquer campo que venha do Bitrix ele fica vazio para
// sempre: nos 36 deals em Nutrição, `field_modified_at->>'stage'` era null em
// TODOS, e a série nunca teve de onde começar a contar — a regra rodava a cada
// minuto e desistia na primeira linha, sem erro nenhum para denunciar.
//
// E não dá para "consertar" mandando o sync carimbar aquela coluna: isso
// marcaria todo campo sincronizado como protegido e o sync pararia de atualizar
// qualquer coisa. Os dois significados não cabem na mesma coluna.
//
// `audit_log` é a fonte agnóstica: o sync grava lá cada valor que muda
// (lib/sync/bitrix/sync.ts), e o app e as automações também. "Desde que mudou
// de etapa" é a última linha de `field = 'stage'` daquele registro,
// independentemente de quem a moveu — que é a semântica que se quer.
//
// Batelado por rodada, no molde de `loadSeriesOccurrences`: o tick avalia
// centenas de registros e uma consulta por registro derrubaria o orçamento.
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Última alteração conhecida de cada (registro, campo) pedido.
 *
 * Chave do mapa externo = `record_id`; a interna = o campo, no MESMO
 * vocabulário do audit (nome da coluna do núcleo, ex. `stage`, ou a chave
 * custom). Valor = timestamp ISO.
 */
export type FieldHistory = Map<string, Map<string, string>>;

/** Só o que o loader precisa saber do registro — o resto vem do audit. */
export interface FieldHistoryRecord {
  id: string;
  /** records.field_modified_at: edição local que pode ser mais recente. */
  fieldModifiedAt: Record<string, string> | null;
}

/**
 * Carrega a última alteração de cada campo pedido para cada registro.
 *
 * Combina as duas fontes pelo MAIOR timestamp: o audit cobre tudo (sync
 * inclusive), e `field_modified_at` cobre a edição local cujo audit tenha sido
 * podado por retenção. Ficar só com o audit seria quase sempre igual e às vezes
 * pior; o máximo dos dois nunca é pior que qualquer um sozinho.
 *
 * Campo sem nenhuma das duas fontes simplesmente NÃO entra no mapa — quem
 * consome trata a ausência como "nunca mudou", e nunca como "mudou hoje".
 */
export async function loadFieldHistory(
  db: SupabaseClient,
  records: FieldHistoryRecord[],
  fields: string[]
): Promise<FieldHistory> {
  const out: FieldHistory = new Map();
  if (records.length === 0 || fields.length === 0) return out;

  const put = (recordId: string, field: string, ts: string) => {
    let byField = out.get(recordId);
    if (!byField) {
      byField = new Map();
      out.set(recordId, byField);
    }
    const current = byField.get(field);
    // O maior vence: a ordem em que as fontes chegam não pode decidir o fato.
    if (!current || ts > current) byField.set(field, ts);
  };

  // Fonte 1: a edição local já veio junto com o registro — de graça.
  for (const rec of records) {
    for (const field of fields) {
      const ts = rec.fieldModifiedAt?.[field];
      if (typeof ts === "string" && ts !== "") put(rec.id, field, ts);
    }
  }

  // Fonte 2: o audit. `order desc` + o índice (record_id, field, changed_at
  // desc) da 0135 faz a primeira linha de cada par já ser a mais recente, mas
  // não dependemos disso — o `put` fica com o maior de qualquer jeito.
  const CHUNK = 200;
  const ids = records.map((r) => r.id);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data } = await db
      .from("audit_log")
      .select("record_id, field, changed_at")
      .in("record_id", ids.slice(i, i + CHUNK))
      .in("field", fields)
      .order("changed_at", { ascending: false });
    for (const row of data ?? []) {
      const ts = row.changed_at as string | null;
      if (!ts) continue;
      put(row.record_id as string, row.field as string, ts);
    }
  }

  return out;
}

/** Leitura pontual do mapa — null quando o campo nunca mudou. */
export function fieldChangedAt(
  history: FieldHistory | null | undefined,
  recordId: string,
  field: string
): string | null {
  return history?.get(recordId)?.get(field) ?? null;
}

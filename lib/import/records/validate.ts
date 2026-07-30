// Versão: 1.0 | Data: 30/07/2026
// Validador PURO do contrato "registros-insert" (inserção de registros por IA).
// Erros em pt-BR e ACIONÁVEIS — eles voltam para a IA no laço de autocorreção
// (lib/ai/json-loop.ts), então cada mensagem diz exatamente como corrigir.
// Leniências deliberadas (espelham a coerção da escrita, lib/records/coerce.ts,
// para o round-trip validador→FormData→createRecord ser sem perdas): número
// aceita string numérica ("1.234,56" inclusive); booleano aceita "true"/"false";
// texto aceita qualquer escalar. Datas são "YYYY-MM-DD" ESTRITO (core ancora em
// Brasília na escrita; custom fica texto naive — invariante 11).
import { stripCodeFence } from "@/lib/import/dashboard/validate";
import { coerce } from "@/lib/records/coerce";
import {
  MAX_AI_INSERT_RECORDS,
  RECORDS_INSERT_FORMAT,
  RECORDS_INSERT_VERSION,
  type EntryFieldSpec,
  type EntryRecord,
  type EntryValue,
  type ParsedRecordInsert,
  type RecordsEntryContext,
} from "@/lib/import/records/types";

export type RecordsInsertValidation =
  | { ok: true; records: ParsedRecordInsert[]; warnings: string[] }
  | { ok: false; errors: string[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidYmd(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const norm = (s: string) => s.trim().toLocaleLowerCase("pt-BR");

/** Lista curta p/ mensagens de erro (não estoura o turno de correção). */
function shortList(items: string[], cap = 25): string {
  return items.length > cap
    ? `${items.slice(0, cap).join(", ")}, … (+${items.length - cap})`
    : items.join(", ");
}

function resolveName(
  raw: string,
  list: { id: string; name: string }[],
  kindLabel: string,
  where: string,
  errors: string[]
): { id: string; name: string } | null {
  const hits = list.filter((r) => norm(r.name) === norm(raw));
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) {
    errors.push(
      `${where}: ${kindLabel} "${raw}" não encontrado. Use um destes nomes exatamente como cadastrado: ${shortList(list.map((r) => r.name))}.`
    );
  } else {
    errors.push(
      `${where}: há ${hits.length} cadastros com o nome "${raw}" — não é possível desambiguar; deixe o campo de fora.`
    );
  }
  return null;
}

// Valida UM valor contra o spec do campo. Devolve o valor CANÔNICO ou undefined
// (com erro registrado). Valor vazio/null = campo ausente (undefined sem erro).
function coerceEntryValue(
  spec: EntryFieldSpec,
  raw: unknown,
  where: string,
  errors: string[]
): EntryValue | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "object") {
    errors.push(
      `${where}: o campo "${spec.key}" deve ser um valor simples (texto/número/booleano), não objeto/lista.`
    );
    return undefined;
  }
  const s = String(raw).trim();
  if (s === "") return undefined;

  switch (spec.dataType) {
    case "numero":
    case "moeda": {
      // Mesma leniência da coerção de escrita (coerce): número JSON ou string
      // numérica (formato pt-BR "1.234,56" incluso).
      const n =
        typeof raw === "number" ? raw : (coerce("numero", s) as number | null);
      if (n == null || !Number.isFinite(n)) {
        errors.push(
          `${where}: "${spec.key}" espera um número (recebi "${s}"). Envie o número puro, ex.: 1250.5.`
        );
        return undefined;
      }
      return n;
    }
    case "booleano": {
      if (typeof raw === "boolean") return raw;
      if (s === "true") return true;
      if (s === "false") return false;
      errors.push(
        `${where}: "${spec.key}" espera true ou false (recebi "${s}").`
      );
      return undefined;
    }
    case "data": {
      if (!isValidYmd(s)) {
        errors.push(
          `${where}: "${spec.key}" espera data no formato YYYY-MM-DD (recebi "${s}").`
        );
        return undefined;
      }
      return s;
    }
    case "selecao": {
      const options = spec.options ?? [];
      const hit = options.find((o) => norm(o) === norm(s));
      if (spec.strictOptions) {
        if (!hit) {
          errors.push(
            `${where}: "${spec.key}" aceita apenas uma destas opções: ${shortList(options)} (recebi "${s}").`
          );
          return undefined;
        }
        return hit; // grafia canônica da opção
      }
      return hit ?? s;
    }
    case "relacao":
      // Resolvido pelo chamador (precisa da lista com ids) — aqui só o texto.
      return s;
    default: {
      // texto (e afins): qualquer escalar vira string.
      if (spec.key === "currency" && spec.strictOptions) {
        const codes = spec.options ?? [];
        const up = s.toUpperCase();
        if (!codes.includes(up)) {
          errors.push(
            `${where}: "currency" aceita apenas os códigos ${codes.join(", ")} (recebi "${s}").`
          );
          return undefined;
        }
        return up;
      }
      return s;
    }
  }
}

/**
 * Valida o JSON cru devolvido pela IA (ou re-serializado/editado pelo cliente)
 * contra o contexto da base. Sucesso devolve os registros CANÔNICOS (valores
 * normalizados; relações resolvidas p/ UUID) + warnings (notas da IA).
 */
export function validateRecordsInsert(
  raw: string,
  ctx: RecordsEntryContext
): RecordsInsertValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  let obj: Record<string, unknown>;
  try {
    const cleaned = stripCodeFence(raw);
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("sem objeto JSON");
    obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      errors: [
        "A resposta não contém um JSON válido. Responda com UM bloco JSON no formato registros-insert, sem texto fora dele.",
      ],
    };
  }

  if (obj.formato !== RECORDS_INSERT_FORMAT) {
    errors.push(`Campo "formato" deve ser "${RECORDS_INSERT_FORMAT}".`);
  }
  if (obj.versao !== RECORDS_INSERT_VERSION) {
    errors.push(`Campo "versao" deve ser ${RECORDS_INSERT_VERSION}.`);
  }

  const rawRecords = obj.registros;
  if (!Array.isArray(rawRecords) || rawRecords.length === 0) {
    errors.push('Inclua ao menos um registro em "registros" (lista de objetos).');
    return { ok: false, errors };
  }
  if (rawRecords.length > MAX_AI_INSERT_RECORDS) {
    errors.push(
      `Máximo de ${MAX_AI_INSERT_RECORDS} registros por vez (recebi ${rawRecords.length}). Mantenha os ${MAX_AI_INSERT_RECORDS} primeiros e explique em "notas" que os demais ficaram de fora.`
    );
    return { ok: false, errors };
  }

  const specByKey = new Map(ctx.fields.map((f) => [f.key, f]));
  const records: ParsedRecordInsert[] = [];

  rawRecords.forEach((rec, i) => {
    const where = `registro ${i + 1}`;
    if (rec == null || typeof rec !== "object" || Array.isArray(rec)) {
      errors.push(`${where}: deve ser um objeto { chave: valor }.`);
      return;
    }
    const values: EntryRecord = {};
    let responsibleId: string | null = null;
    let operationId: string | null = null;

    for (const [key, rawVal] of Object.entries(rec as Record<string, unknown>)) {
      const spec = specByKey.get(key);
      if (!spec) {
        errors.push(
          `${where}: chave desconhecida "${key}". Chaves aceitas: ${shortList(ctx.fields.map((f) => f.key), 40)}.`
        );
        continue;
      }
      const val = coerceEntryValue(spec, rawVal, where, errors);
      if (val === undefined) continue;
      if (spec.dataType === "relacao") {
        const list =
          spec.key === "responsible_id" ? ctx.responsibles : ctx.operations;
        const kindLabel =
          spec.key === "responsible_id" ? "responsável" : "operação";
        const hit = resolveName(String(val), list, kindLabel, where, errors);
        if (!hit) continue;
        values[key] = hit.name; // grafia canônica cadastrada
        if (spec.key === "responsible_id") responsibleId = hit.id;
        else operationId = hit.id;
        continue;
      }
      values[key] = val;
    }

    const title = values.title;
    if (typeof title !== "string" || title.trim() === "") {
      errors.push(`${where}: "title" (nome do registro) é obrigatório.`);
    }
    records.push({ values, responsibleId, operationId });
  });

  if (Array.isArray(obj.notas)) {
    for (const n of obj.notas) {
      const s = String(n ?? "").trim();
      if (s) warnings.push(s);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, records, warnings };
}

/** Serialização CANÔNICA do contrato (pendingJson do apply/da prévia). */
export function serializeRecordsInsert(rows: EntryRecord[]): string {
  return JSON.stringify(
    {
      formato: RECORDS_INSERT_FORMAT,
      versao: RECORDS_INSERT_VERSION,
      registros: rows,
    },
    null,
    2
  );
}

// Versão: 1.0 | Data: 31/07/2026
// Validador PURO do contrato "registros-update" (atualização em massa por IA).
// Erros em pt-BR ACIONÁVEIS (voltam à IA no laço de autocorreção). Regras que
// diferem do insert: ≥1 filtro OBRIGATÓRIO (proibido "todos os registros");
// operadores = exatamente FILTER_OPS (op interno seria dropado em silêncio
// pelo modo lista → over-match); relação em filtro aceita só
// eq/neq/in/is_null/not_null e mantém o NOME no valor (runtime resolve);
// `null`/"" em "alteracoes" LIMPA o campo (title nunca pode ser limpo).
// A coerção de valores de alteração é a MESMA do insert (coerceEntryValue).
import { stripCodeFence } from "@/lib/import/dashboard/validate";
import { FILTER_OPS, opHasNoValue } from "@/lib/widgets/filter-ops";
import type { FilterOp, WidgetFilter } from "@/lib/widgets/types";
import { coerceEntryValue } from "@/lib/import/records/validate";
import {
  RECORDS_UPDATE_FORMAT,
  RECORDS_UPDATE_VERSION,
  type ParsedRecordsUpdate,
  type RecordsUpdateContext,
  type UpdateChangeValue,
  type UpdateFilterFieldSpec,
} from "@/lib/import/records/update-types";

export type RecordsUpdateValidation =
  | { ok: true; update: ParsedRecordsUpdate; warnings: string[] }
  | { ok: false; errors: string[] };

const VALID_OPS = new Set<string>(FILTER_OPS.map((o) => o.op));
/** Relação em filtro: só igualdade/pertencimento/nulo — ilike/faixa sobre
 * NOME de relação não têm tradução (a coluna é UUID; o resolver só cobre
 * igualdade por elemento). */
const RELATION_OPS = new Set<FilterOp>(["eq", "neq", "in", "is_null", "not_null"]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const norm = (s: string) => s.trim().toLocaleLowerCase("pt-BR");

function shortList(items: string[], cap = 25): string {
  return items.length > cap
    ? `${items.slice(0, cap).join(", ")}, … (+${items.length - cap})`
    : items.join(", ");
}

// Resolve um NOME contra a lista cadastrada (case-insensitive). Devolve a
// grafia canônica; erro amigável p/ desconhecido/ambíguo (mesma régua do
// resolveName do insert).
function resolveFilterName(
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
      `${where}: há ${hits.length} cadastros com o nome "${raw}" — não é possível desambiguar.`
    );
  }
  return null;
}

function scalarOrNull(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object") return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function validateOneFilter(
  raw: unknown,
  i: number,
  ctx: RecordsUpdateContext,
  errors: string[]
): WidgetFilter | null {
  const where = `filtro ${i + 1}`;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`${where}: deve ser um objeto { "field", "op", "value" }.`);
    return null;
  }
  const f = raw as Record<string, unknown>;
  const field = typeof f.field === "string" ? f.field : "";
  const spec = ctx.filterFields.find((s) => s.key === field);
  if (!spec) {
    errors.push(
      `${where}: campo desconhecido "${String(f.field ?? "")}". Campos aceitos em filtros: ${shortList(
        ctx.filterFields.map((s) => s.key),
        40
      )}.`
    );
    return null;
  }
  const op = typeof f.op === "string" ? f.op : "";
  if (!VALID_OPS.has(op)) {
    errors.push(
      `${where}: operador inválido "${String(f.op ?? "")}". Operadores aceitos: ${[...VALID_OPS].join(", ")}.`
    );
    return null;
  }
  const filterOp = op as FilterOp;
  const isRelation = spec.dataType === "relacao";
  if (isRelation && !RELATION_OPS.has(filterOp)) {
    errors.push(
      `${where}: "${spec.key}" é uma relação — use eq, neq, in, is_null ou not_null (recebi "${op}").`
    );
    return null;
  }

  if (opHasNoValue(filterOp)) return { field: spec.key, op: filterOp };

  // Valor obrigatório nos demais ops. `in` exige LISTA (array JSON) — string
  // com vírgula é ambígua (nomes podem conter vírgula).
  if (filterOp === "in") {
    if (!Array.isArray(f.value) || f.value.length === 0) {
      errors.push(
        `${where}: o operador "in" exige "value" como LISTA JSON não-vazia, ex.: ["A", "B"].`
      );
      return null;
    }
    const items: string[] = [];
    for (const el of f.value) {
      const s = scalarOrNull(el);
      if (s == null) {
        errors.push(`${where}: a lista do "in" só aceita valores simples não-vazios.`);
        return null;
      }
      items.push(s);
    }
    if (isRelation) {
      const list = spec.key === "responsible_id" ? ctx.responsibles : ctx.operations;
      const kind = spec.key === "responsible_id" ? "responsável" : "operação";
      const resolved: string[] = [];
      for (const name of items) {
        const hit = resolveFilterName(name, list, kind, where, errors);
        if (!hit) return null;
        resolved.push(hit.name); // NOME canônico — runtime resolve p/ id
      }
      return { field: spec.key, op: filterOp, value: resolved };
    }
    return { field: spec.key, op: filterOp, value: items };
  }

  const value = scalarOrNull(f.value);
  if (value == null) {
    errors.push(
      `${where}: o operador "${op}" exige um "value" simples não-vazio (use is_null/not_null para vazio).`
    );
    return null;
  }
  if (isRelation) {
    const list = spec.key === "responsible_id" ? ctx.responsibles : ctx.operations;
    const kind = spec.key === "responsible_id" ? "responsável" : "operação";
    const hit = resolveFilterName(value, list, kind, where, errors);
    if (!hit) return null;
    return { field: spec.key, op: filterOp, value: hit.name };
  }
  // Campo de data: comparação é prefix-based no read side — exigir YYYY-MM-DD
  // evita filtro que nunca casa (ex.: "28/07/2026").
  if (spec.dataType === "data" && !DATE_RE.test(value)) {
    errors.push(
      `${where}: "${spec.key}" é data — use o formato YYYY-MM-DD (recebi "${value}").`
    );
    return null;
  }
  return { field: spec.key, op: filterOp, value };
}

/**
 * Valida o JSON cru devolvido pela IA (ou re-serializado pelo cliente) contra
 * o contexto da base. Sucesso devolve filtros/alterações CANÔNICOS (relações
 * de alteração resolvidas p/ UUID; filtros mantêm o NOME).
 */
export function validateRecordsUpdate(
  raw: string,
  ctx: RecordsUpdateContext
): RecordsUpdateValidation {
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
        "A resposta não contém um JSON válido. Responda com UM bloco JSON no formato registros-update, sem texto fora dele.",
      ],
    };
  }

  if (obj.formato !== RECORDS_UPDATE_FORMAT) {
    errors.push(`Campo "formato" deve ser "${RECORDS_UPDATE_FORMAT}".`);
  }
  if (obj.versao !== RECORDS_UPDATE_VERSION) {
    errors.push(`Campo "versao" deve ser ${RECORDS_UPDATE_VERSION}.`);
  }

  const rawFilters = obj.filtros;
  if (!Array.isArray(rawFilters) || rawFilters.length === 0) {
    errors.push(
      'Inclua ao menos um filtro em "filtros" — atualizar TODOS os registros da base não é permitido; descreva o recorte.'
    );
    return { ok: false, errors };
  }

  const filters: WidgetFilter[] = [];
  rawFilters.forEach((rf, i) => {
    const parsed = validateOneFilter(rf, i, ctx, errors);
    if (parsed) filters.push(parsed);
  });

  const rawChanges = obj.alteracoes;
  if (
    rawChanges == null ||
    typeof rawChanges !== "object" ||
    Array.isArray(rawChanges) ||
    Object.keys(rawChanges as object).length === 0
  ) {
    errors.push(
      'Inclua ao menos uma alteração em "alteracoes" (objeto { chave: valor }; null limpa o campo).'
    );
    return { ok: false, errors };
  }

  const specByKey = new Map(ctx.fields.map((f) => [f.key, f]));
  const changes: Record<string, UpdateChangeValue> = {};
  let responsibleId: string | null | undefined;
  let operationId: string | null | undefined;

  for (const [key, rawVal] of Object.entries(
    rawChanges as Record<string, unknown>
  )) {
    const where = `alteração "${key}"`;
    const spec = specByKey.get(key);
    if (!spec) {
      errors.push(
        `${where}: chave desconhecida ou não-editável. Chaves aceitas em "alteracoes": ${shortList(
          ctx.fields.map((f) => f.key),
          40
        )}.`
      );
      continue;
    }
    // null/"" = LIMPAR o campo (semântica própria do update).
    const cleared =
      rawVal == null ||
      (typeof rawVal !== "object" && String(rawVal).trim() === "");
    if (cleared) {
      if (spec.key === "title") {
        errors.push(`${where}: "title" (nome do registro) não pode ficar vazio.`);
        continue;
      }
      changes[key] = null;
      if (spec.key === "responsible_id") responsibleId = null;
      if (spec.key === "operation_id") operationId = null;
      continue;
    }
    const val = coerceEntryValue(spec, rawVal, where, errors);
    if (val === undefined) continue;
    if (spec.dataType === "relacao") {
      const list = spec.key === "responsible_id" ? ctx.responsibles : ctx.operations;
      const kind = spec.key === "responsible_id" ? "responsável" : "operação";
      const hit = resolveFilterName(String(val), list, kind, where, errors);
      if (!hit) continue;
      changes[key] = hit.name;
      if (spec.key === "responsible_id") responsibleId = hit.id;
      else operationId = hit.id;
      continue;
    }
    changes[key] = val;
  }

  if (Array.isArray(obj.notas)) {
    for (const n of obj.notas) {
      const s = String(n ?? "").trim();
      if (s) warnings.push(s);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const update: ParsedRecordsUpdate = {
    filters,
    changes,
    ...(responsibleId !== undefined ? { responsibleId } : {}),
    ...(operationId !== undefined ? { operationId } : {}),
  };
  return { ok: true, update, warnings };
}

/** Serialização CANÔNICA do contrato (pendingJson da prévia/do apply). */
export function serializeRecordsUpdate(
  filters: WidgetFilter[],
  changes: Record<string, UpdateChangeValue>
): string {
  return JSON.stringify(
    {
      formato: RECORDS_UPDATE_FORMAT,
      versao: RECORDS_UPDATE_VERSION,
      filtros: filters,
      alteracoes: changes,
    },
    null,
    2
  );
}

/** Rótulo legível de um filtro validado (chips da prévia). */
export function describeFilter(
  f: WidgetFilter,
  filterFields: UpdateFilterFieldSpec[]
): string {
  const label = filterFields.find((s) => s.key === f.field)?.label ?? f.field;
  const op = FILTER_OPS.find((o) => o.op === f.op)?.label ?? f.op;
  if (opHasNoValue(f.op)) return `${label} ${op}`;
  const value = Array.isArray(f.value)
    ? f.value.join(", ")
    : String(f.value ?? "");
  return `${label} ${op} ${value}`;
}

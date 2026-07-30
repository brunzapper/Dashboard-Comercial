// Versão: 1.0 | Data: 30/07/2026
// Validador PURO (estrutura) do contrato "campos-create" (criação de campos por
// IA). Erros pt-BR alimentam o laço de autocorreção. A FÓRMULA dos calculados
// só é validável com o catálogo real (banco) — o core (lib/ai/create-fields.ts)
// roda resolveAndValidateFormula (lib/records/formula-server.ts, o MESMO módulo
// dos editores/actions) sobre os itens estruturalmente válidos e devolve os
// erros dela para o mesmo laço. Regras espelham o createField
// (app/(app)/campos/actions.ts): slug do rótulo é a identidade; colisão com
// campo existente/coluna core é erro; moeda/percentual seguem
// resolveCurrencyColumns/resolveShowAsPercent.
import { stripCodeFence } from "@/lib/import/dashboard/validate";
import { slugify } from "@/lib/records/slug";
import {
  DATA_TYPE_LABELS,
  PERCENT_DATA_TYPES,
  type DataType,
} from "@/lib/records/types";
import { CURRENCY_OPTIONS } from "@/lib/widgets/currency";
import {
  FIELDS_CREATE_FORMAT,
  FIELDS_CREATE_VERSION,
  MAX_AI_CREATE_FIELDS,
  type FieldsCreateContext,
  type ParsedFieldCreate,
} from "@/lib/import/fields/types";

export type FieldsCreateValidation =
  | { ok: true; fields: ParsedFieldCreate[]; warnings: string[] }
  | { ok: false; errors: string[] };

const KNOWN_KEYS = new Set([
  "rotulo",
  "tipo",
  "opcoes",
  "formula_texto",
  "moeda",
  "percentual",
]);

const FORMULA_TYPES = new Set<DataType>(["calculado", "calculado_agg"]);
const CURRENCY_TYPES = new Set<DataType>(["moeda", "calculado", "calculado_agg"]);
const CURRENCY_CODES = CURRENCY_OPTIONS.map((c) => c.value);

export function validateFieldsCreate(
  raw: string,
  ctx: FieldsCreateContext
): FieldsCreateValidation {
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
        "A resposta não contém um JSON válido. Responda com UM bloco JSON no formato campos-create, sem texto fora dele.",
      ],
    };
  }

  if (obj.formato !== FIELDS_CREATE_FORMAT) {
    errors.push(`Campo "formato" deve ser "${FIELDS_CREATE_FORMAT}".`);
  }
  if (obj.versao !== FIELDS_CREATE_VERSION) {
    errors.push(`Campo "versao" deve ser ${FIELDS_CREATE_VERSION}.`);
  }

  const rawFields = obj.campos;
  if (!Array.isArray(rawFields) || rawFields.length === 0) {
    errors.push('Inclua ao menos um campo em "campos" (lista de objetos).');
    return { ok: false, errors };
  }
  if (rawFields.length > MAX_AI_CREATE_FIELDS) {
    errors.push(
      `Máximo de ${MAX_AI_CREATE_FIELDS} campos por vez (recebi ${rawFields.length}). Mantenha os ${MAX_AI_CREATE_FIELDS} primeiros e explique em "notas".`
    );
    return { ok: false, errors };
  }

  const existingByKey = new Map(ctx.existing.map((e) => [e.key, e]));
  const seenKeys = new Map<string, string>(); // slug → rótulo (dup no lote)
  const fields: ParsedFieldCreate[] = [];
  const typeKeys = Object.keys(DATA_TYPE_LABELS) as DataType[];

  rawFields.forEach((f, i) => {
    const where = `campo ${i + 1}`;
    if (f == null || typeof f !== "object" || Array.isArray(f)) {
      errors.push(`${where}: deve ser um objeto { rotulo, tipo, … }.`);
      return;
    }
    const item = f as Record<string, unknown>;
    for (const k of Object.keys(item)) {
      if (!KNOWN_KEYS.has(k)) {
        errors.push(
          `${where}: chave desconhecida "${k}". Aceitas: ${[...KNOWN_KEYS].join(", ")}.`
        );
      }
    }

    const rotulo = String(item.rotulo ?? "").trim();
    if (!rotulo) {
      errors.push(`${where}: "rotulo" é obrigatório.`);
      return;
    }
    const fieldKey = slugify(rotulo);
    if (!fieldKey) {
      errors.push(`${where}: rótulo "${rotulo}" não gera uma chave válida — use letras/números.`);
      return;
    }
    const whereNamed = `${where} ("${rotulo}")`;

    const tipo = String(item.tipo ?? "").trim() as DataType;
    if (!typeKeys.includes(tipo)) {
      errors.push(
        `${whereNamed}: tipo "${String(item.tipo ?? "")}" inválido. Tipos: ${typeKeys.join(", ")}.`
      );
      return;
    }

    const clash = existingByKey.get(fieldKey);
    if (clash) {
      errors.push(
        clash.core
          ? `${whereNamed}: "${fieldKey}" é uma coluna do núcleo — use outro rótulo.`
          : `${whereNamed}: já existe um campo com a chave "${fieldKey}" — use outro rótulo ou remova o item.`
      );
      return;
    }
    const dupOf = seenKeys.get(fieldKey);
    if (dupOf) {
      errors.push(
        `${whereNamed}: gera a mesma chave "${fieldKey}" de "${dupOf}" — rótulos precisam ser distintos.`
      );
      return;
    }
    seenKeys.set(fieldKey, rotulo);

    const out: ParsedFieldCreate = { rotulo, fieldKey, tipo };

    // opções (só selecao)
    if (item.opcoes != null) {
      if (tipo !== "selecao") {
        errors.push(`${whereNamed}: "opcoes" só vale para tipo selecao.`);
        return;
      }
      const opts = Array.isArray(item.opcoes)
        ? [...new Set(item.opcoes.map((o) => String(o ?? "").trim()).filter(Boolean))]
        : [];
      if (opts.length === 0) {
        errors.push(`${whereNamed}: "opcoes" deve ser uma lista de textos não vazios.`);
        return;
      }
      out.opcoes = opts;
    } else if (tipo === "selecao") {
      errors.push(`${whereNamed}: tipo selecao exige a lista "opcoes".`);
      return;
    }

    // fórmula (só calculados)
    const formulaTexto = String(item.formula_texto ?? "").trim();
    if (FORMULA_TYPES.has(tipo)) {
      if (!formulaTexto) {
        errors.push(
          `${whereNamed}: tipo ${tipo} exige "formula_texto" (fórmula estilo planilha).`
        );
        return;
      }
      out.formulaTexto = formulaTexto;
    } else if (formulaTexto) {
      errors.push(`${whereNamed}: "formula_texto" só vale para calculado/calculado_agg.`);
      return;
    }

    // moeda
    if (item.moeda != null) {
      if (!CURRENCY_TYPES.has(tipo)) {
        errors.push(`${whereNamed}: "moeda" só vale para moeda/calculado/calculado_agg.`);
        return;
      }
      const m = item.moeda as Record<string, unknown>;
      const modo = String(m?.modo ?? "").trim();
      if (modo !== "inherit" && modo !== "fixed") {
        errors.push(`${whereNamed}: "moeda.modo" deve ser "inherit" ou "fixed".`);
        return;
      }
      out.moedaModo = modo;
      if (modo === "fixed") {
        const codigo = String(m?.codigo ?? "BRL").trim().toUpperCase();
        if (!CURRENCY_CODES.includes(codigo)) {
          errors.push(
            `${whereNamed}: "moeda.codigo" deve ser um de ${CURRENCY_CODES.join(", ")}.`
          );
          return;
        }
        out.moedaCodigo = codigo;
      }
    }

    // percentual (tipos elegíveis; nunca junto com moeda)
    if (item.percentual != null) {
      const p = item.percentual === true || item.percentual === "true";
      if (p) {
        if (!PERCENT_DATA_TYPES.includes(tipo)) {
          errors.push(
            `${whereNamed}: "percentual" só vale para os tipos ${PERCENT_DATA_TYPES.join(", ")}.`
          );
          return;
        }
        if (out.moedaModo) {
          errors.push(`${whereNamed}: "percentual" não combina com "moeda" — escolha um.`);
          return;
        }
        out.percentual = true;
      }
    }

    fields.push(out);
  });

  if (Array.isArray(obj.notas)) {
    for (const n of obj.notas) {
      const s = String(n ?? "").trim();
      if (s) warnings.push(s);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, fields, warnings };
}

/** Serialização CANÔNICA do contrato (pendingJson da prévia/apply). */
export function serializeFieldsCreate(fields: ParsedFieldCreate[]): string {
  return JSON.stringify(
    {
      formato: FIELDS_CREATE_FORMAT,
      versao: FIELDS_CREATE_VERSION,
      campos: fields.map((f) => ({
        rotulo: f.rotulo,
        tipo: f.tipo,
        ...(f.opcoes ? { opcoes: f.opcoes } : {}),
        ...(f.formulaTexto ? { formula_texto: f.formulaTexto } : {}),
        ...(f.moedaModo
          ? {
              moeda: {
                modo: f.moedaModo,
                ...(f.moedaCodigo ? { codigo: f.moedaCodigo } : {}),
              },
            }
          : {}),
        ...(f.percentual ? { percentual: true } : {}),
      })),
    },
    null,
    2
  );
}

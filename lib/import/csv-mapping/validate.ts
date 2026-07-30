// Versão: 1.0 | Data: 30/07/2026
// Validador PURO do contrato "csv-mapeamento" (sugestão de mapeamento de CSV
// por IA na etapa 3 do wizard de import). A IA só SUGERE — o resultado
// preenche o estado `plans` do wizard e o usuário revisa na tabela existente
// (a revisão É a confirmação; o fluxo de import segue intocado). Erros em
// pt-BR alimentam o laço de autocorreção (lib/ai/json-loop.ts).
// Regras espelham as travas do próprio wizard: toda coluna do CSV mapeada
// exatamente uma vez; alvo no conjunto aceito; campo novo exige rótulo válido
// (slug não vazio) + tipo de IMPORT_NEW_FIELD_TYPES; dois alvos iguais
// (fora ignore/responsible) = erro.
import { stripCodeFence } from "@/lib/import/dashboard/validate";
import {
  CORE_IMPORT_TARGETS,
  IMPORT_NEW_FIELD_TYPES,
} from "@/lib/import/csv";
import { slugify } from "@/lib/records/slug";

export const CSV_MAPPING_FORMAT = "csv-mapeamento";
export const CSV_MAPPING_VERSION = 1;

/** Contexto de validação: colunas do CSV + campos existentes aplicáveis. */
export interface CsvMappingContext {
  csvColumns: string[];
  /** field_keys dos campos existentes oferecidos como destino (`custom:<k>`). */
  customFieldKeys: string[];
}

/** Item validado — shape pronto p/ virar patch do ColumnPlan do wizard. */
export interface CsvMappingItem {
  coluna: string;
  /** "ignore" | "responsible" | "new" | "core:<col>" | "custom:<key>" */
  alvo: string;
  novoRotulo?: string;
  novoTipo?: string;
}

export type CsvMappingValidation =
  | { ok: true; items: CsvMappingItem[]; warnings: string[] }
  | { ok: false; errors: string[] };

const FIXED_TARGETS = new Set(["ignore", "responsible", "new"]);

export function validateCsvMapping(
  raw: string,
  ctx: CsvMappingContext
): CsvMappingValidation {
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
        "A resposta não contém um JSON válido. Responda com UM bloco JSON no formato csv-mapeamento, sem texto fora dele.",
      ],
    };
  }

  if (obj.formato !== CSV_MAPPING_FORMAT) {
    errors.push(`Campo "formato" deve ser "${CSV_MAPPING_FORMAT}".`);
  }
  if (obj.versao !== CSV_MAPPING_VERSION) {
    errors.push(`Campo "versao" deve ser ${CSV_MAPPING_VERSION}.`);
  }

  const rawCols = obj.colunas;
  if (!Array.isArray(rawCols)) {
    errors.push('Inclua a lista "colunas" com um item por coluna do CSV.');
    return { ok: false, errors };
  }

  const coreValues = new Set(CORE_IMPORT_TARGETS.map((t) => t.value));
  const customValues = new Set(ctx.customFieldKeys.map((k) => `custom:${k}`));
  const newTypes = new Set<string>(IMPORT_NEW_FIELD_TYPES);
  const wanted = new Set(ctx.csvColumns);
  const seen = new Set<string>();
  const items: CsvMappingItem[] = [];

  rawCols.forEach((c, i) => {
    const where = `colunas[${i}]`;
    if (c == null || typeof c !== "object" || Array.isArray(c)) {
      errors.push(`${where}: deve ser um objeto { coluna, alvo, … }.`);
      return;
    }
    const item = c as Record<string, unknown>;
    const coluna = String(item.coluna ?? "").trim();
    const alvo = String(item.alvo ?? "").trim();
    if (!wanted.has(coluna)) {
      errors.push(
        `${where}: coluna "${coluna}" não existe no CSV. Colunas do arquivo: ${ctx.csvColumns.join(", ")}.`
      );
      return;
    }
    if (seen.has(coluna)) {
      errors.push(`${where}: coluna "${coluna}" mapeada mais de uma vez.`);
      return;
    }
    seen.add(coluna);

    if (
      !FIXED_TARGETS.has(alvo) &&
      !coreValues.has(alvo) &&
      !customValues.has(alvo)
    ) {
      errors.push(
        `${where}: alvo "${alvo}" inválido para "${coluna}". Use ignore, responsible, new, uma coluna do sistema (${[...coreValues].join(", ")}) ou um campo existente (${[...customValues].join(", ") || "nenhum nesta base"}).`
      );
      return;
    }

    const out: CsvMappingItem = { coluna, alvo };
    if (alvo === "new") {
      const rotulo = String(item.novo_rotulo ?? "").trim();
      const tipo = String(item.novo_tipo ?? "").trim();
      if (!rotulo || slugify(rotulo).length === 0) {
        errors.push(
          `${where}: alvo "new" exige "novo_rotulo" (nome do campo a criar) para "${coluna}".`
        );
        return;
      }
      if (!newTypes.has(tipo)) {
        errors.push(
          `${where}: "novo_tipo" deve ser um de ${[...newTypes].join(", ")} (recebi "${tipo}") para "${coluna}".`
        );
        return;
      }
      out.novoRotulo = rotulo;
      out.novoTipo = tipo;
    }
    items.push(out);
  });

  // Toda coluna do CSV precisa aparecer (a IA decide o alvo, nunca omite).
  for (const col of ctx.csvColumns) {
    if (!seen.has(col)) {
      errors.push(
        `A coluna "${col}" do CSV ficou sem mapeamento — inclua-a (use "ignore" se não houver destino).`
      );
    }
  }

  // Dois alvos iguais (fora ignore/responsible) — mesma trava do wizard.
  const targetCount = new Map<string, number>();
  for (const it of items) {
    if (it.alvo === "ignore" || it.alvo === "responsible") continue;
    const key = it.alvo === "new" ? `new:${slugify(it.novoRotulo ?? "")}` : it.alvo;
    targetCount.set(key, (targetCount.get(key) ?? 0) + 1);
  }
  for (const [key, n] of targetCount) {
    if (n > 1) {
      errors.push(
        `O destino "${key.replace(/^new:/, "campo novo ")}" foi usado por ${n} colunas — cada destino aceita uma coluna só.`
      );
    }
  }

  if (Array.isArray(obj.notas)) {
    for (const n of obj.notas) {
      const s = String(n ?? "").trim();
      if (s) warnings.push(s);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, items, warnings };
}

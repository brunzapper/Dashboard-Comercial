// Versão: 1.0 | Data: 07/08/2026
// Resposta de IA EXTERNA em CSV para o contrato "mapeamentos-classify":
// converte o CSV colado (cabeçalho `valor,<fieldKey…>` — aceita também os
// RÓTULOS dos targets e o rótulo do campo cru no lugar de "valor") no
// envelope JSON canônico, que segue pelo MESMO validador do contrato
// (nenhuma regra duplicada aqui — só a tradução de formato). Puro; erros
// pt-BR que listam os cabeçalhos aceitos.
import Papa from "papaparse";

import {
  MAPPINGS_CLASSIFY_FORMAT,
  MAPPINGS_CLASSIFY_VERSION,
  type MappingsClassifyContext,
} from "./types";

export type CsvToClassifyResult =
  | { ok: true; json: string }
  | { ok: false; errors: string[] };

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** O texto colado parece CSV (e não JSON)? Heurística barata p/ o preview. */
export function looksLikeCsv(raw: string): boolean {
  const t = raw.trim();
  if (!t || t.startsWith("{") || t.startsWith("[")) return false;
  const firstLine = t.split(/\r?\n/, 1)[0] ?? "";
  return firstLine.includes(",") || firstLine.includes(";");
}

/**
 * Converte um CSV de classificação no JSON do contrato. Cabeçalho: 1ª coluna
 * "valor" (ou o rótulo do campo cru); demais colunas = fieldKey OU rótulo de
 * cada target do domínio. Linhas com todas as saídas vazias são ignoradas.
 */
export function csvToClassifyJson(
  raw: string,
  ctx: MappingsClassifyContext
): CsvToClassifyResult {
  const parsed = Papa.parse<string[]>(raw.trim(), {
    delimiter: "",
    skipEmptyLines: "greedy",
  });
  const rows = (parsed.data ?? []).filter(
    (r): r is string[] => Array.isArray(r) && r.some((c) => String(c).trim() !== "")
  );
  if (rows.length < 2) {
    return {
      ok: false,
      errors: [
        "CSV vazio — envie um cabeçalho (valor, campos de saída) e ao menos uma linha.",
      ],
    };
  }

  const header = rows[0].map((h) => String(h ?? ""));
  const valueAliases = new Set(["valor", norm(ctx.rawFieldLabel)]);
  if (!valueAliases.has(norm(header[0] ?? ""))) {
    return {
      ok: false,
      errors: [
        `1ª coluna do CSV deve ser "valor" (ou "${ctx.rawFieldLabel}") — veio "${header[0] ?? ""}".`,
      ],
    };
  }

  // Demais colunas → target por fieldKey OU rótulo (case/acentos indiferentes).
  const targetByAlias = new Map<string, string>();
  for (const t of ctx.targets) {
    targetByAlias.set(norm(t.fieldKey), t.fieldKey);
    targetByAlias.set(norm(t.label), t.fieldKey);
  }
  const columnTargets: (string | null)[] = [];
  const errors: string[] = [];
  for (let c = 1; c < header.length; c++) {
    const alias = norm(header[c] ?? "");
    if (alias === "") {
      columnTargets.push(null);
      continue;
    }
    const fieldKey = targetByAlias.get(alias);
    if (!fieldKey) {
      errors.push(
        `Coluna desconhecida no CSV: "${header[c]}". Aceitas: ` +
          ctx.targets.map((t) => `"${t.fieldKey}" (${t.label})`).join(", ") +
          "."
      );
      columnTargets.push(null);
      continue;
    }
    columnTargets.push(fieldKey);
  }
  if (errors.length > 0) return { ok: false, errors };
  if (!columnTargets.some(Boolean)) {
    return {
      ok: false,
      errors: [
        "CSV sem colunas de saída — inclua ao menos um campo do domínio no cabeçalho.",
      ],
    };
  }

  const itens: { valor: string; saidas: Record<string, string> }[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const valor = String(row[0] ?? "").trim();
    if (!valor) continue;
    const saidas: Record<string, string> = {};
    for (let c = 1; c < header.length; c++) {
      const fieldKey = columnTargets[c - 1];
      if (!fieldKey) continue;
      const v = String(row[c] ?? "").trim();
      if (v) saidas[fieldKey] = v;
    }
    if (Object.keys(saidas).length === 0) continue; // linha sem classificação
    itens.push({ valor, saidas });
  }
  if (itens.length === 0) {
    return {
      ok: false,
      errors: ["Nenhuma linha do CSV tem classificação preenchida."],
    };
  }

  return {
    ok: true,
    json: JSON.stringify({
      formato: MAPPINGS_CLASSIFY_FORMAT,
      versao: MAPPINGS_CLASSIFY_VERSION,
      dominio: ctx.domainKey,
      itens,
    }),
  };
}

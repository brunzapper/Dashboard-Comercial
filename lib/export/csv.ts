// Versão: 1.0 | Data: 17/07/2026
// Núcleo PURO de exportação CSV (client-safe) — usado pela tela de Registros,
// pelo menu dos widgets e pelos kanbans. Convenções pensadas para o Excel
// pt-BR abrir direto E para o round-trip com o import (lib/import/csv.ts):
//   - separador ";" + BOM UTF-8 (Excel pt-BR reconhece sem assistente);
//   - datas dd/mm/aaaa (o que coerceDate lê);
//   - números com vírgula decimal e SEM separador de milhar (coerceNumber lê).
import Papa from "papaparse";

const BOM = "\ufeff";

/** Gera o texto CSV (com BOM) a partir de cabeçalhos + linhas já em string. */
export function buildCsv(headers: string[], rows: string[][]): string {
  return (
    BOM +
    Papa.unparse(
      { fields: headers, data: rows },
      { delimiter: ";", newline: "\r\n" }
    )
  );
}

/** Número → string com vírgula decimal, sem milhar ("1234,56"). */
export function csvNumber(value: unknown): string {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return String(n).replace(".", ",");
}

/** `registros-leads` → `registros-leads-2026-07-17.csv` (data local). */
export function csvFilename(context: string): string {
  const d = new Date();
  const ymd = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
  const slug = context
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "export"}-${ymd}.csv`;
}

/** Dispara o download no browser (client only). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

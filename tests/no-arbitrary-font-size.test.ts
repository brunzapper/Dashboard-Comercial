// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): guarda ESTÁTICA da escala tipográfica dos dashboards.
//   Tamanho de fonte em px solto (`text-[11px]`) foi o que deixou a interface
//   com 32 tamanhos avulsos que nenhum estilo conseguia governar. Em
//   components/dashboards/** use a escala nomeada (text-2xs, text-micro,
//   text-xs…) ou `em` relativo ao bloco — nunca px fixo em classe.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../components/dashboards");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("escala tipográfica dos dashboards", () => {
  it("nenhum text-[Npx] em components/dashboards", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const src = readFileSync(file, "utf8");
      src.split("\n").forEach((line, i) => {
        if (/text-\[\d+(\.\d+)?px\]/.test(line)) {
          offenders.push(`${path.relative(ROOT, file)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

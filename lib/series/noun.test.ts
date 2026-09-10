// Versão: 1.0 | Data: 10/09/2026
// O SUBSTANTIVO DA OCORRÊNCIA — e a guarda que impede o vocabulário inventado
// de voltar.
//
// Contexto: uma entrega anterior espalhou por 37 arquivos (código, UI, testes e
// os quatro documentos) uma palavra de domínio que esta organização não usa. Um
// rótulo errado no fonte não é erro de digitação: ele reaparece em toda tela
// nova, e a correção seguinte tem de varrer o repositório de novo. Duas
// defesas, e as duas moram aqui:
//
//   1. o substantivo virou DADO (SeriesConfig.noun / tasks.occurrence_noun),
//      com um dono único da frase (`occurrenceLabel`);
//   2. o teste estático abaixo, que reprova qualquer .ts/.tsx que volte a
//      escrever a palavra no fonte.
//
// A allowlist é curta de propósito e cada linha dela é DADO REAL de negócio
// (um segmento de mercado, o rótulo de um campo que existe no Bitrix) — nunca
// vocabulário do sistema.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SERIES_NOUN,
  MAX_SERIES_NOUN_LEN,
  occurrenceLabel,
  parseSeriesConfig,
  parseSeriesNoun,
} from "./types";

describe("occurrenceLabel", () => {
  it("sem substantivo, o padrão do sistema", () => {
    expect(occurrenceLabel(3)).toBe(`3ª ${DEFAULT_SERIES_NOUN}`);
    expect(DEFAULT_SERIES_NOUN).toBe("Tarefa");
  });

  it("a série escolhe o próprio", () => {
    expect(occurrenceLabel(1, "Follow-up")).toBe("1ª Follow-up");
  });

  // Espaço em branco não é escolha: seria um rótulo "3ª " na tela.
  it("vazio ou só espaço cai no padrão", () => {
    expect(occurrenceLabel(2, "   ")).toBe(`2ª ${DEFAULT_SERIES_NOUN}`);
    expect(occurrenceLabel(2, null)).toBe(`2ª ${DEFAULT_SERIES_NOUN}`);
  });
});

describe("parseSeriesNoun", () => {
  it("corta no teto em vez de recusar", () => {
    const v = parseSeriesNoun("x".repeat(200));
    expect(v).toHaveLength(MAX_SERIES_NOUN_LEN);
  });

  it("qualquer coisa fora do contrato é ausência", () => {
    expect(parseSeriesNoun(undefined)).toBeUndefined();
    expect(parseSeriesNoun(42)).toBeUndefined();
    expect(parseSeriesNoun("  ")).toBeUndefined();
  });
});

describe("parseSeriesConfig — o substantivo é opcional", () => {
  const base = {
    key: "acompanhamento",
    title: "Follow-up",
    anchor: { kind: "field_changed", field: "stage" },
    cadence: { defaultDays: 14 },
  };

  // Um rótulo ruim NÃO pode derrubar a série inteira: quem cobra fail-closed é
  // a cadência e a âncora, não a palavra escolhida para exibir.
  it("substantivo inválido não derruba o parse", () => {
    const cfg = parseSeriesConfig({ ...base, noun: 42 });
    expect(cfg).not.toBeNull();
    expect(cfg!.noun).toBeUndefined();
  });

  it("substantivo válido sobrevive ao round-trip", () => {
    expect(parseSeriesConfig({ ...base, noun: " Visita " })!.noun).toBe("Visita");
  });
});

// ---------------------------------------------------------------------------
// A guarda estática.
// ---------------------------------------------------------------------------

const ROOT = path.join(__dirname, "..", "..");
const SCAN_DIRS = ["app", "components", "lib", "tests"];
/** Este arquivo escreve o radical na própria regex — ele não se audita. */
const SELF = "lib/series/noun.test.ts";

/**
 * Onde a palavra é DADO, não vocabulário do sistema:
 *  - `segmento.ts`: um segmento de mercado classificado (dado do cliente);
 *  - `bitrix-field-map.ts`: o rótulo de um campo que existe no Bitrix — mudar
 *    aqui desalinharia o catálogo do portal.
 */
const ALLOWLIST = new Set([
  "lib/mappings/classify/segmento.ts",
  "lib/config/bitrix-field-map.ts",
]);

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("vocabulário: a palavra inventada não volta ao fonte", () => {
  it("nenhum .ts/.tsx fora da allowlist a escreve", () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(path.join(ROOT, dir), [])) {
        const rel = path.relative(ROOT, file).split(path.sep).join("/");
        if (rel === SELF || ALLOWLIST.has(rel)) continue;
        const text = readFileSync(file, "utf8");
        // Pega o radical inteiro (cobrança/cobranças/cobrar/cobra…), com e sem
        // acento — a busca preguiçosa é justamente a que deixou passar antes.
        if (/cobran[çc]|cobrar|cobran/i.test(text)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});

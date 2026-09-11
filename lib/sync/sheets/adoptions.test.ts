// Versão: 1.0 | Data: 11/09/2026
// Régua PURA da adoção (lib/sync/sheets/adoptions.ts). Os testes de ponta a
// ponta vivem em adapter.test.ts; aqui ficam os fail-closed isolados, porque é
// deles que depende a adoção não ser pior que o bug que conserta.
import { describe, expect, it } from "vitest";

import {
  brasiliaDay,
  pickAdoptions,
  type AdoptionCandidate,
} from "./adoptions";
import type { ExistingRecord } from "@/lib/sync/shared";

function cand(over: Partial<AdoptionCandidate> = {}): AdoptionCandidate {
  return {
    id: "e1",
    sourceId: "hash-antigo",
    email: "contato@cliente.com",
    day: "2026-08-01",
    record: { id: "e1" } as unknown as ExistingRecord,
    ...over,
  };
}

const req = (over: Partial<Parameters<typeof pickAdoptions>[0][number]> = {}) => ({
  sourceId: "hash-novo",
  email: "contato@cliente.com",
  day: "2026-08-01",
  ...over,
});

describe("pickAdoptions", () => {
  it("adota quando a impressão digital casa um único candidato livre", () => {
    const { picks, ambiguous } = pickAdoptions([req()], [cand()], new Set());
    expect(picks.get("hash-novo")?.id).toBe("e1");
    expect(ambiguous).toEqual([]);
  });

  it("dia diferente não casa — é o que impede fundir venda de cliente recorrente", () => {
    const { picks } = pickAdoptions(
      [req({ day: "2026-09-01" })],
      [cand()],
      new Set()
    );
    expect(picks.size).toBe(0);
  });

  it("2+ candidatos: não adota e reporta ambiguidade", () => {
    const { picks, ambiguous } = pickAdoptions(
      [req()],
      [cand({ id: "e1" }), cand({ id: "e2" })],
      new Set()
    );
    expect(picks.size).toBe(0);
    expect(ambiguous).toEqual(["hash-novo"]);
  });

  it("candidato já reivindicado pelo hash não é adotável", () => {
    const { picks } = pickAdoptions([req()], [cand()], new Set(["e1"]));
    expect(picks.size).toBe(0);
  });

  it("sem e-mail nunca adota", () => {
    const { picks } = pickAdoptions([req({ email: null })], [cand()], new Set());
    expect(picks.size).toBe(0);
  });

  it("um candidato serve a uma linha só", () => {
    // Duas linhas com a MESMA impressão digital (o dedup do payload já as
    // colapsa, mas a garantia é barata): a segunda não reassume o mesmo
    // registro por cima da primeira.
    const { picks } = pickAdoptions(
      [req({ sourceId: "novo-a" }), req({ sourceId: "novo-b" })],
      [cand()],
      new Set()
    );
    expect(picks.size).toBe(1);
    expect(picks.has("novo-a")).toBe(true);
  });

  it("e-mail diferente não casa", () => {
    const { picks } = pickAdoptions(
      [req({ email: "outro@cliente.com" })],
      [cand()],
      new Set()
    );
    expect(picks.size).toBe(0);
  });
});

describe("brasiliaDay", () => {
  it("lê o dia no fuso de Brasília, não em UTC", () => {
    // 01/08 21:00 em Brasília é 02/08 00:00Z — o dia certo é o de Brasília,
    // senão a impressão digital erra a data em toda venda do fim do dia.
    expect(brasiliaDay("2026-08-02T00:00:00+00:00")).toBe("2026-08-01");
    expect(brasiliaDay("2026-08-01T00:00:00-03:00")).toBe("2026-08-01");
  });

  it("valor ausente ou inválido devolve null (nunca inventa dia)", () => {
    expect(brasiliaDay(null)).toBeNull();
    expect(brasiliaDay("nao-e-data")).toBeNull();
  });
});

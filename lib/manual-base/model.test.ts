// Versão: 1.0 | Data: 17/09/2026
// O serializador dos lançamentos para prompt. O que estes testes protegem:
//  1. O VOCABULÁRIO — `dado`/`periodo`/`valor`/`operacao`/`responsavel` são as
//     palavras que o contrato base-manual-edit já usa; mudá-las aqui faria a IA
//     aprender uma grafia num prompt e outra no seguinte.
//  2. Nenhum ID atravessa (nem de série, nem de responsável/operação).
//  3. `includeSpread` é OPT-IN: sem ele a saída fica byte-idêntica à do
//     assistente da Base manual, que não pediu a mudança.
//  4. O truncamento corta os mais ANTIGOS, nunca ao acaso.
import { describe, expect, it } from "vitest";

import { manualBaseModelBlock } from "@/lib/manual-base/model";
import type { ManualBaseData } from "@/lib/manual-base/types";

const RESP = new Map([["r1", "Maria Silva"]]);
const OPS = new Map([["o1", "Outbound"]]);

const base = (over: Partial<ManualBaseData> = {}): ManualBaseData => ({
  families: [],
  members: [],
  series: [
    {
      id: "s1",
      key: "emails_replied",
      label: "# Emails replied",
      default_spread: "ancora",
      sort_order: 0,
    },
  ],
  entries: [
    {
      id: "e1",
      series_id: "s1",
      period_start: "2026-08-01",
      period_end: "2026-08-31",
      value: 35,
      responsible_id: null,
      operation_id: "o1",
      spread: "diario",
      note: null,
    coords: {},
    },
  ],
  ...over,
});

describe("manualBaseModelBlock", () => {
  it("usa o vocabulário do contrato e não deixa id nenhum vazar", () => {
    const block = manualBaseModelBlock(base(), { respById: RESP, opById: OPS });
    expect(block.lancamentos).toEqual([
      {
        dado: "# Emails replied",
        periodo: "2026-08-01 a 2026-08-31",
        valor: 35,
        operacao: "Outbound",
        responsavel: null,
      },
    ]);
    expect(block.dados).toEqual([
      { chave: "emails_replied", rotulo: "# Emails replied" },
    ]);
    // Nenhum uuid/id interno no JSON inteiro.
    const text = JSON.stringify(block);
    expect(text).not.toContain("s1");
    expect(text).not.toContain("o1");
    expect(text).not.toContain("e1");
  });

  it("includeSpread acrescenta a forma de contagem, pelo rótulo dono da frase", () => {
    const block = manualBaseModelBlock(base(), {
      respById: RESP,
      opById: OPS,
      includeSpread: true,
    });
    expect(block.lancamentos[0].distribuicao).toBe(
      "Distribuir por igual entre os dias"
    );
    expect(block.dados[0].distribuicao_padrao).toBe(
      "Valor cheio na data de início"
    );
  });

  it("responsável resolve por NOME; id desconhecido vira null, nunca o id", () => {
    const b = base({
      entries: [
        {
          ...base().entries[0],
          responsible_id: "r1",
          operation_id: "sumiu",
        },
      ],
    });
    const block = manualBaseModelBlock(b, { respById: RESP, opById: OPS });
    expect(block.lancamentos[0].responsavel).toBe("Maria Silva");
    expect(block.lancamentos[0].operacao).toBeNull();
  });

  it("ordena do mais recente e trunca os ANTIGOS, contando o resto", () => {
    const mk = (id: string, start: string) => ({
      ...base().entries[0],
      id,
      period_start: start,
      period_end: start,
    });
    const b = base({
      entries: [mk("a", "2026-06-01"), mk("b", "2026-08-01"), mk("c", "2026-07-01")],
    });
    const block = manualBaseModelBlock(b, {
      respById: RESP,
      opById: OPS,
      limit: 2,
    });
    expect(block.lancamentos.map((l) => l.periodo)).toEqual([
      "2026-08-01 a 2026-08-01",
      "2026-07-01 a 2026-07-01",
    ]);
    expect(block.truncado).toBe(1);
  });

  it("sem truncamento a chave nem aparece", () => {
    const block = manualBaseModelBlock(base(), { respById: RESP, opById: OPS });
    expect(block.truncado).toBeUndefined();
    expect("truncado" in block).toBe(false);
  });

  it("base vazia devolve listas vazias, nunca quebra", () => {
    const block = manualBaseModelBlock(
      { series: [], entries: [], families: [], members: [] },
      { respById: RESP, opById: OPS }
    );
    expect(block).toEqual({ dados: [], lancamentos: [] });
  });
});

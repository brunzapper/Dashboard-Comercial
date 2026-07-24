// Versão: 1.0 | Data: 24/07/2026
// Testes da regra 0052 client-side: mocks de "Data Reunião" só contam quando a
// consulta REFERENCIA uma das chaves do campo. A detecção é textual por
// substring DE PROPÓSITO (paridade com o like '%<key>%' do SQL) — o teste de
// substring existe para ninguém "corrigir" só de um lado.
import { describe, expect, it } from "vitest";

import {
  includesMockReuniaoRef,
  MOCK_REUNIAO_KEYS,
} from "@/lib/widgets/mock-reuniao";

const LEAD_KEY = MOCK_REUNIAO_KEYS[0];
const DEAL_KEY = MOCK_REUNIAO_KEYS[1];

describe("includesMockReuniaoRef", () => {
  it("chave em filtro (objeto aninhado serializado) → true", () => {
    const filters = [{ field: `custom:${LEAD_KEY}`, op: "not_null" }];
    expect(includesMockReuniaoRef([filters])).toBe(true);
  });

  it("chave do Negócio numa métrica → true; partes sem chave → false", () => {
    const metrics = [{ field: `custom:${DEAL_KEY}`, agg: "count" }];
    expect(includesMockReuniaoRef([metrics])).toBe(true);
    expect(
      includesMockReuniaoRef([
        [{ field: "closed_at", op: "gte", value: "2026-07-01" }],
        [{ field: "mrr", agg: "sum" }],
      ])
    ).toBe(false);
  });

  it("campo unificado referenciado + correspondência com a chave → true", () => {
    const available = [
      {
        field: "unified:reuniao",
        unifiedMembers: { lead: `custom:${LEAD_KEY}`, negocio: "closed_at" },
      },
    ];
    expect(
      includesMockReuniaoRef([[{ field: "unified:reuniao" }]], available)
    ).toBe(true);
  });

  it("correspondência tem a chave mas o unificado NÃO é referenciado → false", () => {
    const available = [
      { field: "unified:reuniao", unifiedMembers: { lead: `custom:${LEAD_KEY}` } },
    ];
    expect(
      includesMockReuniaoRef([[{ field: "pipeline" }]], available)
    ).toBe(false);
  });

  it("unificado referenciado mas correspondência SEM a chave → false", () => {
    const available = [
      { field: "unified:reuniao", unifiedMembers: { negocio: "closed_at" } },
    ];
    expect(
      includesMockReuniaoRef([[{ field: "unified:reuniao" }]], available)
    ).toBe(false);
  });

  it("substring de string maior → true (paridade proposital com o SQL)", () => {
    expect(includesMockReuniaoRef([`prefixo_${LEAD_KEY}_sufixo`])).toBe(true);
  });

  it("partes null/undefined não quebram", () => {
    expect(includesMockReuniaoRef([null, undefined, {}])).toBe(false);
  });
});

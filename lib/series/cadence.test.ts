// Versão: 1.1 | Data: 10/09/2026
// v1.1 (10/09/2026): o escopo `record` no liga/desliga vale mesmo NÃO
// declarado — a Tree grava `active:false` por registro ao encerrar a sequência,
// e quem clica ali não abriu o construtor. A cadência segue exigindo a
// declaração, e é essa assimetria que os testes novos pinam.
// A cascata decide duas coisas com regras DIFERENTES, e é essa diferença que
// os testes protegem: a cadência é do escopo MAIS PRECEDENTE que tiver número
// gravado; o desligar é de QUALQUER escopo alcançado — um "não" não pode ser
// anulado por uma exceção de cadência mais específica.
import { describe, expect, it } from "vitest";

import { resolveCadence, scopeValueFor, type SeriesSetting } from "./cadence";
import type { SeriesCadence } from "./types";

const record = {
  id: "rec-1",
  responsible_id: "resp-1",
  stage: "Nutrição",
  custom_fields: {},
} as never;

const cadence: SeriesCadence = {
  defaultDays: 14,
  // Precedência declarada pelo esquema: registro > responsável > etapa.
  overrideScopes: [
    { kind: "record" },
    { kind: "responsible" },
    { kind: "field", field: "stage" },
  ],
};

const setting = (over: Partial<SeriesSetting>): SeriesSetting => ({
  scopeKind: "responsible",
  scopeValue: "resp-1",
  cadenceDays: null,
  active: true,
  ...over,
});

describe("resolveCadence", () => {
  it("sem exceção, vale o padrão do esquema", () => {
    const r = resolveCadence(cadence, record, [], []);
    expect(r).toMatchObject({ days: 14, active: true, fromScope: null });
  });

  it("o escopo mais precedente com número gravado vence", () => {
    const r = resolveCadence(cadence, record, [], [
      setting({ scopeKind: "responsible", scopeValue: "resp-1", cadenceDays: 30 }),
      setting({ scopeKind: "record", scopeValue: "rec-1", cadenceDays: 7 }),
    ]);
    expect(r.days).toBe(7);
    expect(r.fromScope).toEqual({ kind: "record" });
  });

  it("exceção de escopo menos precedente vale quando o de cima não tem", () => {
    const r = resolveCadence(cadence, record, [], [
      setting({ scopeKind: "responsible", scopeValue: "resp-1", cadenceDays: 30 }),
    ]);
    expect(r.days).toBe(30);
  });

  it("exceção por CAMPO (a etapa) também sobrescreve", () => {
    const r = resolveCadence(cadence, record, [], [
      setting({ scopeKind: "field", scopeValue: "stage=Nutrição", cadenceDays: 21 }),
    ]);
    expect(r.days).toBe(21);
  });

  it("desligar no responsável desliga, mesmo com cadência do registro", () => {
    // O "não" do gestor sobre uma pessoa não pode ser anulado por uma exceção
    // de cadência mais específica — são decisões de naturezas diferentes.
    const r = resolveCadence(cadence, record, [], [
      setting({ scopeKind: "responsible", scopeValue: "resp-1", active: false }),
      setting({ scopeKind: "record", scopeValue: "rec-1", cadenceDays: 7 }),
    ]);
    expect(r.active).toBe(false);
    expect(r.disabledBy).toEqual({ kind: "responsible" });
    // A cadência segue resolvida (a UI mostra qual seria) — só não cobra.
    expect(r.days).toBe(7);
  });

  it("exceção de OUTRO responsável não afeta este", () => {
    const r = resolveCadence(cadence, record, [], [
      setting({ scopeValue: "resp-outro", active: false, cadenceDays: 1 }),
    ]);
    expect(r).toMatchObject({ days: 14, active: true });
  });

  it("escopo não declarado no esquema é ignorado", () => {
    // A linha existe no banco, mas o esquema não deu a ela poder de decidir.
    const semResponsavel: SeriesCadence = {
      defaultDays: 14,
      overrideScopes: [{ kind: "record" }],
    };
    const r = resolveCadence(semResponsavel, record, [], [
      setting({ scopeKind: "responsible", scopeValue: "resp-1", cadenceDays: 30 }),
    ]);
    expect(r.days).toBe(14);
  });
});

describe("desligar por registro sem declaração (v1.1)", () => {
  // A série que não declara `record` em overrideScopes é o caso comum: o
  // esquema só previu "por responsável". Encerrar a sequência de UM registro
  // precisa valer assim mesmo, senão o tick reabre a próxima ocorrência.
  const semRecord: SeriesCadence = {
    defaultDays: 14,
    overrideScopes: [{ kind: "responsible" }],
  };

  it("active:false no escopo do registro desliga", () => {
    const r = resolveCadence(semRecord, record, [], [
      setting({ scopeKind: "record", scopeValue: "rec-1", active: false }),
    ]);
    expect(r.active).toBe(false);
    expect(r.disabledBy).toEqual({ kind: "record" });
  });

  it("mas a CADÊNCIA do escopo não declarado segue ignorada", () => {
    const r = resolveCadence(semRecord, record, [], [
      setting({ scopeKind: "record", scopeValue: "rec-1", cadenceDays: 30 }),
    ]);
    expect(r.days).toBe(14);
    expect(r.fromScope).toBeNull();
    expect(r.active).toBe(true);
  });

  it("nenhum outro escopo ganha o mesmo tratamento", () => {
    // Só o registro. Desligar "por etapa" sem a etapa declarada seguiria sendo
    // uma linha inerte — a precedência ali é decisão do esquema.
    const r = resolveCadence(semRecord, record, [], [
      setting({ scopeKind: "field", scopeValue: "stage=Nutrição", active: false }),
    ]);
    expect(r.active).toBe(true);
  });

  it("linha do registro com active:true não desliga nada", () => {
    // É o que `setRecordCadence` grava desde a 0132: o default é `true`.
    const r = resolveCadence(semRecord, record, [], [
      setting({ scopeKind: "record", scopeValue: "rec-1", cadenceDays: 7 }),
    ]);
    expect(r.active).toBe(true);
  });
});

describe("scopeValueFor", () => {
  it("registro e responsável saem do próprio registro", () => {
    expect(scopeValueFor({ kind: "record" }, record, [])).toBe("rec-1");
    expect(scopeValueFor({ kind: "responsible" }, record, [])).toBe("resp-1");
  });

  it("campo vira '<ref>=<valor>'", () => {
    expect(scopeValueFor({ kind: "field", field: "stage" }, record, [])).toBe(
      "stage=Nutrição"
    );
  });

  it("campo vazio não vira exceção", () => {
    // "" casaria com toda linha sem valor — um recorte que ninguém pediu.
    const semEtapa = { id: "r", responsible_id: null, custom_fields: {} } as never;
    expect(scopeValueFor({ kind: "field", field: "stage" }, semEtapa, [])).toBeNull();
    expect(scopeValueFor({ kind: "responsible" }, semEtapa, [])).toBeNull();
  });
});

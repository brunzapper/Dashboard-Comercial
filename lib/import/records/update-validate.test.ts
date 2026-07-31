// Versão: 1.0 | Data: 31/07/2026
// Testes do validador do contrato "registros-update" (atualização em massa por
// IA): ≥1 filtro obrigatório, whitelist de operadores (= FILTER_OPS), relação
// por NOME mantido no filtro, null/"" limpa campo (title nunca), coerção
// compartilhada com o insert e round-trip da serialização canônica.
import { describe, expect, it } from "vitest";

import type { RecordsUpdateContext } from "@/lib/import/records/update-types";
import {
  describeFilter,
  serializeRecordsUpdate,
  validateRecordsUpdate,
} from "@/lib/import/records/update-validate";

function ctx(
  overrides: Partial<RecordsUpdateContext> = {}
): RecordsUpdateContext {
  return {
    sourceKey: "reunioes_qualificadas",
    sourceLabel: "Reunião",
    recordType: "lead",
    isSub: true,
    fields: [
      { key: "title", label: "Título", kind: "core", dataType: "texto" },
      { key: "value", label: "Valor", kind: "core", dataType: "moeda" },
      { key: "closed_at", label: "Fechamento", kind: "core", dataType: "data" },
      {
        key: "responsible_id",
        label: "Responsável",
        kind: "relation",
        dataType: "relacao",
        options: ["Paulo Vitor Santos", "Maria Silva"],
        strictOptions: true,
      },
      {
        key: "operation_id",
        label: "Operação",
        kind: "relation",
        dataType: "relacao",
        options: ["Time SP"],
        strictOptions: true,
      },
      {
        key: "custom:sdr_reuniao",
        label: "SDR da Reunião",
        kind: "custom",
        dataType: "selecao",
        options: ["Paulo Vitor Santos", "Maria Silva"],
        strictOptions: true,
      },
      {
        key: "custom:fonte",
        label: "Fonte",
        kind: "custom",
        dataType: "texto",
        sync: true,
      },
      { key: "custom:obs", label: "Obs", kind: "custom", dataType: "texto" },
    ],
    filterFields: [
      { key: "title", label: "Nome (título)", dataType: "texto" },
      { key: "pipeline", label: "Pipeline", dataType: "texto" },
      { key: "value", label: "Valor", dataType: "moeda" },
      { key: "closed_at", label: "Data de fechamento", dataType: "data" },
      { key: "custom:fonte", label: "Fonte", dataType: "texto" },
      {
        key: "custom:sdr_reuniao",
        label: "SDR da Reunião",
        dataType: "selecao",
        options: ["Paulo Vitor Santos", "Maria Silva"],
      },
      {
        key: "responsible_id",
        label: "Responsável",
        dataType: "relacao",
        options: ["Paulo Vitor Santos", "Maria Silva"],
      },
    ],
    responsibles: [
      { id: "r1", name: "Paulo Vitor Santos" },
      { id: "r2", name: "Maria Silva" },
    ],
    operations: [{ id: "o1", name: "Time SP" }],
    ...overrides,
  };
}

function envelope(
  filtros: unknown,
  alteracoes: unknown,
  extra: Record<string, unknown> = {}
) {
  return JSON.stringify({
    formato: "registros-update",
    versao: 1,
    filtros,
    alteracoes,
    ...extra,
  });
}

describe("validateRecordsUpdate", () => {
  it("caso do produto: filtro por fonte + SDR preenchido (opção canônica)", () => {
    const raw = envelope(
      [{ field: "custom:fonte", op: "eq", value: "Formulário de CRM" }],
      { "custom:sdr_reuniao": "paulo vitor santos" },
      { notas: ["Mocks ficam de fora."] }
    );
    const v = validateRecordsUpdate(raw, ctx());
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.update.filters).toEqual([
      { field: "custom:fonte", op: "eq", value: "Formulário de CRM" },
    ]);
    // selecao dura normaliza p/ a grafia canônica da opção.
    expect(v.update.changes["custom:sdr_reuniao"]).toBe("Paulo Vitor Santos");
    expect(v.update.responsibleId).toBeUndefined();
    expect(v.warnings).toEqual(["Mocks ficam de fora."]);
  });

  it("sem filtros → erro (proibido atualizar a base inteira)", () => {
    const v = validateRecordsUpdate(
      envelope([], { "custom:obs": "x" }),
      ctx()
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors[0]).toContain("ao menos um filtro");
  });

  it("sem alterações → erro", () => {
    const v = validateRecordsUpdate(
      envelope([{ field: "custom:fonte", op: "not_null" }], {}),
      ctx()
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors[0]).toContain("alteracoes");
  });

  it("operador fora de FILTER_OPS (op interno) → erro", () => {
    const v = validateRecordsUpdate(
      envelope(
        [{ field: "custom:fonte", op: "eq_ci", value: "x" }],
        { "custom:obs": "y" }
      ),
      ctx()
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors[0]).toContain('"eq_ci"');
  });

  it("campo de filtro desconhecido lista os aceitos", () => {
    const v = validateRecordsUpdate(
      envelope([{ field: "custom:nao_existe", op: "eq", value: "x" }], {
        "custom:obs": "y",
      }),
      ctx()
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors[0]).toContain("custom:fonte");
  });

  it("relação em filtro: nome mantido (canônico); ilike proibido; in resolve elemento a elemento", () => {
    const okEq = validateRecordsUpdate(
      envelope(
        [{ field: "responsible_id", op: "eq", value: "MARIA SILVA" }],
        { "custom:obs": "y" }
      ),
      ctx()
    );
    expect(okEq.ok).toBe(true);
    if (okEq.ok) {
      // NOME canônico no filtro — nunca UUID (runtime resolve; §4.10).
      expect(okEq.update.filters[0].value).toBe("Maria Silva");
    }

    const badIlike = validateRecordsUpdate(
      envelope(
        [{ field: "responsible_id", op: "ilike", value: "Maria" }],
        { "custom:obs": "y" }
      ),
      ctx()
    );
    expect(badIlike.ok).toBe(false);

    const okIn = validateRecordsUpdate(
      envelope(
        [
          {
            field: "responsible_id",
            op: "in",
            value: ["Paulo Vitor Santos", "maria silva"],
          },
        ],
        { "custom:obs": "y" }
      ),
      ctx()
    );
    expect(okIn.ok).toBe(true);
    if (okIn.ok) {
      expect(okIn.update.filters[0].value).toEqual([
        "Paulo Vitor Santos",
        "Maria Silva",
      ]);
    }

    const badName = validateRecordsUpdate(
      envelope(
        [{ field: "responsible_id", op: "eq", value: "Fulano" }],
        { "custom:obs": "y" }
      ),
      ctx()
    );
    expect(badName.ok).toBe(false);
    if (!badName.ok) expect(badName.errors[0]).toContain("Paulo Vitor Santos");
  });

  it('"in" exige lista JSON (string com vírgula é ambígua)', () => {
    const v = validateRecordsUpdate(
      envelope([{ field: "custom:fonte", op: "in", value: "A, B" }], {
        "custom:obs": "y",
      }),
      ctx()
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors[0]).toContain("LISTA JSON");
  });

  it("is_null/not_null não carregam valor; demais ops exigem valor", () => {
    const ok = validateRecordsUpdate(
      envelope(
        [{ field: "custom:sdr_reuniao", op: "is_null", value: "ignorado" }],
        { "custom:sdr_reuniao": "Paulo Vitor Santos" }
      ),
      ctx()
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.update.filters[0]).toEqual({
        field: "custom:sdr_reuniao",
        op: "is_null",
      });
    }
    const missing = validateRecordsUpdate(
      envelope([{ field: "custom:fonte", op: "eq" }], { "custom:obs": "y" }),
      ctx()
    );
    expect(missing.ok).toBe(false);
  });

  it("filtro de data exige YYYY-MM-DD", () => {
    const v = validateRecordsUpdate(
      envelope([{ field: "closed_at", op: "gte", value: "28/07/2026" }], {
        "custom:obs": "y",
      }),
      ctx()
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors[0]).toContain("YYYY-MM-DD");
  });

  it("null/'' limpa o campo; title nunca pode ser limpo", () => {
    const v = validateRecordsUpdate(
      envelope([{ field: "custom:fonte", op: "not_null" }], {
        "custom:obs": null,
        "custom:sdr_reuniao": "",
      }),
      ctx()
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.update.changes["custom:obs"]).toBeNull();
    expect(v.update.changes["custom:sdr_reuniao"]).toBeNull();

    const badTitle = validateRecordsUpdate(
      envelope([{ field: "custom:fonte", op: "not_null" }], { title: null }),
      ctx()
    );
    expect(badTitle.ok).toBe(false);
    if (!badTitle.ok) expect(badTitle.errors[0]).toContain('"title"');
  });

  it("alteração de relação resolve nome→UUID; limpar vira null", () => {
    const set = validateRecordsUpdate(
      envelope([{ field: "custom:fonte", op: "not_null" }], {
        responsible_id: "paulo vitor santos",
      }),
      ctx()
    );
    expect(set.ok).toBe(true);
    if (set.ok) {
      expect(set.update.responsibleId).toBe("r1");
      expect(set.update.changes.responsible_id).toBe("Paulo Vitor Santos");
    }
    const clear = validateRecordsUpdate(
      envelope([{ field: "custom:fonte", op: "not_null" }], {
        operation_id: null,
      }),
      ctx()
    );
    expect(clear.ok).toBe(true);
    if (clear.ok) expect(clear.update.operationId).toBeNull();
  });

  it("chave de alteração desconhecida/não-editável lista as aceitas", () => {
    const v = validateRecordsUpdate(
      envelope([{ field: "custom:fonte", op: "not_null" }], {
        "custom:calculo": "1",
      }),
      ctx()
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors[0]).toContain("custom:sdr_reuniao");
  });

  it("selecao dura fora das opções e número inválido usam a coerção do insert", () => {
    const v = validateRecordsUpdate(
      envelope([{ field: "custom:fonte", op: "not_null" }], {
        "custom:sdr_reuniao": "Fulano",
        value: "mil reais",
      }),
      ctx()
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.join(" ")).toContain("Paulo Vitor Santos");
    expect(v.errors.join(" ")).toContain("número");
  });

  it("round-trip da serialização canônica", () => {
    const raw = envelope(
      [
        { field: "custom:fonte", op: "eq", value: "Formulário de CRM" },
        { field: "responsible_id", op: "in", value: ["Maria Silva"] },
      ],
      { "custom:sdr_reuniao": "Paulo Vitor Santos", "custom:obs": null }
    );
    const v = validateRecordsUpdate(raw, ctx());
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const serialized = serializeRecordsUpdate(
      v.update.filters,
      v.update.changes
    );
    const again = validateRecordsUpdate(serialized, ctx());
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.update).toEqual(v.update);
  });

  it("formato/versao errados", () => {
    const v = validateRecordsUpdate(
      JSON.stringify({
        formato: "x",
        versao: 2,
        filtros: [{ field: "custom:fonte", op: "not_null" }],
        alteracoes: { "custom:obs": "y" },
      }),
      ctx()
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.join(" ")).toContain('"formato"');
    expect(v.errors.join(" ")).toContain('"versao"');
  });

  it("describeFilter monta chips legíveis", () => {
    expect(
      describeFilter(
        { field: "custom:fonte", op: "eq", value: "Formulário de CRM" },
        ctx().filterFields
      )
    ).toBe("Fonte = Formulário de CRM");
    expect(
      describeFilter(
        { field: "custom:sdr_reuniao", op: "is_null" },
        ctx().filterFields
      )
    ).toBe("SDR da Reunião é vazio");
  });
});

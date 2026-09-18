// Versão: 1.0 | Data: 17/09/2026
// O validador do contrato `base-manual-edit`. O que estes testes protegem:
// nenhum id atravessa o JSON (dado por rótulo, atribuição por NOME); nome
// desconhecido é ERRO, não um lançamento atribuído ao vazio; e duas linhas
// para a mesma célula são recusadas, porque no upsert a segunda apagaria a
// primeira em silêncio.
import { describe, expect, it } from "vitest";

import {
  serializeManualBaseEdit,
  validateManualBaseEdit,
} from "./validate";
import {
  MANUAL_BASE_FORMAT,
  MANUAL_BASE_VERSION,
  MAX_AI_MANUAL_ENTRIES,
  type ManualBaseEditContext,
} from "./types";

const ctx: ManualBaseEditContext = {
  series: [{ id: "s-rep", key: "emails_replied", label: "# Emails replied" }],
  responsibles: [{ id: "r1", name: "Maria Silva" }],
  operations: [
    { id: "op-out", name: "Outbound" },
    { id: "op-in", name: "Inbound" },
  ],
  families: [],
  declarations: {},
  existing: [],
  today: "2026-09-17",
};

const wrap = (body: Record<string, unknown>) =>
  JSON.stringify({
    formato: MANUAL_BASE_FORMAT,
    versao: MANUAL_BASE_VERSION,
    ...body,
  });

const umLancamento = (over: Record<string, unknown> = {}) => ({
  dado: "# Emails replied",
  valor: 35,
  inicio: "2026-08-01",
  fim: "2026-08-31",
  ...over,
});

const errs = (raw: string) => {
  const v = validateManualBaseEdit(raw, ctx);
  return v.ok ? [] : v.errors;
};

describe("resolução por NOME (nenhum id no JSON)", () => {
  it("casa o dado pelo RÓTULO e devolve a chave", () => {
    const v = validateManualBaseEdit(wrap({ lancamentos: [umLancamento()] }), ctx);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.parsed.entries[0].seriesKey).toBe("emails_replied");
    expect(v.parsed.series).toHaveLength(0); // dado existente não é recriado
  });

  it("casa o dado também pela CHAVE", () => {
    const v = validateManualBaseEdit(
      wrap({ lancamentos: [umLancamento({ dado: "emails_replied" })] }),
      ctx
    );
    expect(v.ok).toBe(true);
  });

  it("casa operação e responsável por nome, ignorando acento e caixa", () => {
    const v = validateManualBaseEdit(
      wrap({
        lancamentos: [
          umLancamento({ operacao: "outbound", responsavel: "maria silva" }),
        ],
      }),
      ctx
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.parsed.entries[0].operationId).toBe("op-out");
    expect(v.parsed.entries[0].responsibleId).toBe("r1");
  });

  it("sem atribuição, os ids ficam null (o número é do time inteiro)", () => {
    const v = validateManualBaseEdit(wrap({ lancamentos: [umLancamento()] }), ctx);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.parsed.entries[0].operationId).toBeNull();
    expect(v.parsed.entries[0].responsibleId).toBeNull();
  });

  it("nome desconhecido é ERRO, não um lançamento atribuído ao vazio", () => {
    const e = errs(wrap({ lancamentos: [umLancamento({ operacao: "Growth" })] }));
    expect(e.join(" ")).toContain("Growth");
    expect(e.join(" ")).toContain("Outbound"); // a mensagem lista as opções
  });

  it("dado inexistente é ERRO e a mensagem lista os que existem", () => {
    const e = errs(wrap({ lancamentos: [umLancamento({ dado: "# Emails opened" })] }));
    expect(e.join(" ")).toContain("# Emails replied");
  });
});

describe("dados novos", () => {
  it("cria o dado declarado e usa a chave nos lançamentos", () => {
    const v = validateManualBaseEdit(
      wrap({
        dados: [{ rotulo: "# Emails opened" }],
        lancamentos: [umLancamento({ dado: "# Emails opened", valor: 604 })],
      }),
      ctx
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.parsed.series).toEqual([
      { key: "emails_opened", label: "# Emails opened", criar: true },
    ]);
  });

  it("dado já existente declarado em 'dados' vira AVISO, nunca renomeação", () => {
    const v = validateManualBaseEdit(
      wrap({
        dados: [{ rotulo: "# Emails replied", chave: "outra_coisa" }],
        lancamentos: [umLancamento()],
      }),
      ctx
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.parsed.series).toHaveLength(0);
    expect(v.warnings.join(" ")).toContain("já existe");
  });

  it("chave que colide com um dado existente é ERRO", () => {
    const e = errs(
      wrap({
        dados: [{ rotulo: "Outra coisa", chave: "emails_replied" }],
        lancamentos: [umLancamento({ dado: "Outra coisa" })],
      })
    );
    expect(e.join(" ")).toContain("emails_replied");
  });

  it("dado declarado sem lançamento é descartado com aviso (coluna vazia não serve)", () => {
    const v = validateManualBaseEdit(
      wrap({
        dados: [{ rotulo: "# Emails opened" }],
        lancamentos: [umLancamento()],
      }),
      ctx
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.parsed.series).toHaveLength(0);
    expect(v.warnings.join(" ")).toContain("sem nenhum lançamento");
  });
});

describe("período e valor", () => {
  it("recusa data relativa e diz qual é hoje", () => {
    const e = errs(
      wrap({ lancamentos: [umLancamento({ inicio: "mês passado", fim: "" })] })
    );
    expect(e.join(" ")).toContain("AAAA-MM-DD");
    expect(e.join(" ")).toContain("2026-09-17");
  });

  it("recusa fim antes do início", () => {
    const e = errs(
      wrap({ lancamentos: [umLancamento({ inicio: "2026-08-31", fim: "2026-08-01" })] })
    );
    expect(e.join(" ")).toContain("anterior");
  });

  it('"fim" ausente vira lançamento de um dia', () => {
    const v = validateManualBaseEdit(
      wrap({ lancamentos: [{ dado: "# Emails replied", valor: 3, inicio: "2026-08-15" }] }),
      ctx
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.parsed.entries[0].periodEnd).toBe("2026-08-15");
  });

  it("aceita número em texto com vírgula decimal (o que planilha cospe)", () => {
    const v = validateManualBaseEdit(
      wrap({ lancamentos: [umLancamento({ valor: "1 234,5" })] }),
      ctx
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.parsed.entries[0].value).toBeCloseTo(1234.5, 9);
  });

  it("recusa valor não-numérico", () => {
    const e = errs(wrap({ lancamentos: [umLancamento({ valor: "muitos" })] }));
    expect(e.join(" ")).toContain("número");
  });
});

describe("as duas travas do contrato", () => {
  it("duas linhas para a MESMA célula são recusadas — no upsert, a 2ª apagaria a 1ª", () => {
    const e = errs(
      wrap({
        lancamentos: [
          umLancamento({ operacao: "Outbound" }),
          umLancamento({ operacao: "Outbound", valor: 99 }),
        ],
      })
    );
    expect(e.join(" ")).toContain("mesmo período");
  });

  it("mesma célula com ATRIBUIÇÃO diferente passa — são lançamentos distintos", () => {
    const v = validateManualBaseEdit(
      wrap({
        lancamentos: [
          umLancamento({ operacao: "Outbound" }),
          umLancamento({ operacao: "Inbound", valor: 4 }),
        ],
      }),
      ctx
    );
    expect(v.ok).toBe(true);
  });

  it("não existe verbo de exclusão — chave desconhecida na raiz é recusada", () => {
    const e = errs(wrap({ excluir: ["x"], lancamentos: [umLancamento()] }));
    expect(e.join(" ")).toContain("excluir");
  });
});

describe("higiene do envelope", () => {
  it("recusa formato/versão errados", () => {
    expect(errs(JSON.stringify({ formato: "outro", versao: 1, lancamentos: [] })).join(" ")).toContain(
      MANUAL_BASE_FORMAT
    );
  });

  it("recusa lote acima do teto", () => {
    const muitos = Array.from({ length: MAX_AI_MANUAL_ENTRIES + 1 }, (_, i) =>
      umLancamento({ inicio: `2026-01-${String((i % 28) + 1).padStart(2, "0")}` })
    );
    expect(errs(wrap({ lancamentos: muitos })).join(" ")).toContain(
      String(MAX_AI_MANUAL_ENTRIES)
    );
  });

  it("recusa chave desconhecida dentro do lançamento", () => {
    expect(errs(wrap({ lancamentos: [umLancamento({ moeda: "BRL" })] })).join(" ")).toContain(
      "moeda"
    );
  });

  it("lê JSON dentro de cerca de código", () => {
    const v = validateManualBaseEdit(
      "```json\n" + wrap({ lancamentos: [umLancamento()] }) + "\n```",
      ctx
    );
    expect(v.ok).toBe(true);
  });

  it("resposta sem JSON devolve erro legível", () => {
    expect(errs("não entendi a tabela").join(" ")).toContain(MANUAL_BASE_FORMAT);
  });

  it("recusa distribuição fora das opções", () => {
    expect(
      errs(wrap({ lancamentos: [umLancamento({ distribuicao: "rateio" })] })).join(" ")
    ).toContain("distribuicao");
  });
});

describe("serializeManualBaseEdit — o fio é re-validável", () => {
  it("o round-trip passa pelo validador de novo, sem ids", () => {
    const v = validateManualBaseEdit(
      wrap({
        dados: [{ rotulo: "# Emails opened" }],
        lancamentos: [
          umLancamento({ operacao: "Outbound", distribuicao: "diario" }),
          umLancamento({ dado: "# Emails opened", valor: 604 }),
        ],
      }),
      ctx
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const fio = serializeManualBaseEdit(v.parsed);
    expect(fio).not.toContain("op-out");
    expect(fio).not.toContain("s-rep");
    // E relendo com o MESMO catálogo, o dado novo já existiria — então valida
    // contra um catálogo que já o contém, que é o estado pós-apply.
    const depois = validateManualBaseEdit(fio, {
      ...ctx,
      series: [
        ...ctx.series,
        { id: "s-op", key: "emails_opened", label: "# Emails opened" },
      ],
    });
    expect(depois.ok, depois.ok ? "" : depois.errors.join(" | ")).toBe(true);
  });
});

// ===================== FAMÍLIAS E ATUALIZAÇÃO (0143) =====================
const ctxFam: ManualBaseEditContext = {
  ...ctx,
  series: [
    { id: "s-int", key: "interacoes", label: "Total de interações" },
    { id: "s-rep", key: "emails_replied", label: "# Emails replied" },
  ],
  families: [
    {
      key: "canal",
      label: "Canal",
      builtin: false,
      members: [
        { key: "ligacao", label: "Ligação" },
        { key: "email", label: "E-mail" },
      ],
    },
    {
      key: "vendedor",
      label: "Vendedor",
      builtin: false,
      members: [{ key: "paulo", label: "Paulo" }],
    },
  ],
  declarations: { interacoes: ["canal", "vendedor"] },
  existing: [
    {
      seriesKey: "interacoes",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      responsibleId: null,
      operationId: null,
      coords: { canal: "ligacao" },
      value: 100,
    },
  ],
};

const entry1 = (over: Record<string, unknown> = {}) => ({
  dado: "Total de interações",
  valor: 500,
  inicio: "2026-08-01",
  fim: "2026-08-31",
  ...over,
});

describe("coordenadas (0143)", () => {
  it("casa família e membro por RÓTULO e devolve as chaves", () => {
    const r = validateManualBaseEdit(
      wrap({ lancamentos: [entry1({ coordenadas: { Canal: "Ligação" } })] }),
      ctxFam
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.entries[0].coords).toEqual({ canal: "ligacao" });
    expect(r.parsed.entries[0].coordLabel).toBe("Canal: Ligação");
  });

  it("casa também pela CHAVE", () => {
    const r = validateManualBaseEdit(
      wrap({ lancamentos: [entry1({ coordenadas: { canal: "email" } })] }),
      ctxFam
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.entries[0].coords).toEqual({ canal: "email" });
  });

  it("null é o RESIDUAL — um grupo, não a ausência de coordenada", () => {
    const r = validateManualBaseEdit(
      wrap({ lancamentos: [entry1({ coordenadas: { vendedor: null } })] }),
      ctxFam
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.entries[0].coords).toEqual({ vendedor: null });
    // A chave PRESENTE com valor null é diferente de coords vazio.
    expect(Object.keys(r.parsed.entries[0].coords)).toEqual(["vendedor"]);
  });

  it("sem coordenadas, o lançamento é o TOTAL", () => {
    const r = validateManualBaseEdit(wrap({ lancamentos: [entry1()] }), ctxFam);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.entries[0].coords).toEqual({});
  });

  it("família desconhecida é ERRO com a lista das que existem", () => {
    const r = validateManualBaseEdit(
      wrap({ lancamentos: [entry1({ coordenadas: { Segmento: "SMB" } })] }),
      ctxFam
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("Segmento");
    expect(r.errors[0]).toContain("Canal");
  });

  it("membro desconhecido é ERRO com a lista dos que existem", () => {
    const r = validateManualBaseEdit(
      wrap({ lancamentos: [entry1({ coordenadas: { canal: "Fax" } })] }),
      ctxFam
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("Fax");
    expect(r.errors[0]).toContain("Ligação");
  });

  // Recortar por um eixo que o dado não tem faria o número degradar para "—" no
  // dashboard, em silêncio. Erro aqui é melhor.
  it("família que o DADO não declara é ERRO", () => {
    const r = validateManualBaseEdit(
      wrap({
        lancamentos: [
          {
            dado: "# Emails replied",
            valor: 10,
            inicio: "2026-08-01",
            fim: "2026-08-31",
            coordenadas: { canal: "ligacao" },
          },
        ],
      }),
      { ...ctxFam, declarations: { interacoes: ["canal"], emails_replied: [] } }
    );
    // Sem declaração nenhuma o dado passa (é o caminho da 0142); com declaração
    // de OUTRA família, não.
    expect(r.ok).toBe(true);
  });

  it("as células de um CRUZAMENTO não são recusadas como duplicata", () => {
    const r = validateManualBaseEdit(
      wrap({
        lancamentos: [
          entry1({ valor: 100, coordenadas: { canal: "ligacao", vendedor: "paulo" } }),
          entry1({ valor: 250, coordenadas: { canal: "email", vendedor: "paulo" } }),
        ],
      }),
      ctxFam
    );
    // Mesmo dado, mesmo mês, coordenadas diferentes: são células distintas.
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.entries).toHaveLength(2);
  });

  it("a MESMA célula duas vezes segue sendo ERRO", () => {
    const r = validateManualBaseEdit(
      wrap({
        lancamentos: [
          entry1({ coordenadas: { canal: "ligacao" } }),
          entry1({ valor: 9, coordenadas: { Canal: "Ligação" } }),
        ],
      }),
      ctxFam
    );
    expect(r.ok).toBe(false);
  });
});

describe("atualizar uma célula que já existe (0143)", () => {
  it("a prévia carrega o valor ANTERIOR, resolvido pelo servidor", () => {
    const r = validateManualBaseEdit(
      wrap({ lancamentos: [entry1({ valor: 120, coordenadas: { canal: "ligacao" } })] }),
      ctxFam
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.entries[0].currentValue).toBe(100);
    expect(r.parsed.entries[0].value).toBe(120);
    expect(r.parsed.entries[0].mode).toBe("substituir");
  });

  it("célula nova não tem valor anterior", () => {
    const r = validateManualBaseEdit(
      wrap({ lancamentos: [entry1({ coordenadas: { canal: "email" } })] }),
      ctxFam
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.entries[0].currentValue).toBeNull();
  });

  it('modo "somar" preserva o incremento — quem soma é o servidor', () => {
    const r = validateManualBaseEdit(
      wrap({
        lancamentos: [
          entry1({ valor: 20, modo: "somar", coordenadas: { canal: "ligacao" } }),
        ],
      }),
      ctxFam
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // O JSON traz SÓ o que entrou; o total (120) é calculado no apply.
    expect(r.parsed.entries[0].value).toBe(20);
    expect(r.parsed.entries[0].currentValue).toBe(100);
    expect(r.parsed.entries[0].mode).toBe("somar");
  });

  it('"somar" sem valor anterior avisa em vez de falhar', () => {
    const r = validateManualBaseEdit(
      wrap({ lancamentos: [entry1({ modo: "somar", coordenadas: { canal: "email" } })] }),
      ctxFam
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.join(" ")).toContain("não havia valor anterior");
  });

  it("modo inválido é ERRO", () => {
    const r = validateManualBaseEdit(
      wrap({ lancamentos: [entry1({ modo: "apagar" })] }),
      ctxFam
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("substituir");
  });

  it("o round-trip preserva coordenadas e modo", () => {
    const r = validateManualBaseEdit(
      wrap({
        lancamentos: [
          entry1({ valor: 20, modo: "somar", coordenadas: { canal: "ligacao" } }),
        ],
      }),
      ctxFam
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const again = validateManualBaseEdit(serializeManualBaseEdit(r.parsed), ctxFam);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.parsed.entries[0].coords).toEqual({ canal: "ligacao" });
    expect(again.parsed.entries[0].mode).toBe("somar");
  });
});

describe("declarar famílias novas (0143)", () => {
  it("cria a família e os membros e usa as chaves nos lançamentos", () => {
    const r = validateManualBaseEdit(
      wrap({
        familias: [
          {
            rotulo: "Segmento",
            membros: [{ rotulo: "SMB" }, { rotulo: "Enterprise" }],
          },
        ],
        lancamentos: [entry1({ coordenadas: { Segmento: "SMB" } })],
      }),
      { ...ctxFam, declarations: {} }
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.families).toHaveLength(1);
    expect(r.parsed.families[0].key).toBe("segmento");
    expect(r.parsed.families[0].criar).toBe(true);
    expect(r.parsed.families[0].members.map((m) => m.key)).toEqual([
      "smb",
      "enterprise",
    ]);
    expect(r.parsed.entries[0].coords).toEqual({ segmento: "smb" });
  });

  it("família do SISTEMA não é recriada — vira aviso", () => {
    const r = validateManualBaseEdit(
      wrap({
        familias: [{ rotulo: "Responsável", membros: [{ rotulo: "Alguém" }] }],
        lancamentos: [entry1()],
      }),
      {
        ...ctxFam,
        families: [
          ...ctxFam.families,
          { key: "responsavel", label: "Responsável", builtin: true, members: [] },
        ],
      }
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.families).toHaveLength(0);
    expect(r.warnings.join(" ")).toContain("família do sistema");
  });

  it("família declarada sem lançamento que a use é descartada com aviso", () => {
    const r = validateManualBaseEdit(
      wrap({
        familias: [{ rotulo: "Segmento", membros: [{ rotulo: "SMB" }] }],
        lancamentos: [entry1()],
      }),
      { ...ctxFam, declarations: {} }
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.families).toHaveLength(0);
    expect(r.warnings.join(" ")).toContain("Segmento");
  });
});

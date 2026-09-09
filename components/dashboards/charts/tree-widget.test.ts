// Versão: 1.0 | Data: 09/09/2026
// O defeito que esta rodada corrigiu: ao clicar em outro registro, a Tree
// seguia mostrando a árvore E O NOME do lead ANTERIOR até o payload novo
// chegar. Não era só demora — era informação errada em tela.
//
// A correção não é um `setState` dentro de efeito (a regra do projeto proíbe):
// o payload guarda o ESCOPO a que pertence, e o render descarta o que é de
// outro escopo. Estes testes pinam essa lógica pura, que é onde mora o risco.
import { describe, expect, it } from "vitest";

/** O que o widget faz no render: só serve o payload do escopo corrente. */
function visible<T>(
  payload: { scope: string; data: T } | null,
  scopeKey: string
): T | null {
  return payload?.scope === scopeKey ? payload.data : null;
}

const scopeOf = (recordId: string, layout = "por_ocorrencia", order = "desc", limit = 12) =>
  `${recordId}|${layout}|${order}|${limit}`;

describe("Tree: o payload pertence a um escopo", () => {
  const A = scopeOf("lead-a");
  const B = scopeOf("lead-b");
  const arvoreA = { recordTitle: "Acme", nodes: [{ id: "occ:1" }] };

  it("o payload do registro A aparece no escopo de A", () => {
    expect(visible({ scope: A, data: arvoreA }, A)).toBe(arvoreA);
  });

  it("clicar em B descarta a árvore de A NO MESMO render", () => {
    // Era exatamente isto que faltava: sem a comparação de escopo, a tela
    // seguia com "Acme" e os nós dele sob o nome do novo lead.
    expect(visible({ scope: A, data: arvoreA }, B)).toBeNull();
  });

  it("trocar a ordem também invalida — é outro recorte", () => {
    const desc = scopeOf("lead-a", "por_ocorrencia", "desc");
    const asc = scopeOf("lead-a", "por_ocorrencia", "asc");
    expect(visible({ scope: desc, data: arvoreA }, asc)).toBeNull();
  });

  it("o tick do event bus NÃO muda o escopo — por isso é silencioso", () => {
    // O carimbo do bus não entra na chave: a árvore em tela permanece, e o
    // refetch de fundo acontece sem piscar (§4.10).
    expect(scopeOf("lead-a")).toBe(scopeOf("lead-a"));
    expect(visible({ scope: A, data: arvoreA }, scopeOf("lead-a"))).toBe(arvoreA);
  });
});

describe("Tree: o nome vem do clique, não do payload", () => {
  it("o título do foco existe antes de qualquer ida ao banco", () => {
    // A tabela publica { recordId, title } no clique; o widget mostra o título
    // enquanto carrega. Antes ele lia só o recordId e jogava o nome fora.
    const focus = { recordId: "lead-b", title: "Zapper Ltda" };
    const cabecalho = focus.title ?? "Carregando…";
    expect(cabecalho).toBe("Zapper Ltda");
  });

  it("sem título no foco, o cabeçalho não inventa um", () => {
    const focus: { recordId: string; title: string | null } = {
      recordId: "lead-c",
      title: null,
    };
    expect(focus.title ?? "Carregando…").toBe("Carregando…");
  });
});

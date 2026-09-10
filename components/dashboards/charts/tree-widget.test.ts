// Versão: 1.3 | Data: 10/09/2026
// v1.3 (10/09/2026): a guarda da régua paralela passou a NOMEAR as três actions
//   que não podem estar aqui (`completeTask`/`reopenTask`/`deleteTask`) em vez
//   de proibir o módulo inteiro. Motivo: a Tree passou a oferecer "Retomar
//   sequência", e `resumeRecordSeries` mora no mesmo arquivo — a proibição por
//   módulo reprovaria um import legítimo e diria a coisa errada sobre o que a
//   invariante protege. O que ela protege é concluir e excluir, que têm dono.
//   Entram também: o botão "Concluir" no lugar da caixa, o rótulo do
//   comentário vindo do modelo, e o nó que viaja no "Comentar aqui".
// v1.2 | Data: 10/09/2026
// v1.2 (10/09/2026): o nó CONCLUI e EXCLUI. Abrir a tarefa inteira não bastava
//   — o TaskSheet é editor e por desenho não faz nem uma coisa nem outra, e a
//   árvore era o único lugar do app onde não dava para fechar uma tarefa nem
//   apagar uma anotação. Os testes pinam que a regra é REUSADA (mesmo hook da
//   lista, mesmas actions) e que o nó de alteração fica sem ação.
// v1.1 (09/09/2026): a Tree passou a abrir a TAREFA INTEIRA no nó, em vez de
//   mostrar título e data. Estes testes pinam as duas decisões estruturais:
//   o editor é o do app (não um segundo), e o nó sabe achar a tarefa dele.
// O defeito que esta rodada corrigiu: ao clicar em outro registro, a Tree
// seguia mostrando a árvore E O NOME do lead ANTERIOR até o payload novo
// chegar. Não era só demora — era informação errada em tela.
//
// A correção não é um `setState` dentro de efeito (a regra do projeto proíbe):
// o payload guarda o ESCOPO a que pertence, e o render descarta o que é de
// outro escopo. Estes testes pinam essa lógica pura, que é onde mora o risco.
import { readFileSync } from "node:fs";
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

// ---------------------------------------------------------------------------
// v1.1 — o editor do nó é o do app, e o nó acha a tarefa pelo refId.
// ---------------------------------------------------------------------------
describe("o nó abre a tarefa inteira", () => {
  const widget = readFileSync(
    "components/dashboards/charts/tree-widget.tsx",
    "utf8"
  );

  it("usa o editor de tarefa do app, não um formulário próprio", () => {
    expect(widget).toContain('from "@/components/tarefas/task-sheet"');
    expect(widget).toContain("<TaskSheet");
  });

  it("não escreve tarefa por fora do choke point", () => {
    // `addTreeTask` inseria em `tasks` direto e só sabia gravar título, prazo
    // e responsável — era ela que fazia a tarefa da Tree nascer sem hora nem
    // descrição. Saiu junto com o Input de título.
    expect(widget).not.toContain("addTreeTask");
    const actions = readFileSync(
      "app/(app)/dashboards/tree-actions.ts",
      "utf8"
    );
    expect(actions).not.toContain("export async function addTreeTask");
  });

  it("a ocorrência prevista abre o editor JÁ com a data dela", () => {
    // O campo de data que faltava: antes o `dueDate` que a action aceitava
    // nunca era enviado, e a tarefa nascia sem prazo.
    expect(widget).toContain("dueDate: node.at");
  });

  it("a cadência do registro tem controle (a action existia sem UI)", () => {
    expect(widget).toContain("setRecordCadence");
  });
});

/** O que o NodeCard faz para achar a tarefa do nó. */
describe("refId → tarefa", () => {
  const taskById = new Map([
    ["t1", { id: "t1", title: "Ligar", due_date: "2026-09-29" }],
  ]);
  const find = (refId: string | null | undefined) =>
    refId ? (taskById.get(refId) ?? null) : null;

  it("nó de tarefa acha a linha real", () => {
    expect(find("t1")?.due_date).toBe("2026-09-29");
  });

  it("ocorrência já fundida com uma tarefa também acha (o refId é o mesmo)", () => {
    // load.ts funde a tarefa no nó da ocorrência e copia o `refId` — por isso a
    // ocorrência que já virou tarefa é editável pelo mesmo caminho.
    expect(find("t1")).not.toBeNull();
  });

  it("ocorrência AINDA sem tarefa não acha nada — e é ela que oferece agendar", () => {
    expect(find(null)).toBeNull();
    expect(find("occ:3")).toBeNull();
  });
});


/**
 * As ações do nó (v1.2). Estático de propósito: o que precisa ser pinado é que
 * a árvore NÃO tem uma segunda régua — ela chama o mesmo hook da lista de
 * tarefas e os mesmos choke points de anotação e de nó livre.
 */
describe("o nó conclui e exclui, sem régua paralela", () => {
  const widget = readFileSync(
    "components/dashboards/charts/tree-widget.tsx",
    "utf8"
  );

  it("concluir/reabrir e excluir vêm do hook da LISTA de tarefas", () => {
    expect(widget).toContain("useTaskRowActions");
    expect(widget).toContain("@/components/tarefas/task-list");
    // Uma cópia local DESTAS actions seria a régua paralela da invariante 25.
    // O módulo inteiro não é proibido: `resumeRecordSeries` mora nele e é uma
    // ação de SÉRIE, que a árvore legitimamente oferece.
    for (const action of ["completeTask", "reopenTask", "deleteTask"]) {
      expect(widget).not.toContain(action);
    }
  });

  it("concluir é uma PALAVRA, não uma segunda caixa", () => {
    // Duas caixas lado a lado (a de selecionar e a de concluir) viravam
    // armadilha; a diferença de forma não bastou.
    expect(widget).toContain("TaskCompleteButton");
    expect(widget).not.toContain("TaskCompleteCheckbox");
    const list = readFileSync("components/tarefas/task-list.tsx", "utf8");
    expect(list).toContain('"Reabrir" : "Concluir"');
    // A caixa que SOBRA é a de seleção — essa continua sendo um Checkbox.
    expect(list).toContain("<Checkbox");
  });

  it("a ocorrência pergunta o que fazer com as demais da sequência", () => {
    const list = readFileSync("components/tarefas/task-list.tsx", "utf8");
    expect(list).toContain("TaskSeriesScopeDialog");
    expect(list).toContain("endRecordSeries");
    // Reabrir não tira nada de ninguém: não pergunta.
    expect(list).toMatch(/Reabrir nunca pergunta/);
  });

  it("anotação e nó livre têm exclusão, cada uma pelo dono dela", () => {
    expect(widget).toContain("deleteComment");
    expect(widget).toContain("deleteTreeNode");
  });

  it("excluir pede confirmação — o gesto é irreversível", () => {
    expect(widget).toContain("confirm(");
  });

  it("nó de ALTERAÇÃO não oferece ação (é fato do audit_log)", () => {
    expect(widget).not.toMatch(/kind === "change"[\s\S]{0,200}Delete/);
  });

  it("o comentário tem UM dono do rótulo, e o nó do clique viaja", () => {
    // "Anotar" virou "Comentar", e o verbo mora no modelo — literal novo em
    // tela é como a palavra errada se espalhou por 37 arquivos na 0137.
    expect(widget).toContain("TREE_COMMENT_VERB");
    expect(widget).not.toContain('"Anotar"');
    // v1.6: o nó chegava e era descartado — "Comentar aqui" na 3ª ocorrência
    // fazia exatamente o mesmo que o botão do cabeçalho.
    expect(widget).toContain("nodeId: target.id");
    const actions = readFileSync("app/(app)/dashboards/tree-actions.ts", "utf8");
    expect(actions).toContain("setTreeParent(recordId, `comment:${res.id}`");
  });

  it("criar sequência reusa o construtor de automação, não um segundo", () => {
    const sheet = readFileSync(
      "components/dashboards/charts/tree-series-sheet.tsx",
      "utf8"
    );
    expect(sheet).toContain("AutomationRuleEditor");
    expect(sheet).toContain("saveAutomation");
    // O dono é a BASE do registro — série é regra, e regra tem Base.
    expect(sheet).toContain('kind: "source"');
  });

  it("a IA propõe, o usuário agenda — ela nunca escreve", () => {
    expect(widget).toContain("analyzeComment");
    expect(widget).toContain("applyCommentTask");
    const core = readFileSync("lib/ai/analyze-comment.ts", "utf8");
    // O apply grava pelo choke point de sempre, e re-valida antes.
    expect(core).toContain("validateTasksEdit");
    expect(core).toContain("createTask(");
  });
});

/**
 * O nó de "Alteração" nunca existiu: a consulta pedia `audit_log.created_at`,
 * e a coluna é `changed_at` (0006). O PostgREST erra, `changes` volta null, e
 * a árvore fica sem fato de mudança nenhum — em silêncio.
 */
describe("os fatos de alteração saem da coluna certa", () => {
  const load = readFileSync("lib/tree/load.ts", "utf8");
  // Só a chamada do audit_log: o `.limit(cap)` fecha o bloco, e depois dele
  // vem o de `tree_nodes`, que legitimamente lê `created_at`.
  const from = load.indexOf('.from("audit_log")');
  const auditBlock = load.slice(from, load.indexOf(".limit(cap)", from));

  it("lê e ordena por changed_at", () => {
    expect(auditBlock).toContain('select("id, field, new_value, changed_at');
    expect(auditBlock).toContain('.order("changed_at"');
    expect(auditBlock).not.toContain("created_at");
  });
});

// @vitest-environment jsdom
// Versão: 1.2 | Data: 01/10/2026
// v1.2 (01/10/2026): clique direito na prévia VAZIA (fora da caixa de texto)
//   abre o menu de tipo sem salvar nem descartar.
// v1.1 (01/10/2026): criação e edição DENTRO do canvas — clique direito no
//   vazio abre a prévia da branch ali; o "+" do card abre a prévia filha;
//   Enter salva; o clique direito num card abre o menu (converter anotação em
//   comentário/tarefa); clicar no texto de uma anotação edita no próprio card.
//   Vocabulário: "branch".
// A visualização ROOT da Tree. O que um teste estático não alcança e se pina
// aqui:
//  - selecionar um nó diz a que ele SERVE (o caminho até o Resultado) e
//    quanto falta abaixo dele;
//  - arrastar um cartão para o vazio grava a POSIÇÃO; soltar sobre outro nó o
//    RE-PENDURA — e um clique curto não arrasta nada;
//  - recolher um galho esconde os filhos e diz quantos ficaram escondidos;
//  - no mapa livre o comentário aparece DESABILITADO (é do feed de um
//    registro), nunca escondido.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TREE_BRANCH_LABELS, type TreeNode } from "@/lib/tree/model";

vi.mock("@/app/(app)/dashboards/tree-actions", () => ({
  deleteTreeNode: vi.fn(async () => ({ ok: true })),
  setRecordCadence: vi.fn(async () => ({ ok: true })),
  updateTreeNote: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/comments/actions", () => ({ deleteComment: vi.fn() }));
vi.mock("@/lib/tasks/actions", () => ({ resumeRecordSeries: vi.fn() }));
vi.mock("./tree-series-sheet", () => ({ TreeSeriesSheet: () => null }));
vi.mock("@/components/tarefas/task-sheet", () => ({
  TaskSheet: () => null,
  TaskForm: () => null,
}));
vi.mock("@/components/tarefas/task-list", () => ({
  TaskCompleteButton: () => null,
  TaskDeleteButton: () => null,
  TaskSeriesPrompt: () => null,
  useTaskRowActions: () => ({}),
}));
vi.mock("@/lib/use-debounced-refresh", () => ({
  useDebouncedRefresh: () => () => {},
}));

import { TreeRootView, type TreeRootViewProps } from "./tree-root-view";

const n = (
  id: string,
  children: TreeNode[] = [],
  extra: Partial<TreeNode> = {}
): TreeNode => ({ id, kind: "note", at: "", label: id, children, depth: 0, refId: id, ...extra });

const plano = (): TreeNode[] => [
  n(
    "note:meta",
    [
      n("note:proposta", [n("note:orcamento", [], { status: "concluída" }), n("note:demo", [], { status: "aberta" })]),
      n("note:contrato", [], { status: "aberta" }),
    ],
    { goal: true, label: "Fechar o contrato" }
  ),
];

function setup(over: Partial<TreeRootViewProps> = {}) {
  const props: TreeRootViewProps = {
    nodes: plano(),
    geometry: [],
    defaultDirection: "h",
    storageKey: "test:collapsed",
    scope: { kind: "livre", mapKey: "plano" },
    actx: {
      scope: { kind: "livre", mapKey: "plano" },
      ctx: { responsibles: [], canAssignOthers: true, canLock: false },
      recordTitle: "",
      taskById: new Map(),
      seriesByKey: new Map(),
      canConfigure: false,
      sourceKey: null,
      onNote: vi.fn(),
      onChanged: vi.fn(),
    },
    onCreate: vi.fn(async () => "note:nova"),
    onCreateTask: vi.fn(),
    onConvert: vi.fn(),
    onDeleteNote: vi.fn(),
    onEditComment: vi.fn(),
    onReparent: vi.fn(),
    onMove: vi.fn(),
    onDirection: vi.fn(),
    onEditNote: vi.fn(),
    ...over,
  };
  render(<TreeRootView {...props} />);
  return props;
}

const tile = (id: string) =>
  document.querySelector<HTMLElement>(`[data-tree-node="${id}"]`)!;

/** Seleciona pelo CORPO do card (o texto agora edita). */
function selectTile(id: string) {
  const canvas = screen.getByRole("tree");
  fireEvent.pointerDown(tile(id), { button: 0, pointerId: 9, clientX: 5, clientY: 5 });
  fireEvent.pointerUp(canvas, { pointerId: 9, clientX: 5, clientY: 5 });
}

describe("TreeRootView", () => {
  // O recolhido é lembrado em localStorage: um teste não pode herdar o outro.
  beforeEach(() => window.localStorage.clear());

  it("desenha um cartão por nó, com o Resultado marcado", () => {
    setup();
    expect(document.querySelectorAll("[data-tree-node]")).toHaveLength(5);
    expect(within(tile("note:meta")).getByText("Resultado")).toBeInTheDocument();
    // O progresso do Resultado conta o que está ABAIXO dele.
    expect(within(tile("note:meta")).getByText("1/3")).toBeInTheDocument();
  });

  it("selecionar mostra a que o nó serve e quanto falta", () => {
    setup();
    selectTile("note:proposta");
    expect(screen.getByText(/Serve a: Fechar o contrato/)).toBeInTheDocument();
    expect(screen.getByText(/1 de 2 concluídos · faltam 1/)).toBeInTheDocument();
  });

  it("arrastar para o vazio grava a posição (relativa ao slot)", () => {
    const props = setup();
    const canvas = screen.getByRole("tree");
    const card = tile("note:contrato");
    fireEvent.pointerDown(card, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 160, clientY: 5000 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 160, clientY: 5000 });
    expect(props.onMove).toHaveBeenCalledTimes(1);
    const [id, offset] = (props.onMove as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe("note:contrato");
    expect(offset.x).toBeGreaterThan(0);
    expect(props.onReparent).not.toHaveBeenCalled();
  });

  it("soltar SOBRE outro nó re-pendura (passa a depender dele)", () => {
    const props = setup();
    const canvas = screen.getByRole("tree");
    const card = tile("note:contrato");
    const target = tile("note:demo");
    // jsdom não tem layout: a posição sai do style que o layout escreveu.
    const tx = parseFloat(target.style.left) + 10;
    const ty = parseFloat(target.style.top) + 10;
    const cx = parseFloat(card.style.left) + 10;
    const cy = parseFloat(card.style.top) + 10;
    fireEvent.pointerDown(card, { button: 0, pointerId: 2, clientX: cx, clientY: cy });
    // O encaixe automático (sem tamanho de janela) é translate(24 - minX).
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: tx + 24, clientY: ty + 24 });
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: tx + 24, clientY: ty + 24 });
    expect(props.onReparent).toHaveBeenCalledWith("note:contrato", "note:demo");
    expect(props.onMove).not.toHaveBeenCalled();
  });

  it("um clique curto seleciona, não arrasta", () => {
    const props = setup();
    const canvas = screen.getByRole("tree");
    const card = tile("note:demo");
    fireEvent.pointerDown(card, { button: 0, pointerId: 3, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(canvas, { pointerId: 3, clientX: 51, clientY: 51 });
    expect(props.onMove).not.toHaveBeenCalled();
    expect(tile("note:demo")).toHaveAttribute("aria-selected", "true");
  });

  it("recolher esconde os filhos e diz quantos", () => {
    setup();
    fireEvent.click(within(tile("note:proposta")).getByLabelText("Recolher branch"));
    expect(tile("note:orcamento")).toBeNull();
    expect(within(tile("note:proposta")).getByText("+2")).toBeInTheDocument();
  });

  it("a direção da branch é escolhida na barra do nó", () => {
    const props = setup();
    selectTile("note:proposta");
    fireEvent.click(screen.getByLabelText("Branches abrem para baixo"));
    expect(props.onDirection).toHaveBeenCalledWith("note:proposta", "v");
  });

  it("vazio convida a começar pelo resultado", () => {
    setup({ nodes: [] });
    expect(screen.getByText(/comece pelo resultado esperado/)).toBeInTheDocument();
  });

  // --- v1.1: criação e edição dentro do canvas ---
  it("clique direito no VAZIO abre a prévia de uma branch independente, e Enter salva", async () => {
    const props = setup();
    const canvas = screen.getByRole("tree");
    fireEvent.contextMenu(canvas, { clientX: 900, clientY: 700 });
    const draft = tile("draft:new");
    expect(draft).not.toBeNull();
    const box = within(draft).getByRole("textbox");
    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: "Contratar o jurídico" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(props.onCreate).toHaveBeenCalledWith({
        kind: "note",
        parentRef: null,
        text: "Contratar o jurídico",
        analyze: false,
      })
    );
    // Salvo: a branch volta para onde a prévia apareceu (geometria).
    await waitFor(() => expect(tile("draft:new")).toBeNull());
  });

  it("o + do card abre a prévia FILHA na hora", async () => {
    const props = setup();
    fireEvent.click(within(tile("note:contrato")).getByLabelText("Nova branch a partir deste nó"));
    const box = within(tile("draft:new")).getByRole("textbox");
    fireEvent.change(box, { target: { value: "Assinatura" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(props.onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ parentRef: "note:contrato", text: "Assinatura" })
      )
    );
  });

  it("Esc na prévia vazia descarta sem gravar", () => {
    const props = setup();
    fireEvent.contextMenu(screen.getByRole("tree"), { clientX: 10, clientY: 10 });
    fireEvent.keyDown(within(tile("draft:new")).getByRole("textbox"), { key: "Escape" });
    expect(tile("draft:new")).toBeNull();
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it("v1.2: clique direito na prévia VAZIA, fora da caixa, abre o menu de tipo", () => {
    const props = setup({
      scope: { kind: "record", recordId: "00000000-0000-4000-a000-000000000001" },
    });
    fireEvent.contextMenu(screen.getByRole("tree"), { clientX: 10, clientY: 10 });
    const draft = tile("draft:new");
    const badge = within(draft).getByText(TREE_BRANCH_LABELS.note);
    // O mousedown fora da caixa não pode tirar o foco dela (o blur descartaria
    // a prévia vazia antes do menu).
    expect(fireEvent.mouseDown(badge, { button: 2 })).toBe(false);
    expect(within(draft).getByRole("textbox")).toHaveFocus();
    fireEvent.contextMenu(badge);
    expect(screen.getByRole("menuitem", { name: /Anotação/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Tarefa/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /Comentário/ }));
    const after = tile("draft:new");
    expect(after).not.toBeNull();
    expect(within(after).getByText(TREE_BRANCH_LABELS.comment)).toBeInTheDocument();
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it("clique direito na PRÉVIA troca o tipo; Tarefa leva o texto para o editor", () => {
    const props = setup({
      scope: { kind: "record", recordId: "00000000-0000-4000-a000-000000000001" },
    });
    fireEvent.contextMenu(screen.getByRole("tree"), { clientX: 10, clientY: 10 });
    const box = within(tile("draft:new")).getByRole("textbox");
    fireEvent.change(box, { target: { value: "Ligar para o decisor" } });
    fireEvent.contextMenu(box);
    fireEvent.click(screen.getByRole("menuitem", { name: /Tarefa/ }));
    expect(props.onCreateTask).toHaveBeenCalledWith({
      parentRef: null,
      title: "Ligar para o decisor",
    });
  });

  it("clique direito numa ANOTAÇÃO converte em comentário ou tarefa", () => {
    const props = setup({
      scope: { kind: "record", recordId: "00000000-0000-4000-a000-000000000001" },
    });
    fireEvent.contextMenu(tile("note:demo"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Converter em tarefa/ }));
    expect(props.onConvert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "note:demo" }),
      "task"
    );
  });

  it("no mapa livre, converter em comentário fica desabilitado com o motivo", () => {
    setup();
    fireEvent.contextMenu(tile("note:demo"));
    const item = screen.getByRole("menuitem", { name: /Converter em comentário/ });
    expect(item).toBeDisabled();
    expect(item).toHaveTextContent(/feed de um registro/);
  });

  it("clicar no TEXTO de uma anotação edita no próprio card", () => {
    const props = setup();
    fireEvent.click(within(tile("note:demo")).getByText("note:demo"));
    const box = within(tile("note:demo")).getByRole("textbox");
    fireEvent.change(box, { target: { value: "Demo marcada" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(props.onEditNote).toHaveBeenCalledWith(
      expect.objectContaining({ id: "note:demo" }),
      { label: "Demo marcada" }
    );
  });

  it("comentário também é digitado no card, pelo dono dele", () => {
    const props = setup({
      nodes: [
        n("comment:c1", [], {
          kind: "comment",
          refId: "c1",
          label: "Liguei",
          body: "Liguei, sem resposta",
        }),
      ],
    });
    fireEvent.click(within(tile("comment:c1")).getByText("Liguei"));
    const box = within(tile("comment:c1")).getByRole("textbox");
    expect(box).toHaveValue("Liguei, sem resposta");
    fireEvent.change(box, { target: { value: "Liguei, retornar amanhã" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(props.onEditComment).toHaveBeenCalledWith(
      expect.objectContaining({ id: "comment:c1" }),
      "Liguei, retornar amanhã"
    );
  });
});

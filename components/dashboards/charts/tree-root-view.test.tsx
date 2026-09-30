// @vitest-environment jsdom
// Versão: 1.0 | Data: 30/09/2026
// A visualização ROOT da Tree. O que um teste estático não alcança e se pina
// aqui:
//  - selecionar um nó diz a que ele SERVE (o caminho até o Resultado) e
//    quanto falta abaixo dele;
//  - arrastar um cartão para o vazio grava a POSIÇÃO; soltar sobre outro nó o
//    RE-PENDURA — e um clique curto não arrasta nada;
//  - recolher um galho esconde os filhos e diz quantos ficaram escondidos;
//  - no mapa livre o comentário aparece DESABILITADO (é do feed de um
//    registro), nunca escondido.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TreeNode } from "@/lib/tree/model";

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
    onAddBranch: vi.fn(),
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

describe("TreeRootView", () => {
  it("desenha um cartão por nó, com o Resultado marcado", () => {
    setup();
    expect(document.querySelectorAll("[data-tree-node]")).toHaveLength(5);
    expect(within(tile("note:meta")).getByText("Resultado")).toBeInTheDocument();
    // O progresso do Resultado conta o que está ABAIXO dele.
    expect(within(tile("note:meta")).getByText("1/3")).toBeInTheDocument();
  });

  it("selecionar mostra a que o nó serve e quanto falta", () => {
    setup();
    fireEvent.click(within(tile("note:proposta")).getByText("note:proposta"));
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
    fireEvent.click(within(tile("note:proposta")).getByLabelText("Recolher galho"));
    expect(tile("note:orcamento")).toBeNull();
    expect(within(tile("note:proposta")).getByText("+2")).toBeInTheDocument();
  });

  it("a direção do galho é escolhida na barra do nó", () => {
    const props = setup();
    fireEvent.click(within(tile("note:proposta")).getByText("note:proposta"));
    fireEvent.click(screen.getByLabelText("Galhos abrem para baixo"));
    expect(props.onDirection).toHaveBeenCalledWith("note:proposta", "v");
  });

  it("vazio convida a começar pelo resultado", () => {
    setup({ nodes: [] });
    expect(screen.getByText(/Comece pelo resultado esperado/)).toBeInTheDocument();
  });
});

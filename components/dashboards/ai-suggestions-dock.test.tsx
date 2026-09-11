// @vitest-environment jsdom
// Versão: 1.0 | Data: 11/09/2026
// O dock das sugestões da IA.
//
// O que se pina aqui é a moldura COMPARTILHADA — a parte do pedido que um teste
// estático não alcança. Com três análises em curso, três cartões empilhados
// cobririam o painel; a resposta é um pop-up só, com `‹ 2/3 ›` trocando o
// conteúdo, minimizável sem cancelar nada, e um botão flutuante que diz quantas
// conversas estão esperando alguém.
//
// O caso que motivou tudo: a pessoa escreve o comentário, a análise demora, e
// nada na tela dizia que algo estava acontecendo (o compositor, que segurava o
// único spinner, fechava antes de a IA ser chamada). Por isso o fio ENTRA na
// lista já ocupado — e é isso que o teste do estado "analisando" guarda.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CommentThread } from "@/lib/ai/analyze-comment";

import { AiSuggestionsDock } from "./ai-suggestions-dock";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));
vi.mock("@/app/(app)/dashboards/tree-actions", () => ({
  applyCommentThread: vi.fn(async () => ({ ok: true })),
  dismissCommentThread: vi.fn(async () => ({ ok: true })),
}));

const thread = (over: Partial<CommentThread> = {}): CommentThread => ({
  id: "t1",
  recordId: "r1",
  recordTitle: "Acme Ltda",
  chat: [{ kind: "user", text: "O Oscar pediu para contactar no fim de outubro" }],
  updatedAt: "2026-09-11T00:00:00Z",
  ...over,
});

/** O contexto real é um provider; aqui basta o valor que o dock consome. */
function mountDock(over: Record<string, unknown> = {}) {
  const value = {
    threads: [thread()],
    busy: new Set<string>(),
    openId: "t1",
    open: vi.fn(),
    minimized: false,
    setMinimized: vi.fn(),
    start: vi.fn(),
    reply: vi.fn(),
    close: vi.fn(),
    ...over,
  };
  vi.doMock("./ai-suggestions-context", () => ({
    useAiSuggestions: () => value,
    useHasAiSuggestions: () => true,
  }));
  return value;
}

describe("o dock é UM para todas as conversas", () => {
  it("sem conversa nenhuma, não ocupa espaço na tela", async () => {
    vi.resetModules();
    mountDock({ threads: [] });
    const { AiSuggestionsDock: Dock } = await import("./ai-suggestions-dock");
    const { container } = render(<Dock />);
    expect(container).toBeEmptyDOMElement();
  });

  it("com uma só, não desenha a navegação (não há para onde ir)", async () => {
    vi.resetModules();
    mountDock();
    const { AiSuggestionsDock: Dock } = await import("./ai-suggestions-dock");
    render(<Dock />);
    expect(screen.getByText("Acme Ltda")).toBeTruthy();
    expect(screen.queryByLabelText("Próxima conversa")).toBeNull();
  });

  it("com várias, a setinha navega e a posição aparece", async () => {
    vi.resetModules();
    const value = mountDock({
      threads: [thread(), thread({ id: "t2", recordTitle: "Beta SA" })],
    });
    const { AiSuggestionsDock: Dock } = await import("./ai-suggestions-dock");
    render(<Dock />);
    expect(screen.getByText("1/2")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Próxima conversa"));
    expect(value.open).toHaveBeenCalledWith("t2");
  });

  it("a volta dá a volta: da última para a primeira", async () => {
    vi.resetModules();
    const value = mountDock({
      threads: [thread(), thread({ id: "t2" })],
      openId: "t1",
    });
    const { AiSuggestionsDock: Dock } = await import("./ai-suggestions-dock");
    render(<Dock />);
    fireEvent.click(screen.getByLabelText("Conversa anterior"));
    expect(value.open).toHaveBeenCalledWith("t2");
  });
});

describe("o estado de espera é visível", () => {
  it("fio ocupado mostra que a IA está trabalhando", async () => {
    vi.resetModules();
    mountDock({ busy: new Set(["t1"]) });
    const { AiSuggestionsDock: Dock } = await import("./ai-suggestions-dock");
    render(<Dock />);
    // É o feedback que não existia: antes o compositor (com o único spinner da
    // tela) fechava antes de a análise começar.
    expect(screen.getByText("Analisando o comentário…")).toBeTruthy();
  });

  it("enquanto analisa, não há o que aplicar", async () => {
    vi.resetModules();
    mountDock({
      busy: new Set(["t1"]),
      threads: [thread({ acoes: [{ resumo: "criar · X", destrutiva: false }] })],
    });
    const { AiSuggestionsDock: Dock } = await import("./ai-suggestions-dock");
    render(<Dock />);
    expect(screen.queryByText("Aplicar")).toBeNull();
  });

  it("a proposta lista as ações, e a destrutiva se destaca", async () => {
    vi.resetModules();
    mountDock({
      threads: [
        thread({
          acoes: [
            { resumo: "editar · Proposta", destrutiva: false },
            { resumo: "adiar a sequência até 2026-10-31", destrutiva: true },
          ],
        }),
      ],
    });
    const { AiSuggestionsDock: Dock } = await import("./ai-suggestions-dock");
    render(<Dock />);
    expect(screen.getByText("editar · Proposta")).toBeTruthy();
    // Um clique aplica o lote inteiro: o que some com dado não pode parecer
    // igual ao resto.
    expect(
      screen.getByText("adiar a sequência até 2026-10-31").className
    ).toContain("text-destructive");
  });
});

describe("minimizar não cancela nada", () => {
  it("minimizado vira botão com a contagem do que espera alguém", async () => {
    vi.resetModules();
    mountDock({
      minimized: true,
      threads: [
        thread({ acoes: [{ resumo: "criar · X", destrutiva: false }] }),
        thread({ id: "t2" }),
      ],
    });
    const { AiSuggestionsDock: Dock } = await import("./ai-suggestions-dock");
    render(<Dock />);
    expect(screen.getByText("Sugestões")).toBeTruthy();
    // Duas conversas, mas só uma com proposta pronta: o badge conta o que
    // exige decisão, não o que está na lista.
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("o botão de minimizar existe e devolve o estado ao contexto", async () => {
    vi.resetModules();
    const value = mountDock();
    const { AiSuggestionsDock: Dock } = await import("./ai-suggestions-dock");
    render(<Dock />);
    fireEvent.click(screen.getByLabelText("Minimizar"));
    expect(value.setMinimized).toHaveBeenCalledWith(true);
  });
});

describe("a réplica dispensa escrever outro comentário", () => {
  it("Enter manda o texto para o fio ABERTO", async () => {
    vi.resetModules();
    const value = mountDock();
    const { AiSuggestionsDock: Dock } = await import("./ai-suggestions-dock");
    render(<Dock />);
    const input = screen.getByLabelText("Responder à IA");
    fireEvent.change(input, { target: { value: "só a próxima" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(value.reply).toHaveBeenCalledWith("t1", "só a próxima");
  });

  it("não manda vazio, nem com a IA ocupada", async () => {
    vi.resetModules();
    const value = mountDock({ busy: new Set(["t1"]) });
    const { AiSuggestionsDock: Dock } = await import("./ai-suggestions-dock");
    render(<Dock />);
    const input = screen.getByLabelText("Responder à IA");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(value.reply).not.toHaveBeenCalled();
  });
});

// O import estático existe só para o arquivo falhar cedo se o componente sumir;
// os testes usam o import dinâmico porque cada um remonta o contexto.
void AiSuggestionsDock;

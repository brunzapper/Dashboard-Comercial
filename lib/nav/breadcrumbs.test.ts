// Versão: 1.0 | Data: 10/10/2026
// v1.0 (10/10/2026): migalhas da barra de local — rótulos de topo fixos, nome
//   do objeto só pelo `leaf`, último nível sem link, nunca um id na tela.
import { describe, expect, it } from "vitest";

import { breadcrumbsFor } from "./breadcrumbs";

const labels = (p: string, leaf?: string) =>
  breadcrumbsFor(p, leaf).map((c) => c.label);

describe("breadcrumbsFor", () => {
  it("raiz = Painéis, sem link", () => {
    expect(breadcrumbsFor("/")).toEqual([{ label: "Painéis", href: null }]);
  });

  it("dashboard usa o nome publicado e sobe para Painéis", () => {
    const crumbs = breadcrumbsFor("/dashboards/abc-123", "Comercial — Sudeste");
    expect(crumbs).toEqual([
      { label: "Painéis", href: "/" },
      { label: "Comercial — Sudeste", href: null },
    ]);
  });

  it("sem nome publicado nunca mostra o id", () => {
    expect(labels("/dashboards/8f1c")).toEqual(["Painéis", "Dashboard"]);
    expect(labels("/kanbans/w/123")).toEqual(["Painéis", "Kanban"]);
  });

  it("Operação e seus módulos", () => {
    expect(labels("/operacao")).toEqual(["Operação"]);
    expect(breadcrumbsFor("/operacao/tarefas")).toEqual([
      { label: "Operação", href: "/operacao" },
      { label: "Tarefas", href: null },
    ]);
    expect(breadcrumbsFor("/operacao/workflow/rule:1", "Follow-up")).toEqual([
      { label: "Operação", href: "/operacao" },
      { label: "Workflow", href: "/operacao/workflow" },
      { label: "Follow-up", href: null },
    ]);
    expect(labels("/operacao/f/lead", "Novo lead")).toEqual([
      "Operação",
      "Novo lead",
    ]);
  });

  it("Configurações usa o rótulo do catálogo único", () => {
    expect(breadcrumbsFor("/configuracoes/tema")).toEqual([
      { label: "Configurações", href: "/configuracoes" },
      { label: "Tema e interface", href: null },
    ]);
  });

  it("Registros e sub-rotas", () => {
    expect(labels("/registros")).toEqual(["Registros"]);
    expect(labels("/registros/bases")).toEqual(["Registros", "Bases"]);
  });

  it("rota desconhecida sem nome ⇒ sem migalha", () => {
    expect(breadcrumbsFor("/escolher-organizacao")).toEqual([]);
  });
});

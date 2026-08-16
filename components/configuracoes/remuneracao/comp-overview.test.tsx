// @vitest-environment jsdom
// Versão: 1.3 | Data: 16/08/2026
// v1.3: payload v3 — o clique no export manda o roster (`members`, com o nome
// da aba Det-<Nome>) e os `links` por linha; e o Realizado de cada fator abre
// o painel de conferência (a action de detalhe é mockada — server-only).
// Versão: 1.2 | Data: 02/08/2026
// v1.2: botão "Google Planilhas" (0115) — sem config, admin vê só o
// "Configurar…"; configurado, o clique abre a aba SINCRONAMENTE
// (popup-safe) e chama a action com scope/aba/números; falha fecha a aba.
// Actions de sheets são mockadas (importam server-only).
// Versão: 1.1 | Data: 02/08/2026
// v1.1: exportação — botões Exportar CSV/PDF do toolbar (CSV dispara o
// download; PDF monta o portal [data-print-root], chama window.print e
// desmonta no afterprint) e impressão do demonstrativo de UMA pessoa no
// agrupamento por pessoa (conteúdo do portal recortado ao membro). jsdom não
// tem print/createObjectURL — stubs no beforeEach.
// Versão: 1.0 | Data: 01/08/2026
// Testes da Visão geral da Remuneração: agrupamento por plano (default) e por
// pessoa, memória de cálculo visível nos cards, membro sem lançamento com
// nota, somente leitura (sem Recalcular/Publicar) e preferência de
// agrupamento em localStorage (`comp-overview:group`).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fmtMoneyBRL } from "@/lib/comp/commission-label";
import type { CompPlanConfig } from "@/lib/comp/model";

import { createSheetExportTicket } from "@/app/(app)/operacao/remuneracao/sheets-actions";
import { CompOverview } from "./comp-overview";
import type {
  CompEntryClientRow,
  CompPlanClientRow,
} from "./remuneracao-manager";

// O botão de Sheets importa as actions (server-only) e o popover usa o router.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/app/(app)/operacao/remuneracao/detail-actions", () => ({
  loadCompFactorDetail: vi.fn(async () => ({
    ok: true as const,
    planName: "Plano A",
    memberLabel: "Ana",
    apuracaoShifted: false,
    detail: {
      factorId: "reunioes",
      label: "Reuniões",
      money: false,
      valueLabel: "Registros",
      aggNote: "Contagem de registros · 2 registros no recorte",
      realized: 44,
      listedSum: 2,
      rows: [],
      total: 2,
      truncated: false,
      warnings: [],
    },
  })),
}));
vi.mock("@/app/(app)/operacao/remuneracao/sheets-actions", () => ({
  createSheetExportTicket: vi.fn(async () => ({
    ok: true,
    token: "tok-de-teste",
    webappUrl: "https://script.google.com/macros/s/x/exec",
  })),
  saveCompSheetsWebappUrl: vi.fn(async () => ({ ok: true })),
}));

// Radix (tooltips dos cards) exige ResizeObserver, ausente no jsdom.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
  }
  window.localStorage.clear();
  // jsdom não implementa print nem blob URLs (caminho do downloadCsv); o
  // click do <a download> também navegaria (not implemented) — tudo stub.
  window.print = vi.fn();
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
});

// Plano A: 100% comissão (fator peso 0 + per_unit) — memória "44 × R$ 12,50".
const configA: CompPlanConfig = {
  v: 1,
  factors: [
    {
      id: "reunioes",
      label: "Reuniões",
      weightPct: 0,
      metricKey: "m_r",
      money: false,
      formula: { tokens: [{ kind: "field", ref: "agg:count:*" }] },
      sources: [],
    },
  ],
  commissions: [
    {
      id: "premio",
      label: "Prêmio por reunião",
      triggerFactorId: "reunioes",
      basisKind: "factor",
      basisFactorId: "reunioes",
      tierBy: "realized",
      kind: "per_unit",
      tiers: [
        { fromPct: 0, amount: 10 },
        { fromPct: 26, amount: 12.5 },
      ],
    },
  ],
};

// Plano B: clássico (peso 100%).
const configB: CompPlanConfig = {
  v: 1,
  factors: [
    {
      id: "vendas",
      label: "Vendas",
      weightPct: 100,
      metricKey: "m_v",
      money: true,
      formula: { tokens: [{ kind: "field", ref: "agg:sum:value" }] },
      sources: [],
    },
  ],
};

const plans: CompPlanClientRow[] = [
  {
    id: "pA",
    name: "Plano A",
    active: true,
    base_amount_default: null,
    config: configA,
    updated_at: "2026-08-01T00:00:00Z",
  },
  {
    id: "pB",
    name: "Plano B",
    active: true,
    base_amount_default: 1000,
    config: configB,
    updated_at: "2026-08-01T00:00:00Z",
  },
];

function entry(
  id: string,
  planId: string,
  respId: string,
  realized: Record<string, number>
): CompEntryClientRow & { plan_id: string } {
  return {
    id,
    plan_id: planId,
    responsible_id: respId,
    base_amount: null,
    inputs: {},
    computed: { v: 1, at: "2026-08-01T10:00:00Z", realized },
    total: null,
    mirror_record_id: null,
    published_at: null,
    updated_at: "2026-08-01T10:00:00Z",
  };
}

function renderOverview(sheetsWebappUrl: string | null = null) {
  return render(
    <CompOverview
      plans={plans}
      entries={[
        // Ana lançada no A (44 reuniões ⇒ R$ 550); Bruno lançado no B
        // (50k/100k ⇒ 1000×100%×50% = R$ 500). Cruzados ficam SEM lançamento.
        entry("e1", "pA", "r_ana", { reunioes: 44 }),
        entry("e2", "pB", "r_bruno", { vendas: 50000 }),
      ]}
      targetsByPlan={{ pB: { r_bruno: { vendas: 100000 } } }}
      targetRatesByPlan={{}}
      responsibles={[
        { id: "r_ana", label: "Ana" },
        { id: "r_bruno", label: "Bruno" },
      ]}
      operationMembersById={{}}
      year={2026}
      month={8}
      sheetsWebappUrl={sheetsWebappUrl}
    />
  );
}

// NBSP do Intl pt-BR normalizado dos DOIS lados da comparação.
const norm = (s: string) => s.replace(/ /g, " ");
const bodyText = () => norm(document.body.textContent ?? "");
const money = (v: number) => norm(fmtMoneyBRL(v));
const firstHeading = () =>
  screen.getAllByRole("heading", { level: 2 })[0]?.textContent ?? "";

describe("CompOverview", () => {
  it("default por plano: seções por plano, cards pelo nome do membro, totais", () => {
    renderOverview();
    // 1ª seção = Plano A (agrupamento por plano).
    expect(firstHeading()).toContain("Plano A");
    // Memória visível nos cards.
    expect(bodyText()).toContain("44 (Reuniões) × R$ 12,50 = R$ 550,00");
    // Membro sem lançamento no plano (Bruno no A e Ana no B).
    expect(bodyText()).toContain("sem lançamento no mês");
    // Totais derivados do computeEntry: A = 550; B = 500; geral = 1050.
    expect(bodyText()).toContain(`Total do mês: ${money(1050)}`);
    expect(bodyText()).toContain(money(550));
    expect(bodyText()).toContain(money(500));
  });

  it("toggle por pessoa reagrupa (seções por responsável)", () => {
    renderOverview();
    fireEvent.click(screen.getByRole("button", { name: "Por pessoa" }));
    expect(firstHeading()).toContain("Ana");
  });

  it("é somente leitura: sem Recalcular/Publicar", () => {
    renderOverview();
    expect(
      screen.queryByRole("button", { name: /Recalcular|Publicar/ })
    ).toBeNull();
  });

  it("Exportar CSV baixa o relatório (blob) sem tocar em nada mais", () => {
    renderOverview();
    fireEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    // O conteúdo das linhas é contrato de lib/export/comp.test.ts.
  });

  it("Exportar PDF monta o portal de impressão, imprime e desmonta no afterprint", async () => {
    renderOverview();
    fireEvent.click(screen.getByRole("button", { name: "Exportar PDF" }));
    const root = document.querySelector("[data-print-root]");
    expect(root).not.toBeNull();
    expect(document.body.dataset.printing).toBe("comp");
    const text = norm(root!.textContent ?? "");
    expect(text).toContain("Remuneração — Agosto de 2026");
    expect(text).toContain("Plano A");
    expect(text).toContain("Plano B");
    // double-rAF antes do print.
    await waitFor(() => expect(window.print).toHaveBeenCalled());
    fireEvent(window, new Event("afterprint"));
    await waitFor(() =>
      expect(document.querySelector("[data-print-root]")).toBeNull()
    );
    expect(document.body.dataset.printing).toBeUndefined();
  });

  it("imprimir demonstrativo de uma pessoa recorta o portal ao membro", () => {
    renderOverview();
    fireEvent.click(screen.getByRole("button", { name: "Por pessoa" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Imprimir demonstrativo de Ana" })
    );
    const text = norm(
      document.querySelector("[data-print-root]")?.textContent ?? ""
    );
    expect(text).toContain("Ana");
    expect(text).toContain("Plano A");
    expect(text).not.toContain("Bruno");
  });

  it("Sheets sem config: admin vê só o 'Configurar…' (sem botão de export)", () => {
    renderOverview(null);
    expect(
      screen.getByRole("button", { name: /Google Planilhas — Configurar…/ })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /^Google Planilhas$/ })
    ).toBeNull();
  });

  it("Sheets configurado: clique abre aba SINCRONAMENTE e chama a action", async () => {
    const fakeWin = { close: vi.fn(), location: { href: "" } };
    window.open = vi.fn(() => fakeWin as unknown as Window);
    renderOverview("https://script.google.com/macros/s/x/exec");
    fireEvent.click(screen.getByRole("button", { name: "Google Planilhas" }));
    // window.open antes de qualquer await (popup-safe).
    expect(window.open).toHaveBeenCalledWith("", "_blank");
    await waitFor(() =>
      expect(vi.mocked(createSheetExportTicket)).toHaveBeenCalled()
    );
    const arg = vi.mocked(createSheetExportTicket).mock.calls[0][0];
    expect(arg.scope).toBe("visao-geral");
    expect(arg.tabName).toBe("Agosto 2026");
    // Payload v2 (compSheetReport): kinds paralelo às rows + números CRUS.
    expect(arg.kinds).toHaveLength(arg.rows.length);
    expect(arg.rows.flat().some((c) => typeof c === "number")).toBe(true);
    // Título do demonstrativo viaja em headers (linha 1 da aba).
    expect(arg.headers[0]).toContain("Demonstrativo de remuneração");
    // Payload v3: roster p/ o servidor montar as abas + links por linha.
    expect(arg.links).toHaveLength(arg.rows.length);
    expect(arg.members).toEqual([
      { id: "r_ana", label: "Ana", tabName: "Det-Ana" },
      { id: "r_bruno", label: "Bruno", tabName: "Det-Bruno" },
    ]);
    // Toda aba referenciada por um link existe no roster.
    const abas = new Set(arg.members!.map((m) => m.tabName));
    for (const l of arg.links!) if (l != null) expect(abas.has(l)).toBe(true);
    await waitFor(() =>
      expect(fakeWin.location.href).toContain(
        "https://script.google.com/macros/s/x/exec?token="
      )
    );
  });

  it("Sheets: falha da action fecha a aba aberta", async () => {
    vi.mocked(createSheetExportTicket).mockResolvedValueOnce({
      ok: false,
      message: "nope",
    });
    const fakeWin = { close: vi.fn(), location: { href: "" } };
    window.open = vi.fn(() => fakeWin as unknown as Window);
    renderOverview("https://script.google.com/macros/s/x/exec");
    fireEvent.click(screen.getByRole("button", { name: "Google Planilhas" }));
    await waitFor(() => expect(fakeWin.close).toHaveBeenCalled());
  });

  it("Realizado do fator abre a conferência dos registros", async () => {
    const { loadCompFactorDetail } = await import(
      "@/app/(app)/operacao/remuneracao/detail-actions"
    );
    renderOverview();
    const gatilhos = screen.getAllByTitle(
      "Ver os registros que compõem este realizado"
    );
    expect(gatilhos.length).toBeGreaterThan(0);
    fireEvent.click(gatilhos[0]);
    await waitFor(() =>
      expect(vi.mocked(loadCompFactorDetail)).toHaveBeenCalled()
    );
    const arg = vi.mocked(loadCompFactorDetail).mock.calls[0][0];
    expect(arg).toMatchObject({ year: 2026, month: 8 });
    expect(arg.planId).toBeTruthy();
    expect(arg.memberId).toBeTruthy();
  });

  it("preferência salva abre por pessoa; 'Usar como padrão' grava a chave", async () => {
    window.localStorage.setItem("comp-overview:group", "por-pessoa");
    renderOverview();
    // A preferência entra pós-mount (effect).
    await waitFor(() => expect(firstHeading()).toContain("Ana"));
    // Volta para por plano e fixa como padrão.
    fireEvent.click(screen.getByRole("button", { name: "Por plano" }));
    fireEvent.click(screen.getByRole("button", { name: "Usar como padrão" }));
    expect(window.localStorage.getItem("comp-overview:group")).toBe(
      "por-plano"
    );
    // Botão vira "Padrão" (desabilitado) quando atual === salvo.
    expect(screen.getByRole("button", { name: "Padrão" })).toBeTruthy();
  });
});

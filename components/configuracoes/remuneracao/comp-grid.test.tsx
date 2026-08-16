// @vitest-environment jsdom
// Versão: 1.2 | Data: 16/08/2026
// v1.2 (16/08/2026): conferência por registro — o ícone da célula Realizado
// abre o painel de detalhe SEM disparar o override de duplo-clique (o gesto
// de edição da célula não pode ser sequestrado). Action de detalhe mockada
// (server-only).
// Versão: 1.1 | Data: 07/08/2026
// v1.1 (07/08/2026): blocos do save OTIMISTA em background (v1.7 da grade) —
// digitação sobrevive a um eco de props com save em voo (guard hasPending
// adota a key sem aplicar), erro reverte a linha ao estado pré-edição, e
// mudança de ESCOPO (mês) re-semeia mesmo com save em voo.
// Testes da grade de Lançamentos — MEMÓRIA DE CÁLCULO da comissão (v1.5): o
// popover da célula Comissão mostra a multiplicação por bloco (helper único
// commissionMemory) e o Valor de fator com peso 0 sem override vira "—".
// Cenário espelha o plano real "SDR Inbound FC": fator de reuniões peso 0 +
// bloco per_unit por realizado (44 reuniões × R$ 12,50 = R$ 550).
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CompPlanConfig } from "@/lib/comp/model";
import { saveEntryInputs } from "@/app/(app)/operacao/remuneracao/actions";

import { CompGrid } from "./comp-grid";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/app/(app)/operacao/remuneracao/detail-actions", () => ({
  loadCompFactorDetail: vi.fn(async () => ({
    ok: true as const,
    planName: "SDR Inbound FC",
    memberLabel: "Ana",
    apuracaoShifted: false,
    detail: {
      factorId: "reunioes",
      label: "Reuniões",
      money: false,
      valueLabel: "Registros",
      aggNote: "Contagem de registros · 44 registros no recorte",
      realized: 44,
      listedSum: 44,
      rows: [],
      total: 44,
      truncated: false,
      warnings: [],
    },
  })),
}));
vi.mock("@/app/(app)/operacao/remuneracao/actions", () => ({
  publishMonth: vi.fn(),
  recomputeMonth: vi.fn(),
  saveEntryInputs: vi.fn(async () => ({ ok: true })),
  saveTarget: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/feedback/notify", () => ({
  notifyActionError: vi.fn(),
  // Pass-through com a MESMA semântica do real: rejeição resolve undefined.
  notifyOnError: vi.fn(async (p: Promise<unknown>) => {
    try {
      return await p;
    } catch {
      return undefined;
    }
  }),
}));

// Radix popper (floating-ui) exige ResizeObserver, que o jsdom não tem.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
  }
});

const config: CompPlanConfig = {
  v: 1,
  factors: [
    {
      id: "reunioes",
      label: "Reuniões",
      weightPct: 0,
      metricKey: "comp_reunioes",
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

function renderGrid() {
  return render(
    <CompGrid
      plan={{
        id: "p1",
        name: "Plano SDR",
        active: true,
        base_amount_default: null,
        config,
        updated_at: "2026-08-01T00:00:00Z",
      }}
      config={config}
      year={2026}
      month={8}
      entries={[
        {
          id: "e1",
          responsible_id: "r1",
          base_amount: null,
          inputs: {},
          computed: {
            v: 1,
            at: "2026-08-01T10:00:00Z",
            realized: { reunioes: 44 },
          },
          total: 550,
          mirror_record_id: null,
          published_at: null,
          updated_at: "2026-08-01T10:00:00Z",
        },
      ]}
      responsibles={[{ id: "r1", label: "Paulo Vitor Santos" }]}
      targets={{}}
      operationMembersById={{}}
      targetRates={{}}
    />
  );
}

// Intl pt-BR emite NBSP entre "R$" e o número — normalizar antes de comparar.
const bodyText = () => (document.body.textContent ?? "").replace(/ /g, " ");

describe("CompGrid — memória de cálculo", () => {
  it("linha de detalhe SEMPRE visível traz a conta sem abrir o popover", () => {
    renderGrid();
    // Sem nenhum clique: a memória está no corpo da tabela (linha de detalhe).
    expect(bodyText()).toContain("44 (Reuniões) × R$ 12,50 = R$ 550,00");
    expect(bodyText()).toContain("faixa a partir de 26 (Reuniões: 44)");
    expect(bodyText()).toContain("realizado 44 (gatilho/base de comissão)");
  });

  it("colSpan da linha de detalhe == soma dos colSpans do thead (layout pinado)", () => {
    renderGrid();
    const table = document.querySelector("table");
    expect(table).not.toBeNull();
    const headCells = table!.querySelectorAll("thead tr:first-child th");
    const sum = [...headCells].reduce(
      (a, th) => a + ((th as HTMLTableCellElement).colSpan || 1),
      0
    );
    const detail = table!.querySelector("tbody td[colspan]");
    expect(detail).not.toBeNull();
    expect(Number(detail!.getAttribute("colspan"))).toBe(sum);
  });

  it("popover da Comissão abre com a mesma memória", async () => {
    renderGrid();
    fireEvent.click(
      screen.getByRole("button", { name: "Memória de cálculo da comissão" })
    );
    await waitFor(() => {
      // Título exclusivo do popover (a linha de detalhe não o tem).
      expect(screen.getByText("Memória de cálculo")).toBeTruthy();
      expect(bodyText()).toContain("44 (Reuniões) × R$ 12,50 = R$ 550,00");
    });
  });

  it("Valor de fator com peso 0 sem override exibe — (display-only)", () => {
    renderGrid();
    const dash = screen.getByTitle(/^Peso 0%/);
    expect(dash.textContent).toBe("—");
  });

  it("ícone do Realizado abre a conferência SEM disparar o override", async () => {
    const { loadCompFactorDetail } = await import(
      "@/app/(app)/operacao/remuneracao/detail-actions"
    );
    renderGrid();
    const gatilho = screen.getByRole("button", {
      name: "Ver os registros que compõem este realizado",
    });
    fireEvent.click(gatilho);
    await waitFor(() =>
      expect(vi.mocked(loadCompFactorDetail)).toHaveBeenCalled()
    );
    // O clique no ícone NÃO entra no modo de edição da célula.
    expect(document.querySelector("input")).toBeNull();
  });

  it("duplo clique na célula Realizado segue abrindo o override manual", () => {
    renderGrid();
    const gatilho = screen.getByRole("button", {
      name: "Ver os registros que compõem este realizado",
    });
    // A célula é o ancestral <td> do ícone.
    fireEvent.doubleClick(gatilho.closest("td")!);
    expect(document.querySelector("input")).not.toBeNull();
  });
});

// ---------- Save otimista em background (v1.7) ----------

// Props parametrizáveis: base default 1000 dá à célula Base um texto único
// ("R$ 1.000,00") p/ localizar; updatedAt/month simulam eco e troca de escopo.
function gridProps(overrides?: {
  updatedAt?: string;
  baseAmount?: number | null;
  month?: number;
}) {
  return {
    plan: {
      id: "p1",
      name: "Plano SDR",
      active: true,
      base_amount_default: 1000,
      config,
      updated_at: "2026-08-01T00:00:00Z",
    },
    config,
    year: 2026,
    month: overrides?.month ?? 8,
    entries: [
      {
        id: "e1",
        responsible_id: "r1",
        base_amount: overrides?.baseAmount ?? null,
        inputs: {},
        computed: {
          v: 1,
          at: "2026-08-01T10:00:00Z",
          realized: { reunioes: 44 },
        },
        total: 550,
        mirror_record_id: null,
        published_at: null,
        updated_at: overrides?.updatedAt ?? "2026-08-01T10:00:00Z",
      },
    ],
    responsibles: [{ id: "r1", label: "Paulo Vitor Santos" }],
    targets: {},
    operationMembersById: {},
    targetRates: {},
  };
}

// Edita a célula Base (duplo-clique → input → blur) para `value`.
function editBase(value: string) {
  const baseCell = screen.getByText(
    (t) => t.replace(/ /g, " ") === "R$ 1.000,00"
  );
  fireEvent.doubleClick(baseCell);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe("CompGrid — save otimista em background", () => {
  it("digitação com save em voo sobrevive ao eco de props (guard hasPending)", async () => {
    let resolveSave!: (v: Awaited<ReturnType<typeof saveEntryInputs>>) => void;
    vi.mocked(saveEntryInputs).mockImplementationOnce(
      () => new Promise((r) => (resolveSave = r))
    );
    const view = render(<CompGrid {...gridProps()} />);
    editBase("2000");
    // Otimista imediato, sem esperar o servidor.
    expect(bodyText()).toContain("R$ 2.000,00");
    // Eco stale aterrissa com o save EM VOO (updated_at novo, base ainda
    // null): a digitação não pode ser descartada.
    view.rerender(
      <CompGrid {...gridProps({ updatedAt: "2026-08-01T11:00:00Z" })} />
    );
    expect(bodyText()).toContain("R$ 2.000,00");
    // Drena: segue otimista até o refresh trazer o dado gravado.
    await act(async () => resolveSave({ ok: true }));
    expect(bodyText()).toContain("R$ 2.000,00");
  });

  it("erro no save reverte a linha ao estado pré-edição", async () => {
    vi.mocked(saveEntryInputs).mockResolvedValueOnce({
      ok: false,
      message: "RLS negou.",
    });
    render(<CompGrid {...gridProps()} />);
    editBase("2000");
    expect(bodyText()).toContain("R$ 2.000,00");
    await waitFor(() =>
      expect(bodyText()).not.toContain("R$ 2.000,00")
    );
    // Revert: volta ao default do plano (base da linha segue null).
    expect(bodyText()).toContain("R$ 1.000,00");
  });

  it("troca de MÊS re-semeia mesmo com save em voo (escopo vence o guard)", async () => {
    let resolveSave!: (v: Awaited<ReturnType<typeof saveEntryInputs>>) => void;
    vi.mocked(saveEntryInputs).mockImplementationOnce(
      () => new Promise((r) => (resolveSave = r))
    );
    const view = render(<CompGrid {...gridProps()} />);
    editBase("2000");
    expect(bodyText()).toContain("R$ 2.000,00");
    // Mês novo chega com o save em voo: otimista de AGOSTO não pode vazar
    // para setembro — re-semeia do servidor.
    view.rerender(<CompGrid {...gridProps({ month: 9 })} />);
    expect(bodyText()).not.toContain("R$ 2.000,00");
    expect(bodyText()).toContain("R$ 1.000,00");
    await act(async () => resolveSave({ ok: true }));
  });
});

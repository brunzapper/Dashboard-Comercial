// @vitest-environment jsdom
// Versão: 1.0 | Data: 03/10/2026
// v1.0 (03/10/2026): a tela v2 da Base manual. O que estes testes protegem:
//   * as ABAS (Lançamentos · Métricas · Divisões) e o modo `compact` do widget;
//   * o NAVEGADOR DE MÊS filtra a grade (antes: todos os meses de uma vez);
//   * a conferência só aparece com divergência — o "Total: 0 / Canal: 0 ✔" de
//     um mês vazio não volta;
//   * renomear divisão/opção chama o choke point com o id, e `onChanged`
//     dispara (é ele que faz o ⋮ do dashboard mostrar o que foi criado).
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/app/(app)/registros/base-manual/actions", () => ({
  deleteManualEntry: vi.fn(async () => ({ ok: true })),
  deleteManualFamily: vi.fn(async () => ({ ok: true })),
  deleteManualFamilyMember: vi.fn(async () => ({ ok: true })),
  deleteManualSeries: vi.fn(async () => ({ ok: true })),
  reorderManualItems: vi.fn(async () => ({ ok: true })),
  saveManualEntry: vi.fn(async () => ({ ok: true, id: "new" })),
  saveManualFamily: vi.fn(async () => ({ ok: true, id: "f1" })),
  saveManualFamilyMember: vi.fn(async () => ({ ok: true, id: "m1" })),
  saveManualSeries: vi.fn(async () => ({ ok: true, id: "s1" })),
  setManualSeriesFamilies: vi.fn(async () => ({ ok: true })),
}));

import {
  reorderManualItems,
  saveManualFamily,
  saveManualFamilyMember,
  saveManualSeries,
} from "@/app/(app)/registros/base-manual/actions";
import type { ManualEntry } from "@/lib/manual-base/types";

import { ManualBaseManager } from "./manual-base-manager";

const SERIES = [
  { id: "s1", key: "reunioes", label: "Reuniões", default_spread: "ancora" as const, sort_order: 0 },
  { id: "s2", key: "ligacoes", label: "Ligações", default_spread: "ancora" as const, sort_order: 1 },
];
const FAMILIES = [{ id: "f1", key: "canal", label: "Canal", sort_order: 0 }];
const MEMBERS = [
  { id: "m1", family_id: "f1", key: "ligacao", label: "Ligação", sort_order: 0 },
  { id: "m2", family_id: "f1", key: "email", label: "E-mail", sort_order: 1 },
];

let n = 0;
const entry = (over: Partial<ManualEntry>): ManualEntry => ({
  id: `e${++n}`,
  series_id: "s1",
  period_start: "2026-08-01",
  period_end: "2026-08-31",
  value: 10,
  responsible_id: null,
  operation_id: null,
  spread: "ancora",
  note: null,
  coords: {},
  ...over,
});

function renderManager(over: Partial<React.ComponentProps<typeof ManualBaseManager>> = {}) {
  return render(
    <ManualBaseManager
      series={SERIES}
      entries={[]}
      responsibles={[]}
      operations={[]}
      families={FAMILIES}
      members={MEMBERS}
      declarations={{ s1: ["canal"] }}
      canEdit
      initialMonth="2026-08"
      {...over}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ManualBaseManager v2", () => {
  it("abre em Lançamentos e alterna entre as abas", async () => {
    renderManager();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Lançamentos", "Métricas2", "Divisões1"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    await userEvent.click(tabs[2]);
    expect(screen.getByDisplayValue("Canal")).toBeInTheDocument();
    expect(screen.getByText("Divisões do sistema")).toBeInTheDocument();
  });

  it("não expõe as referências internas na tela", async () => {
    renderManager();
    await userEvent.click(screen.getByRole("tab", { name: /Métricas/ }));
    expect(screen.queryByText(/manual:/)).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: /Divisões/ }));
    expect(screen.queryByText(/manualdim:/)).toBeNull();
  });

  it("o navegador de mês filtra a grade", async () => {
    renderManager({
      entries: [
        entry({ value: 111 }),
        entry({ value: 222, period_start: "2026-09-01", period_end: "2026-09-30" }),
      ],
    });
    expect(screen.getByDisplayValue("111")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("222")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Próximo mês" }));
    expect(screen.getByDisplayValue("222")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("111")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Todos os meses" }));
    expect(screen.getByDisplayValue("111")).toBeInTheDocument();
    expect(screen.getByDisplayValue("222")).toBeInTheDocument();
  });

  it("mês sem lançamento não mostra conferência (nada de 'Total: 0 / Canal: 0 ✔')", () => {
    renderManager({
      initialMonth: "2026-10",
      entries: [entry({ value: 1000 }), entry({ value: 1000, coords: { canal: "ligacao" } })],
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/Nada lançado em Outubro\/2026/)).toBeInTheDocument();
  });

  it("divisão que não fecha com o total vira aviso do mês", () => {
    renderManager({
      entries: [entry({ value: 1000 }), entry({ value: 800, coords: { canal: "ligacao" } })],
    });
    const status = screen.getByRole("status");
    expect(within(status).getByText(/faltam 200/)).toBeInTheDocument();
  });

  it("colunas de Responsável/Operação só aparecem com atribuição solta", () => {
    renderManager({ entries: [entry({})] });
    expect(screen.queryByRole("columnheader", { name: "Responsável" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Operação" })).toBeNull();
  });

  it("renomear divisão e opção passa pelo choke point e avisa o host", async () => {
    const onChanged = vi.fn();
    renderManager({ onChanged });
    await userEvent.click(screen.getByRole("tab", { name: /Divisões/ }));

    const fam = screen.getByLabelText("Nome da divisão Canal");
    await userEvent.clear(fam);
    await userEvent.type(fam, "Canal de contato{Enter}");
    expect(saveManualFamily).toHaveBeenCalledWith(
      { id: "f1", label: "Canal de contato" },
      { revalidate: false }
    );

    const opt = screen.getByLabelText("Nome da opção E-mail");
    await userEvent.clear(opt);
    await userEvent.type(opt, "Email{Enter}");
    expect(saveManualFamilyMember).toHaveBeenCalledWith(
      { id: "m2", familyId: "f1", label: "Email" },
      { revalidate: false }
    );
    await act(async () => {});
    expect(onChanged).toHaveBeenCalled();
  });

  it("criar opção aparece na hora (otimista)", async () => {
    renderManager();
    await userEvent.click(screen.getByRole("tab", { name: /Divisões/ }));
    await userEvent.type(screen.getByLabelText("Nova opção em Canal"), "WhatsApp{Enter}");
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(saveManualFamilyMember).toHaveBeenCalledWith(
      { familyId: "f1", label: "WhatsApp", sortOrder: 2 },
      { revalidate: false }
    );
  });

  it("reordenar opção grava a ordem completa", async () => {
    renderManager();
    await userEvent.click(screen.getByRole("tab", { name: /Divisões/ }));
    await userEvent.click(screen.getByRole("button", { name: "Subir E-mail" }));
    expect(reorderManualItems).toHaveBeenCalledWith("members", ["m2", "m1"], {
      revalidate: false,
    });
  });

  it("renomear métrica não envia a contagem padrão (não a reseta)", async () => {
    renderManager();
    await userEvent.click(screen.getByRole("tab", { name: /Métricas/ }));
    const input = screen.getByLabelText("Nome de Ligações");
    await userEvent.clear(input);
    await userEvent.type(input, "Ligações feitas");
    fireEvent.blur(input);
    expect(saveManualSeries).toHaveBeenCalledWith(
      { id: "s2", label: "Ligações feitas", defaultSpread: undefined },
      { revalidate: false }
    );
  });

  it("compact mostra só os lançamentos e o atalho de gestão", () => {
    renderManager({ compact: true });
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByRole("link", { name: "Gerenciar métricas e divisões" })).toHaveAttribute(
      "href",
      "/registros/base-manual"
    );
  });
});

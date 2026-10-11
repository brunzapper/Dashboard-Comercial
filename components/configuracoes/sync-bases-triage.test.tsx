// @vitest-environment jsdom
// Versão: 1.0 | Data: 11/10/2026
// Triagem de novas Bases de Sync (0155): os processos aparecem pelo NOME,
// "Avaliar" mostra a amostra com os campos escolhidos, desmarcar um campo o
// tira da amostra sem outra ida ao servidor, e a aprovação salva o rascunho
// ANTES de aprovar (a action aprova o que está gravado).
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/registros/bases/sync/actions", () => ({
  listSpaCandidates: vi.fn(),
  loadSpaPreview: vi.fn(),
  requestSpaSource: vi.fn(),
  saveSpaRequest: vi.fn(),
  approveSpaRequest: vi.fn(),
  rejectSpaRequest: vi.fn(),
}));

import {
  approveSpaRequest,
  listSpaCandidates,
  loadSpaPreview,
  saveSpaRequest,
} from "@/app/(app)/registros/bases/sync/actions";
import { defaultSpaRequestConfig } from "@/lib/sync/bitrix/spa-config";
import { SyncBasesTriage } from "./sync-bases-triage";

const FIELDS = [
  { id: "ufCrm5_1", title: "Plano", type: "enumeration", readOnly: false, technical: false },
  { id: "ufCrm5_2", title: "Observação", type: "string", readOnly: false, technical: false },
];
const SUGGESTED = defaultSpaRequestConfig(
  { title: "Onboarding" },
  FIELDS.map((f) => ({ id: f.id, title: f.title, type: f.type }))
);

beforeEach(() => {
  vi.mocked(listSpaCandidates).mockResolvedValue({
    ok: true,
    data: {
      candidates: [
        {
          entityTypeId: 1036,
          title: "Onboarding",
          total: 42,
          status: "pending",
          requestId: "req1",
          sourceKey: null,
        },
      ],
      requests: [
        {
          id: "req1",
          entityTypeId: 1036,
          title: "Onboarding",
          status: "pending",
          config: SUGGESTED,
          note: null,
          sourceKey: null,
          createdAt: "2026-10-11T00:00:00Z",
          decidedAt: null,
        },
      ],
    },
  });
  vi.mocked(loadSpaPreview).mockResolvedValue({
    ok: true,
    data: {
      suggested: SUGGESTED,
      preview: {
        entityTypeId: 1036,
        fields: FIELDS,
        categories: [{ id: "8", name: "Implantação" }],
        stages: ["Novo", "Concluído"],
        total: 42,
        rows: [
          {
            id: "5",
            title: "Cliente X",
            stage: "Novo",
            pipeline: "Implantação",
            responsible: "Ana",
            value: "1.500",
            created: "2026-10-01 04:00",
            modified: "",
            closed: false,
            values: { ufCrm5_1: "Pro", ufCrm5_2: "ligar segunda" },
          },
        ],
        activities: [
          { id: "90", ownerId: "5", subject: "Kickoff", kind: "Reunião", deadline: "", completed: false },
        ],
      },
    },
  });
  vi.mocked(saveSpaRequest).mockImplementation(async (_id, cfg) => ({
    ok: true,
    data: { config: cfg as typeof SUGGESTED },
  }));
  vi.mocked(approveSpaRequest).mockResolvedValue({
    ok: true,
    data: { sourceKey: "onboarding", jobStarted: true },
  });
});

describe("SyncBasesTriage", () => {
  it("lista pelo nome, avalia a amostra e ajusta os campos na hora", async () => {
    const user = userEvent.setup();
    render(<SyncBasesTriage />);
    expect(await screen.findByText("Onboarding")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Avaliar" }));
    expect(await screen.findByText("Cliente X")).toBeTruthy();
    expect(screen.getByText("ligar segunda")).toBeTruthy();
    expect(screen.getByText("Kickoff")).toBeTruthy();

    // Desmarca "Observação": some da amostra sem nova chamada.
    await user.click(screen.getByRole("checkbox", { name: "Incluir Observação" }));
    expect(screen.queryByText("ligar segunda")).toBeNull();
    expect(loadSpaPreview).toHaveBeenCalledTimes(1);
  });

  it("aprovar salva o rascunho antes e avisa a Base criada", async () => {
    const user = userEvent.setup();
    render(<SyncBasesTriage />);
    await user.click(await screen.findByRole("button", { name: "Avaliar" }));
    await screen.findByText("Cliente X");

    await user.click(screen.getByRole("button", { name: /Aprovar e importar/ }));
    await waitFor(() => expect(approveSpaRequest).toHaveBeenCalledWith("req1"));
    const saveOrder = vi.mocked(saveSpaRequest).mock.invocationCallOrder[0];
    const approveOrder = vi.mocked(approveSpaRequest).mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(approveOrder);
    expect(await screen.findByText(/Base "onboarding" criada/)).toBeTruthy();
  });
});

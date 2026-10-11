// Versão: 1.0 | Data: 11/10/2026
// Write-back de PROCESSO INTELIGENTE (0155): o que muda é só a fronteira —
// coluna core aponta para o campo camelCase do crm.item, e a etapa vira CÓDIGO
// pela família do PRÓPRIO processo (rótulos se repetem entre processos).
import { describe, expect, it } from "vitest";

import { coreWriteBackFieldId } from "@/lib/config/core-writeback";

import type { BitrixClient } from "./client";
import { BitrixLookups } from "./lookups";
import { toBitrixValue, WriteBackFatal } from "./writeback";

describe("coreWriteBackFieldId", () => {
  it("lead/negócio byte-idênticos", () => {
    expect(coreWriteBackFieldId("title", "deal")).toBe("TITLE");
    expect(coreWriteBackFieldId("stage", "lead")).toBe("STATUS_ID");
  });

  it("processo inteligente usa os campos do crm.item", () => {
    expect(coreWriteBackFieldId("title", "dynamic_1036")).toBe("title");
    expect(coreWriteBackFieldId("stage", "dynamic_1036")).toBe("stageId");
    expect(coreWriteBackFieldId("value", "dynamic_1036")).toBe("opportunity");
    expect(coreWriteBackFieldId("responsible_id", "dynamic_1036")).toBe("assignedById");
    expect(coreWriteBackFieldId("mrr", "dynamic_1036")).toBeNull();
  });
});

describe("etapa do processo", () => {
  const l = BitrixLookups.hydrate({} as BitrixClient, undefined, {
    leadStatuses: {},
    dealStages: {},
    categories: {},
    dealEnums: {},
    leadEnums: {},
    spaStages: {
      "DT1036_8:NEW": "Novo",
      "DT1036_8:WIN": "Ganho",
      "DT1040_9:NEW": "Novo",
    },
  });

  it("rótulo → código restrito ao processo", () => {
    expect(l.spaStageCodes(1036)).toEqual({ Novo: "DT1036_8:NEW", Ganho: "DT1036_8:WIN" });
    expect(l.spaStageCodes(1040)).toEqual({ Novo: "DT1040_9:NEW" });
  });

  it("toBitrixValue manda o código da etapa", () => {
    const meta = {
      fieldId: "stageId",
      title: "Etapa",
      type: "crm_status",
      isMultiple: false,
      isReadOnly: false,
    };
    const codes = { spaStages: l.spaStageCodes(1036) };
    expect(toBitrixValue(meta, "Ganho", codes)).toBe("DT1036_8:WIN");
    expect(toBitrixValue(meta, "DT1036_8:NEW", codes)).toBe("DT1036_8:NEW");
    expect(() => toBitrixValue(meta, "Inexistente", codes)).toThrow(WriteBackFatal);
  });
});

// Versão: 1.0 | Data: 19/11/2026
import { describe, expect, it } from "vitest";

import { distinctFieldKey } from "@/lib/records/slug";
import { collisionPending, csvCollision } from "./csv-collision";

const FIELDS = [
  { key: "status", label: "Status", appliesTo: ["meetime"] },
  { key: "global", label: "Global", appliesTo: [] },
  { key: "plano", label: "Plano", appliesTo: ["eventos", "meetime"] },
];

describe("csvCollision", () => {
  it("campo novo com nome de campo de OUTRA Base colide", () => {
    const c = csvCollision(
      { target: "new", newLabel: "Status" },
      FIELDS,
      "eventos",
      "eventos"
    );
    expect(c?.field.key).toBe("status");
    expect(c?.distinctKey).toBe("status_eventos");
  });

  it("destino sugerido de outra Base também colide", () => {
    expect(
      csvCollision({ target: "custom:status", newLabel: "" }, FIELDS, "eventos", "eventos")
    ).not.toBeNull();
  });

  it("campo da própria Base ou 'de todas' não colide", () => {
    expect(
      csvCollision({ target: "new", newLabel: "Plano" }, FIELDS, "eventos", "eventos")
    ).toBeNull();
    expect(
      csvCollision({ target: "new", newLabel: "Global" }, FIELDS, "eventos", "eventos")
    ).toBeNull();
    expect(
      csvCollision({ target: "new", newLabel: "Inédito" }, FIELDS, "eventos", "eventos")
    ).toBeNull();
  });

  it("pendente até responder", () => {
    const plan = { target: "new", newLabel: "Status" };
    const c = csvCollision(plan, FIELDS, "eventos", "eventos");
    expect(collisionPending(plan, c)).toBe(true);
    expect(collisionPending({ ...plan, distinct: true }, c)).toBe(false);
    expect(collisionPending({ target: "custom:status", newLabel: "", same: true }, c)).toBe(false);
  });
});

describe("distinctFieldKey", () => {
  it("sufixa a Base e respeita 60 chars", () => {
    expect(distinctFieldKey("status", "eventos")).toBe("status_eventos");
    expect(distinctFieldKey("status_eventos", "eventos")).toBe("status_eventos");
    expect(distinctFieldKey("x".repeat(60), "meetime").length).toBe(60);
  });
});

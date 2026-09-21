import { describe, expect, it } from "vitest";
import { sortHubItems } from "./hub-sort";
import { HUB_SORT_OPTIONS, normalizeUiPrefs, resolveUiPrefs } from "./ui-prefs";

const rows = [
  { id: "a", created_at: "2026-01-01", updated_at: "2026-03-01", last_opened_at: "2026-02-01" },
  { id: "b", created_at: "2026-02-01", updated_at: "2026-01-01", last_opened_at: "2026-03-01" },
  { id: "c", created_at: "2026-03-01", updated_at: "2026-02-01", last_opened_at: null },
];
describe("ordenação do workspace", () => {
  it.each([
    ["created_desc", ["c", "b", "a"]], ["created_asc", ["a", "b", "c"]],
    ["updated_desc", ["a", "c", "b"]], ["updated_asc", ["b", "c", "a"]],
    ["opened_desc", ["b", "a", "c"]], ["opened_asc", ["a", "b", "c"]],
  ] as const)("%s", (sort, expected) => {
    expect(sortHubItems(rows, sort).map((row) => row.id)).toEqual(expected);
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });
  it("mantém empates estáveis e datas ausentes/inválidas no fim", () => {
    expect(sortHubItems([
      { id: "bad", created_at: "bad" }, { id: "a", created_at: "2026-01-01" },
      { id: "b", created_at: "2026-01-01" }, { id: "none" },
    ], "created_desc").map((row) => row.id)).toEqual(["a", "b", "bad", "none"]);
  });
  it("normaliza e respeita as travas das novas preferências", () => {
    for (const { value } of HUB_SORT_OPTIONS) {
      expect(normalizeUiPrefs({ hubSort: value, hubLayout: "preview" })).toEqual({ hubSort: value, hubLayout: "preview" });
    }
    expect(normalizeUiPrefs({ hubSort: "bad", operacaoLayout: "preview" })).toEqual({});
    expect(resolveUiPrefs({ hubSort: "opened_desc" }, {
      values: { hubSort: "created_asc" }, locked: new Set(["hubSort"]), operacaoDescriptions: {},
    }).values.hubSort).toBe("created_asc");
  });
});

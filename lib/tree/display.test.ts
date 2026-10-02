// Versão: 1.0 | Data: 02/10/2026
// Exibição dos cartões da Tree (lib/tree/display.ts).
import { describe, expect, it } from "vitest";

import { parseNodeDisplay, parsePresentationSettings, treeChrome } from "./display";

describe("treeChrome", () => {
  it("fora da apresentação mostra tudo", () => {
    expect(treeChrome({}, { kindBadge: "hide" }, false)).toEqual({
      kindBadge: true,
      addBranch: true,
      ritualSchedule: true,
      doneToggle: true,
      warnings: true,
    });
  });
  it("apresentando, por padrão esconde tipo, +, agendar, concluir e avisos", () => {
    expect(treeChrome(undefined, null, true)).toEqual({
      kindBadge: false,
      addBranch: false,
      ritualSchedule: false,
      doneToggle: false,
      warnings: false,
    });
  });
  it("o widget liga de volta; o cartão força o rótulo de tipo", () => {
    const w = { kindBadge: true, ritualSchedule: true };
    expect(treeChrome(w, null, true).kindBadge).toBe(true);
    expect(treeChrome(w, { kindBadge: "hide" }, true).kindBadge).toBe(false);
    expect(treeChrome({}, { kindBadge: "show" }, true).kindBadge).toBe(true);
    expect(treeChrome(w, null, true).ritualSchedule).toBe(true);
    expect(treeChrome(w, null, true).addBranch).toBe(false);
  });
});

describe("parse", () => {
  it("display: só chaves conhecidas; 'padrao' é ausência", () => {
    expect(parseNodeDisplay({ kindBadge: "show", tone: "verde", x: 1 })).toEqual({
      kindBadge: "show",
      tone: "verde",
    });
    expect(parseNodeDisplay({ tone: "padrao" })).toBeNull();
    expect(parseNodeDisplay("x")).toBeNull();
  });
  it("presentation: só booleanos verdadeiros", () => {
    expect(parsePresentationSettings({ kindBadge: true, addBranch: "sim", warnings: false })).toEqual({
      kindBadge: true,
    });
  });
});

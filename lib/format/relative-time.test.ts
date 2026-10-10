// Versão: 1.0 | Data: 10/10/2026
// v1.0 (10/10/2026): rótulos de tempo relativo e iniciais da lista densa.
import { describe, expect, it } from "vitest";

import { nameInitials, relativeTimeLabel } from "./relative-time";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("relativeTimeLabel", () => {
  it("ausente ou inválido ⇒ —", () => {
    expect(relativeTimeLabel(null, NOW)).toBe("—");
    expect(relativeTimeLabel("lixo", NOW)).toBe("—");
  });
  it("escala", () => {
    expect(relativeTimeLabel(ago(10_000), NOW)).toBe("agora");
    expect(relativeTimeLabel(ago(2 * 60_000), NOW)).toBe("há 2 min");
    expect(relativeTimeLabel(ago(3 * 3_600_000), NOW)).toBe("há 3 h");
    expect(relativeTimeLabel(ago(26 * 3_600_000), NOW)).toBe("ontem");
    expect(relativeTimeLabel(ago(4 * 86_400_000), NOW)).toBe("há 4 d");
    expect(relativeTimeLabel(ago(15 * 86_400_000), NOW)).toBe("há 2 sem");
    expect(relativeTimeLabel(ago(35 * 86_400_000), NOW)).toBe("há 1 mês");
    expect(relativeTimeLabel(ago(800 * 86_400_000), NOW)).toBe("há 2 anos");
  });
  it("data futura não vira negativo", () => {
    expect(relativeTimeLabel(ago(-60_000), NOW)).toBe("agora");
  });
});

describe("nameInitials", () => {
  it("primeira e última palavra", () => {
    expect(nameInitials("Paula Costa")).toBe("PC");
    expect(nameInitials("Ana Maria Souza")).toBe("AS");
    expect(nameInitials("Júlio")).toBe("JÚ");
    expect(nameInitials("")).toBe("?");
  });
});

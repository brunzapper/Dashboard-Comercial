// Versão: 1.0 | Data: 07/08/2026
// Helpers puros da Lixeira de registros (0121): janela de 30 dias e rótulo de
// expiração (defesa em profundidade da página — vencidos somem mesmo sem o
// cron de purga instalado).
import { describe, expect, it } from "vitest";

import {
  RECORDS_TRASH_TTL_DAYS,
  RECORDS_TRASH_TTL_MS,
  recordsTrashExpiryLabel,
  withinRecordsTrashTtl,
} from "@/lib/records/trash";

const NOW = Date.parse("2026-08-07T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("withinRecordsTrashTtl", () => {
  it("dentro da janela de 30 dias", () => {
    expect(withinRecordsTrashTtl(daysAgo(0), NOW)).toBe(true);
    expect(withinRecordsTrashTtl(daysAgo(29), NOW)).toBe(true);
  });

  it("fora da janela (>= 30 dias) e null (epoch) ficam de fora", () => {
    expect(withinRecordsTrashTtl(daysAgo(30), NOW)).toBe(false);
    expect(withinRecordsTrashTtl(daysAgo(31), NOW)).toBe(false);
    expect(withinRecordsTrashTtl(null, NOW)).toBe(false);
  });

  it("TTL exportado é 30 dias", () => {
    expect(RECORDS_TRASH_TTL_DAYS).toBe(30);
    expect(RECORDS_TRASH_TTL_MS).toBe(30 * 86_400_000);
  });
});

describe("recordsTrashExpiryLabel", () => {
  it("recém-excluído = 30 dias; singular no penúltimo dia", () => {
    expect(recordsTrashExpiryLabel(daysAgo(0), NOW)).toBe("Expira em 30 dias");
    // 29 dias atrás + 30 de TTL = resta 1 dia.
    expect(recordsTrashExpiryLabel(daysAgo(29), NOW)).toBe("Expira em 1 dia");
  });

  it("vencido/no limite = Expira hoje", () => {
    expect(recordsTrashExpiryLabel(daysAgo(30), NOW)).toBe("Expira hoje");
    expect(recordsTrashExpiryLabel(daysAgo(40), NOW)).toBe("Expira hoje");
  });

  it("frações arredondam para cima (meio dia restante = 1 dia)", () => {
    const halfDayLeft = new Date(
      NOW - (RECORDS_TRASH_TTL_MS - 43_200_000)
    ).toISOString();
    expect(recordsTrashExpiryLabel(halfDayLeft, NOW)).toBe("Expira em 1 dia");
  });
});

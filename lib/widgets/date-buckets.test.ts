// Versão: 1.0 | Data: 03/08/2026
// Testes de rótulo de bucket (lib/widgets/date-buckets.ts) com a âncora de
// semana (WeekStart, "Semana Fechada"): o dono do mês é o mês do 4º dia da
// semana (quinta p/ segunda, terça p/ sábado — mesma aritmética +3d) e o
// week_year numera pela semana ISO do 4º dia.
import { describe, expect, it } from "vitest";

import { formatBucketLabel } from "./date-buckets";

describe("formatBucketLabel com âncora de sábado", () => {
  it("week_month full: dono = mês da terça (4º dia)", () => {
    // Semana 04/07–10/07: terça 07/07 → 1ª semana de julho.
    expect(formatBucketLabel("week_month", "2026-07-04", "full", "saturday")).toBe(
      "1ª semana de Julho"
    );
    // Semana 27/06–03/07: terça 30/06 → 5ª semana de JUNHO (não julho).
    expect(formatBucketLabel("week_month", "2026-06-27", "full", "saturday")).toBe(
      "5ª semana de Junho"
    );
  });

  it("week_year: semana ISO do 4º dia", () => {
    // Bucket sábado 27/06 → terça 30/06 → semana ISO 27 (a mesma da segunda
    // 29/06 no modo histórico).
    expect(formatBucketLabel("week_year", "2026-06-27", "full", "saturday")).toBe(
      formatBucketLabel("week_year", "2026-06-29", "full")
    );
  });

  it("âncora default (monday) segue byte-idêntica ao histórico", () => {
    expect(formatBucketLabel("week_month", "2026-06-29", "full")).toBe(
      formatBucketLabel("week_month", "2026-06-29", "full", "monday")
    );
    expect(formatBucketLabel("week_month", "2026-06-29", "full")).toBe(
      "1ª semana de Julho"
    );
  });
});

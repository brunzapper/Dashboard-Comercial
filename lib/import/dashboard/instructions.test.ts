// Versão: 1.0 | Data: 25/07/2026
// Guarda de paridade do prompt de importação por IA (mesmo espírito de
// tests/rpc-parity.test.ts): o SPEC é DERIVADO do código (instructions.ts +
// settings-docs.ts), e este teste garante que a derivação chega inteira ao
// texto final — enums presentes, dicionários renderizados linha a linha, sem
// transforms legados, e o EXEMPLO do SPEC aceito pelo validador real. A
// exaustividade dos dicionários em si é garantida pelo typecheck (`satisfies`
// em settings-docs.ts); aqui fica o que o typecheck não vê. Também confere as
// CONTAGENS das enumerações do manual (§16.2) — o drift mais comum quando
// nasce um widget/função/paleta sem tocar o doc.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildImportPromptText,
  SPEC_EXAMPLE,
} from "@/lib/import/dashboard/instructions";
import {
  APPEARANCE_DOC,
  APPEARANCE_TABLE_DOC,
  DASHBOARD_SETTINGS_DOC,
  FORMULA_FUNC_GROUPS,
  WIDGET_SETTINGS_DOC,
} from "@/lib/import/dashboard/settings-docs";
import type { DashboardImportContext } from "@/lib/import/dashboard/types";
import { validateDashboardImport } from "@/lib/import/dashboard/validate";
import { BUILTIN_GOAL_METRICS } from "@/lib/metas/metrics";
import { DATA_TYPE_LABELS } from "@/lib/records/types";
import { BUILTIN_SOURCES } from "@/lib/sources";
import { DATE_TRANSFORMS } from "@/lib/widgets/fields";
import { FILTER_OPS } from "@/lib/widgets/filter-ops";
import { PALETTES } from "@/lib/widgets/palettes";
import {
  DATE_TOKENS,
  PERIOD_ALL,
  PERIOD_PRESETS,
} from "@/lib/widgets/period";
import {
  AGG_LABELS,
  COMPARISON_BASE_LABELS,
  COMPARISON_WINDOW_LABELS,
  DATE_AGG_LABELS,
  PERIOD_WINDOW_LABELS,
  VISUAL_TYPE_LABELS,
} from "@/lib/widgets/types";

const prompt = buildImportPromptText({
  basesLabel: "Teste",
  baseModelJson: "{}",
  sampleJson: "[]",
  sampleNote: "",
});

// Linhas do prompt sem indentação — os dicionários são renderizados com indent
// variável (aninhamento appearance/table), então a comparação é por linha
// TRIMADA, insensível a indentação.
const promptLines = new Set(
  prompt
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
);

function expectDocRendered(
  name: string,
  doc: Record<string, string | null>
): void {
  for (const [key, value] of Object.entries(doc)) {
    if (value == null) continue;
    for (const line of value.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      expect(
        promptLines.has(t),
        `${name}.${key}: linha ausente do prompt → ${t}`
      ).toBe(true);
    }
  }
}

describe("prompt de importação por IA — paridade com o código", () => {
  it("todos os enums de runtime aparecem no prompt", () => {
    const enums: Record<string, string[]> = {
      visual_type: Object.keys(VISUAL_TYPE_LABELS),
      agg: Object.keys(AGG_LABELS),
      filter_op: FILTER_OPS.map((o) => o.op),
      data_type: Object.keys(DATA_TYPE_LABELS),
      palette: Object.keys(PALETTES),
      date_token: [...DATE_TOKENS],
      transform: DATE_TRANSFORMS.filter((t) => t !== "none"),
      comparison_base: Object.keys(COMPARISON_BASE_LABELS),
      comparison_window: Object.keys(COMPARISON_WINDOW_LABELS),
      period_window: Object.keys(PERIOD_WINDOW_LABELS),
      formula_func: Object.keys(FORMULA_FUNC_GROUPS),
    };
    for (const [group, keys] of Object.entries(enums)) {
      for (const key of keys) {
        expect(
          prompt.includes(key),
          `${group}: chave "${key}" ausente do prompt`
        ).toBe(true);
      }
    }
    // Presets de período: a lista completa (com o sentinel "all") sai numa
    // linha só — presença conjunta evita falso positivo por substring.
    expect(prompt).toContain(
      [...Object.keys(PERIOD_PRESETS), PERIOD_ALL].join("|")
    );
  });

  it("transforms LEGADOS (day/week/month) ficam fora da lista derivada", () => {
    // O formato derivado é `chave (rótulo)`; um legado reintroduzido viraria
    // "day (dia)" etc. ("weekday (" não casa: \b exige fronteira de palavra).
    expect(prompt).not.toMatch(/\bday \(/);
    expect(prompt).not.toMatch(/\bweek \(/);
    expect(prompt).not.toMatch(/\bmonth \(/);
  });

  it("dicionários de settings renderizados por inteiro (nenhuma entrada engolida)", () => {
    expectDocRendered("WIDGET_SETTINGS_DOC", WIDGET_SETTINGS_DOC);
    expectDocRendered("APPEARANCE_DOC", APPEARANCE_DOC);
    expectDocRendered("APPEARANCE_TABLE_DOC", APPEARANCE_TABLE_DOC);
    expectDocRendered("DASHBOARD_SETTINGS_DOC", DASHBOARD_SETTINGS_DOC);
  });

  it("o exemplo do SPEC é aceito pelo validador real", () => {
    const ctx: DashboardImportContext = {
      sources: BUILTIN_SOURCES,
      defs: [],
      correspondenceKeys: [],
      responsibleNames: [],
      operationNames: [],
      goalMetrics: BUILTIN_GOAL_METRICS,
    };
    const res = validateDashboardImport(SPEC_EXAMPLE, ctx);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });
});

describe("manual de construção §16.2 — contagens das enumerações", () => {
  // Só as CONTAGENS `**Label (N)**` são conferidas (o texto segue humano).
  // Offsets explícitos documentam a diferença entre a lista de UI e o enum.
  const manual = readFileSync(
    path.join(process.cwd(), "docs/manual-de-construcao-de-dashboards.md"),
    "utf8"
  );
  const counts = new Map<string, number>();
  for (const m of manual.matchAll(/\*\*([^*]+?) \((\d+)\)\*\*/g)) {
    counts.set(m[1], Number(m[2]));
  }

  const expected: Record<string, number> = {
    "Tipos de widget": Object.keys(VISUAL_TYPE_LABELS).length,
    "Agregações de métrica": Object.keys(AGG_LABELS).length,
    'Agregações de "Agrupar período"': Object.keys(DATE_AGG_LABELS).length,
    "Operadores de filtro": FILTER_OPS.length,
    // presets (11) + "Todo o período" + "Personalizado" (opções da barra).
    Períodos: Object.keys(PERIOD_PRESETS).length + 2,
    // DATE_TRANSFORMS inclui "none" (a opção "—" da UI).
    "Formatos de data de dimensão": DATE_TRANSFORMS.length,
    "Bases de comparação": Object.keys(COMPARISON_BASE_LABELS).length,
    Janelas: Object.keys(COMPARISON_WINDOW_LABELS).length,
    "Janela de períodos do card": Object.keys(PERIOD_WINDOW_LABELS).length,
    "Funções de fórmula": Object.keys(FORMULA_FUNC_GROUPS).length,
  };

  for (const [label, n] of Object.entries(expected)) {
    it(`"${label}" = ${n}`, () => {
      expect(
        counts.has(label),
        `bullet "**${label} (N)**" não encontrado no §16.2 do manual`
      ).toBe(true);
      expect(counts.get(label), `contagem defasada de "${label}"`).toBe(n);
    });
  }
});

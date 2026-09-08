// Versão: 1.0 | Data: 07/09/2026
// Guarda do saneamento de settings.kanban/settings.agenda vindos de JSON
// (07/09/2026). Antes deles o validador tratava esses objetos como
// PASSTHROUGH: quadro nascia vazio quando o enum vinha errado e — o furo
// grave — um `allocationFieldKey` do JSON escrevia no campo-espelho do quadro
// de ORIGEM (invariante 24). Puro (sem banco): as dependências do validador
// entram por injeção.
import { describe, expect, it } from "vitest";

import {
  KANBAN_LOCAL_KEYS,
  KANBAN_MAX_EXTRA_FIELDS,
  sanitizeAgendaSettings,
  sanitizeKanbanSettings,
  type SanitizeDeps,
} from "./kanban-settings";
import { KANBAN_MAX_BADGES, KANBAN_MAX_COLUMNS } from "@/lib/kanban/types";

/** Deps sintéticas: `checkRef` aceita tudo menos refs marcados com "!". */
function deps(over: Partial<SanitizeDeps> = {}): SanitizeDeps & {
  warnings: string[];
} {
  const warnings: string[] = [];
  return {
    checkRef: (ref) => !ref.startsWith("!"),
    knownSources: new Set(["deals", "leads", "reuniao"]),
    rootSources: new Set(["deals", "leads"]),
    where: 'widgets[0] ("Quadro")',
    warnings,
    ...over,
  };
}

const base = { mode: "registros", source: "deals", groupField: "stage" };

describe("sanitizeKanbanSettings — vínculos locais do quadro", () => {
  it.each(KANBAN_LOCAL_KEYS)(
    "faz STRIP de %s com aviso (invariante 24)",
    (key) => {
      const d = deps();
      const out = sanitizeKanbanSettings({ ...base, [key]: "qualquer" }, d);
      expect(out).toBeDefined();
      expect(out).not.toHaveProperty(key);
      expect(d.warnings.join("\n")).toContain(key);
    }
  );

  it("preserva o resto da config ao remover o vínculo", () => {
    const out = sanitizeKanbanSettings(
      { ...base, allocationFieldKey: "fase_x", writeBack: true },
      deps()
    );
    expect(out).toMatchObject({
      mode: "registros",
      source: "deals",
      groupField: "stage",
      writeBack: true,
    });
  });
});

describe("sanitizeKanbanSettings — enums e refs", () => {
  it("cai em 'registros' quando o mode é inválido", () => {
    const d = deps();
    const out = sanitizeKanbanSettings({ ...base, mode: "quadro" }, d);
    expect(out?.mode).toBe("registros");
    expect(d.warnings.join("\n")).toContain("mode");
  });

  it("descarta dateBucket fora do enum e mantém o agrupamento por campo", () => {
    const d = deps();
    const out = sanitizeKanbanSettings({ ...base, dateBucket: "trimestre" }, d);
    expect(out).not.toHaveProperty("dateBucket");
    expect(out?.groupField).toBe("stage");
    expect(d.warnings.join("\n")).toContain("dateBucket");
  });

  it("descarta o quadro inteiro quando a Base não existe", () => {
    const d = deps();
    expect(
      sanitizeKanbanSettings({ ...base, source: "inexistente" }, d)
    ).toBeUndefined();
    expect(d.warnings.join("\n")).toContain("source");
  });

  it("descarta o quadro quando não há como derivar colunas", () => {
    expect(
      sanitizeKanbanSettings({ mode: "registros", source: "deals" }, deps())
    ).toBeUndefined();
  });

  it("exige dateField válido quando há dateBucket", () => {
    expect(
      sanitizeKanbanSettings(
        { mode: "registros", source: "deals", dateBucket: "month_year" },
        deps()
      )
    ).toBeUndefined();
    const out = sanitizeKanbanSettings(
      {
        mode: "registros",
        source: "deals",
        dateBucket: "month_year",
        dateField: "closed_at",
      },
      deps()
    );
    expect(out).toMatchObject({ dateBucket: "month_year", dateField: "closed_at" });
    // As duas formas de coluna são exclusivas: a de campo sai fora.
    expect(out).not.toHaveProperty("groupField");
  });

  it('"Personalizar" dispensa campo e limpa os refs de agrupamento', () => {
    const out = sanitizeKanbanSettings(
      {
        mode: "registros",
        source: "deals",
        columnSource: "custom",
        groupField: "stage",
        columns: [{ key: "novo", label: "Novo" }],
      },
      deps()
    );
    expect(out).toMatchObject({ columnSource: "custom" });
    expect(out).not.toHaveProperty("groupField");
    expect(out?.columns).toHaveLength(1);
  });

  it("modo tarefas descarta as chaves de registro", () => {
    const out = sanitizeKanbanSettings(
      { mode: "tarefas", source: "deals", groupField: "stage", writeBack: true },
      deps()
    );
    expect(out).toEqual({ mode: "tarefas" });
  });
});

describe("sanitizeKanbanSettings — métricas, card e colunas", () => {
  it("aceita as 4 famílias de métrica e recusa kind desconhecido", () => {
    const d = deps();
    const out = sanitizeKanbanSettings(
      {
        ...base,
        columnMetric: { spec: { kind: "field", ref: "value" }, agg: "avg" },
        card: {
          titleField: "title",
          badges: [
            { kind: "linked", source: "leads" },
            { kind: "tasks", metric: "overdue" },
            { kind: "age" },
            { kind: "inventado" },
          ],
        },
      },
      d
    );
    expect(out?.columnMetric).toEqual({
      spec: { kind: "field", ref: "value" },
      agg: "avg",
    });
    expect(out?.card?.badges).toEqual([
      { kind: "linked", source: "leads" },
      { kind: "tasks", metric: "overdue" },
      { kind: "age" },
    ]);
    expect(d.warnings.join("\n")).toContain("badges[3].kind");
  });

  it("métrica 'linked' só aceita Base RAIZ", () => {
    const d = deps();
    const out = sanitizeKanbanSettings(
      { ...base, columnMetric: { spec: { kind: "linked", source: "reuniao" } } },
      d
    );
    expect(out).not.toHaveProperty("columnMetric");
    expect(d.warnings.join("\n")).toContain("Base raiz");
  });

  it("descarta agg fora do enum mas mantém a métrica", () => {
    const d = deps();
    const out = sanitizeKanbanSettings(
      {
        ...base,
        columnMetric: { spec: { kind: "age" }, agg: "mediana" },
      },
      d
    );
    expect(out?.columnMetric).toEqual({ spec: { kind: "age" } });
    expect(d.warnings.join("\n")).toContain("agg");
  });

  it("derruba refs inválidos do card sem perder o quadro", () => {
    const out = sanitizeKanbanSettings(
      {
        ...base,
        card: {
          titleField: "!morto",
          extraFields: ["value", "!morto", "mrr"],
          colorField: "!morto",
        },
      },
      deps()
    );
    expect(out?.card).toEqual({ extraFields: ["value", "mrr"] });
  });

  it("respeita os tetos de extraFields, badges e columns", () => {
    const d = deps();
    const out = sanitizeKanbanSettings(
      {
        ...base,
        card: {
          extraFields: Array.from({ length: 9 }, (_, i) => `f${i}`),
          badges: Array.from({ length: 6 }, () => ({ kind: "age" })),
        },
        columns: Array.from({ length: KANBAN_MAX_COLUMNS + 4 }, (_, i) => ({
          key: `c${i}`,
        })),
      },
      d
    );
    expect(out?.card?.extraFields).toHaveLength(KANBAN_MAX_EXTRA_FIELDS);
    expect(out?.card?.badges).toHaveLength(KANBAN_MAX_BADGES);
    expect(out?.columns).toHaveLength(KANBAN_MAX_COLUMNS);
    expect(d.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it("badges [] explícito sobrevive (é 'sem badges', não 'ausente')", () => {
    const out = sanitizeKanbanSettings(
      { ...base, card: { badges: [] } },
      deps()
    );
    expect(out?.card?.badges).toEqual([]);
  });

  it("remove coluna sem key e key repetida", () => {
    const d = deps();
    const out = sanitizeKanbanSettings(
      {
        ...base,
        columns: [{ key: "a" }, { label: "sem key" }, { key: "a", label: "dup" }],
      },
      d
    );
    expect(out?.columns).toEqual([{ key: "a" }]);
    expect(d.warnings).toHaveLength(2);
  });
});

describe("sanitizeAgendaSettings", () => {
  it("descarta a fonte quando não há campo de data", () => {
    const d = deps();
    const out = sanitizeAgendaSettings({ source: "deals" }, d);
    expect(out).not.toHaveProperty("source");
    expect(d.warnings.join("\n")).toContain("dateField");
  });

  it("mantém fonte + campo de data válidos", () => {
    expect(
      sanitizeAgendaSettings({ source: "deals", dateField: "closed_at" }, deps())
    ).toMatchObject({ source: "deals", dateField: "closed_at" });
  });

  it("descarta defaultView fora do enum", () => {
    const d = deps();
    const out = sanitizeAgendaSettings({ defaultView: "trimestre" }, d);
    expect(out).not.toHaveProperty("defaultView");
    expect(d.warnings.join("\n")).toContain("defaultView");
  });

  it("normaliza os toggles para booleano", () => {
    expect(
      sanitizeAgendaSettings({ showTasks: "sim", showNotes: false }, deps())
    ).toEqual({ showTasks: false, showNotes: false });
  });
});

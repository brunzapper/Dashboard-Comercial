// Versão: 1.0 | Data: 02/10/2026
// GUARDA "IA nunca desatualizada" da orquestração por tópicos.
//
//  1. Paridade por assistente: o prompt fatiado e remontado com TODOS os
//     tópicos é exatamente o prompt da IA externa (marcadores fora) — o
//     recorte nunca vira uma segunda redação.
//  2. Classificação: todo cabeçalho de nível 1–2 de cada prompt tem tópico
//     declarado ou está na lista de núcleo — seção nova não entra no prompt
//     sem alguém decidir se ela é sempre necessária ou escolhível.
//  3. Todo tópico escolhível existe no texto (catálogo não aponta seção morta).
//  4. Estática: TODA chamada a `runJsonGenerationLoop(` em lib/ai passa
//     `topics:` (molde de lib/series/noun.test.ts).
//  5. Dashboards: todo visual_type tem tópico de item; o bloco de settings é
//     particionado por tópico; `null` nos dicionários só com justificativa
//     ALLOWLISTADA aqui (foi o `tree: null` que deixou a IA cega para a Tree).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  AI_TOPIC_CATALOGS,
  COMMENT_ANALYSIS_TOPIC_CATALOG,
  COMP_TOPIC_CATALOG,
  CORE_HEADINGS,
  CSV_MAPPING_TOPIC_CATALOG,
  DASHBOARD_TOPIC_CATALOG,
  FIELDS_TOPIC_CATALOG,
  KANBAN_TOPIC_CATALOG,
  MANUAL_BASE_TOPIC_CATALOG,
  MAPPINGS_TOPIC_CATALOG,
  OPERATIONS_TOPIC_CATALOG,
  RECORDS_INSERT_TOPIC_CATALOG,
  RECORDS_UPDATE_TOPIC_CATALOG,
  TASKS_TOPIC_CATALOG,
  WORKFLOW_FORM_TOPIC_CATALOG,
} from "./catalogs";
import {
  normalizeForMatch,
  renderChunks,
  selectableTopics,
  splitPrompt,
  stripTopicMarkers,
  unmappedTopHeadings,
  type TopicCatalog,
} from "./split";
import { buildImportPromptText } from "@/lib/import/dashboard/instructions";
import { buildKanbanPromptText } from "@/lib/import/kanban/instructions";
import { buildCompPromptText } from "@/lib/import/comp/instructions";
import { buildFieldsPromptText } from "@/lib/import/fields/instructions";
import { buildManualBasePromptText } from "@/lib/import/manual-base/instructions";
import { buildTasksPromptText } from "@/lib/import/tasks/instructions";
import { buildCommentAnalysisPrompt } from "@/lib/import/tasks/analyze-instructions";
import { buildRecordsUpdatePromptText } from "@/lib/import/records/update-instructions";
import { buildRecordsPromptText } from "@/lib/import/records/instructions";
import { buildOperationsPromptText } from "@/lib/import/operations/instructions";
import { buildMappingsClassifyPromptText } from "@/lib/import/mappings/instructions";
import { buildCsvMappingPromptText } from "@/lib/import/csv-mapping/instructions";
import { buildFormFillPromptText } from "@/lib/import/workflow-form/instructions";
import {
  DASHBOARD_SETTINGS_DOC,
  WIDGET_SETTINGS_DOC,
} from "@/lib/import/dashboard/settings-docs";
import { VISUAL_TYPE_TOPICS, WIDGET_SETTINGS_TOPIC } from "@/lib/import/dashboard/topics";
import { VISUAL_TYPE_LABELS } from "@/lib/widgets/types";

const parts = { catalogJson: "{}" };
const recordsParts = {
  baseLabel: "Base (b)",
  todayIso: "2026-10-02",
  catalogJson: "{}",
  samplesJson: "[]",
  samplesNote: "",
};

const PROMPTS: [TopicCatalog, string][] = [
  [
    DASHBOARD_TOPIC_CATALOG,
    buildImportPromptText({
      basesLabel: "Teste",
      baseModelJson: "{}",
      manualModelJson: "{}",
      sampleJson: "[]",
      sampleNote: "",
    }),
  ],
  [KANBAN_TOPIC_CATALOG, buildKanbanPromptText(parts)],
  [COMP_TOPIC_CATALOG, buildCompPromptText(parts)],
  [FIELDS_TOPIC_CATALOG, buildFieldsPromptText({ catalogJson: "{}", operandsJson: "{}" })],
  [MANUAL_BASE_TOPIC_CATALOG, buildManualBasePromptText(parts)],
  [TASKS_TOPIC_CATALOG, buildTasksPromptText({ catalogJson: "{}", allowDelete: true, allowSeries: true })],
  [
    COMMENT_ANALYSIS_TOPIC_CATALOG,
    buildCommentAnalysisPrompt({
      comment: "ligar sexta",
      todayIso: "2026-10-02",
      record: { title: "ACME" },
      catalogJson: "{}",
      allowDelete: true,
      allowSeries: true,
    }),
  ],
  [RECORDS_UPDATE_TOPIC_CATALOG, buildRecordsUpdatePromptText(recordsParts)],
  [RECORDS_UPDATE_TOPIC_CATALOG, buildRecordsUpdatePromptText({ ...recordsParts, selectionCount: 3 }, "selection")],
  [RECORDS_INSERT_TOPIC_CATALOG, buildRecordsPromptText(recordsParts)],
  [OPERATIONS_TOPIC_CATALOG, buildOperationsPromptText(parts)],
  [
    MAPPINGS_TOPIC_CATALOG,
    buildMappingsClassifyPromptText({
      domainKey: "cargo",
      domainLabel: "Cargo",
      rawFieldLabel: "Cargo",
      targetsJson: "{}",
      pendingJson: "[]",
    }),
  ],
  [
    CSV_MAPPING_TOPIC_CATALOG,
    buildCsvMappingPromptText({ baseLabel: "B", columnsJson: "[]", customFieldsJson: "[]" }),
  ],
  [
    WORKFLOW_FORM_TOPIC_CATALOG,
    buildFormFillPromptText({ schemaLabel: "Lead", todayIso: "2026-10-02", catalogJson: "[]" }),
  ],
];

const coreNorm = CORE_HEADINGS.map(normalizeForMatch);
const isCoreHeading = (h: string) => coreNorm.some((c) => normalizeForMatch(h).startsWith(c));

describe("catálogos de tópicos — paridade por assistente", () => {
  it("todo assistente registrado tem prompt de teste", () => {
    const tested = new Set(PROMPTS.map(([c]) => c.domain));
    for (const c of AI_TOPIC_CATALOGS) expect(tested.has(c.domain), c.domain).toBe(true);
  });

  for (const [catalog, prompt] of PROMPTS) {
    describe(catalog.domain, () => {
      it("remontado com todos os tópicos = prompt da IA externa", () => {
        const chunks = splitPrompt(prompt, catalog);
        expect(renderChunks(chunks, "all")).toBe(stripTopicMarkers(prompt));
      });

      it("todo cabeçalho de nível 1–2 tem tópico ou é núcleo declarado", () => {
        const loose = unmappedTopHeadings(prompt, catalog).filter((h) => !isCoreHeading(h));
        expect(loose, `classifique em lib/ai/topics/catalogs.ts: ${loose.join(" | ")}`).toEqual([]);
      });

      it("todo tópico do catálogo existe no texto", () => {
        const chunks = splitPrompt(prompt, catalog);
        const present = new Set(selectableTopics(chunks, catalog).map((t) => t.key));
        for (const t of catalog.topics.filter((x) => !x.always)) {
          expect(present.has(t.key), `${catalog.domain}: tópico "${t.key}" sem seção`).toBe(true);
        }
      });

      it("keys únicas e resumo preenchido", () => {
        const keys = catalog.topics.map((t) => t.key);
        expect(new Set(keys).size).toBe(keys.length);
        for (const t of catalog.topics) expect(t.summary.length).toBeGreaterThan(10);
      });
    });
  }
});

describe("guarda estática — todo laço de geração passa o catálogo", () => {
  it("runJsonGenerationLoop( sempre com topics:", () => {
    const dir = path.join(process.cwd(), "lib", "ai");
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts") || f === "json-loop.ts") continue;
      const src = readFileSync(path.join(dir, f), "utf8");
      const re = /runJsonGenerationLoop(?:<[\s\S]*?>)?\(\{([\s\S]*?)\n\s{2}\}\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        if (!/\btopics:\s*[A-Z_]+_TOPIC_CATALOG\b/.test(m[1])) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("o laço próprio de dashboards roteia pelo catálogo dele", () => {
    const src = readFileSync(path.join(process.cwd(), "lib", "ai", "generate-dashboard.ts"), "utf8");
    expect(src).toContain("DASHBOARD_TOPIC_CATALOG");
    expect(src).toContain("routeTopics(");
    expect(src).toContain("stripTopicMarkers(");
  });
});

// `null` nos dicionários = "a IA não gera esta chave". Cada um tem de estar
// aqui, com o motivo — `null` novo QUEBRA este teste até alguém decidir.
const NULL_ALLOWLIST: Record<string, string> = {
  "widget.operationId": "exige UUID — prefira quickFilters",
  "widget.responsibleId": "exige UUID — prefira quickFilters",
  "widget.scope": "documentado na linha de metric",
  "widget.period": "documentado na linha de metric",
  "widget.denominator": "documentado na linha de numerator",
  "widget.conversionBasis": "moeda avançada do KPI — UI",
  "widget.currencyDisplay": "moeda avançada do KPI — UI",
  "widget.currencyMultiMode": "moeda avançada do KPI — UI",
  "widget.grandTotalMode": "moeda avançada do KPI — UI",
  "widget.kind": "implícito no visual_type filtro",
  "widget.targets": "legado do widget filtro",
  "widget.defaultDe": "prefira defaultPreset",
  "widget.defaultAte": "prefira defaultPreset",
  "widget.excludedTargets": "estado de UI",
  "widget.valueScope": "default por usuário serve",
  "widget.formula": "métrica calculada usa metrics[].formula_text",
  "widget.calcField": "via fields + metrics[].field",
  "widget.calculator": "variáveis tokenizadas pelo editor",
  "widget.quickTable": "estrutura da Tabela Livre montada na UI (metas via goalTable)",
  "widget.presetKey": "identidade — o servidor carimba",
  "widget.pages": "ids do banco — export remove",
  "widget.rowAction": "atributos da org desconhecidos da IA",
  "dashboard.kanban": "kanban dedicado — nunca no import",
  "dashboard.connectors": "linhas entre widgets — UI",
  "dashboard.preset": "identidade — o servidor",
  "dashboard.sourceScope": "recorte de Bases — config manual",
};

describe("dashboards — dicionários e tópicos", () => {
  it("`null` só com justificativa allowlistada", () => {
    const nulls = [
      ...Object.entries(WIDGET_SETTINGS_DOC)
        .filter(([, v]) => v == null)
        .map(([k]) => `widget.${k}`),
      ...Object.entries(DASHBOARD_SETTINGS_DOC)
        .filter(([, v]) => v == null)
        .map(([k]) => `dashboard.${k}`),
    ];
    const missing = nulls.filter((k) => !(k in NULL_ALLOWLIST));
    expect(missing, "chave fora do alcance da IA sem justificativa").toEqual([]);
    const stale = Object.keys(NULL_ALLOWLIST).filter((k) => !nulls.includes(k));
    expect(stale, "allowlist com chave que já é documentada — remova").toEqual([]);
  });

  it("`tree` é documentado e mora no tópico tree", () => {
    expect(WIDGET_SETTINGS_DOC.tree).toBeTruthy();
    expect(WIDGET_SETTINGS_TOPIC.tree).toBe("tree");
  });

  it("todo visual_type puxa ao menos um tópico existente", () => {
    const keys = new Set(DASHBOARD_TOPIC_CATALOG.topics.map((t) => t.key));
    for (const vt of Object.keys(VISUAL_TYPE_LABELS)) {
      const topics = VISUAL_TYPE_TOPICS[vt as keyof typeof VISUAL_TYPE_TOPICS];
      expect(topics?.length ?? 0, vt).toBeGreaterThan(0);
      for (const t of topics) expect(keys.has(t), `${vt} → ${t}`).toBe(true);
    }
  });

  it("recorte só da Tree leva os nós e deixa o kanban de fora", () => {
    const [, prompt] = PROMPTS[0];
    const chunks = splitPrompt(prompt, DASHBOARD_TOPIC_CATALOG);
    const out = renderChunks(chunks, new Set(["tree"]), DASHBOARD_TOPIC_CATALOG);
    expect(out).toContain('"mapas" — nós da Tree');
    expect(out).toContain('"tree": {');
    expect(out).not.toContain('"kanban": {');
    expect(out).toContain("## Envelope");
    expect(out).toContain("REGRAS SEMÂNTICAS");
    // Recorte de verdade: bem menor que o inteiro.
    expect(out.length).toBeLessThan(renderChunks(chunks, "all").length * 0.6);
  });
});

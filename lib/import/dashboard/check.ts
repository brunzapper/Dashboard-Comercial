// Versão: 1.1 | Data: 02/10/2026
// v1.1 (02/10/2026): (a) a prévia passou a ser HONESTA — widget cujo delta não
//   muda nada sai como "sem mudança" (antes todo widget de key existente era
//   "atualiza", e "8 atualizados" sem efeito virou a queixa); (b) a seção
//   `mapas` (nós da Tree) é validada aqui pelo MESMO módulo do apply
//   (tree-maps.ts) e entra no resumo.
// Versão: 1.0 | Data: 17/09/2026
// Normalizar + validar + resumir um JSON de dashboard, no contexto de um modo.
//
// Extraído de `generateDashboardCore` porque passou a ter DOIS consumidores: o
// laço de autocorreção da IA ao vivo e a conferência de um JSON COLADO de IA
// externa. Os dois precisam da mesma sequência — e sobretudo das injeções
// protetivas do `normalizeImportRaw`, que reescrevem a identidade no SERVIDOR:
// uma `chave` copiada da referência sobrescreveria o board de ORIGEM no modo
// "Criar a partir de". Repetir a sequência no caminho da colagem seria a régua
// paralela da invariante 25, com a diferença de que o erro dela só apareceria
// quando alguém colasse um JSON de outra origem.
//
// Módulo PURO (sem I/O, sem `server-only`): o núcleo da IA é server-only e não
// pode ser importado por um teste — mesma razão que separa
// `lib/ai/operacao/scopes.ts` de `handlers.ts`.
import { IMPORT_PRESET_PREFIX, type DashboardImportContext } from "./types";
import { normalizeImportRaw } from "./rewrite";
import { stripCodeFence, validateDashboardImport } from "./validate";
import type { ImportWidgetSpec } from "./types";
import {
  sameJson,
  treeMapKeysInJson,
  treeMapSummary,
  validateTreeMaps,
  type ImportMapSpec,
  type TreeMapPlanMap,
} from "./tree-maps";

/**
 * O que a checagem precisa do modo. É um subconjunto ESTRUTURAL do contexto de
 * modo do núcleo da IA — declarado estreito de propósito, para este módulo não
 * arrastar o resto (bases, regras, estado exportado) só para compilar.
 */
export interface DashboardCheckContext {
  chave: string;
  currentTabs?: { id: string; name: string; color?: string }[];
  currentRoles?: string[];
  avoidName?: string;
  baseWidgets?: ImportWidgetSpec[];
  refWidgets?: ImportWidgetSpec[];
  currentCanvas?: Record<string, unknown>;
  /** Keys de widget que já existem no board — decide "novo" × "atualiza". */
  existingKeys: ReadonlySet<string>;
  /** v1.1: mapas da Tree exportados do board (base do merge por nó). */
  baseMaps?: ImportMapSpec[];
  /** v1.1: mapas dos widgets Tree (modo livre) do board. */
  boardMapKeys?: string[];
}

export type DashboardCheckResult =
  | {
      ok: true;
      normalized: string;
      summary: string[];
      warnings: string[];
      /** v1.1: plano de escrita dos nós da Tree (vazio sem `mapas`). */
      treeMaps: TreeMapPlanMap[];
      /** v1.1: quantos itens a resposta de fato altera (widgets + nós). */
      changedCount: number;
    }
  | { ok: false; errors: string[] };

export function checkDashboardJson(
  raw: string,
  ctx: DashboardCheckContext,
  importCtx: DashboardImportContext
): DashboardCheckResult {
  // Identidade canônica + injeções protetivas + base do merge por widget
  // (só nos modos com estado) ANTES da validação.
  const normalized = normalizeImportRaw(raw, {
    chave: ctx.chave,
    currentTabs: ctx.currentTabs,
    currentRoles: ctx.currentRoles,
    avoidName: ctx.avoidName,
    baseWidgets: ctx.baseWidgets,
    refWidgets: ctx.refWidgets,
    currentCanvas: ctx.currentCanvas,
    baseMaps: ctx.baseMaps,
  });

  const validation = validateDashboardImport(normalized, importCtx);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(stripCodeFence(normalized));
  } catch {
    parsed = null;
  }
  const parsedObj =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const maps = validateTreeMaps(parsedObj.mapas, {
    existing: ctx.baseMaps ?? [],
    allowedMapKeys: new Set([
      ...(ctx.boardMapKeys ?? []),
      ...treeMapKeysInJson(parsedObj),
    ]),
  });
  if (!validation.ok || !validation.preset || maps.errors.length > 0) {
    return { ok: false, errors: [...validation.errors, ...maps.errors] };
  }
  // Resumo por widget (prévia e mensagem): novo × atualiza × sem mudança.
  const prefix = `${IMPORT_PRESET_PREFIX}${ctx.chave}.`;
  const baseByKey = new Map(
    (ctx.baseWidgets ?? []).map((w) => [w.key ?? "", w] as const)
  );
  const aiByKey = new Map<string, unknown>();
  for (const w of Array.isArray(parsedObj.widgets) ? parsedObj.widgets : []) {
    if (w && typeof w === "object" && typeof (w as { key?: unknown }).key === "string") {
      aiByKey.set((w as { key: string }).key, w);
    }
  }
  const unchanged: string[] = [];
  let changedCount = 0;
  const summary = validation.preset.widgets.map((w) => {
    const key = w.presetKey.startsWith(prefix)
      ? w.presetKey.slice(prefix.length)
      : w.presetKey;
    if (!ctx.existingKeys.has(key)) {
      changedCount += 1;
      return `novo: ${w.title}`;
    }
    const base = baseByKey.get(key);
    if (base && sameJson(aiByKey.get(key), base)) {
      unchanged.push(w.title);
      return `sem mudança: ${w.title}`;
    }
    changedCount += 1;
    return `atualiza: ${w.title}`;
  });
  summary.push(...treeMapSummary(maps.plan));
  for (const m of maps.plan) changedCount += m.updates.length + m.creates.length;
  const warnings = [...validation.warnings, ...maps.warnings];
  if (unchanged.length > 0) {
    warnings.push(
      `A resposta não altera nada em ${unchanged.length} widget(s) (${unchanged.join(", ")}) — se o pedido era mudar algo neles, ele pode estar fora do que o JSON alcança.`
    );
  }
  return {
    ok: true,
    normalized,
    summary,
    warnings,
    treeMaps: maps.plan,
    changedCount,
  };
}

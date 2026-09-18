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
import { validateDashboardImport } from "./validate";
import type { ImportWidgetSpec } from "./types";

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
}

export type DashboardCheckResult =
  | { ok: true; normalized: string; summary: string[]; warnings: string[] }
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
  });

  const validation = validateDashboardImport(normalized, importCtx);
  if (!validation.ok || !validation.preset) {
    return { ok: false, errors: validation.errors };
  }
  // Resumo por widget (prévia e mensagem): novo × atualiza.
  const prefix = `${IMPORT_PRESET_PREFIX}${ctx.chave}.`;
  const summary = validation.preset.widgets.map((w) => {
    const key = w.presetKey.startsWith(prefix)
      ? w.presetKey.slice(prefix.length)
      : w.presetKey;
    return `${ctx.existingKeys.has(key) ? "atualiza" : "novo"}: ${w.title}`;
  });
  return { ok: true, normalized, summary, warnings: validation.warnings };
}

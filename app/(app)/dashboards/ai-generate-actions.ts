// Versão: 2.1 | Data: 24/07/2026
// v2.1 (24/07/2026): a IA passa a LER melhor o estado — `baseWidgets` (merge
//   por widget) também no modo "from"; `copy_of` nas regras dos modos from/edit
//   (cópia por delta, resolvida no servidor em normalizeImportRaw); e a prévia
//   pendente não aplicada (input.pendingJson) entra no system como seção
//   própria (a resposta do turno substitui a prévia inteira).
// v2.0 (23/07/2026): CONVERSA multi-turno + 3 modos — "new" (criar do zero),
//   "from" (criar a partir de um dashboard existente) e "edit" (editar
//   in-place). Desenho:
//   - STATELESS por turno: a cada turno o servidor RE-EXPORTA o estado atual
//     do board (modos from/edit) para o system e envia só os turnos de USUÁRIO
//     anteriores (cap 10) — nada de acumular JSONs de assistant no histórico.
//     Após o 1º apply em new/from, o CLIENTE troca a sessão para mode:'edit' +
//     targetDashboardId (new/from só existem no 1º turno).
//   - IDENTIDADE FORÇADA NO SERVIDOR: normalizeImportRaw sobrescreve a `chave`
//     do JSON da IA pela canônica (edit: derivada do board; new/from: gerada
//     aqui) ANTES da validação — a IA nunca é confiada com identidade (uma
//     chave trocada poderia sobrescrever o board de ORIGEM no modo from).
//   - Aplicação: edit → applyDashboardEditJson (adoção + apply com
//     targetDashboardId, SEM GC — widget omitido permanece; snapshot p/
//     Desfazer); new/from → importDashboardJson (gates por seção intactos).
//   - Toggle "Aplicar automaticamente": OFF ⇒ o turno para após a validação e
//     devolve pendingJson + resumo; o Aplicar chama applyGeneratedDashboard
//     (re-valida/re-gates/re-deriva identidade — nada confiado do cliente).
//   - Truncamento (AiTruncatedError) aborta o laço na hora, com mensagem
//     acionável — JSON cortado nunca valida e queimaria as tentativas.
// v1.0 (23/07/2026): geração one-shot com laço de autocorreção.
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import { loadOrgAiConfig } from "@/lib/ai/config";
import { getAiClient, AiTruncatedError, type AiMessage } from "@/lib/ai";
import { buildImportPrompt } from "@/app/(app)/dashboards/import-prompt-actions";
import { loadImportContext } from "@/lib/import/dashboard/context";
import { validateDashboardImport } from "@/lib/import/dashboard/validate";
import { normalizeImportRaw } from "@/lib/import/dashboard/rewrite";
import {
  exportDashboardJson,
  type ExportDashRow,
  type ExportWidgetRow,
} from "@/lib/import/dashboard/export";
import {
  IMPORT_PRESET_PREFIX,
  type ImportWidgetSpec,
} from "@/lib/import/dashboard/types";
import type { DashboardSettings } from "@/lib/widgets/types";
import type { DashboardSnapshot } from "@/lib/widgets/history";
import {
  applyDashboardEditJson,
  importDashboardJson,
  duplicateBoard,
  type ImportDashboardState,
  type EditDashboardState,
} from "@/app/(app)/dashboards/actions";

export type AiDashboardMode = "new" | "from" | "edit";

export interface GenerateDashboardInput {
  mode: AiDashboardMode;
  /** Modo new: Bases marcadas (obrigatório). */
  bases?: string[];
  /** Modo from: board de REFERÊNCIA; modo edit: board ALVO. */
  targetDashboardId?: string;
  /** Pedido deste turno. */
  description: string;
  /** Turnos de usuário anteriores da sessão (stateless; cap 10). */
  priorTurns?: string[];
  /** Switch "Aplicar automaticamente" da janela da sessão. */
  autoApply?: boolean;
  /** Prévia do turno anterior AINDA não aplicada (auto-aplicar OFF): entra no
   * system para a IA enxergar o que ela mesma propôs — a resposta do turno
   * SUBSTITUI a prévia inteira, então ela precisa re-incluir o que continuar
   * desejado. */
  pendingJson?: string;
}

export interface GenerateDashboardState extends ImportDashboardState {
  // Último JSON bruto quando o laço falha — vai para o campo de import manual.
  draftJson?: string;
  // Toggle OFF: JSON validado (já com identidade canônica) aguardando Aplicar.
  pendingJson?: string;
  // Resumo por widget da prévia ("novo: X" / "atualiza: Y").
  summary?: string[];
  // Modo edit: snapshot pré-edição (Desfazer via restoreDashboardSnapshot).
  snapshot?: DashboardSnapshot;
  chave?: string;
  mode?: AiDashboardMode;
}

const MAX_ATTEMPTS = 3;
const CALL_TIMEOUT_MS = 120_000; // por chamada ao provedor
const TURN_BUDGET_MS = 240_000; // orçamento do turno (Home tem maxDuration=300)
const MAX_PRIOR_TURNS = 10;

const WIDGET_COLS =
  "id, title, visual_type, sources, split_by_source, dimensions, metrics, filters, settings, grid_position, sort_order";

function randomChave(): string {
  return `board_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

function section(title: string, body: string): string {
  return `\n\n============================================================\n# ${title}\n============================================================\n\n${body.trim()}\n`;
}

const EDIT_RULES = `
Você está EDITANDO o dashboard mostrado em "ESTADO ATUAL DO DASHBOARD (JSON)".
Regras deste modo (além da especificação acima):
- Responda com UM bloco de JSON no MESMO formato do estado atual.
- A resposta pode ser PARCIAL: inclua APENAS os widgets que você ALTEROU ou
  CRIOU. Widgets não incluídos permanecem exatamente como estão.
- NUNCA mude a "key" de um widget existente (é a identidade dele). Widget
  NOVO recebe uma "key" nova (slug curto, ex.: "w_funil_2").
- Ao alterar um widget existente, inclua a "key" dele e SÓ os campos que
  mudam — o resto do widget é preservado pelo servidor (NÃO re-emita o objeto
  inteiro). Dentro de "settings", mande só as chaves alteradas; as demais são
  preservadas. Para APAGAR um campo de propósito, envie-o vazio (ex.:
  "filters": []) ou null.
- Para DUPLICAR um widget existente ou criar um "parecido com" ele: widget de
  key NOVA com "copy_of": "<key do widget de origem>" + SÓ os campos que
  diferem — o servidor copia a definição INTEIRA da origem (métricas, filtros,
  settings, fontes) e aplica o seu delta por cima. NÃO re-emita a definição da
  origem. Sem "grid_position" no delta, a cópia é posicionada abaixo do
  conteúdo da aba.
- Localize o widget que o usuário citar pelo "title" no ESTADO ATUAL e use a
  "key" correspondente — não invente keys nem adivinhe configurações que o
  estado já mostra.
- Você NÃO exclui widgets (omitir não exclui). Se o usuário pedir remoção,
  responda que a exclusão é manual (⋮ do widget) e siga com o resto.
- Não mude "name", "visible_to_roles" nem "settings.tabs" sem pedido
  explícito. Inclua "dashboard.settings" só se alterar periodBar/canvas/
  background/dateFormat/fontScale/tabs.
- A "chave" é fixa (o sistema a impõe) — repita a do estado atual.`;

const FROM_RULES = `
O "ESTADO ATUAL DO DASHBOARD (JSON)" abaixo é um dashboard de REFERÊNCIA. O
sistema já vai fazer uma CÓPIA FIEL dele para você — você NÃO precisa (nem deve)
reproduzir os widgets existentes.
- Mantenha o envelope (formato/versao/chave/bases/dashboard.name) e liste em
  "widgets" APENAS os NOVOS a acrescentar (cada um com "key" nova, ex.:
  "w_novo_card") — pelo menos um. Nada dos widgets existentes.
- Para adicionar uma ABA, inclua em "dashboard.settings.tabs" a LISTA de abas na
  ordem desejada — copie as abas existentes (que você vê no estado) e acrescente
  a nova ao final — e aponte os widgets novos para o "tab" (id) da aba nova. As
  abas existentes são preservadas pelo servidor mesmo se você omiti-las.
- NÃO re-emita widgets existentes (viraria duplicata). Para mudar ou remover um
  widget copiado, faça depois no modo Editar (ou manual pelo ⋮ do card).
- Para um widget NOVO "parecido com" um da referência: key nova com
  "copy_of": "<key do widget de origem>" + SÓ os campos que diferem — o
  servidor copia a definição inteira da origem e aplica o seu delta por cima
  (não re-emita a definição da origem).
- Dê um "name" ao novo dashboard (obrigatório); repetir o da referência ganha o
  sufixo "(cópia)".
- A "chave" é definida pelo sistema — pode manter a que vier no estado.`;

const NEW_RULES = `
Se o usuário continuar a conversa depois deste dashboard ser criado, os
próximos turnos vão EDITÁ-LO (mantenha keys de widget estáveis e descritivas).`;

// Carrega board + widgets para os modos from/edit (RLS decide a visibilidade).
async function loadBoardForExport(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dashboardId: string
): Promise<
  | {
      ok: true;
      dash: ExportDashRow & {
        owner_user_id: string | null;
        kind: string;
        status: string;
      };
      widgets: ExportWidgetRow[];
    }
  | { ok: false; message: string }
> {
  const { data: dash } = await supabase
    .from("dashboards")
    .select("id, name, owner_user_id, visible_to_roles, settings, kind, status")
    .eq("id", dashboardId)
    .maybeSingle();
  if (!dash) return { ok: false, message: "Dashboard não encontrado." };
  if ((dash.kind as string) === "kanban") {
    return { ok: false, message: "A conversa com IA é só para dashboards." };
  }
  if ((dash.status as string) === "trashed") {
    return { ok: false, message: "Restaure o dashboard antes de usá-lo aqui." };
  }
  const { data: widgetsData } = await supabase
    .from("widgets")
    .select(WIDGET_COLS)
    .eq("dashboard_id", dashboardId)
    .order("sort_order", { ascending: true });
  return {
    ok: true,
    dash: dash as unknown as ExportDashRow & {
      owner_user_id: string | null;
      kind: string;
      status: string;
    },
    widgets: (widgetsData ?? []) as unknown as ExportWidgetRow[],
  };
}

// Modo "Criar a partir de": cópia FIEL da referência (duplicateBoard — clone via
// banco, sem a IA reproduzir nada) e então o DELTA da IA aplicado como edição na
// cópia (applyDashboardEditJson: sem GC, widgets omitidos preservados, aba nova
// mesclada em settings.tabs). Duplica só AQUI, no apply — nunca em turnos não
// aplicados, então não sobram cópias órfãs. O cliente troca a sessão para Editar
// sobre a cópia usando o `id` retornado.
async function applyFromReference(
  referenceId: string,
  raw: string
): Promise<EditDashboardState> {
  const dup = await duplicateBoard(referenceId);
  if (!dup.ok || !dup.id) {
    return { ok: false, message: dup.message ?? "Falha ao copiar o dashboard." };
  }
  return applyDashboardEditJson(dup.id, raw);
}

export async function generateDashboardWithAi(
  input: GenerateDashboardInput
): Promise<GenerateDashboardState> {
  const t0 = Date.now();
  const mode: AiDashboardMode = input.mode ?? "new";
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.permissions.includes("create_dashboards")) {
    return { ok: false, message: "Você não tem permissão para criar dashboards." };
  }
  const description = (input.description ?? "").trim();
  if (!description) {
    return { ok: false, message: "Descreva o que você quer." };
  }
  const priorTurns = (input.priorTurns ?? [])
    .map((t) => String(t ?? "").trim())
    .filter(Boolean)
    .slice(-MAX_PRIOR_TURNS);
  const autoApply = input.autoApply !== false;

  const orgId = await getActiveOrgId();
  const aiConfig = await loadOrgAiConfig(orgId);
  if (!aiConfig) {
    return {
      ok: false,
      message:
        "IA não configurada para esta organização. Cadastre o provedor e a chave em Configurações → Integrações.",
    };
  }

  const supabase = await createClient();

  // ---- Contexto por modo: bases, estado atual (from/edit), chave canônica.
  let bases: string[];
  let stateJson: string | null = null;
  let chave: string;
  let modeRules: string;
  let currentTabs: { id: string; name: string; color?: string }[] | undefined;
  let currentRoles: string[] | undefined;
  let avoidName: string | undefined;
  let existingKeys = new Set<string>();
  // Modos from/edit: base do merge por widget e do `copy_of` (a IA manda só o
  // delta).
  let baseWidgets: ImportWidgetSpec[] | undefined;

  if (mode === "new") {
    bases = (input.bases ?? []).filter(Boolean);
    if (bases.length === 0) {
      return { ok: false, message: "Selecione ao menos uma Base." };
    }
    chave = randomChave();
    modeRules = NEW_RULES;
  } else {
    if (!input.targetDashboardId) {
      return { ok: false, message: "Escolha um dashboard." };
    }
    const board = await loadBoardForExport(supabase, input.targetDashboardId);
    if (!board.ok) return { ok: false, message: board.message };
    if (mode === "edit") {
      const isAdmin = session.roles.includes("admin");
      if (!isAdmin && board.dash.owner_user_id !== session.user.id) {
        return {
          ok: false,
          message: "Apenas o dono ou um administrador podem editar por IA.",
        };
      }
    }
    const sources = await loadSources(supabase);
    const exported = exportDashboardJson({
      dash: board.dash,
      widgets: board.widgets,
      sources,
    });
    bases = exported.json.bases ?? [];
    stateJson = JSON.stringify(exported.json, null, 2);
    existingKeys = new Set(exported.widgetKeyById.values());
    // Base do merge por widget e do `copy_of` nos DOIS modos com estado: no
    // "from" o apply já mescla sobre a cópia (applyDashboardEditJson) — sem a
    // base aqui, um delta/cópia válido reprovaria na validação do laço.
    baseWidgets = exported.json.widgets;
    if (mode === "edit") {
      chave = exported.chave; // canônica do próprio board
      modeRules = EDIT_RULES;
      const settings = (board.dash.settings ?? {}) as DashboardSettings;
      currentTabs = settings.tabs;
      currentRoles = board.dash.visible_to_roles ?? [];
    } else {
      chave = randomChave(); // "from": identidade NOVA — nunca a da referência
      modeRules = FROM_RULES;
      avoidName = board.dash.name;
    }
  }

  // ---- System: spec + modelo das Bases + amostras (reuso do fluxo manual) +
  // estado atual + regras do modo.
  const prompt = await buildImportPrompt(bases, "compacto");
  if (!prompt.ok || !prompt.prompt) {
    return { ok: false, message: prompt.message ?? "Não foi possível montar o prompt." };
  }
  let system = prompt.prompt;
  if (stateJson) {
    system += section("ESTADO ATUAL DO DASHBOARD (JSON)", stateJson);
  }
  // Prévia pendente (auto-aplicar OFF): sem isso a IA não enxerga o que ela
  // mesma propôs no turno anterior — "ajusta o card que você criou" falharia.
  const pendingJson = (input.pendingJson ?? "").trim();
  if (pendingJson) {
    system += section(
      "PRÉVIA PENDENTE (AINDA NÃO APLICADA)",
      "No turno anterior você propôs as mudanças abaixo e o usuário AINDA NÃO " +
        "as aplicou — elas NÃO fazem parte do estado atual. O usuário pode se " +
        "referir a widgets desta prévia. Sua resposta deste turno SUBSTITUI a " +
        "prévia INTEIRA: re-inclua as mudanças dela que continuarem desejadas " +
        "(com as mesmas keys) e omita as que o usuário descartar.\n\n" +
        pendingJson
    );
  }
  system += section("REGRAS DESTE MODO", modeRules);

  const ctx = await loadImportContext(supabase);
  const client = getAiClient(aiConfig);

  // ---- Conversa stateless: turnos de usuário anteriores + o pedido atual.
  const messages: AiMessage[] = [
    ...priorTurns.map((t): AiMessage => ({ role: "user", content: t })),
    { role: "user", content: description },
  ];

  let lastErrors: string[] = [];
  let lastRaw = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Orçamento do turno: não inicia uma tentativa sem tempo hábil.
    if (attempt > 0 && Date.now() - t0 > TURN_BUDGET_MS - CALL_TIMEOUT_MS) break;

    let raw: string;
    try {
      raw = await client.generateText({
        system,
        messages,
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof AiTruncatedError) {
        return {
          ok: false,
          message: err.message,
          draftJson: lastRaw || undefined,
          mode,
          chave,
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: `Falha ao chamar a IA (${aiConfig.provider}): ${msg}`,
        mode,
        chave,
      };
    }
    lastRaw = raw;

    // Identidade canônica + injeções protetivas + base do merge por widget
    // (só no modo Editar) ANTES da validação.
    const normalized = normalizeImportRaw(raw, {
      chave,
      currentTabs,
      currentRoles,
      avoidName,
      baseWidgets,
    });

    const validation = validateDashboardImport(normalized, ctx);
    if (validation.ok && validation.preset) {
      // Resumo por widget (prévia e mensagem): novo × atualiza.
      const prefix = `${IMPORT_PRESET_PREFIX}${chave}.`;
      const summary = validation.preset.widgets.map((w) => {
        const key = w.presetKey.startsWith(prefix)
          ? w.presetKey.slice(prefix.length)
          : w.presetKey;
        const exists = existingKeys.has(key);
        return `${exists ? "atualiza" : "novo"}: ${w.title}`;
      });

      if (!autoApply) {
        return {
          ok: true,
          message:
            "Prévia pronta — revise as mudanças e clique em Aplicar.",
          pendingJson: normalized,
          summary,
          warnings: validation.warnings,
          chave,
          mode,
        };
      }

      const applied =
        mode === "edit"
          ? await applyDashboardEditJson(
              input.targetDashboardId as string,
              normalized
            )
          : mode === "from"
            ? await applyFromReference(
                input.targetDashboardId as string,
                normalized
              )
            : await importDashboardJson(normalized);
      return { ...applied, summary, chave, mode };
    }

    lastErrors = validation.errors;
    // Turno de correção (interno à tentativa): JSON anterior + erros pt-BR.
    messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content:
        "O validador do sistema apontou estes problemas no JSON. Corrija TODOS " +
        "e responda de novo com o JSON inteiro (apenas o bloco JSON, sem texto " +
        "fora dele):\n- " +
        lastErrors.join("\n- "),
    });
  }

  return {
    ok: false,
    message:
      "A IA não conseguiu gerar um JSON válido após algumas tentativas. Revise o rascunho e ajuste/importe manualmente.",
    errors: lastErrors,
    draftJson: lastRaw || undefined,
    mode,
    chave: undefined,
  };
}

/**
 * Aplicação MANUAL de um turno (switch "Aplicar automaticamente" desligado).
 * Recebe o pendingJson devolvido pelo turno; NADA é confiado do cliente — o
 * caminho de edit re-deriva a identidade e re-valida (applyDashboardEditJson)
 * e o de criação passa pelos mesmos gates do import manual.
 */
export async function applyGeneratedDashboard(
  raw: string,
  ctx: { mode: AiDashboardMode; targetDashboardId?: string }
): Promise<GenerateDashboardState> {
  if (ctx.mode === "edit") {
    if (!ctx.targetDashboardId) {
      return { ok: false, message: "Dashboard alvo ausente." };
    }
    const res = await applyDashboardEditJson(ctx.targetDashboardId, raw);
    return { ...res, mode: ctx.mode };
  }
  if (ctx.mode === "from") {
    if (!ctx.targetDashboardId) {
      return { ok: false, message: "Dashboard de referência ausente." };
    }
    const res = await applyFromReference(ctx.targetDashboardId, raw);
    return { ...res, mode: ctx.mode };
  }
  const res = await importDashboardJson(raw);
  return { ...res, mode: ctx.mode };
}

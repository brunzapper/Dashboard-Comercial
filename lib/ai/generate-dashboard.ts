// Versão: 1.3 | Data: 17/09/2026
// v1.3 (17/09/2026): três blocos EXTRAÍDOS de generateDashboardCore, sem
//   mudança de comportamento — contexto por modo, montagem do system e a
//   checagem do JSON (esta última foi para lib/import/dashboard/check.ts, que
//   é puro e portanto testável; este arquivo é server-only). Em cima deles, as
//   duas entradas de IA EXTERNA: `buildDashboardPromptCore` (copiar prompt,
//   agora COM o estado atual do board — era só isso que faltava para o painel
//   poder oferecê-lo) e `previewDashboardJsonCore` (conferir JSON colado, sem
//   escrever). Nenhuma das duas exige IA configurada: é para a organização sem
//   provedor que o fluxo manual existe.
// Versão: 1.2 | Data: 17/09/2026
// v1.2 (17/09/2026): repassa `onNotice` (aviso de rebaixamento de modelo do
//   Gemini) e para de prefixar o provedor numa mensagem que já se apresenta —
//   a mesma desduplicação que a json-loop v1.1 ganhou, reusando o
//   `providerLabel` dela em vez de recriá-lo. Sem isso o painel mostrava
//   "Falha ao chamar a IA (gemini): Gemini está sobrecarregado…".
// v1.1 (30/07/2026)
// v1.1 (30/07/2026): MESCLA no modo "Criar a partir de" — `extraReferenceIds`
//   (até MAX_EXTRA_REFS além da base): cada extra é exportada e fundida por
//   fuseExtraReferences (multi-ref.ts) — keys prefixadas rN_, união de bases,
//   uma section de prompt por extra, refWidgets no rewrite. As extras existem
//   SÓ na geração: o copy_of é resolvido ANTES do apply, então
//   applyFromReference/duplicateBoard seguem single-id e intocados.
// NÚCLEO da geração de dashboards por IA — extraído de
// app/(app)/dashboards/ai-generate-actions.ts (v2.2) SEM mudança de
// comportamento, para que o route handler de streaming (ai-turn) possa passar
// `onThought` (raciocínio ao vivo) sem colocar função em argumento de server
// action. As actions públicas (`generateDashboardWithAi`/
// `applyGeneratedDashboard`) viraram wrappers finos deste módulo — histórico
// de decisões (modos new/from/edit, identidade forçada no servidor, laço de
// autocorreção, truncamento) segue documentado lá.
import "server-only";

import { getSessionInfo, type SessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import { loadOrgAiConfig } from "@/lib/ai/config";
import { getAiClient, AiTruncatedError, type AiMessage } from "@/lib/ai";
import { providerLabel } from "@/lib/ai/json-loop";
import {
  buildImportPrompt,
  type ImportPromptVariant,
} from "@/app/(app)/dashboards/import-prompt-actions";
import { loadImportContext } from "@/lib/import/dashboard/context";
import { checkDashboardJson } from "@/lib/import/dashboard/check";
import {
  DASHBOARD_SETTINGS_DOC,
  documentedKeys,
} from "@/lib/import/dashboard/settings-docs";
import {
  exportDashboardJson,
  type ExportDashRow,
  type ExportWidgetRow,
} from "@/lib/import/dashboard/export";
import { loadExportFkNames } from "@/lib/import/dashboard/export-fk-names";
import type { ImportWidgetSpec } from "@/lib/import/dashboard/types";
import {
  fuseExtraReferences,
  MAX_EXTRA_REFS,
  type ExtraRefInput,
} from "@/lib/import/dashboard/multi-ref";
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
  /** Modo from: board de REFERÊNCIA (a BASE da cópia); modo edit: board ALVO. */
  targetDashboardId?: string;
  /** Modo from: referências ADICIONAIS para MESCLA (cap MAX_EXTRA_REFS, sem a
   * base). Entram só na geração — o apply segue duplicando apenas a base. */
  extraReferenceIds?: string[];
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
  explícito. Inclua "dashboard.settings" só se alterar
  ${documentedKeys(DASHBOARD_SETTINGS_DOC).join("/")}.
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

// Anexado a FROM_RULES SÓ quando há referências adicionais selecionadas.
const FROM_RULES_EXTRAS = `
- MESCLA: além da referência acima (a que será COPIADA), você recebeu seções
  "REFERÊNCIA ADICIONAL N — … (JSON)". Esses dashboards NÃO são copiados —
  servem só como fonte de widgets para a mescla. As keys dos widgets deles
  levam o prefixo "rN_" (ex.: "r2_w_funil").
- Para trazer um widget de uma referência adicional, crie um widget NOVO (key
  nova SUA, sem o prefixo) com "copy_of": "<key prefixada>" (ex.:
  "copy_of": "r2_w_funil") + SÓ os campos que quiser mudar — o servidor copia a
  definição inteira da origem e aplica o seu delta por cima. NUNCA re-emita a
  key "rN_…" como key de widget.
- Aponte o "tab" desses widgets para uma aba do dashboard de referência (as
  abas das referências adicionais não existem na cópia); sem "tab", eles caem
  na primeira aba, empilhados abaixo do conteúdo existente.
- Em "bases" do envelope, liste todas as Bases usadas pelo resultado —
  incluindo as dos widgets trazidos das referências adicionais.`;

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

/**
 * Um turno de geração/edição por IA. `onThought` (opcional) recebe trechos do
 * raciocínio do modelo enquanto a resposta é gerada (só onde isso não custa
 * tokens extras — ver lib/ai/types.ts); passa por TODAS as tentativas do laço
 * de autocorreção.
 */
/** O que o contexto por modo LÊ do pedido. Estreito de propósito: as entradas
 *  de IA externa (copiar prompt / colar JSON) não têm `description`. */
interface DashboardModeInput {
  mode?: AiDashboardMode;
  bases?: string[];
  targetDashboardId?: string;
  extraReferenceIds?: string[];
}

/** O que o modo resolve antes de montar prompt ou validar JSON. */
interface DashboardModeContext {
  mode: AiDashboardMode;
  bases: string[];
  stateJson: string | null;
  chave: string;
  modeRules: string;
  currentTabs?: { id: string; name: string; color?: string }[];
  currentRoles?: string[];
  avoidName?: string;
  existingKeys: Set<string>;
  baseWidgets?: ImportWidgetSpec[];
  refWidgets?: ImportWidgetSpec[];
  refSections: { title: string; body: string }[];
  currentCanvas?: Record<string, unknown>;
}

/**
 * Contexto por MODO: bases, estado atual (from/edit), chave canônica, regras.
 *
 * Extraído de `generateDashboardCore` em 17/09/2026 — sem mudança de
 * comportamento. O turno ao vivo não era o único a precisar disto: o
 * "Copiar prompt" de um dashboard existente e a conferência de um JSON colado
 * dependem do MESMO estado exportado (é daqui que sai `baseWidgets`, a base do
 * merge por widget). Montar isso uma segunda vez seria a régua paralela que a
 * invariante 25 proíbe.
 */
async function resolveDashboardModeContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  session: SessionInfo,
  input: DashboardModeInput
): Promise<
  { ok: true; ctx: DashboardModeContext } | { ok: false; message: string }
> {
  const mode: AiDashboardMode = input.mode ?? "new";
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
  // Modo from com MESCLA: widgets das referências ADICIONAIS (keys rN_ — só
  // origem de copy_of no rewrite) e as sections de prompt correspondentes.
  let refWidgets: ImportWidgetSpec[] | undefined;
  let refSections: { title: string; body: string }[] = [];
  // Modos from/edit: canvas do estado EXPORTADO (carimbo do espaço de grid v2)
  // — injetado no JSON da IA quando ela o omite (rewrite.currentCanvas).
  let currentCanvas: Record<string, unknown> | undefined;

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
    // Filtros de relação do ESTADO ATUAL por NOME (31/07/2026): a IA lê/edita
    // nomes, nunca UUIDs.
    const exported = exportDashboardJson({
      dash: board.dash,
      widgets: board.widgets,
      sources,
      fkNames: await loadExportFkNames(supabase, board.widgets),
    });
    bases = exported.json.bases ?? [];
    stateJson = JSON.stringify(exported.json, null, 2);
    existingKeys = new Set(exported.widgetKeyById.values());
    // Base do merge por widget e do `copy_of` nos DOIS modos com estado: no
    // "from" o apply já mescla sobre a cópia (applyDashboardEditJson) — sem a
    // base aqui, um delta/cópia válido reprovaria na validação do laço.
    baseWidgets = exported.json.widgets;
    currentCanvas = exported.json.dashboard.settings?.canvas as
      | Record<string, unknown>
      | undefined;
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
      // MESCLA: referências adicionais (dedup, sem a base, cap).
      const extraIds = [
        ...new Set((input.extraReferenceIds ?? []).filter(Boolean)),
      ].filter((id) => id !== input.targetDashboardId);
      if (extraIds.length > MAX_EXTRA_REFS) {
        return {
          ok: false,
          message: `No máximo ${MAX_EXTRA_REFS} referências adicionais.`,
        };
      }
      if (extraIds.length > 0) {
        const extras: ExtraRefInput[] = [];
        for (const id of extraIds) {
          const extra = await loadBoardForExport(supabase, id);
          if (!extra.ok) {
            return {
              ok: false,
              message: `Referência adicional: ${extra.message}`,
            };
          }
          extras.push({
            name: extra.dash.name,
            json: exportDashboardJson({
              dash: extra.dash,
              widgets: extra.widgets,
              sources,
              fkNames: await loadExportFkNames(supabase, extra.widgets),
            }).json,
          });
        }
        const fusion = fuseExtraReferences(
          { bases, widgetKeys: exported.widgetKeyById.values() },
          extras
        );
        bases = fusion.bases; // união → o prompt cobre o catálogo de todas
        refWidgets = fusion.refWidgets;
        refSections = fusion.sections;
        // Habilita o fallback de aba do rewrite (cópia de extra sem aba
        // empilha na PRIMEIRA aba real). Sem extras, currentTabs segue
        // undefined no from — paridade com o comportamento anterior.
        currentTabs = exported.json.dashboard.settings?.tabs;
        modeRules = FROM_RULES + FROM_RULES_EXTRAS;
      }
    }
  }

  return {
    ok: true,
    ctx: {
      mode,
      bases,
      stateJson,
      chave,
      modeRules,
      currentTabs,
      currentRoles,
      avoidName,
      existingKeys,
      baseWidgets,
      refWidgets,
      refSections,
      currentCanvas,
    },
  };
}

/**
 * O prompt de sistema INTEIRO: spec + modelo das Bases + amostras (reuso do
 * fluxo manual) + estado atual + referências + prévia pendente + regras do
 * modo.
 *
 * Extraído em 17/09/2026. Era isto que faltava para o painel do dashboard
 * poder oferecer "Copiar prompt": `buildImportPrompt` sozinho não conhece o
 * ESTADO do board, e um copiar-prompt sem ele mandaria a IA externa editar às
 * cegas.
 */
async function buildDashboardSystemPrompt(
  ctx: DashboardModeContext,
  opts: { variant: ImportPromptVariant; pendingJson?: string }
): Promise<{ ok: true; system: string } | { ok: false; message: string }> {
  const prompt = await buildImportPrompt(ctx.bases, opts.variant);
  if (!prompt.ok || !prompt.prompt) {
    return {
      ok: false,
      message: prompt.message ?? "Não foi possível montar o prompt.",
    };
  }
  let system = prompt.prompt;
  if (ctx.stateJson) {
    system += section("ESTADO ATUAL DO DASHBOARD (JSON)", ctx.stateJson);
  }
  for (const s of ctx.refSections) system += section(s.title, s.body);
  // Prévia pendente (auto-aplicar OFF): sem isso a IA não enxerga o que ela
  // mesma propôs no turno anterior — "ajusta o card que você criou" falharia.
  const pendingJson = (opts.pendingJson ?? "").trim();
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
  system += section("REGRAS DESTE MODO", ctx.modeRules);
  return { ok: true, system };
}

/** Gate comum das entradas de dashboard por IA (viva ou externa). */
async function gateDashboardAi(): Promise<
  { ok: true; session: SessionInfo } | { ok: false; message: string }
> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.permissions.includes("create_dashboards")) {
    return {
      ok: false,
      message: "Você não tem permissão para criar dashboards.",
    };
  }
  return { ok: true, session };
}

/**
 * O prompt completo para uma IA EXTERNA (fluxo copiar-prompt → colar-JSON).
 *
 * Mesmo SPEC, mesmo modelo e mesmo ESTADO ATUAL que o turno ao vivo monta —
 * uma entrada, um contrato. NÃO exige IA configurada de propósito: este
 * caminho existe justamente para a organização que não tem provedor
 * cadastrado (padrão de operações/mapeamentos/Base manual).
 */
export async function buildDashboardPromptCore(input: {
  mode?: AiDashboardMode;
  targetDashboardId?: string;
  bases?: string[];
  extraReferenceIds?: string[];
  variant?: ImportPromptVariant;
}): Promise<{ ok: boolean; prompt?: string; message?: string }> {
  const gate = await gateDashboardAi();
  if (!gate.ok) return { ok: false, message: gate.message };
  const supabase = await createClient();
  const modeCtx = await resolveDashboardModeContext(supabase, gate.session, input);
  if (!modeCtx.ok) return { ok: false, message: modeCtx.message };
  const res = await buildDashboardSystemPrompt(modeCtx.ctx, {
    variant: input.variant ?? "compacto",
  });
  if (!res.ok) return { ok: false, message: res.message };
  return { ok: true, prompt: res.system };
}

/**
 * Confere um JSON COLADO de IA externa — mesma prévia do turno ao vivo, sem IA.
 *
 * Nunca escreve: devolve o JSON NORMALIZADO para quem chamou guardar como
 * prévia. A normalização não é cosmética — é ela que reescreve a identidade no
 * servidor (uma `chave` copiada de outro board sobrescreveria a origem).
 */
export async function previewDashboardJsonCore(
  raw: string,
  input: {
    mode?: AiDashboardMode;
    targetDashboardId?: string;
    bases?: string[];
    extraReferenceIds?: string[];
  }
): Promise<{
  ok: boolean;
  message: string;
  pendingJson?: string;
  summary?: string[];
  warnings?: string[];
  errors?: string[];
}> {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, message: "Cole o JSON devolvido pela IA." };
  const gate = await gateDashboardAi();
  if (!gate.ok) return { ok: false, message: gate.message };
  const supabase = await createClient();
  const modeCtx = await resolveDashboardModeContext(supabase, gate.session, input);
  if (!modeCtx.ok) return { ok: false, message: modeCtx.message };

  const importCtx = await loadImportContext(supabase);
  const checked = checkDashboardJson(text, modeCtx.ctx, importCtx);
  if (!checked.ok) {
    return {
      ok: false,
      message: "O JSON tem problemas — corrija na IA externa e cole de novo.",
      errors: checked.errors,
    };
  }
  return {
    ok: true,
    message: "Prévia pronta — revise as mudanças e clique em Aplicar.",
    pendingJson: checked.normalized,
    summary: checked.summary,
    warnings: checked.warnings,
  };
}

export async function generateDashboardCore(
  input: GenerateDashboardInput,
  onThought?: (chunk: string) => void,
  onNotice?: (text: string) => void
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

  // ---- Contexto por modo (extraído em 17/09/2026 — ver a função).
  const modeCtxRes = await resolveDashboardModeContext(supabase, session, input);
  if (!modeCtxRes.ok) return { ok: false, message: modeCtxRes.message };
  // Só a chave sobrevive aqui: o resto do contexto vai INTEIRO para as funções
  // extraídas, e repetir os campos soltos convidaria a divergirem.
  const { chave } = modeCtxRes.ctx;

  // ---- System (extraído em 17/09/2026 — o "Copiar prompt" usa o mesmo).
  const systemRes = await buildDashboardSystemPrompt(modeCtxRes.ctx, {
    variant: "compacto",
    pendingJson: input.pendingJson,
  });
  if (!systemRes.ok) return { ok: false, message: systemRes.message };
  const system = systemRes.system;

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
        onThought,
        onNotice,
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
      // A mensagem do adaptador já nomeia o provedor ("Gemini está
      // sobrecarregado…"); prefixar de novo daria "…(gemini): Gemini está…".
      // Mesma regra da json-loop v1.1, com o MESMO helper.
      return {
        ok: false,
        message: msg.startsWith(providerLabel(aiConfig.provider))
          ? msg
          : `Falha ao chamar a IA (${aiConfig.provider}): ${msg}`,
        mode,
        chave,
      };
    }
    lastRaw = raw;

    const checked = checkDashboardJson(raw, modeCtxRes.ctx, ctx);
    if (checked.ok) {
      const { normalized, summary } = checked;
      const validation = { warnings: checked.warnings };

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

    lastErrors = checked.errors;
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
export async function applyGeneratedDashboardCore(
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

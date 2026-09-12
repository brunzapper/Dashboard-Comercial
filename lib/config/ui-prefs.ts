// Versão: 1.1 | Data: 12/09/2026
// v1.1 (12/09/2026): `hubCardHeight`/`operacaoCardHeight` — altura mínima do
//   card. Em LISTA o card nasce de uma linha só e ficava fino demais para
//   quem usa o hub como tela de trabalho; 0 = automático (altura natural).
// Preferências de INTERFACE em TRÊS camadas, resolvidas AQUI e em nenhum outro
// lugar: padrão do app → padrão da ORGANIZAÇÃO (organizations.ui_prefs, 0141)
// → preferência do USUÁRIO (user_settings.settings.uiPrefs).
//
// A org pode TRAVAR uma chave (`locked`): travada, o valor da org vence o
// override do usuário. Trava NÃO apaga o override — destravar devolve a escolha
// pessoal de cada um. "Aplicar a todos" é outra operação (apaga o override dos
// membros; ver app/(app)/configuracoes/tema/actions.ts) e por isso é
// irreversível de propósito.
//
// Módulo PURO e client-safe (sem server-only), no molde de lib/theme.ts: os
// controles da interface são Client Components e precisam do mesmo resolver que
// o servidor usa — duas réguas divergiriam no primeiro ajuste.
//
// Chave legada: `sidebarPinned` vivia solta na raiz de user_settings.settings
// (Fase 10). normalizeUiPrefs a ACEITA na raiz e a promove — a linha antiga
// nunca é reescrita às cegas (mesmo trato do lastView "/agenda" na Home).

export type HubLayout = "grid" | "list";

export interface UiPrefs {
  // ----- hub: dashboards e kanbans -----
  hubLayout?: HubLayout;
  /** Teto de colunas em telas largas (1..MAX_HUB_COLUMNS). */
  hubColumns?: number;
  hubShowDescription?: boolean;
  hubShowAccess?: boolean;
  /** Altura MÍNIMA do card em px; 0 = automática (altura natural). */
  hubCardHeight?: number;
  // ----- hub/painel: cards de Operação -----
  operacaoLayout?: HubLayout;
  operacaoColumns?: number;
  operacaoShowDescription?: boolean;
  operacaoShowAccess?: boolean;
  operacaoCardHeight?: number;
  // ----- barra lateral -----
  sidebarPinned?: boolean;
  /** Revelar a barra ao aproximar do canto esquerdo da tela. */
  sidebarHoverEdge?: boolean;
  // ----- painel de detalhe do registro -----
  /** true = mostra também os campos sem valor. */
  recordPanelAllFields?: boolean;
}

export const MIN_HUB_COLUMNS = 1;
export const MAX_HUB_COLUMNS = 6;
/** 0 = automático; acima disso, altura mínima do card em px. */
export const MIN_CARD_HEIGHT = 0;
export const MAX_CARD_HEIGHT = 320;
export const CARD_HEIGHT_STEP = 8;

/**
 * Padrão do app. Descrição nasce DESLIGADA nas duas famílias (requisito: o
 * botão é para entrar, não para ler) e o nível de acesso segue visível só onde
 * já era — dashboards/kanbans.
 */
export const UI_PREF_DEFAULTS: Required<UiPrefs> = {
  hubLayout: "grid",
  hubColumns: 3,
  hubShowDescription: false,
  hubShowAccess: true,
  hubCardHeight: 0,
  operacaoLayout: "grid",
  operacaoColumns: 3,
  operacaoShowDescription: false,
  operacaoShowAccess: false,
  operacaoCardHeight: 0,
  sidebarPinned: false,
  sidebarHoverEdge: true,
  recordPanelAllFields: false,
};

/** Ordem estável (a UI de trava itera por aqui). */
export const UI_PREF_KEYS = Object.keys(UI_PREF_DEFAULTS) as UiPrefKey[];

export type UiPrefKey = keyof UiPrefs;

/** Rótulos pt-BR das chaves — donos únicos do texto da UI de trava. */
export const UI_PREF_LABELS: Record<UiPrefKey, string> = {
  hubLayout: "Painéis: formato (grade/lista)",
  hubColumns: "Painéis: número de colunas",
  hubShowDescription: "Painéis: exibir descrição",
  hubShowAccess: "Painéis: exibir nível de acesso",
  hubCardHeight: "Painéis: altura do card",
  operacaoLayout: "Operação: formato (grade/lista)",
  operacaoColumns: "Operação: número de colunas",
  operacaoShowDescription: "Operação: exibir descrição",
  operacaoShowAccess: "Operação: exibir nível de acesso",
  operacaoCardHeight: "Operação: altura do card",
  sidebarPinned: "Barra lateral: fixada",
  sidebarHoverEdge: "Barra lateral: abrir ao aproximar da borda",
  recordPanelAllFields: "Registro: exibir campos vazios",
};

function boolOrUndef(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function layoutOrUndef(v: unknown): HubLayout | undefined {
  return v === "grid" || v === "list" ? v : undefined;
}

/** Clampa ao intervalo aceito; não-número/NaN ⇒ undefined (cai no default). */
export function clampColumns(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const n = Math.round(v);
  return Math.min(MAX_HUB_COLUMNS, Math.max(MIN_HUB_COLUMNS, n));
}

/** Idem para a altura do card (0 = automático). */
export function clampCardHeight(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const n = Math.round(v);
  return Math.min(MAX_CARD_HEIGHT, Math.max(MIN_CARD_HEIGHT, n));
}

/**
 * Parse FAIL-SAFE por chave: valor inválido some (cai no default da camada
 * seguinte) em vez de derrubar o objeto inteiro — preferência de interface
 * nunca deve impedir alguém de abrir o app.
 *
 * `legacyRoot` é o objeto de user_settings.settings (raiz), de onde vem a chave
 * solta `sidebarPinned` anterior à 0141.
 */
export function normalizeUiPrefs(
  v: unknown,
  legacyRoot?: unknown
): UiPrefs {
  const raw = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: UiPrefs = {};
  const put = <K extends UiPrefKey>(k: K, val: UiPrefs[K]) => {
    if (val !== undefined) out[k] = val;
  };
  put("hubLayout", layoutOrUndef(raw.hubLayout));
  put("hubColumns", clampColumns(raw.hubColumns));
  put("hubShowDescription", boolOrUndef(raw.hubShowDescription));
  put("hubShowAccess", boolOrUndef(raw.hubShowAccess));
  put("hubCardHeight", clampCardHeight(raw.hubCardHeight));
  put("operacaoLayout", layoutOrUndef(raw.operacaoLayout));
  put("operacaoColumns", clampColumns(raw.operacaoColumns));
  put("operacaoShowDescription", boolOrUndef(raw.operacaoShowDescription));
  put("operacaoShowAccess", boolOrUndef(raw.operacaoShowAccess));
  put("operacaoCardHeight", clampCardHeight(raw.operacaoCardHeight));
  put("sidebarPinned", boolOrUndef(raw.sidebarPinned));
  put("sidebarHoverEdge", boolOrUndef(raw.sidebarHoverEdge));
  put("recordPanelAllFields", boolOrUndef(raw.recordPanelAllFields));

  // Legado: sidebarPinned na RAIZ de user_settings.settings. Só vale quando o
  // bloco novo não decidiu — assim o primeiro save da UI nova já manda.
  if (out.sidebarPinned === undefined && legacyRoot && typeof legacyRoot === "object") {
    const legacy = boolOrUndef((legacyRoot as Record<string, unknown>).sidebarPinned);
    if (legacy !== undefined) out.sidebarPinned = legacy;
  }
  return out;
}

/**
 * Preferências do USUÁRIO a partir do bag cru de user_settings.settings —
 * ponto único que sabe onde o bloco mora e que a chave legada vive na raiz.
 */
export function userUiPrefs(settings: unknown): UiPrefs {
  const root = (settings && typeof settings === "object" ? settings : {}) as
    Record<string, unknown>;
  return normalizeUiPrefs(root.uiPrefs, root);
}

/** Itens fixados na barra a partir do mesmo bag cru. */
export function userSidebarPins(settings: unknown): SidebarPin[] {
  const root = (settings && typeof settings === "object" ? settings : {}) as
    Record<string, unknown>;
  return normalizeSidebarPins(root.sidebarItems);
}

/** Padrão + travas da ORG (organizations.ui_prefs, 0141). */
export interface OrgUiPrefs {
  values: UiPrefs;
  locked: ReadonlySet<UiPrefKey>;
  /** Override de descrição dos cards de Operação (catálogo é código). */
  operacaoDescriptions: Record<string, string>;
}

export const EMPTY_ORG_UI_PREFS: OrgUiPrefs = {
  values: {},
  locked: new Set(),
  operacaoDescriptions: {},
};

const UI_PREF_KEY_SET = new Set<string>(UI_PREF_KEYS);

/** Normaliza o jsonb da org ({} ⇒ sem padrão e sem trava). */
export function normalizeOrgUiPrefs(v: unknown): OrgUiPrefs {
  if (!v || typeof v !== "object" || Array.isArray(v)) return EMPTY_ORG_UI_PREFS;
  const raw = v as Record<string, unknown>;
  const locked = new Set<UiPrefKey>(
    (Array.isArray(raw.locked) ? raw.locked : []).filter(
      (k): k is UiPrefKey => typeof k === "string" && UI_PREF_KEY_SET.has(k)
    )
  );
  const descRaw =
    raw.operacaoDescriptions && typeof raw.operacaoDescriptions === "object"
      ? (raw.operacaoDescriptions as Record<string, unknown>)
      : {};
  const operacaoDescriptions: Record<string, string> = {};
  for (const [k, val] of Object.entries(descRaw)) {
    if (typeof val === "string" && val.trim() !== "") {
      operacaoDescriptions[k] = val.trim();
    }
  }
  return { values: normalizeUiPrefs(raw.values), locked, operacaoDescriptions };
}

export interface ResolvedUiPrefs {
  values: Required<UiPrefs>;
  /** Chaves cuja personalização a org travou (controle desabilitado na UI). */
  locked: ReadonlySet<UiPrefKey>;
}

/**
 * Precedência por CHAVE (campos independentes, como em resolveTheme):
 *   travada pela org ⇒ org ?? default do app (override do usuário ignorado)
 *   livre            ⇒ usuário ?? org ?? default do app
 */
export function resolveUiPrefs(
  user: UiPrefs | null | undefined,
  org: OrgUiPrefs | null | undefined
): ResolvedUiPrefs {
  const u = user ?? {};
  const o = org ?? EMPTY_ORG_UI_PREFS;
  const values = { ...UI_PREF_DEFAULTS };
  for (const key of UI_PREF_KEYS) {
    const orgVal = o.values[key];
    const userVal = o.locked.has(key) ? undefined : u[key];
    const picked = userVal ?? orgVal;
    if (picked !== undefined) {
      // O laço é genérico sobre uma união de tipos por chave; o cast mantém a
      // tabela de chaves como fonte única (sem 11 linhas copiadas).
      (values as Record<string, unknown>)[key] = picked;
    }
  }
  return { values, locked: o.locked };
}

// ---------------------------------------------------------------------------
// Itens fixados na barra lateral (personalização por USUÁRIO — sem camada de
// org: é a barra DELE). Guardamos ID/key, nunca rótulo: o nome do board muda.

export type SidebarPinKind =
  | "dashboard"
  | "kanban"
  | "widget-kanban"
  | "operacao";

export interface SidebarPin {
  kind: SidebarPinKind;
  id: string;
}

export const MAX_SIDEBAR_PINS = 12;

const PIN_KINDS = new Set<string>([
  "dashboard",
  "kanban",
  "widget-kanban",
  "operacao",
]);

/** Parse fail-safe + dedupe + teto. Item inválido some, lista sobrevive. */
export function normalizeSidebarPins(v: unknown): SidebarPin[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: SidebarPin[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const { kind, id } = item as { kind?: unknown; id?: unknown };
    if (typeof kind !== "string" || !PIN_KINDS.has(kind)) continue;
    if (typeof id !== "string" || id === "") continue;
    const token = `${kind}:${id}`;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push({ kind: kind as SidebarPinKind, id });
    if (out.length >= MAX_SIDEBAR_PINS) break;
  }
  return out;
}

/** Alterna um item na lista (fixar/desfixar), respeitando o teto. */
export function toggleSidebarPin(
  pins: SidebarPin[],
  pin: SidebarPin
): SidebarPin[] {
  const has = pins.some((p) => p.kind === pin.kind && p.id === pin.id);
  if (has) return pins.filter((p) => !(p.kind === pin.kind && p.id === pin.id));
  return normalizeSidebarPins([...pins, pin]);
}

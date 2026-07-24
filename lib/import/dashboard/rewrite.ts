// Versão: 1.2 | Data: 24/07/2026
// Normalização do JSON BRUTO devolvido pela IA, ANTES da validação — o ponto
// central da segurança de identidade da conversa (modos Editar/Criar a partir
// de): a `chave` NUNCA é confiada à IA. Reescrevemos o envelope para a chave
// CANÔNICA (derivada do dashboard alvo ou gerada no servidor) e o validador
// então deriva todos os presetKeys dela — sem cirurgia pós-validação. Também
// injeta, no modo Editar, o que a IA pode ter omitido e cuja ausência teria
// efeito destrutivo no reimporte: `visible_to_roles` (ausente viraria [] =
// des-compartilhar) e `settings.tabs` (ausente faria o validador apagar o
// `tab` dos widgets retornados). Puro; parse tolerante (falhou = devolve o
// original e o validador reporta o erro legível).
// v1.1 (24/07/2026): MERGE por widget (modo Editar). Com `baseWidgets` (estado
//   atual exportado), um widget da IA que traz a MESMA `key` é MESCLADO sobre o
//   do estado — a IA manda só os campos que mudam e o resto é preservado no
//   SERVIDOR (settings mescla por chave; arrays substituem; null limpa). Assim
//   a IA não precisa re-emitir o widget inteiro (que apagaria os campos
//   omitidos). Widget com key NOVA passa intacto; widget do estado NÃO
//   referenciado não é adicionado (o apply SEM GC preserva a linha do banco).
// v1.2 (24/07/2026): CÓPIA por referência (`copy_of`). Widget da IA de key
//   NOVA pode trazer `"copy_of": "<key existente>"` — o widget do estado vira
//   a BASE do merge (a IA manda só o delta da cópia) e o marcador é REMOVIDO
//   antes da validação (nunca chega ao validador nem a um export). Sem
//   `grid_position` no delta, a cópia é posicionada ABAIXO do conteúdo da aba
//   dela (herdar a posição da origem sobreporia os dois; o auto-empilhamento
//   do validador começa em y=0 e colidiria com widgets reais no modo Editar).
//   `copy_of` num widget de key JÁ existente é ignorado (merge normal); para
//   key de origem desconhecida (ou sem baseWidgets) só o marcador é removido e
//   o validador reporta os campos faltantes.

import { stripCodeFence } from "./validate";
import type { ImportWidgetSpec } from "./types";

export interface NormalizeImportRawOpts {
  /** Chave canônica (identidade) — sempre sobrescreve a da IA. */
  chave: string;
  /** Modo Editar: abas atuais do board (injetadas se o JSON não trouxer). */
  currentTabs?: { id: string; name: string; color?: string }[];
  /** Modo Editar: papéis atuais (injetados se a CHAVE não vier no JSON). */
  currentRoles?: string[];
  /** Modo Criar a partir de: nome a evitar (colisão ⇒ sufixo " (cópia)"). */
  avoidName?: string;
  /**
   * Modos Editar/Criar a partir de: widgets do estado atual (exportado),
   * keyados por `key`. Quando presentes, um widget da IA com a MESMA `key` é
   * MESCLADO sobre o do estado — a IA manda só os campos que mudam e o resto é
   * preservado — e `"copy_of": "<key>"` num widget de key NOVA usa o widget de
   * origem como base do merge (cópia por delta; marcador removido). Widget com
   * key NOVA sem `copy_of` passa intacto; widget do estado não referenciado
   * NÃO é adicionado ao JSON (o apply sem-GC já preserva a linha do banco).
   */
  baseWidgets?: ImportWidgetSpec[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

interface GridPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

function gridOf(w: Record<string, unknown>): GridPos | null {
  const gp = w.grid_position;
  if (!isPlainObject(gp)) return null;
  const nums = [gp.x, gp.y, gp.w, gp.h];
  if (nums.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
    return null;
  }
  return {
    x: gp.x as number,
    y: gp.y as number,
    w: gp.w as number,
    h: gp.h as number,
  };
}

// Mesma chave de aba do auto-empilhamento do validador (settings.tab ausente =
// aba única).
function tabOf(w: Record<string, unknown>): string {
  const s = w.settings;
  return isPlainObject(s) && typeof s.tab === "string" && s.tab
    ? s.tab
    : "__single__";
}

// Deep-merge do PATCH (widget parcial da IA) sobre a BASE (widget do estado
// atual): objetos recursam (settings preserva as chaves omitidas); arrays e
// primitivos do patch vencem (substituição inteira); `null` explícito limpa;
// chave ausente no patch vem da base.
function deepMergeValue(base: unknown, patch: unknown): unknown {
  if (isPlainObject(base) && isPlainObject(patch)) {
    const out: Record<string, unknown> = { ...base };
    for (const k of Object.keys(patch)) {
      out[k] = deepMergeValue(base[k], patch[k]);
    }
    return out;
  }
  return patch;
}

export function normalizeImportRaw(
  raw: string,
  opts: NormalizeImportRawOpts
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    return raw; // inválido — o validador produz a mensagem certa
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return raw;
  }
  const obj = parsed as Record<string, unknown>;
  obj.chave = opts.chave;

  const dash =
    typeof obj.dashboard === "object" &&
    obj.dashboard !== null &&
    !Array.isArray(obj.dashboard)
      ? (obj.dashboard as Record<string, unknown>)
      : null;
  if (dash) {
    if (opts.currentRoles && !("visible_to_roles" in dash)) {
      dash.visible_to_roles = opts.currentRoles;
    }
    if (opts.currentTabs && opts.currentTabs.length > 0) {
      const settings =
        typeof dash.settings === "object" &&
        dash.settings !== null &&
        !Array.isArray(dash.settings)
          ? (dash.settings as Record<string, unknown>)
          : {};
      const tabs = settings.tabs;
      if (!Array.isArray(tabs) || tabs.length === 0) {
        settings.tabs = opts.currentTabs;
      }
      dash.settings = settings;
    }
    if (
      opts.avoidName &&
      typeof dash.name === "string" &&
      dash.name.trim() === opts.avoidName.trim()
    ) {
      dash.name = `${dash.name.trim()} (cópia)`;
    }
  }

  // Merge por widget (modos Editar/Criar a partir de): a IA manda a `key` + só
  // os campos que mudam; o resto vem do estado atual. Preserva o que não foi
  // tocado sem depender de a IA re-emitir o widget inteiro. `copy_of` (cópia
  // por referência) é resolvido aqui e SEMPRE removido — mesmo sem baseWidgets.
  if (Array.isArray(obj.widgets)) {
    const baseByKey = new Map<string, Record<string, unknown>>();
    for (const b of opts.baseWidgets ?? []) {
      const bk = b.key;
      if (typeof bk === "string" && bk) {
        baseByKey.set(bk, b as unknown as Record<string, unknown>);
      }
    }
    // Fundo de cada aba no estado atual: cópias sem grid próprio empilham daí
    // para baixo (nunca sobre a origem nem sobre y=0 de uma aba ocupada).
    const bottomByTab = new Map<string, number>();
    for (const b of baseByKey.values()) {
      const g = gridOf(b);
      if (!g) continue;
      const tab = tabOf(b);
      bottomByTab.set(tab, Math.max(bottomByTab.get(tab) ?? 0, g.y + g.h));
    }
    obj.widgets = (obj.widgets as unknown[]).map((w) => {
      if (!isPlainObject(w)) return w;
      const copyOf = w.copy_of;
      delete w.copy_of; // marcador de entrada — o validador nunca o vê
      const k = w.key;
      const base = typeof k === "string" && k ? baseByKey.get(k) : undefined;
      if (base) return deepMergeValue(base, w);
      const src =
        typeof copyOf === "string" && copyOf
          ? baseByKey.get(copyOf)
          : undefined;
      if (!src) return w;
      const copyBase = { ...src };
      delete copyBase.key; // a key NOVA do delta é a identidade da cópia
      delete copyBase.grid_position;
      const merged = deepMergeValue(copyBase, w) as Record<string, unknown>;
      if (!("grid_position" in merged)) {
        const srcGrid = gridOf(src);
        if (srcGrid) {
          const tab = tabOf(merged);
          const y = bottomByTab.get(tab) ?? 0;
          merged.grid_position = { x: srcGrid.x, y, w: srcGrid.w, h: srcGrid.h };
          bottomByTab.set(tab, y + srcGrid.h);
        }
      }
      return merged;
    });
  }

  return JSON.stringify(obj);
}

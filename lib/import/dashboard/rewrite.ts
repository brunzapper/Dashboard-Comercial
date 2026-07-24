// Versão: 1.1 | Data: 24/07/2026
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
   * Modo Editar: widgets do estado atual (exportado), keyados por `key`. Quando
   * presentes, um widget da IA com a MESMA `key` é MESCLADO sobre o do estado —
   * a IA manda só os campos que mudam e o resto é preservado. Widget com key
   * NOVA (sem correspondente) passa intacto; widget do estado não referenciado
   * NÃO é adicionado ao JSON (o apply sem-GC já preserva a linha do banco).
   */
  baseWidgets?: ImportWidgetSpec[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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

  // Merge por widget (modo Editar): a IA manda a `key` + só os campos que mudam;
  // o resto vem do estado atual. Preserva o que não foi tocado sem depender de a
  // IA re-emitir o widget inteiro.
  if (
    opts.baseWidgets &&
    opts.baseWidgets.length > 0 &&
    Array.isArray(obj.widgets)
  ) {
    const baseByKey = new Map<string, Record<string, unknown>>();
    for (const b of opts.baseWidgets) {
      const bk = b.key;
      if (typeof bk === "string" && bk) {
        baseByKey.set(bk, b as unknown as Record<string, unknown>);
      }
    }
    obj.widgets = (obj.widgets as unknown[]).map((w) => {
      if (!isPlainObject(w)) return w;
      const k = w.key;
      if (typeof k !== "string" || !k) return w;
      const base = baseByKey.get(k);
      return base ? deepMergeValue(base, w) : w;
    });
  }

  return JSON.stringify(obj);
}

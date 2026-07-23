// Versão: 1.0 | Data: 23/07/2026
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

import { stripCodeFence } from "./validate";

export interface NormalizeImportRawOpts {
  /** Chave canônica (identidade) — sempre sobrescreve a da IA. */
  chave: string;
  /** Modo Editar: abas atuais do board (injetadas se o JSON não trouxer). */
  currentTabs?: { id: string; name: string; color?: string }[];
  /** Modo Editar: papéis atuais (injetados se a CHAVE não vier no JSON). */
  currentRoles?: string[];
  /** Modo Criar a partir de: nome a evitar (colisão ⇒ sufixo " (cópia)"). */
  avoidName?: string;
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
  return JSON.stringify(obj);
}

// Versão: 1.1 | Data: 11/10/2026
// v1.1 (11/10/2026): COR do texto por tipo (`color`, só #RRGGBB por
//   `normalizeHexColor`), nas mesmas duas camadas e com a mesma precedência.
// Versão: 1.0 | Data: 11/10/2026
// v1.0 (11/10/2026): TIPOGRAFIA dos cartões da Tree — módulo PURO e
//   client-safe (o editor é Client Component; uma segunda régua divergiria).
//
// Numa apresentação (Root com zoom baixo, projetor) o texto dos cartões ficava
// pequeno demais e nada permitia mudar: os tamanhos eram classes fixas. Agora
// cada TIPO de texto do cartão (título, etiqueta, meses, valores…) tem fonte e
// tamanho configuráveis em DUAS camadas:
//   * o WIDGET define o padrão (`settings.tree.typography`);
//   * o CARTÃO sobrepõe (`tree_nodes.display.typography`, jsonb da 0150 — sem
//     migração).
// A camada mais específica vence POR PROPRIEDADE: o cartão pode trocar só o
// tamanho do título e herdar a fonte do widget. Ausente nas duas = o visual de
// sempre (nenhum `style` emitido — render byte-idêntico).
// Fonte só por chave do catálogo FECHADO `DASHBOARD_FONTS` (nada gravado vira
// `font-family` cru) e tamanho só dentro de [TREE_TEXT_MIN_PX, TREE_TEXT_MAX_PX].
// Dono ÚNICO da decisão: `resolveTreeTypography` + `treeTextStyle`.

import type { CSSProperties } from "react";
import { DASHBOARD_FONTS, isDashboardFontKey, type DashboardFontKey } from "@/lib/dashboards/style";
import { normalizeHexColor } from "@/lib/theme";

/** Os tipos de texto que um cartão pode exibir (ordem = ordem do editor). */
export const TREE_TEXT_ROLES = [
  "kind",
  "title",
  "subtitle",
  "tag",
  "description",
  "chips",
  "header",
  "rowLabel",
  "value",
  "footer",
] as const;
export type TreeTextRole = (typeof TREE_TEXT_ROLES)[number];

export const TREE_TEXT_ROLE_LABELS: Record<TreeTextRole, string> = {
  kind: "Tipo do cartão (Indicador, Anotação…)",
  title: "Título",
  subtitle: "Subtítulo (responsável, frase de apoio, cadência)",
  tag: "Etiqueta (N3, Resultado, automático)",
  description: "Descrição / texto (anotação, fatores, leitura)",
  chips: "Recortes e indicadores vinculados",
  header: "Cabeçalho da tabela (meses)",
  rowLabel: "Rótulos das linhas (Meta, Realizado…)",
  value: "Valores (números)",
  footer: "Rodapé (data, progresso, próxima ocorrência)",
};

export const TREE_TEXT_MIN_PX = 6;
export const TREE_TEXT_MAX_PX = 72;

/** Fonte e tamanho de UM tipo de texto (ausente = herda). */
export interface TreeTextStyle {
  font?: DashboardFontKey;
  /** px na escala do canvas (o zoom da Root multiplica). */
  size?: number;
  /** v1.1: cor do texto (#RRGGBB). */
  color?: string;
}

export type TreeTypography = Partial<Record<TreeTextRole, TreeTextStyle>>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isRole(k: string): k is TreeTextRole {
  return (TREE_TEXT_ROLES as readonly string[]).includes(k);
}

/** Tamanho válido (arredondado a 0,5 px) ou null. */
export function normalizeTreeTextSize(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n < TREE_TEXT_MIN_PX || n > TREE_TEXT_MAX_PX) return null;
  return Math.round(n * 2) / 2;
}

/** Parse fail-closed (papel/fonte/tamanho inválido some). Vazio = null. */
export function parseTreeTypography(raw: unknown): TreeTypography | null {
  if (!isRecord(raw)) return null;
  const out: TreeTypography = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!isRole(k) || !isRecord(v)) continue;
    const s: TreeTextStyle = {};
    if (isDashboardFontKey(v.font)) s.font = v.font;
    const size = normalizeTreeTextSize(v.size);
    if (size != null) s.size = size;
    const color = normalizeHexColor(v.color);
    if (color) s.color = color;
    if (Object.keys(s).length > 0) out[k] = s;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * O efetivo de um cartão: o cartão vence o widget POR PROPRIEDADE (a última
 * camada configurada tem prioridade). Ausente nas duas = herda.
 */
export function resolveTreeTypography(
  widget: TreeTypography | null | undefined,
  node: TreeTypography | null | undefined
): TreeTypography {
  const out: TreeTypography = {};
  for (const role of TREE_TEXT_ROLES) {
    const w = widget?.[role];
    const n = node?.[role];
    const font = n?.font ?? w?.font;
    const size = n?.size ?? w?.size;
    const color = n?.color ?? w?.color;
    if (font || size != null || color) {
      const s: TreeTextStyle = {};
      if (font) s.font = font;
      if (size != null) s.size = size;
      if (color) s.color = color;
      out[role] = s;
    }
  }
  return out;
}

/** `style` de um papel (undefined = nada configurado: a classe decide). */
export function treeTextStyle(
  typography: TreeTypography | null | undefined,
  role: TreeTextRole
): CSSProperties | undefined {
  const s = typography?.[role];
  if (!s) return undefined;
  const style: CSSProperties = {};
  if (s.font && isDashboardFontKey(s.font)) style.fontFamily = DASHBOARD_FONTS[s.font].stack;
  const size = normalizeTreeTextSize(s.size);
  if (size != null) {
    style.fontSize = `${size}px`;
    // A classe de origem fixa o line-height da escala pequena; com tamanho
    // próprio a linha acompanha (senão o texto grande se sobrepõe).
    style.lineHeight = 1.25;
  }
  const color = normalizeHexColor(s.color);
  if (color) style.color = color;
  return Object.keys(style).length > 0 ? style : undefined;
}

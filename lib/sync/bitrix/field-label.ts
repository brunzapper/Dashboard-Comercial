// Versão: 1.0 | Data: 19/11/2026
// Rótulo de UI de um campo do Bitrix (esquema por Base, fase 2).
//
// Em `crm.deal.fields`/`crm.lead.fields` o `title` de um campo de USUÁRIO
// (UF_CRM_…) volta como o próprio código interno; o nome que o usuário vê na
// tela do Bitrix vem em `formLabel` (formulário), `listLabel` (coluna da
// lista) ou `filterLabel` (filtro). Ler `title` primeiro é o que deixava 56
// campos com "UF_CRM_1690…" no construtor. Regra única (pinada em
// field-label.test.ts): o primeiro rótulo NÃO vazio que não seja o próprio
// código vence, na ordem form → list → filter → title; nenhum serve ⇒ o código.
// Módulo PURO.

export interface BitrixLabelSource {
  title?: unknown;
  formLabel?: unknown;
  listLabel?: unknown;
  filterLabel?: unknown;
}

function looksLikeCode(label: string, fieldId: string): boolean {
  if (label === fieldId) return true;
  return /^UF_CRM_[A-Z0-9_]+$/i.test(label);
}

/** Nome de UI do campo; cai no código só se o Bitrix não tiver nenhum. */
export function bitrixUiLabel(fieldId: string, def: BitrixLabelSource): string {
  for (const candidate of [def.formLabel, def.listLabel, def.filterLabel, def.title]) {
    if (typeof candidate !== "string") continue;
    const label = candidate.trim();
    if (label && !looksLikeCode(label, fieldId)) return label;
  }
  return fieldId;
}

/** O rótulo gravado é só o código interno (precisa de atenção do admin). */
export function isInternalBitrixLabel(label: string | null | undefined): boolean {
  return typeof label === "string" && /^UF_CRM_[A-Z0-9_]+$/i.test(label.trim());
}

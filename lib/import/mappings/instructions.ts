// Versão: 1.0 | Data: 07/08/2026
// SPEC/prompt do contrato "mapeamentos-classify" v1 — DERIVADO das constantes
// reais (formato/versão/teto de ./types; targets/categorias entram
// interpolados pelo builder a partir do REGISTRY em runtime, nunca em prosa
// duplicada). `buildMappingsClassifyPromptText` devolve o MESMO texto usado
// como system do chat interno E como prompt de IA externa (copiar-prompt) —
// um contrato, duas entradas. Paridade fiscalizada em instructions.test.ts
// (constantes presentes no texto + exemplo aceito pelo validador REAL).
import {
  MAPPINGS_CLASSIFY_FORMAT,
  MAPPINGS_CLASSIFY_VERSION,
  MAX_AI_MAPPING_ITEMS,
} from "./types";

export const MAPPINGS_SPEC_EXAMPLE = `{
  "formato": "${MAPPINGS_CLASSIFY_FORMAT}",
  "versao": ${MAPPINGS_CLASSIFY_VERSION},
  "dominio": "cargo",
  "itens": [
    {
      "valor": "Head of Data Analytics",
      "saidas": { "cargo_area": "TI", "cargo_nivel": "Gerente" }
    },
    {
      "valor": "Sócio-Administrador",
      "saidas": { "cargo_area": "Administração", "cargo_nivel": "C-Level" }
    }
  ],
  "notas": ["\\"Negócios\\" ficou de fora — ambíguo demais para classificar."]
}`;

export const MAPPINGS_SPEC = `Você classifica VALORES CRUS de um campo em categorias padronizadas (de-para
de classificação do sistema). Responda com UM único objeto JSON, sem texto
fora dele e sem cercas de código.

FORMATO
{
  "formato": "${MAPPINGS_CLASSIFY_FORMAT}",
  "versao": ${MAPPINGS_CLASSIFY_VERSION},
  "dominio": "<chave do domínio — informada abaixo>",
  "itens": [ { "valor": "<valor pendente EXATO>", "saidas": { "<campo>": "<categoria>" } } ],
  "notas": ["observações livres (opcional)"]
}

REGRAS
1. "valor" DEVE ser um dos VALORES PENDENTES listados abaixo (copie o texto
   exato; maiúsculas/minúsculas não importam). Nunca invente valores.
2. As chaves de "saidas" são SÓ os campos de saída do domínio (listados
   abaixo) e cada categoria DEVE ser uma das ACEITAS do campo — nunca crie
   categoria nova. Omita a chave se não souber aquele campo.
3. Classifique o que der com confiança; valor ambíguo/lixo fica DE FORA (é
   melhor deixar pendente do que chutar) — explique em "notas" se quiser.
4. Cada valor aparece NO MÁXIMO uma vez. NO MÁXIMO ${MAX_AI_MAPPING_ITEMS}
   itens por resposta — se houver mais pendentes, priorize os de maior
   contagem de registros e diga em "notas" que há mais.
5. Numa conversa, sua resposta SUBSTITUI a proposta pendente INTEIRA —
   re-inclua os itens que continuarem desejados.
6. Alternativa SÓ no fluxo manual (colar resposta): um CSV com cabeçalho
   "valor,<campos de saída>" (mesmas regras) também é aceito.

EXEMPLO (domínio "cargo")
${MAPPINGS_SPEC_EXAMPLE}`;

export interface MappingsPromptInput {
  domainKey: string;
  domainLabel: string;
  rawFieldLabel: string;
  /** JSON legível dos campos de saída + categorias aceitas. */
  targetsJson: string;
  /** JSON legível dos valores pendentes [{ valor, registros }]. */
  pendingJson: string;
}

export function buildMappingsClassifyPromptText(
  input: MappingsPromptInput
): string {
  return (
    MAPPINGS_SPEC +
    `\n\n## DOMÍNIO ATUAL\n\n` +
    `Chave: "${input.domainKey}" (${input.domainLabel} — campo cru "${input.rawFieldLabel}").\n` +
    `\n## CAMPOS DE SAÍDA E CATEGORIAS ACEITAS (JSON)\n\n${input.targetsJson}\n` +
    `\n## VALORES PENDENTES (JSON)\n\n${input.pendingJson}\n`
  );
}

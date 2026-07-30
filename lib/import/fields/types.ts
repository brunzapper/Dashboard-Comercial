// Versão: 1.0 | Data: 30/07/2026
// Contrato do fluxo "Criar campos com IA" (/campos): tipos PUROS compartilhados
// entre o validador (validate.ts), o core server-only (lib/ai/create-fields.ts)
// e a sheet client-side (components/campos/ai-fields-sheet.tsx).
//
// Formato do JSON que a IA devolve:
//   { "formato": "campos-create", "versao": 1,
//     "campos": [ { "rotulo": "Status do contrato", "tipo": "selecao",
//                   "opcoes": ["Ativo", "Encerrado"] },
//                 { "rotulo": "Margem", "tipo": "calculado",
//                   "formula_texto": "([Valor] - [Custo]) / [Valor]",
//                   "percentual": true } ],
//     "notas": ["…"] }
// Papéis/visibilidade/ordem NÃO são da IA — o apply usa os defaults
// programáticos (mesmos do import de CSV). A chave (field_key) é DERIVADA do
// rótulo por slugify no servidor, nunca ditada pela IA.
import type { DataType } from "@/lib/records/types";

export const FIELDS_CREATE_FORMAT = "campos-create";
export const FIELDS_CREATE_VERSION = 1;
export const MAX_AI_CREATE_FIELDS = 10;

/** Campo validado (estrutura) — a fórmula ainda valida no servidor (catálogo). */
export interface ParsedFieldCreate {
  rotulo: string;
  /** slugify(rotulo) — identidade que o createField vai derivar igual. */
  fieldKey: string;
  tipo: DataType;
  /** Só selecao. */
  opcoes?: string[];
  /** Só calculado/calculado_agg (modo texto, estilo Sheets). */
  formulaTexto?: string;
  /** Só moeda/calculado/calculado_agg. */
  moedaModo?: "inherit" | "fixed";
  moedaCodigo?: string;
  /** Exibição percentual (tipos elegíveis; nunca junto com moeda). */
  percentual?: boolean;
}

/** Contexto de validação: chaves já existentes (colisão = erro claro). */
export interface FieldsCreateContext {
  existing: { key: string; core: boolean }[];
}

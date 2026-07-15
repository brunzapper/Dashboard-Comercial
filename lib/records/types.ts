// Versão: 1.3 | Data: 14/07/2026
// Tipos compartilhados de registros e definições de campo (UI da Fase 4).
// v1.1 (09/07/2026): Fase 7 — DataType ganha 'booleano' (campos Y/N do Bitrix)
//   e 'calculado' (campo com fórmula); FieldDefinition ganha source_system,
//   source_field_id, show_in_builder e formula.
// v1.2 (09/07/2026): Fase 8 — FieldDefinition ganha applies_to (fonte/record_type).
// v1.3 (14/07/2026): DataType ganha 'calculado_agg' — fórmula sobre AGREGAÇÕES
//   (refs agg:sum|avg|count:<campo>), avaliada pelo engine de widgets sobre os
//   totais do recorte. Nunca materializado por registro (fora de
//   loadFormulaDefs/recalc) e fora de NUMERIC_DATA_TYPES (não é operando de
//   fórmula por-registro nem métrica agregável diretamente pelo RPC).
import type { Formula } from "./formulas";

export type DataType =
  | "texto"
  | "numero"
  | "data"
  | "selecao"
  | "moeda"
  | "booleano"
  | "calculado"
  | "calculado_agg";

export const DATA_TYPE_LABELS: Record<DataType, string> = {
  texto: "Texto",
  numero: "Número",
  data: "Data",
  selecao: "Seleção",
  moeda: "Moeda",
  booleano: "Booleano",
  calculado: "Calculado",
  calculado_agg: "Calculado (totais)",
};

// Tipos numéricos: podem ser métrica (soma/média) e operando de fórmula.
export const NUMERIC_DATA_TYPES: DataType[] = ["numero", "moeda", "calculado"];

// Exibição percentual (15/07/2026): tipos elegíveis a show_as_percent — o valor
// cru (0.35) exibe como "35%". Moeda fica de fora (formato conflita).
export const PERCENT_DATA_TYPES: DataType[] = [
  "numero",
  "calculado",
  "calculado_agg",
];

// true quando o campo deve exibir como percentual (×100 + "%"). Exige tipo
// elegível e ausência de currency_mode (moeda × percent são mutuamente
// exclusivos; o server já zera o flag, isto é a segunda trava).
export function isPercentField(
  f: Pick<FieldDefinition, "data_type" | "show_as_percent" | "currency_mode">
): boolean {
  return (
    f.show_as_percent === true &&
    PERCENT_DATA_TYPES.includes(f.data_type) &&
    !f.currency_mode
  );
}

export interface FieldDefinition {
  id: string;
  field_key: string;
  label: string;
  data_type: DataType;
  options: string[];
  visible_to_roles: string[];
  editable_by_roles: string[];
  is_local: boolean;
  sort_order: number;
  // Fase 7 (podem vir null em linhas antigas até o próximo select/migração):
  source_system?: string | null;
  source_field_id?: string | null;
  show_in_builder?: boolean;
  formula?: Formula | null;
  // Campos calculados (13/07/2026): quando false, resultado negativo vira 0.
  allow_negative?: boolean;
  // Moeda por campo (12/07/2026): 'moeda' e 'calculado' usam currency_mode
  // ('inherit' = moeda do registro | 'fixed' = currency_code). Em 'moeda',
  // 'inherit' é o padrão e mode null (legado) equivale a fixo em currency_code;
  // em 'calculado', ausente/null = número puro (não é moeda).
  currency_code?: string | null;
  currency_mode?: "inherit" | "fixed" | null;
  // Fase 8: a quais record_type (fonte) a coluna pertence. Vazio/ausente = todas.
  applies_to?: string[];
  // Write-back: quando true, editar este campo enfileira a mudança de volta ao
  // Bitrix (só faz sentido em campos de origem Bitrix, com source_field_id).
  write_back?: boolean;
  // Exibição percentual (15/07/2026): valor cru exibe ×100 + "%" (0.35 → "35%").
  // Só exibição — edição e valores gravados permanecem crus. Ver isPercentField.
  show_as_percent?: boolean;
}

export interface RecordRow {
  id: string;
  record_type: "lead" | "negocio" | "venda_site";
  source_system: "bitrix" | "sheet_site" | "manual";
  title: string | null;
  pipeline: string | null;
  stage: string | null;
  value: number | null;
  mrr: number | null;
  currency: string | null;
  sale_type: string | null;
  channel: string | null;
  closed: boolean;
  closed_at: string | null;
  // Datas de abertura/criação na origem (fallback p/ conversão de moeda quando o
  // registro ainda não tem fechamento). Podem vir ausentes em selects antigos.
  opened_at?: string | null;
  source_created_at?: string | null;
  responsible_id: string | null;
  operation_id: string | null;
  related_lead_id: string | null;
  lead_time_days: number | null;
  custom_fields: Record<string, unknown>;
  last_synced_at: string | null;
  locally_modified_at: string | null;
  // Registros casados por fonte (Fase 2), preenchido no modo lista para resolver
  // colunas `match:<fonte>:<campo>`. Chave = SourceKey ('leads'|'deals'|'estudo').
  __match?: Record<string, RecordRow | undefined>;
}

export const RECORD_TYPE_LABELS: Record<RecordRow["record_type"], string> = {
  lead: "Lead",
  negocio: "Negócio",
  venda_site: "Venda do site",
};

export interface OptionItem {
  id: string;
  label: string;
  // Responsável vinculado a um usuário do Bitrix (bitrix_user_id não nulo).
  // Só estes podem entrar em dropdowns com write-back: responsáveis criados só
  // no sistema não têm usuário Bitrix p/ onde gravar a atribuição.
  bitrixLinked?: boolean;
}

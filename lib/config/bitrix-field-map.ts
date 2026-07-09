// Versão: 1.0 | Data: 05/07/2026
// Mapeamento ÚNICO e editável Bitrix → núcleo (records). Toda a tradução de
// campos do Bitrix para as colunas do `records` e para `custom_fields` vive
// aqui — não espalhe mapeamento pelo código do sync.
//
// - `core`: campo do Bitrix → coluna própria de `records` (via chaves lógicas
//   consumidas pelo mapper).
// - `custom`: UF_CRM_* relevantes → chave semântica dentro de `custom_fields`.
//   `type` orienta a resolução de label (enumeration/employee) e o parse.

export type BitrixFieldType =
  | "string"
  | "double"
  | "money"
  | "date"
  | "datetime"
  | "boolean"
  | "enumeration"
  | "employee";

export interface CustomFieldMap {
  key: string; // chave dentro de records.custom_fields
  type: BitrixFieldType;
}

// ----------------------------- DEALS (negócios) -----------------------------
export const DEAL_CORE = {
  sourceId: "ID",
  title: "TITLE",
  categoryId: "CATEGORY_ID", // pipeline (resolvido p/ nome via dealcategory.list)
  stageId: "STAGE_ID", // resolvido p/ nome via status.list
  stageSemantic: "STAGE_SEMANTIC_ID",
  value: "OPPORTUNITY",
  currency: "CURRENCY_ID",
  mrr: "UF_CRM_1729887583805", // MRR (money) — métrica central
  assignedById: "ASSIGNED_BY_ID", // responsável / owner
  closed: "CLOSED", // Y/N
  closedAt: "CLOSEDATE",
  openedAt: "BEGINDATE",
  sourceCreatedAt: "DATE_CREATE",
  sourceModifiedAt: "DATE_MODIFY",
  movedTime: "MOVED_TIME",
  leadId: "LEAD_ID", // vínculo nativo com o lead de origem
  signatureDate: "UF_CRM_1729887608434", // Data da assinatura (ref. do lead time)
  channel: "UF_CRM_1755888290", // Canal → records.channel
  saleType: "UF_CRM_1729887417240", // Tipo de contrato → records.sale_type
} as const;

export const DEAL_CUSTOM: Record<string, CustomFieldMap> = {
  // Data da assinatura: também é usada como referência do lead time
  // (DEAL_CORE.signatureDate). Exposta aqui como coluna própria disponível.
  UF_CRM_1729887608434: { key: "data_assinatura", type: "date" },
  UF_CRM_1729888316385: { key: "temperatura_cliente", type: "enumeration" },
  UF_CRM_1730223822320: { key: "tier", type: "enumeration" },
  UF_CRM_1729887525503: { key: "licencas_contratadas", type: "double" },
  UF_CRM_1729887560060: { key: "valor_licenca", type: "money" },
  UF_CRM_1757444918: { key: "sdr_responsavel", type: "employee" },
  UF_CRM_670D3038A49B4: { key: "ae_responsavel", type: "employee" },
  UF_CRM_66BA02D679160: { key: "consultor_responsavel", type: "enumeration" },
  UF_CRM_670D3038C98A0: { key: "grupo_origem", type: "enumeration" },
  UF_CRM_660FF22427D0A: { key: "motivo_desqualificacao", type: "enumeration" },
  UF_CRM_1715111774935: { key: "cnpj", type: "string" },
  UF_CRM_1715111700112: { key: "razao_social", type: "string" },
  UF_CRM_1715111748742: { key: "nome_fantasia", type: "string" },
  // UTMs
  UTM_SOURCE: { key: "utm_source", type: "string" },
  UTM_MEDIUM: { key: "utm_medium", type: "string" },
  UTM_CAMPAIGN: { key: "utm_campaign", type: "string" },
  UTM_CONTENT: { key: "utm_content", type: "string" },
  UTM_TERM: { key: "utm_term", type: "string" },
};

// ----------------------------- LEADS -----------------------------
export const LEAD_CORE = {
  sourceId: "ID",
  title: "TITLE",
  stageId: "STATUS_ID", // status do lead (resolvido via status.list)
  value: "OPPORTUNITY",
  currency: "CURRENCY_ID",
  assignedById: "ASSIGNED_BY_ID",
  sourceCreatedAt: "DATE_CREATE",
  sourceModifiedAt: "DATE_MODIFY",
  movedTime: "MOVED_TIME",
  companyTitle: "COMPANY_TITLE",
} as const;

export const LEAD_CUSTOM: Record<string, CustomFieldMap> = {
  UF_CRM_1713984862: { key: "sales_qualified_lead", type: "boolean" },
  UF_CRM_1728913702: { key: "lead_score", type: "enumeration" },
  UF_CRM_1728913647652: { key: "grupo_origem", type: "enumeration" },
  UF_CRM_1728914081: { key: "data_qualificacao", type: "date" },
  UF_CRM_1728914053: { key: "data_desqualificacao", type: "date" },
  UF_CRM_1722903196: { key: "consultor_responsavel", type: "enumeration" },
  UF_CRM_1712319204356: { key: "motivo_desqualificacao", type: "enumeration" },
  UTM_SOURCE: { key: "utm_source", type: "string" },
  UTM_MEDIUM: { key: "utm_medium", type: "string" },
  UTM_CAMPAIGN: { key: "utm_campaign", type: "string" },
  UTM_CONTENT: { key: "utm_content", type: "string" },
  UTM_TERM: { key: "utm_term", type: "string" },
};

// Pipelines de negócios a sincronizar. "Vendas" = CATEGORY_ID 0 (fixo);
// "Enterprise" é descoberto via crm.dealcategory.list pelo nome.
export const DEAL_PIPELINES = {
  vendasCategoryId: "0",
  enterpriseCategoryName: "Enterprise",
} as const;

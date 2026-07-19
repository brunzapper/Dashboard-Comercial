// Versão: 1.4 | Data: 19/07/2026
// v1.4 (19/07/2026): MOVED_TIME sai de DEAL_CORE/LEAD_CORE — não há coluna
//   própria em `records` e a presença nos mapas do núcleo o excluía do catálogo
//   dinâmico (coreIds em lib/sync/bitrix/catalog.ts). Como já está em
//   FIELD_LABELS, passa a ser descoberto como campo de data visível
//   (bitrix_moved_time), no mesmo trilho da Data Reunião.
// v1.3 (18/07/2026): SOURCE_ID → "fonte" (novo tipo "source", resolvido via
//   crm.status.list ENTITY_ID='SOURCE') e UF_CRM_1778094396888 → "implementacao"
//   (campo de valor da implementação; substitui o antigo campo local homônimo —
//   ver migração 0075).
// v1.2 (09/07/2026): Fase 8b — FIELD_LABELS (fieldId → nome visual, do arquivo de
//   integração) sobrepõe o título do schema do Bitrix (que às vezes volta vazio e
//   cai para o próprio fieldId). Também define o conjunto de campos exibidos por
//   padrão. Ver lib/sync/bitrix/catalog.ts.
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
  | "employee"
  | "company" // COMPANY_ID → nome da empresa (resolvido via crm.company.get)
  | "source"; // SOURCE_ID → nome da origem (crm.status.list, ENTITY_ID='SOURCE')

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
  leadId: "LEAD_ID", // vínculo nativo com o lead de origem
  signatureDate: "UF_CRM_1729887608434", // Data da assinatura (ref. do lead time)
  channel: "UF_CRM_1755888290", // Canal → records.channel
  saleType: "UF_CRM_1729887417240", // Tipo de contrato → records.sale_type
} as const;

export const DEAL_CUSTOM: Record<string, CustomFieldMap> = {
  // Empresa: o Bitrix entrega COMPANY_ID (link), não o nome. Resolvido para o
  // nome via crm.company.get (BitrixLookups.companyName). Mesma chave `empresa`
  // usada nos leads (COMPANY_TITLE) → coluna única entre as fontes.
  COMPANY_ID: { key: "empresa", type: "company" },
  // Fonte (origem) do negócio: código resolvido p/ nome via lookup de origens.
  // Mesma chave `fonte` usada nos leads → coluna única entre as fontes.
  SOURCE_ID: { key: "fonte", type: "source" },
  // Valor da implementação (taxa de setup). Substitui o antigo campo local
  // homônimo dos presets — o sync passa a alimentá-lo (migração 0075).
  UF_CRM_1778094396888: { key: "implementacao", type: "money" },
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
  companyTitle: "COMPANY_TITLE",
} as const;

export const LEAD_CUSTOM: Record<string, CustomFieldMap> = {
  // Empresa do lead: COMPANY_TITLE já é o nome. Mesma chave `empresa` dos deals
  // (curada tem precedência sobre a exclusão de core-id no catálogo).
  COMPANY_TITLE: { key: "empresa", type: "string" },
  // Fonte (origem) do lead — mesma chave `fonte` dos deals.
  SOURCE_ID: { key: "fonte", type: "source" },
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

// ----------------------------- RÓTULOS VISUAIS -----------------------------
// Rótulo visual por campo do Bitrix (fieldId → nome), do arquivo de integração.
// AUTORITATIVO: vence o título do schema (crm.deal.fields/crm.lead.fields), que
// no ambiente do cliente às vezes volta vazio e cai para o próprio fieldId
// (o "nome da API"). As CHAVES aqui também definem o conjunto de campos que
// nascem visíveis (show_in_builder) no catálogo. Ver lib/sync/bitrix/catalog.ts.
export const FIELD_LABELS: Record<string, string> = {
  ID: "ID",
  TITLE: "Nome do negócio",
  HONORIFIC: "Saudação",
  NAME: "Primeiro nome",
  SECOND_NAME: "Segundo nome",
  LAST_NAME: "Sobrenome",
  BIRTHDATE: "Data de nascimento",
  DATE_CREATE: "Criado",
  STATUS_DESCRIPTION: "Informações da etapa",
  SOURCE_ID: "Fonte",
  SOURCE_DESCRIPTION: "Informações da fonte",
  DATE_MODIFY: "Última atualização em",
  COMPANY_TITLE: "Nome da Empresa",
  COMPANY_ID: "Empresa",
  POST: "Posição",
  ADDRESS: "Endereço",
  ADDRESS_2: "Rua, nº da casa",
  ADDRESS_CITY: "Cidade",
  ADDRESS_REGION: "Distrito",
  ADDRESS_PROVINCE: "Região/Área",
  ADDRESS_POSTAL_CODE: "Código Postal (CEP)",
  ADDRESS_COUNTRY: "País",
  COMMENTS: "Comentário",
  OPPORTUNITY: "Renda",
  CURRENCY_ID: "Moeda",
  WEBFORM_ID: "Criada pelo formulário de CRM",
  IS_RETURN_CUSTOMER: "Negócio repetido",
  MOVED_TIME: "Data da mudança de etapa",
  UTM_SOURCE: "UTM Source",
  UTM_MEDIUM: "UTM Medium",
  UTM_CAMPAIGN: "UTM Campaign",
  UTM_CONTENT: "UTM Content",
  UTM_TERM: "UTM Term",
  UF_CRM_LEAD_1710181729432: "Quantidade de contas de WhatsApp em sua empresa(S)",
  UF_CRM_LEAD_1710181844287: "Outros Casos de Uso",
  UF_CRM_LEAD_1711031049279: "WhatsApp.lead",
  UF_CRM_1711380283: "Caso(s) de Uso",
  UF_CRM_1711981431: "Link WhatsApp",
  UF_CRM_1712063451265: "Necessidade",
  UF_CRM_1712063474493: "Autoridade",
  UF_CRM_1712319204356: "Motivo da desqualificação",
  UF_CRM_1712319365583: "Detalhes da desqualificação",
  UF_CRM_1712763104: "Quantidade de contas de WhatsApp em sua empresa",
  UF_CRM_1712763467: "Sou/Represento uma Empresa",
  UF_CRM_LEAD_1712766441234: "Número de seu WhatsApp com ddd",
  UF_CRM_1713984862: "Sales Qualified Lead",
  UF_CRM_1722903196: "Consultor Responsável",
  UF_CRM_1728575207836: "Quantidade de contas monitoradas",
  UF_CRM_1728913567: "AE Responsável",
  UF_CRM_1728913647652: "Grupo de origem",
  UF_CRM_1728913702: "Lead score",
  UF_CRM_1728914053: "Data desqualificação",
  UF_CRM_1728914081: "Data qualificação",
  UF_CRM_1731530978625: "Indústria",
  UF_CRM_1731531005705: "Indústria (detalhes)",
  UF_CRM_1731952339: "Negociação/Cliente?",
  UF_CRM_1732191501: "Recebe E-mails Marketing?",
  // "(Lead)" para distinguir do campo homônimo de negócio (UF_CRM_67EACEFCCCD98)
  // no construtor de fórmulas — os dois viravam "Contagem de Data Reunião".
  UF_CRM_1743441331: "Data Reunião (Lead)",
  UF_CRM_LEAD_1746471547151: "O que você busca resolver com Zapper? - Facebook",
  UF_CRM_1749753840: "Quantidade de contas de WhatsApp a monitorar(FB)",
  UF_CRM_1753299252: "email.lead",
  UF_CRM_1753299269: "nome.lead",
  UF_CRM_1755622688: "ID Lead RD",
  UF_CRM_1755622732: "ID Lead MT",
  UF_CRM_LEAD_1761648166123: "Work Email",
  LAST_COMMUNICATION_TIME: "Último contato",
  IS_REPEATED_APPROACH: "Consulta repetida",
  PROBABILITY: "Probabilidade, %",
  PAY_STATUS: "Status do pagamento",
  DELIVERY_STATUS: "Status de entrega",
  LEAD_ID: "Vínculo",
  CLOSED: "Fechado",
  BEGINDATE: "Data de início",
  CLOSEDATE: "Data de fechamento",
  ORIGINATOR_ID: "Criada pelo formulário de CRM",
  UF_CRM_65FB7D6B53C3C: "Caso(s) de Uso",
  UF_CRM_65FC496E40C40: "Quantidade de contas de WhatsApp em sua empresa(S)",
  UF_CRM_65FC496E56B05: "Outros Casos de Uso",
  UF_CRM_65FC496E5EAE5: "WhatsApp.lead",
  UF_CRM_660ABC1A9ED8A: "WhatsApp.negócio",
  UF_CRM_660B1A863C60D: "Link WhatsApp",
  UF_CRM_1712081994801: "Orçamento",
  UF_CRM_1712082038339: "Autoridade",
  UF_CRM_1712082079810: "Necessidade",
  UF_CRM_660FF22427D0A: "Motivo da desqualificação",
  UF_CRM_660FF2244AC6A: "Detalhes da desqualificação",
  UF_CRM_1712694237729: "Contrato Assinado",
  UF_CRM_1712694351368: "Nome do responsável pelo Onboarding",
  UF_CRM_1712694396367: "Telefone do responsável pelo Onboarding",
  UF_CRM_1712694416274: "Email do responsável pelo Onboarding",
  UF_CRM_6616EE3A1D505: "Quantidade de contas de WhatsApp em sua empresa",
  UF_CRM_6616EE3A2D0D8: "Sou/Represento uma Empresa",
  UF_CRM_6616EE3A3850F: "Número de seu WhatsApp com ddd",
  UF_CRM_66295FBA14AA6: "Sales Qualified Lead",
  UF_CRM_1714743617062: "Link da 1ª Reunião Gravada",
  UF_CRM_1715111700112: "Razão Social do Cliente",
  UF_CRM_1715111748742: "Nome Fantasia",
  UF_CRM_1715111774935: "CNPJ",
  UF_CRM_1715111926953: "Valor por licença do contrato (R$)",
  UF_CRM_1715111953936: "Valor por licença extra (R$)",
  UF_CRM_1715112112104: "Necessidade/Dor do Cliente",
  UF_CRM_1715112135150: "Potencial identificado no Cliente",
  UF_CRM_1715112157359: "Observações pertinentes",
  UF_CRM_1715258133683: "Número de licenças contratadas",
  UF_CRM_1715363010: "Responsável pelo Fechamento",
  UF_CRM_1715363554: "Nome Responsável Financeiro",
  UF_CRM_1715363563: "Telefone Responsável Financeiro",
  UF_CRM_1715363571: "Email Responsável Financeiro",
  UF_CRM_1720729034783: "Data Apresentação",
  UF_CRM_1720729059595: "Link da Implementação",
  UF_CRM_1720729076400: "Data Implementação",
  UF_CRM_1720729195283: "Conclusão do Onboarding",
  UF_CRM_1720730755289: "Link do Review",
  UF_CRM_1720730768030: "Data do Review",
  UF_CRM_66BA02D679160: "Consultor Responsável",
  UF_CRM_6708125AE6020: "Quantidade de contas monitoradas",
  UF_CRM_670D3038A49B4: "AE Responsável",
  UF_CRM_670D3038C98A0: "Grupo de origem",
  UF_CRM_670D3038F1DCF: "Lead score",
  UF_CRM_670D30391B47A: "Data desqualificação",
  UF_CRM_670D30392B620: "Data qualificação",
  UF_CRM_1729887417240: "Tipo de contrato",
  UF_CRM_1729887483290: "Condições de pagamento",
  UF_CRM_1729887525503: "Quantidade de licenças contratadas",
  UF_CRM_1729887560060: "Valor da licença contratada",
  UF_CRM_1729887583805: "MRR",
  UF_CRM_1729887608434: "Data da assinatura",
  UF_CRM_1729887656224: "Contrato assinado",
  UF_CRM_1729887690007: "Potencial de crescimento",
  UF_CRM_1729887798973: "Nota NPS",
  UF_CRM_1729887809591: "Comentário NPS",
  UF_CRM_1729887901047: "Link reunião onboarding",
  UF_CRM_1729887926401: "Link apresentação onboarding",
  UF_CRM_1729888316385: "Termperatura do cliente",
  UF_CRM_1729890653843: "Status do acesso guiado",
  UF_CRM_1730223822320: "Tier",
  UF_CRM_673512D46CD31: "Indústria",
  UF_CRM_673512D48529F: "Indústria (detalhes)",
  UF_CRM_673B8ABB73E23: "Negociação/Cliente?",
  UF_CRM_673F348EC6FA6: "Recebe E-mails Marketing?",
  UF_CRM_1736255583330: "Data da desqualificação(APAGAR)",
  UF_CRM_1739552352625: "Health Score",
  UF_CRM_1739553426880: "Detalhamento Assessment",
  UF_CRM_1740147404000: "Novo texto",
  UF_CRM_1740147679140: "Objetivo da Contração",
  UF_CRM_1740484138461: "Cliente solicitou cancelamento alguma vez?",
  UF_CRM_1740484195874: "Já solicitou cancelamento alguma vez?",
  UF_CRM_1740484699185: "Motivo da solicitação  do Cancelamento",
  UF_CRM_1740484795112: "Detalhamento da Tratativa do Cancelamento",
  UF_CRM_1740485386225: "Entregas com dados da Zapper",
  UF_CRM_1740485406109: "Detalhamento das Entregasa",
  UF_CRM_1740494154222: "Nome do decisor",
  UF_CRM_1740494176577: "Telefone do decisor",
  UF_CRM_1740494201300: "Email do decisor",
  UF_CRM_1740494245130: "Nome do gestor  da ferramenta Zapper",
  UF_CRM_1740494264316: "Telefone do gestor  da ferramenta Zapper",
  UF_CRM_1740494284995: "Email gestor  da ferramenta Zapper",
  UF_CRM_1740494996849: "Detalhamento do Objetivo do cliente",
  UF_CRM_1740741566579: "Compliance ID",
  UF_CRM_1741283829282: "Data do cancelamento",
  UF_CRM_1741283991648: "Data da finalização",
  UF_CRM_1741295646288: "Houve reversão?",
  UF_CRM_1741296180747: "Houve reversão?",
  UF_CRM_1742214066621: "Pasta do Cliente",
  // "(Negócio)" para distinguir do campo homônimo de lead (UF_CRM_1743441331).
  UF_CRM_67EACEFCCCD98: "Data Reunião (Negócio)",
  UF_CRM_1744202582275: "E-mail para Liberação do Analytics",
  UF_CRM_1744203748950: "Regra de Cobrança",
  UF_CRM_1744203833098: "Modelo de Upsell",
  UF_CRM_1744203880205: "Fluxo do pagamento",
  UF_CRM_1744203991165: "Nome no Financeiro",
  UF_CRM_1744204037903: "Situação do Pagamento",
  UF_CRM_1744204178867: "Número de licenças bonificadas",
  UF_CRM_1744204239153: "Observações sobre as licenças bonificadas",
  UF_CRM_1744204463340: "Observação sobre o Pagamento",
  UF_CRM_1744912948795: "Cliente usará o Analytics?",
  UF_CRM_1744913087525: "Observação sobre o Analytics",
  UF_CRM_68190B490490E: "O que você busca resolver com Zapper? - Facebook",
  UF_CRM_684B29B2229E9: "Quantidade de contas de WhatsApp a monitorar(FB)",
  UF_CRM_1750187148619: "CS Responsável",
  UF_CRM_68826C3694B45: "email.lead",
  UF_CRM_68826C36B5FE7: "nome.lead",
  UF_CRM_68A4DE10375FB: "ID Lead RD",
  UF_CRM_68A4DE105C16A: "ID Lead MT",
  UF_CRM_1755888290: "Canal",
  UF_CRM_1757444918: "SDR Responsável",
  UF_CRM_1778094396888: "Implementação",
  UF_CRM_69012FCE35D9D: "Work Email",
  REPEAT_SALE_SEGMENT_ID: "Script de vendas recorrentes",
};

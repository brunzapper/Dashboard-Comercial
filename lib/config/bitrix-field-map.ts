// Versão: 1.1 | Data: 09/07/2026
// v1.1 (09/07/2026): Fase 8 — LEAD_CUSTOM/DEAL_CUSTOM ampliados com o conjunto
//   COMPLETO de colunas do arquivo de integração (nome visual + tipo), para que
//   toda coluna apareça com rótulo legível. CustomFieldMap ganha `label`.
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
  label?: string; // rótulo visual (do mapa do Bitrix); usado quando o schema
  // do Bitrix não trouxer título — garante nome visual mesmo sem sync recente.
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
  // Fase 8: colunas completas do mapa de integração (nome visual + tipo).
  IS_RETURN_CUSTOMER: { key: "negocio_repetido", type: "string", label: "Negócio repetido" },
  IS_REPEATED_APPROACH: { key: "consulta_repetida", type: "string", label: "Consulta repetida" },
  PROBABILITY: { key: "probabilidade", type: "string", label: "Probabilidade, %" },
  PAY_STATUS: { key: "status_do_pagamento", type: "string", label: "Status do pagamento" },
  DELIVERY_STATUS: { key: "status_de_entrega", type: "string", label: "Status de entrega" },
  SOURCE_DESCRIPTION: { key: "informacoes_da_fonte", type: "string", label: "Informações da fonte" },
  COMMENTS: { key: "comentario", type: "string", label: "Comentário" },
  ORIGINATOR_ID: { key: "criada_pelo_formulario_de_crm", type: "string", label: "Criada pelo formulário de CRM" },
  UF_CRM_65FB7D6B53C3C: { key: "caso_s_de_uso", type: "enumeration", label: "Caso(s) de Uso" },
  UF_CRM_65FC496E40C40: { key: "quantidade_de_contas_de_whatsapp_em_sua_empresa_s", type: "string", label: "Quantidade de contas de WhatsApp em sua empresa(S)" },
  UF_CRM_65FC496E56B05: { key: "outros_casos_de_uso", type: "string", label: "Outros Casos de Uso" },
  UF_CRM_65FC496E5EAE5: { key: "whatsapp_lead", type: "double", label: "WhatsApp.lead" },
  UF_CRM_660ABC1A9ED8A: { key: "whatsapp_negocio", type: "double", label: "WhatsApp.negócio" },
  UF_CRM_660B1A863C60D: { key: "link_whatsapp", type: "string", label: "Link WhatsApp" },
  UF_CRM_1712081994801: { key: "orcamento", type: "string", label: "Orçamento" },
  UF_CRM_1712082038339: { key: "autoridade", type: "string", label: "Autoridade" },
  UF_CRM_1712082079810: { key: "necessidade", type: "string", label: "Necessidade" },
  UF_CRM_660FF2244AC6A: { key: "detalhes_da_desqualificacao", type: "string", label: "Detalhes da desqualificação" },
  UF_CRM_1712694237729: { key: "contrato_assinado", type: "string", label: "Contrato Assinado" },
  UF_CRM_1712694351368: { key: "nome_do_responsavel_pelo_onboarding", type: "string", label: "Nome do responsável pelo Onboarding" },
  UF_CRM_1712694396367: { key: "telefone_do_responsavel_pelo_onboarding", type: "string", label: "Telefone do responsável pelo Onboarding" },
  UF_CRM_1712694416274: { key: "email_do_responsavel_pelo_onboarding", type: "string", label: "Email do responsável pelo Onboarding" },
  UF_CRM_6616EE3A1D505: { key: "quantidade_de_contas_de_whatsapp_em_sua_empresa", type: "string", label: "Quantidade de contas de WhatsApp em sua empresa" },
  UF_CRM_6616EE3A2D0D8: { key: "sou_represento_uma_empresa", type: "boolean", label: "Sou/Represento uma Empresa" },
  UF_CRM_6616EE3A3850F: { key: "numero_de_seu_whatsapp_com_ddd", type: "string", label: "Número de seu WhatsApp com ddd" },
  UF_CRM_66295FBA14AA6: { key: "sales_qualified_lead", type: "boolean", label: "Sales Qualified Lead" },
  UF_CRM_1714743617062: { key: "link_da_1_reuniao_gravada", type: "string", label: "Link da 1ª Reunião Gravada" },
  UF_CRM_1715111926953: { key: "valor_por_licenca_do_contrato_r", type: "money", label: "Valor por licença do contrato (R$)" },
  UF_CRM_1715111953936: { key: "valor_por_licenca_extra_r", type: "money", label: "Valor por licença extra (R$)" },
  UF_CRM_1715112112104: { key: "necessidade_dor_do_cliente", type: "string", label: "Necessidade/Dor do Cliente" },
  UF_CRM_1715112135150: { key: "potencial_identificado_no_cliente", type: "string", label: "Potencial identificado no Cliente" },
  UF_CRM_1715112157359: { key: "observacoes_pertinentes", type: "string", label: "Observações pertinentes" },
  UF_CRM_1715258133683: { key: "numero_de_licencas_contratadas", type: "string", label: "Número de licenças contratadas" },
  UF_CRM_1715363010: { key: "responsavel_pelo_fechamento", type: "string", label: "Responsável pelo Fechamento" },
  UF_CRM_1715363554: { key: "nome_responsavel_financeiro", type: "string", label: "Nome Responsável Financeiro" },
  UF_CRM_1715363563: { key: "telefone_responsavel_financeiro", type: "string", label: "Telefone Responsável Financeiro" },
  UF_CRM_1715363571: { key: "email_responsavel_financeiro", type: "string", label: "Email Responsável Financeiro" },
  UF_CRM_1720729034783: { key: "data_apresentacao", type: "date", label: "Data Apresentação" },
  UF_CRM_1720729059595: { key: "link_da_implementacao", type: "string", label: "Link da Implementação" },
  UF_CRM_1720729076400: { key: "data_implementacao", type: "date", label: "Data Implementação" },
  UF_CRM_1720729195283: { key: "conclusao_do_onboarding", type: "date", label: "Conclusão do Onboarding" },
  UF_CRM_1720730755289: { key: "link_do_review", type: "string", label: "Link do Review" },
  UF_CRM_1720730768030: { key: "data_do_review", type: "date", label: "Data do Review" },
  UF_CRM_6708125AE6020: { key: "quantidade_de_contas_monitoradas", type: "double", label: "Quantidade de contas monitoradas" },
  UF_CRM_670D3038F1DCF: { key: "lead_score", type: "enumeration", label: "Lead score" },
  UF_CRM_670D30391B47A: { key: "data_desqualificacao", type: "date", label: "Data desqualificação" },
  UF_CRM_670D30392B620: { key: "data_qualificacao", type: "date", label: "Data qualificação" },
  UF_CRM_1729887483290: { key: "condicoes_de_pagamento", type: "enumeration", label: "Condições de pagamento" },
  UF_CRM_1729887656224: { key: "contrato_assinado_2", type: "enumeration", label: "Contrato assinado" },
  UF_CRM_1729887690007: { key: "potencial_de_crescimento", type: "string", label: "Potencial de crescimento" },
  UF_CRM_1729887798973: { key: "nota_nps", type: "double", label: "Nota NPS" },
  UF_CRM_1729887809591: { key: "comentario_nps", type: "string", label: "Comentário NPS" },
  UF_CRM_1729887901047: { key: "link_reuniao_onboarding", type: "string", label: "Link reunião onboarding" },
  UF_CRM_1729887926401: { key: "link_apresentacao_onboarding", type: "string", label: "Link apresentação onboarding" },
  UF_CRM_1729890653843: { key: "status_do_acesso_guiado", type: "enumeration", label: "Status do acesso guiado" },
  UF_CRM_673512D46CD31: { key: "industria", type: "enumeration", label: "Indústria" },
  UF_CRM_673512D48529F: { key: "industria_detalhes", type: "string", label: "Indústria (detalhes)" },
  UF_CRM_673B8ABB73E23: { key: "negociacao_cliente", type: "boolean", label: "Negociação/Cliente?" },
  UF_CRM_673F348EC6FA6: { key: "recebe_e_mails_marketing", type: "boolean", label: "Recebe E-mails Marketing?" },
  UF_CRM_1736255583330: { key: "data_da_desqualificacao_apagar", type: "date", label: "Data da desqualificação(APAGAR)" },
  UF_CRM_1739552352625: { key: "health_score", type: "enumeration", label: "Health Score" },
  UF_CRM_1739553426880: { key: "detalhamento_assessment", type: "string", label: "Detalhamento Assessment" },
  UF_CRM_1740147404000: { key: "novo_texto", type: "string", label: "Novo texto" },
  UF_CRM_1740147679140: { key: "objetivo_da_contracao", type: "enumeration", label: "Objetivo da Contração" },
  UF_CRM_1740484138461: { key: "cliente_solicitou_cancelamento_alguma_vez", type: "boolean", label: "Cliente solicitou cancelamento alguma vez?" },
  UF_CRM_1740484195874: { key: "ja_solicitou_cancelamento_alguma_vez", type: "enumeration", label: "Já solicitou cancelamento alguma vez?" },
  UF_CRM_1740484699185: { key: "motivo_da_solicitacao_do_cancelamento", type: "enumeration", label: "Motivo da solicitação  do Cancelamento" },
  UF_CRM_1740484795112: { key: "detalhamento_da_tratativa_do_cancelamento", type: "string", label: "Detalhamento da Tratativa do Cancelamento" },
  UF_CRM_1740485386225: { key: "entregas_com_dados_da_zapper", type: "enumeration", label: "Entregas com dados da Zapper" },
  UF_CRM_1740485406109: { key: "detalhamento_das_entregasa", type: "string", label: "Detalhamento das Entregasa" },
  UF_CRM_1740494154222: { key: "nome_do_decisor", type: "string", label: "Nome do decisor" },
  UF_CRM_1740494176577: { key: "telefone_do_decisor", type: "string", label: "Telefone do decisor" },
  UF_CRM_1740494201300: { key: "email_do_decisor", type: "string", label: "Email do decisor" },
  UF_CRM_1740494245130: { key: "nome_do_gestor_da_ferramenta_zapper", type: "string", label: "Nome do gestor  da ferramenta Zapper" },
  UF_CRM_1740494264316: { key: "telefone_do_gestor_da_ferramenta_zapper", type: "string", label: "Telefone do gestor  da ferramenta Zapper" },
  UF_CRM_1740494284995: { key: "email_gestor_da_ferramenta_zapper", type: "string", label: "Email gestor  da ferramenta Zapper" },
  UF_CRM_1740494996849: { key: "detalhamento_do_objetivo_do_cliente", type: "string", label: "Detalhamento do Objetivo do cliente" },
  UF_CRM_1740741566579: { key: "compliance_id", type: "string", label: "Compliance ID" },
  UF_CRM_1741283829282: { key: "data_do_cancelamento", type: "date", label: "Data do cancelamento" },
  UF_CRM_1741283991648: { key: "data_da_finalizacao", type: "date", label: "Data da finalização" },
  UF_CRM_1741295646288: { key: "houve_reversao", type: "boolean", label: "Houve reversão?" },
  UF_CRM_1741296180747: { key: "houve_reversao_2", type: "enumeration", label: "Houve reversão?" },
  UF_CRM_1742214066621: { key: "pasta_do_cliente", type: "string", label: "Pasta do Cliente" },
  UF_CRM_67EACEFCCCD98: { key: "data_reuniao", type: "datetime", label: "Data Reunião" },
  UF_CRM_1744202582275: { key: "e_mail_para_liberacao_do_analytics", type: "string", label: "E-mail para Liberação do Analytics" },
  UF_CRM_1744203748950: { key: "regra_de_cobranca", type: "enumeration", label: "Regra de Cobrança" },
  UF_CRM_1744203833098: { key: "modelo_de_upsell", type: "enumeration", label: "Modelo de Upsell" },
  UF_CRM_1744203880205: { key: "fluxo_do_pagamento", type: "enumeration", label: "Fluxo do pagamento" },
  UF_CRM_1744203991165: { key: "nome_no_financeiro", type: "string", label: "Nome no Financeiro" },
  UF_CRM_1744204037903: { key: "situacao_do_pagamento", type: "enumeration", label: "Situação do Pagamento" },
  UF_CRM_1744204178867: { key: "numero_de_licencas_bonificadas", type: "double", label: "Número de licenças bonificadas" },
  UF_CRM_1744204239153: { key: "observacoes_sobre_as_licencas_bonificadas", type: "string", label: "Observações sobre as licenças bonificadas" },
  UF_CRM_1744204463340: { key: "observacao_sobre_o_pagamento", type: "string", label: "Observação sobre o Pagamento" },
  UF_CRM_1744912948795: { key: "cliente_usara_o_analytics", type: "enumeration", label: "Cliente usará o Analytics?" },
  UF_CRM_1744913087525: { key: "observacao_sobre_o_analytics", type: "string", label: "Observação sobre o Analytics" },
  UF_CRM_68190B490490E: { key: "o_que_voce_busca_resolver_com_zapper_facebook", type: "string", label: "O que você busca resolver com Zapper? - Facebook" },
  UF_CRM_684B29B2229E9: { key: "quantidade_de_contas_de_whatsapp_a_monitorar_fb", type: "string", label: "Quantidade de contas de WhatsApp a monitorar(FB)" },
  UF_CRM_1750187148619: { key: "cs_responsavel", type: "enumeration", label: "CS Responsável" },
  UF_CRM_68826C3694B45: { key: "email_lead", type: "string", label: "email.lead" },
  UF_CRM_68826C36B5FE7: { key: "nome_lead", type: "string", label: "nome.lead" },
  UF_CRM_68A4DE10375FB: { key: "id_lead_rd", type: "string", label: "ID Lead RD" },
  UF_CRM_68A4DE105C16A: { key: "id_lead_mt", type: "string", label: "ID Lead MT" },
  UF_CRM_69012FCE35D9D: { key: "work_email", type: "string", label: "Work Email" },
  REPEAT_SALE_SEGMENT_ID: { key: "script_de_vendas_recorrentes", type: "string", label: "Script de vendas recorrentes" },
  LAST_COMMUNICATION_TIME: { key: "ultimo_contato", type: "string", label: "Último contato" },
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
  // Fase 8: colunas completas do mapa de integração (nome visual + tipo).
  HONORIFIC: { key: "saudacao", type: "string", label: "Saudação" },
  NAME: { key: "primeiro_nome", type: "string", label: "Primeiro nome" },
  SECOND_NAME: { key: "segundo_nome", type: "string", label: "Segundo nome" },
  LAST_NAME: { key: "sobrenome", type: "string", label: "Sobrenome" },
  BIRTHDATE: { key: "data_de_nascimento", type: "string", label: "Data de nascimento" },
  STATUS_DESCRIPTION: { key: "informacoes_da_etapa", type: "string", label: "Informações da etapa" },
  SOURCE_DESCRIPTION: { key: "informacoes_da_fonte", type: "string", label: "Informações da fonte" },
  POST: { key: "posicao", type: "string", label: "Posição" },
  ADDRESS: { key: "endereco", type: "string", label: "Endereço" },
  ADDRESS_2: { key: "rua_n_da_casa", type: "string", label: "Rua, nº da casa" },
  ADDRESS_CITY: { key: "cidade", type: "string", label: "Cidade" },
  ADDRESS_REGION: { key: "distrito", type: "string", label: "Distrito" },
  ADDRESS_PROVINCE: { key: "regiao_area", type: "string", label: "Região/Área" },
  ADDRESS_POSTAL_CODE: { key: "codigo_postal_cep", type: "string", label: "Código Postal (CEP)" },
  ADDRESS_COUNTRY: { key: "pais", type: "string", label: "País" },
  COMMENTS: { key: "comentario", type: "string", label: "Comentário" },
  WEBFORM_ID: { key: "criada_pelo_formulario_de_crm", type: "string", label: "Criada pelo formulário de CRM" },
  IS_RETURN_CUSTOMER: { key: "lead_repetido", type: "string", label: "Lead repetido" },
  UF_CRM_LEAD_1710181729432: { key: "quantidade_de_contas_de_whatsapp_em_sua_empresa_s", type: "string", label: "Quantidade de contas de WhatsApp em sua empresa(S)" },
  UF_CRM_LEAD_1710181844287: { key: "outros_casos_de_uso", type: "string", label: "Outros Casos de Uso" },
  UF_CRM_LEAD_1711031049279: { key: "whatsapp_lead", type: "string", label: "WhatsApp.lead" },
  UF_CRM_1711380283: { key: "caso_s_de_uso", type: "enumeration", label: "Caso(s) de Uso" },
  UF_CRM_1711981431: { key: "link_whatsapp", type: "string", label: "Link WhatsApp" },
  UF_CRM_1712063451265: { key: "necessidade", type: "string", label: "Necessidade" },
  UF_CRM_1712063474493: { key: "autoridade", type: "string", label: "Autoridade" },
  UF_CRM_1712319365583: { key: "detalhes_da_desqualificacao", type: "string", label: "Detalhes da desqualificação" },
  UF_CRM_1712763104: { key: "quantidade_de_contas_de_whatsapp_em_sua_empresa", type: "string", label: "Quantidade de contas de WhatsApp em sua empresa" },
  UF_CRM_1712763467: { key: "sou_represento_uma_empresa", type: "boolean", label: "Sou/Represento uma Empresa" },
  UF_CRM_LEAD_1712766441234: { key: "numero_de_seu_whatsapp_com_ddd", type: "string", label: "Número de seu WhatsApp com ddd" },
  UF_CRM_1728575207836: { key: "quantidade_de_contas_monitoradas", type: "double", label: "Quantidade de contas monitoradas" },
  UF_CRM_1728913567: { key: "ae_responsavel", type: "employee", label: "AE Responsável" },
  UF_CRM_1731530978625: { key: "industria", type: "enumeration", label: "Indústria" },
  UF_CRM_1731531005705: { key: "industria_detalhes", type: "string", label: "Indústria (detalhes)" },
  UF_CRM_1731952339: { key: "negociacao_cliente", type: "boolean", label: "Negociação/Cliente?" },
  UF_CRM_1732191501: { key: "recebe_e_mails_marketing", type: "boolean", label: "Recebe E-mails Marketing?" },
  UF_CRM_1743441331: { key: "data_reuniao", type: "datetime", label: "Data Reunião" },
  UF_CRM_LEAD_1746471547151: { key: "o_que_voce_busca_resolver_com_zapper_facebook", type: "string", label: "O que você busca resolver com Zapper? - Facebook" },
  UF_CRM_1749753840: { key: "quantidade_de_contas_de_whatsapp_a_monitorar_fb", type: "string", label: "Quantidade de contas de WhatsApp a monitorar(FB)" },
  UF_CRM_1753299252: { key: "email_lead", type: "string", label: "email.lead" },
  UF_CRM_1753299269: { key: "nome_lead", type: "string", label: "nome.lead" },
  UF_CRM_1755622688: { key: "id_lead_rd", type: "string", label: "ID Lead RD" },
  UF_CRM_1755622732: { key: "id_lead_mt", type: "string", label: "ID Lead MT" },
  UF_CRM_LEAD_1761648166123: { key: "work_email", type: "string", label: "Work Email" },
  LAST_COMMUNICATION_TIME: { key: "ultimo_contato", type: "string", label: "Último contato" },
};

// Pipelines de negócios a sincronizar. "Vendas" = CATEGORY_ID 0 (fixo);
// "Enterprise" é descoberto via crm.dealcategory.list pelo nome.
export const DEAL_PIPELINES = {
  vendasCategoryId: "0",
  enterpriseCategoryName: "Enterprise",
} as const;

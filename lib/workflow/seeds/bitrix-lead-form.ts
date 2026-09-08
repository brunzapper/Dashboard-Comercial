// Versão: 1.0 | Data: 08/09/2026
// Esquema de FÁBRICA "Formulário de criação Bitrix" — o primeiro esquema real
// do Workflow (0125) e a demonstração de que o motor é genérico: nada aqui é
// código, é dado.
//
// O formulário é UMA lista plana de campos. Quem lança o lead não vê "Empresa",
// "Contato" e "Lead" como coisas separadas — vê os dados do lead. O destrinchar
// em três entidades do CRM é dos PASSOS, e cada um puxa o que precisa da mesma
// resposta por referência: {{form.empresa}} alimenta o TITLE da empresa E o
// COMPANY_TITLE do lead; {{form.contato_nome}} alimenta o contato E o lead.
//
// Os passos são individualmente desligáveis. Desligar "Criar empresa" faz
// {{steps.criar_empresa.id}} resolver vazio, e o lead nasce sem COMPANY_ID —
// nada quebra, porque nenhum passo conhece os outros.
import type { WorkflowDefinition } from "../types";

export const BITRIX_LEAD_FORM_KEY = "bitrix_lead_form";
export const BITRIX_LEAD_FORM_LABEL = "Formulário de criação Bitrix";
export const BITRIX_LEAD_FORM_DESCRIPTION =
  "Lança um lead no Bitrix24 a partir de um formulário: cria a empresa, o contato e o lead vinculados, e grava o registro local já pareado com o CRM.";

/** Base local de destino do passo de registro. */
const LEAD_SOURCE_KEY = "lead";

export function bitrixLeadFormDefinition(): WorkflowDefinition {
  return {
    version: 1,
    form: {
      fields: [
        {
          key: "empresa",
          label: "Nome do Lead (empresa)",
          type: "texto",
          required: true,
          visible: true,
          order: 0,
          placeholder: "Ex.: Acme Indústria",
          help: "Vira o nome da empresa no CRM e o título do lead.",
        },
        {
          key: "contato_nome",
          label: "Nome do contato",
          type: "texto",
          required: true,
          visible: true,
          order: 1,
          placeholder: "Ex.: Maria Silva",
          help: "Primeiro nome e sobrenome são separados automaticamente.",
        },
        {
          key: "telefone",
          label: "Telefone do contato",
          type: "telefone",
          required: false,
          visible: true,
          order: 2,
          placeholder: "(11) 90000-0000",
        },
        {
          key: "email",
          label: "E-mail",
          type: "email",
          required: false,
          visible: true,
          order: 3,
          placeholder: "maria@acme.com.br",
        },
        {
          key: "fonte",
          label: "Fonte",
          type: "selecao",
          required: false,
          visible: true,
          order: 4,
          optionsSource: "bitrix:sources",
          help: "Origens cadastradas no portal.",
        },
        {
          key: "fonte_info",
          label: "Informações da Fonte",
          type: "texto",
          required: false,
          visible: true,
          order: 5,
          placeholder: "Ex.: indicação do João, evento X",
        },
        {
          key: "comentarios",
          label: "Comentários",
          type: "texto_longo",
          required: false,
          visible: true,
          order: 6,
        },
        // Disponíveis, ocultos por padrão: quem quiser exibir liga em Esquemas.
        {
          key: "etapa",
          label: "Etapa",
          type: "selecao",
          required: false,
          visible: false,
          order: 7,
          optionsSource: "bitrix:lead_status",
          help: "Vazio deixa o lead na primeira etapa do funil.",
        },
        {
          key: "responsavel",
          label: "Responsável",
          type: "selecao",
          required: false,
          visible: false,
          order: 8,
          optionsSource: "responsibles",
          help: "Vazio usa o responsável vinculado a quem preencheu.",
        },
      ],
    },
    steps: [
      {
        id: "criar_empresa",
        type: "bitrix.entity.add",
        label: "Criar empresa no CRM",
        enabled: true,
        connection: "bitrix_webhook",
        params: {
          entity: "company",
          // Sem nome de empresa não há empresa a criar — pula sem erro.
          skipIfEmpty: "{{form.empresa}}",
          fields: {
            TITLE: { value: "{{form.empresa}}" },
            ASSIGNED_BY_ID: { value: "{{ctx.responsibleBitrixId}}" },
          },
        },
      },
      {
        id: "criar_contato",
        type: "bitrix.entity.add",
        label: "Criar contato no CRM",
        enabled: true,
        connection: "bitrix_webhook",
        params: {
          entity: "contact",
          skipIfEmpty: "{{form.contato_nome}}",
          fields: {
            NAME: { value: "{{ctx.contatoPrimeiroNome}}" },
            LAST_NAME: { value: "{{ctx.contatoSobrenome}}" },
            // Vínculo 1: pendura o contato na empresa recém-criada.
            COMPANY_ID: { value: "{{steps.criar_empresa.id}}" },
            EMAIL: { value: "{{form.email}}", shape: "comm" },
            PHONE: { value: "{{form.telefone}}", shape: "comm" },
            ASSIGNED_BY_ID: { value: "{{ctx.responsibleBitrixId}}" },
          },
        },
      },
      {
        id: "criar_lead",
        type: "bitrix.entity.add",
        label: "Criar lead no CRM",
        enabled: true,
        connection: "bitrix_webhook",
        params: {
          entity: "lead",
          fields: {
            TITLE: { value: "{{form.empresa}}" },
            NAME: { value: "{{ctx.contatoPrimeiroNome}}" },
            LAST_NAME: { value: "{{ctx.contatoSobrenome}}" },
            // COMPANY_TITLE (texto) e COMPANY_ID (vínculo) convivem de
            // propósito: o texto sobrevive mesmo se a empresa não for criada.
            COMPANY_TITLE: { value: "{{form.empresa}}" },
            COMPANY_ID: { value: "{{steps.criar_empresa.id}}" },
            CONTACT_ID: { value: "{{steps.criar_contato.id}}" },
            SOURCE_ID: { value: "{{form.fonte}}" },
            SOURCE_DESCRIPTION: { value: "{{form.fonte_info}}" },
            STATUS_ID: { value: "{{form.etapa}}" },
            COMMENTS: { value: "{{form.comentarios}}" },
            EMAIL: { value: "{{form.email}}", shape: "comm" },
            PHONE: { value: "{{form.telefone}}", shape: "comm" },
            ASSIGNED_BY_ID: { value: "{{ctx.responsibleBitrixId}}" },
          },
        },
      },
      {
        id: "gravar_registro",
        type: "record.create",
        label: "Gravar registro local",
        enabled: true,
        params: {
          sourceKey: LEAD_SOURCE_KEY,
          // Vínculo com o lead: o registro nasce pareado e o próximo sync o
          // ADOTA em vez de criar uma duplicata.
          linkSourceIdFrom: "criar_lead",
          core: {
            title: { value: "{{form.empresa}}" },
            stage: { value: "{{form.etapa}}" },
          },
          custom: {
            empresa: { value: "{{form.empresa}}" },
            fonte: { value: "{{form.fonte}}" },
          },
        },
      },
    ],
  };
}

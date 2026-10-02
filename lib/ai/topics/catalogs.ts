// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): REGISTRY ÚNICO dos catálogos de tópicos — um por
// assistente de IA. Todo laço de geração (`runJsonGenerationLoop` e o laço
// próprio de dashboards) recebe o catálogo do seu domínio; a guarda estática
// (catalogs.test.ts) recusa chamada sem `topics:`.
//
// Por que um catálogo mesmo onde não há o que escolher: o catálogo é o lugar
// onde uma SEÇÃO NOVA do prompt é classificada. O teste de paridade monta o
// prompt de cada domínio e acusa cabeçalho de nível 1–2 que não esteja aqui
// (nem na lista de núcleo) — feature nova voltada à IA não entra no prompt
// sem alguém decidir se ela é sempre necessária ou um tópico escolhível.
// Onde o contrato é pequeno e indivisível (um formato só), `topics` fica vazio
// e o roteador nem é chamado ("nada a escolher") — a chamada extra só existe
// onde ela economiza alguma coisa.
//
// PURO (client-safe; sem I/O).
import { DASHBOARD_TOPIC_CATALOG } from "@/lib/import/dashboard/topics";
import type { TopicCatalog } from "./split";

export { DASHBOARD_TOPIC_CATALOG };

/** Cabeçalhos de seção que são NÚCLEO (sempre enviados) em algum domínio. */
export const CORE_HEADINGS: readonly string[] = [
  // Seções-moldura (aiSection) comuns.
  "FORMATO DA RESPOSTA",
  "PRÉVIA PENDENTE",
  "CATÁLOGO",
  "CONTEXTO",
  "REGRAS DESTE MODO",
  "ESTADO ATUAL DO DASHBOARD",
  "REFERÊNCIA ADICIONAL",
  "MODELO DAS BASES",
  "ANEXO",
  "TÓPICOS NÃO CARREGADOS",
  // Dashboards — partes do contrato.
  "Tarefa",
  "Contrato de saída",
  "Envelope",
  "Referências de campo",
  "widgets",
  "Exemplo mínimo completo",
  // Demais domínios.
  "Regras gerais",
  "Regras",
  "Identidades",
  "QUADRO ATUAL E CATÁLOGO",
  "PLANO ATUAL E CATÁLOGO",
  "CAMPOS DA BASE",
  "CAMPOS DE FILTRO",
  "CAMPOS DO FORMULÁRIO",
  "CAMPOS EXISTENTES",
  "COLUNAS DO CSV",
  "O COMENTÁRIO",
  "REGISTROS SELECIONADOS",
  "VALORES PENDENTES",
  "ALVO",
  // Amostras são núcleo nos assistentes de registros (ensinam o FORMATO dos
  // valores); em dashboards são um tópico próprio.
  "AMOSTRAS DE DADOS",
  "DOMÍNIO ATUAL",
  "CAMPOS DE SAÍDA",
];

export const KANBAN_TOPIC_CATALOG: TopicCatalog = {
  domain: "Quadro kanban",
  topics: [
    {
      key: "quadro",
      title: "Configuração do quadro",
      summary:
        "Modo, Base, colunas (por campo, por data ou livres), indicador do cabeçalho, o que o card mostra, write-back.",
      headings: ['"quadro"'],
      keywords: ["coluna", "colunas", "fase", "card", "cor", "cabecalho", "badge", "write"],
    },
    {
      key: "automacoes",
      title: "Automações",
      summary:
        "Regras que movem cards e gravam campos: condições (campo, registros conectados, tarefas, tempo) e ações.",
      headings: ['"automacoes"'],
      keywords: ["automa", "regra", "mover", "quando", "dias", "gravar", "sozinh"],
    },
  ],
};

export const COMP_TOPIC_CATALOG: TopicCatalog = {
  domain: "Remuneração variável",
  topics: [
    {
      key: "plano",
      title: "Plano (fatores, pesos, fórmulas, membros)",
      summary:
        "Delta da configuração: membros/operações, fatores (peso, fórmula, fontes, filtros do recorte, alvo padrão) e a fórmula do total.",
      headings: ['"plano"'],
      keywords: ["fator", "peso", "formula", "membro", "apuracao", "plano", "recorte", "filtro"],
    },
    {
      key: "comissoes",
      title: "Comissões por faixas",
      summary: "Blocos de comissão (gatilho, base, tipo pct/flat/per_unit, faixas).",
      headings: ['"comissoes"'],
      keywords: ["comiss", "faixa", "gatilho", "percentual", "bonus"],
    },
    {
      key: "metas",
      title: "Metas por membro",
      summary: "Células de meta membro × fator do mês aberto (null exclui).",
      headings: ['"metas"'],
      keywords: ["meta", "alvo", "objetivo"],
    },
  ],
};

export const FIELDS_TOPIC_CATALOG: TopicCatalog = {
  domain: "Criar campos",
  topics: [
    {
      key: "formulas",
      title: "Fórmulas e operandos",
      summary:
        "Sintaxe de fórmula (calculado por registro e calculado_agg), funções e a lista de operandos disponíveis.",
      headings: ["Formulas", "OPERANDOS DISPONIVEIS"],
      keywords: ["formula", "calculad", "soma", "media", "taxa", "percent", "divid", "se(", "agg"],
    },
  ],
};

export const MANUAL_BASE_TOPIC_CATALOG: TopicCatalog = {
  domain: "Base manual",
  topics: [
    {
      key: "familias",
      title: "Repartir o mesmo número (famílias)",
      summary: "Famílias/membros e coordenadas: total × divisão por canal/vendedor, residual e cruzamento.",
      headings: ["Repartir o mesmo numero"],
      keywords: ["familia", "dividi", "repart", "por canal", "por vendedor", "coordenad", "cruzament", "dessas", "desses"],
    },
  ],
};

/** Contratos pequenos e indivisíveis — catálogo sem tópicos escolhíveis. */
function single(domain: string): TopicCatalog {
  return { domain, topics: [] };
}

export const TASKS_TOPIC_CATALOG = single("Tarefas");
export const COMMENT_ANALYSIS_TOPIC_CATALOG = single("Análise de comentário (Tree)");
export const RECORDS_UPDATE_TOPIC_CATALOG = single("Atualizar registros");
export const RECORDS_INSERT_TOPIC_CATALOG = single("Inserir registros");
export const OPERATIONS_TOPIC_CATALOG = single("Operações");
export const MAPPINGS_TOPIC_CATALOG = single("Mapeamentos (de-para)");
export const CSV_MAPPING_TOPIC_CATALOG = single("Mapeamento de CSV");
export const WORKFLOW_FORM_TOPIC_CATALOG = single("Preencher formulário");

/** Todos os catálogos (a guarda de paridade itera sobre eles). */
export const AI_TOPIC_CATALOGS: readonly TopicCatalog[] = [
  DASHBOARD_TOPIC_CATALOG,
  KANBAN_TOPIC_CATALOG,
  COMP_TOPIC_CATALOG,
  FIELDS_TOPIC_CATALOG,
  MANUAL_BASE_TOPIC_CATALOG,
  TASKS_TOPIC_CATALOG,
  COMMENT_ANALYSIS_TOPIC_CATALOG,
  RECORDS_UPDATE_TOPIC_CATALOG,
  RECORDS_INSERT_TOPIC_CATALOG,
  OPERATIONS_TOPIC_CATALOG,
  MAPPINGS_TOPIC_CATALOG,
  CSV_MAPPING_TOPIC_CATALOG,
  WORKFLOW_FORM_TOPIC_CATALOG,
];

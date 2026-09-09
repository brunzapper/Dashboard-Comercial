// Versão: 1.0 | Data: 08/09/2026
// Catálogo somente-leitura dos FLUXOS DO SISTEMA — as automações que já
// existiam antes do Workflow (0125) e continuam rodando no código delas.
//
// Por que existir: "quais automações este sistema roda sozinho?" não tinha
// resposta em lugar nenhum. Estavam espalhadas por tick de cron, hook pós-sync
// e fila em background, cada uma configurada numa tela diferente — e algumas
// (o auto-match, a aplicação do de-para) não tinham tela nenhuma. A aba "Fluxos
// do sistema" as EXIBE com os passos legíveis e leva para onde cada uma se
// configura hoje.
//
// O que NÃO é: uma reimplementação. Nenhuma entrada aqui é executada pelo
// motor de esquemas — o código continua sendo a verdade, e este arquivo é a
// descrição dele. Migrar qualquer um destes para dentro do motor seria uma
// entrega própria, com as invariantes de cada subsistema no caminho.
//
// Entrada nova = uma linha aqui quando um fluxo automático nascer. O teste
// pina que todo `configuredAt` aponta para uma rota que existe.

export interface SystemFlowStep {
  label: string;
  detail: string;
}

export interface SystemFlow {
  key: string;
  label: string;
  description: string;
  /** O que dispara — em linguagem de quem opera, não de cron. */
  trigger: string;
  steps: SystemFlowStep[];
  /** Rota clicável de onde se chega à configuração, ou null se não há tela. */
  configuredAt: string | null;
  /** O caminho exato dentro dessa rota — nem toda automação tem página
   *  própria; algumas moram num painel de dentro de um quadro ou painel. */
  configuredWhere: string;
  /** Onde mora o código — para quem for mexer. */
  code: string;
}

export const SYSTEM_FLOWS: SystemFlow[] = [
  {
    key: "sync_bitrix",
    label: "Sincronização com o Bitrix24",
    description:
      "Traz negócios e leads do CRM para os registros, resolvendo rótulos de etapa, origem e responsável.",
    trigger: "Automático, a cada minuto.",
    steps: [
      {
        label: "Buscar o que mudou",
        detail: "crm.deal.list / crm.lead.list a partir da última sincronização.",
      },
      {
        label: "Traduzir códigos em rótulos",
        detail:
          "Etapas, origens, enums e responsáveis viram texto legível (crm.status.list).",
      },
      {
        label: "Gravar preservando edição manual",
        detail:
          "Upsert por (origem, id). Campo editado no app fica protegido até o próximo write-back.",
      },
      {
        label: "Atualizar o catálogo de campos",
        detail:
          "Campos novos do portal aparecem em Campos; opções de Fonte, Etapa e funil são reescritas.",
      },
    ],
    configuredAt: "/configuracoes/integracoes",
    configuredWhere: "Configurações → Integrações (e o catálogo em Campos).",
    code: "lib/sync/bitrix/",
  },
  {
    key: "bitrix_writeback",
    label: "Devolução de edições ao Bitrix24",
    description:
      "Campo marcado com write-back que é editado no app volta para o CRM.",
    trigger: "Ao salvar a edição; entrega em segundo plano.",
    steps: [
      { label: "Enfileirar", detail: "Uma linha por campo alterado." },
      {
        label: "Converter para o formato do CRM",
        detail:
          "Rótulo vira código (opções, origens, etapas); booleano vira Y/N.",
      },
      {
        label: "Enviar e registrar",
        detail:
          "crm.deal.update / crm.lead.update. Falha fica registrada e é retentada; erro de conversão não insiste.",
      },
    ],
    configuredAt: "/campos",
    configuredWhere: "Campos → a chave \"Devolver ao Bitrix\" de cada campo.",
    code: "lib/sync/bitrix/writeback.ts",
  },
  {
    key: "automation_rules",
    label: "Automações do kanban",
    description:
      "Move cards de coluna e preenche campos quando as condições da regra batem.",
    trigger: "A cada minuto, depois de cada sincronização e no botão Executar agora.",
    steps: [
      {
        label: "Avaliar as regras em ordem",
        detail: "A primeira que casar vence, por card.",
      },
      {
        label: "Aplicar a ação",
        detail:
          "Mover de coluna ou gravar um valor fixo — sem reescrever o que já está igual.",
      },
    ],
    configuredAt: "/",
    configuredWhere: "Dentro do quadro, no menu ⋮ → Automações.",
    code: "lib/kanban/automations/",
  },
  {
    key: "value_mappings",
    label: "Mapeamentos de valores (de-para)",
    description:
      "Classifica valores livres em categorias padronizadas e grava o resultado nos registros.",
    trigger: "Depois de cada importação de planilha ou entrada pela API.",
    steps: [
      {
        label: "Procurar o valor no de-para",
        detail: "Comparação sem acento e sem diferença de maiúsculas.",
      },
      {
        label: "Classificar o que não tem entrada",
        detail:
          "Classificador do domínio e, na falta dele, o motor que aprende com as entradas já existentes.",
      },
      {
        label: "Gravar e cobrar o resto",
        detail:
          "O que sobrou vira uma tarefa de pendência para o administrador.",
      },
    ],
    configuredAt: "/operacao/mapeamentos",
    configuredWhere: "Operação → Mapeamentos (e os domínios em Campos → Reclassificações).",
    code: "lib/mappings/",
  },
  {
    key: "auto_match",
    label: "Conexão automática entre bases",
    description:
      "Casa registros de bases diferentes pelas regras de correspondência (parcerias).",
    trigger: "Depois de cada sincronização, só sobre o que mudou.",
    steps: [
      {
        label: "Aplicar as regras de correspondência",
        detail: "Até dois pares de campos por regra, o segundo como reserva.",
      },
      {
        label: "Recalcular o que dependia do par",
        detail: "Campos calculados que citam o registro casado.",
      },
    ],
    configuredAt: "/campos",
    configuredWhere: "Campos → Correspondências.",
    code: "lib/matching.ts",
  },
  {
    key: "webhooks_out",
    label: "Webhooks de saída",
    description:
      "Avisa sistemas externos quando registros, tarefas ou comentários mudam no app.",
    trigger: "A cada minuto, a partir da fila de eventos.",
    steps: [
      { label: "Montar e assinar", detail: "Assinatura HMAC com o segredo do endpoint." },
      {
        label: "Entregar com retentativa",
        detail:
          "Espera crescente entre tentativas; endpoint que falha muitas vezes seguidas é desativado.",
      },
    ],
    configuredAt: "/configuracoes/integracoes",
    configuredWhere: "Configurações → Integrações → Endpoints de saída.",
    code: "lib/webhooks/",
  },
  {
    key: "api_ingest",
    label: "Entrada por API",
    description:
      "Sistemas externos empurram linhas para uma base usando uma chave de API.",
    trigger: "Sob demanda, quando o sistema externo chama.",
    steps: [
      { label: "Autenticar a chave", detail: "Resposta idêntica para qualquer falha." },
      {
        label: "Passar pelo motor de importação",
        detail:
          "Mesmo caminho da planilha: dedup, conversão pt-BR e edição manual preservada.",
      },
    ],
    configuredAt: "/configuracoes/integracoes",
    configuredWhere: "Configurações → Integrações → Chaves de API.",
    code: "app/api/ingest/[source]/route.ts",
  },
  {
    key: "snapshots_refresh",
    label: "Atualização de snapshots",
    description:
      "Recongela os dados dos painéis compartilhados por link público.",
    trigger: "Automático, na frequência configurada em cada snapshot.",
    steps: [
      { label: "Recapturar os registros", detail: "Respeitando as restrições do snapshot." },
      { label: "Manter o período congelado", detail: "O recorte da criação é preservado." },
    ],
    configuredAt: "/",
    configuredWhere: "No painel, em ⋮ → Snapshots.",
    code: "lib/snapshots/refresh.ts",
  },
];

export function systemFlow(key: string): SystemFlow | null {
  return SYSTEM_FLOWS.find((f) => f.key === key) ?? null;
}

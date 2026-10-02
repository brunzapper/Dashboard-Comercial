// Versão: 1.3 | Data: 02/10/2026
// v1.3 (02/10/2026): ESQUELETO DE SLIDE no deck (settings.slide + headline e
//   kicker por aba; capa com frame false) e o slide DESTAQUE — KPI em escala +
//   MRR por mês com destaque de outubro e anotação, no recorte do preset
//   Inbound fixado em 2026. Versão do preset → 4.
// Versão: 1.2 | Data: 02/10/2026
// v1.2 (02/10/2026): PROVA do estilo de apresentação (lib/dashboards/style.ts).
//   O deck nasce no estilo "Editorial" (papel off-white, títulos em serifa,
//   divisórias finas) e apresenta em PALCO 16:9 com entrada suave. Capa escura
//   própria (fundo por aba) com kicker, filete, título grande e subtítulo;
//   notas laterais viram COLUNA DE COMENTÁRIO (sem fundo cinza, com filete);
//   "Fontes e critérios" vira um slide de texto com títulos e listas, e o
//   placeholder dos links é um comentário de AUTOR (( … )) — não vaza mais no
//   slide. As linhas N0 do painel são a conclusão (destaque). A Base manual
//   saiu do slide de Investimento para uma aba de TRABALHO ("Lançamentos"),
//   fora da apresentação. Versão do preset → 3.
// v1.1 (01/10/2026): slides que OCUPAM a tela. (a) grade FINA (gridVersion 2,
//   linha quadrada): cada slide é um bloco 120 × 64 células, ~16:9 em
//   qualquer largura — antes as posições eram do espaço legado com linha de
//   30px e vários slides usavam metade da altura; (b) tabelas dividem o slide
//   com uma nota "como ler" (o texto que estava no rodapé da tabela); (c) os
//   meses ficam FIXOS (out–dez/2026) nas tabelas e nos nós de indicador e a
//   barra de período nasce desligada — toda aba já abre no período certo, e o
//   modo Apresentar não precisa de filtro nenhum. Versão do preset → 2.
// Preset "Comercial — Metas e desdobramentos 4T26" (0149): a apresentação de
// metas do 4º trimestre de 2026 montada com as PEÇAS do sistema — nada de
// slide escrito à mão.
//
//  - os NÚMEROS são dados: indicadores do catálogo (o que cada meta mede e
//    como se calcula o realizado), metas mês a mês em `goals` (globais e por
//    vendedor) e a Base manual para o que não vem do CRM (investimento,
//    marketing, abertura/expansão/perda de MRR);
//  - as ÁRVORES N0→N1→N2→N3, os PLANOS de ação e o RITMO de acompanhamento são
//    UM mapa livre da Tree (`metas-4t26`); cada slide mostra o galho dele
//    (`rootRef`) — editar um nó edita a apresentação inteira;
//  - cada ABA é um slide (modo Apresentar); a aba "Árvore completa" é de
//    trabalho e fica fora dos slides.
//
// Tudo ensure-if-absent (lib/presets/data-sections.ts): ajustar uma meta, um
// nó ou um indicador depois do apply nunca é desfeito por reaplicar. Onde o
// mapeamento no CRM é incerto (empresas prospectadas, contatos), o indicador
// nasce SEM realizado — só meta/premissa, configurável em Configurações →
// Metas → Indicadores.
import type { Formula, FormulaToken } from "@/lib/records/formulas";
import type { WidgetSettings } from "@/lib/widgets/types";
import type {
  PresetDashboard,
  PresetGoal,
  PresetIndicator,
  PresetMapNode,
  PresetWidget,
} from "./definitions";
import { INBOUND_PRESET } from "./inbound";
import { OUTBOUND_PRESET } from "./outbound";

export const METAS_4T26_KEY = "metas_4t26";
export const METAS_4T26_MAP = "metas-4t26";
const YEAR = 2026;
const MONTHS = [10, 11, 12] as const;

// ---- fórmulas do realizado (operandos com escopo de Base — §4.1) -----------
const fld = (ref: string): FormulaToken => ({ kind: "field", ref });
const op = (o: "+" | "-" | "*" | "/"): FormulaToken => ({ kind: "op", op: o });
const num = (value: number): FormulaToken => ({ kind: "const", value });
const LP: FormulaToken = { kind: "lparen" };
const RP: FormulaToken = { kind: "rparen" };

const MRR_VENDAS = [
  fld("agg:sum:custom:mrr_contrato@vendas_assinadas"),
  op("+"),
  fld("agg:sum:mrr@vendas_site"),
];
const VENDAS = [fld("agg:count:*@vendas_assinadas"), op("+"), fld("agg:count:*@vendas_site")];
const SQL = [fld("agg:count:*@sqls"), op("+"), fld("agg:count:*@clientes_lite")];
const m = (key: string): FormulaToken => fld(`manual:${key}`);
const f = (tokens: FormulaToken[], source: string): Formula => ({ tokens, source });

const R_MRR: Formula = f(MRR_VENDAS, "[agg:sum:custom:mrr_contrato@vendas_assinadas] + [agg:sum:mrr@vendas_site]");
const R_VENDAS: Formula = f(VENDAS, "[agg:count:*@vendas_assinadas] + [agg:count:*@vendas_site]");
const R_TICKET: Formula = f([LP, ...MRR_VENDAS, RP, op("/"), LP, ...VENDAS, RP], "MRR das vendas ÷ vendas");
const R_SQL: Formula = f(SQL, "[agg:count:*@sqls] + [agg:count:*@clientes_lite]");
const R_MQL: Formula = f([fld("agg:count:*@mqls")], "[agg:count:*@mqls]");
const R_CONV_MQL_SQL: Formula = f(
  [LP, LP, ...SQL, RP, op("/"), fld("agg:count:*@mqls"), RP, op("*"), num(100)],
  "SQL ÷ MQL × 100"
);
const R_CONV_SQL_VENDA: Formula = f(
  [LP, LP, ...VENDAS, RP, op("/"), LP, ...SQL, RP, RP, op("*"), num(100)],
  "vendas ÷ SQL × 100"
);
const R_REUNIOES: Formula = f([fld("agg:count:*@ob_rr")], "[agg:count:*@ob_rr]");
const R_MANUAL = (key: string): Formula => f([m(key)], `[manual:${key}]`);
const R_INVEST_PART = (member: string): Formula =>
  f(
    [fld(`manual:investimento_comercial@componente_investimento=${member}`)],
    `[manual:investimento_comercial@componente_investimento=${member}]`
  );
const R_CAC: Formula = f(
  [LP, m("marketing"), op("+"), m("investimento_comercial"), RP, op("/"), LP, ...VENDAS, RP],
  "(Marketing + Comercial) ÷ clientes novos"
);
const R_MRR_FINAL: Formula = f(
  [m("mrr_abertura"), op("+"), ...MRR_VENDAS, op("+"), m("mrr_expansao"), op("-"), m("mrr_perda")],
  "abertura + novos + expansão − perda"
);

const realized = (formula: Formula) => ({ formula, sources: [] as string[] });

// ---- indicadores -------------------------------------------------------------
export const METAS_4T26_INDICATORS: PresetIndicator[] = [
  // N0
  { key: "mrr_final", label: "MRR final", unit: "moeda", rollup: "ultimo", ownerName: "Bruno", description: "MRR final = abertura + novos + expansão − perda.", realized: realized(R_MRR_FINAL) },
  { key: "cac", label: "CAC (R$/cliente)", unit: "moeda", rollup: "media", direction: "menor_melhor", ownerName: "Felipe", description: "CAC = (Marketing + Comercial) ÷ clientes novos.", realized: realized(R_CAC) },
  // N1
  { key: "mrr_novo", label: "MRR novo (oficial)", unit: "moeda", ownerName: "Bruno", description: "Inbound + outbound. Meta global oficial; metas por vendedor são compromissos individuais.", realized: realized(R_MRR) },
  { key: "mrr_novo_inbound", label: "MRR novo inbound", unit: "moeda", ownerName: "Bruno", description: "Vendas × ticket. Regra de venda herdada do preset Inbound (contratos assinados + vendas do site) — ajuste se os contratos incluírem outbound.", realized: realized(R_MRR) },
  { key: "mrr_novo_outbound", label: "MRR novo outbound", unit: "moeda", ownerName: "Bruno", description: "Vendas × ticket outbound. Defina o realizado quando a venda outbound tiver marcação no CRM." },
  { key: "investimento_comercial", label: "Investimento comercial", unit: "moeda", ownerName: "Felipe", description: "Equipe + comissões + softwares + consultorias (Base manual).", realized: realized(R_MANUAL("investimento_comercial")) },
  { key: "clientes_novos", label: "Clientes novos", unit: "quantidade", ownerName: "Bruno", realized: realized(R_VENDAS) },
  { key: "marketing", label: "Investimento em marketing", unit: "moeda", ownerName: "Felipe", realized: realized(R_MANUAL("marketing")) },
  { key: "mrr_abertura", label: "MRR de abertura", unit: "moeda", rollup: "nenhum", ownerName: "Ricardo", realized: realized(R_MANUAL("mrr_abertura")) },
  { key: "mrr_expansao", label: "MRR de expansão", unit: "moeda", ownerName: "Ricardo", realized: realized(R_MANUAL("mrr_expansao")) },
  { key: "mrr_perda", label: "MRR perdido", unit: "moeda", direction: "menor_melhor", ownerName: "Ricardo", realized: realized(R_MANUAL("mrr_perda")) },
  // N2
  { key: "vendas_inbound", label: "Vendas inbound", unit: "quantidade", description: "SQL realizados × conversão.", realized: realized(R_VENDAS) },
  { key: "ticket_inbound", label: "Ticket inbound", unit: "moeda", rollup: "media", description: "MRR novo inbound ÷ vendas.", realized: realized(R_TICKET) },
  { key: "vendas_outbound", label: "Vendas outbound", unit: "quantidade" },
  { key: "ticket_outbound", label: "Ticket outbound", unit: "moeda", rollup: "media" },
  { key: "clientes_inbound", label: "Clientes inbound", unit: "quantidade", realized: realized(R_VENDAS) },
  { key: "clientes_outbound", label: "Clientes outbound", unit: "quantidade" },
  { key: "invest_equipe", label: "Equipe: pessoas × custo médio", unit: "moeda", realized: realized(R_INVEST_PART("equipe")) },
  { key: "invest_comissoes", label: "Comissões: soma por contrato", unit: "moeda", realized: realized(R_INVEST_PART("comissoes")) },
  { key: "invest_softwares", label: "Softwares: licenças × preços", unit: "moeda", realized: realized(R_INVEST_PART("softwares")) },
  { key: "invest_consultorias", label: "Consultorias: soma dos contratos", unit: "moeda", realized: realized(R_INVEST_PART("consultorias")) },
  // N3 — funil inbound
  { key: "leads_inbound", label: "Leads necessários", unit: "quantidade" },
  { key: "conv_lead_mql", label: "Conversão lead → MQL", unit: "percentual", rollup: "media" },
  { key: "mql_inbound", label: "MQL necessários", unit: "quantidade", realized: realized(R_MQL) },
  { key: "conv_mql_sql", label: "Conversão MQL → SQL", unit: "percentual", rollup: "media", realized: realized(R_CONV_MQL_SQL) },
  { key: "sql_inbound", label: "SQL realizados", unit: "quantidade", realized: realized(R_SQL) },
  { key: "conv_sql_venda", label: "Conversão SQL → venda", unit: "percentual", rollup: "media", realized: realized(R_CONV_SQL_VENDA) },
  // N3 — funil outbound
  { key: "empresas_mailing", label: "Empresas prospectadas (mailing)", unit: "quantidade", description: "Em média 2 pessoas por empresa em mailing." },
  { key: "empresas_manual", label: "Empresas prospecção manual", unit: "quantidade" },
  { key: "contatos_sucesso", label: "Contatos bem-sucedidos", unit: "quantidade" },
  { key: "contatos_por_reuniao", label: "Contatos bem-sucedidos por reunião", unit: "numero", rollup: "media", direction: "menor_melhor" },
  { key: "reunioes_agendar", label: "Reuniões a agendar", unit: "quantidade" },
  { key: "comparecimento", label: "Comparecimento", unit: "percentual", rollup: "media" },
  { key: "reunioes_realizadas", label: "Reuniões realizadas", unit: "quantidade", realized: realized(R_REUNIOES) },
  { key: "conv_reuniao_venda", label: "Conversão reunião → venda", unit: "percentual", rollup: "media" },
].map((ind, i) => ({ ...ind, sortOrder: (i + 1) * 10 }) as PresetIndicator);

// ---- metas (Out/Nov/Dez 2026) --------------------------------------------
const TARGETS: Record<string, readonly [number, number, number]> = {
  mrr_final: [517591, 549278, 584639],
  cac: [2837, 2684, 2482],
  mrr_novo: [33820, 38650, 42750],
  mrr_novo_inbound: [30220, 34330, 37566],
  mrr_novo_outbound: [3600, 4320, 5184],
  investimento_comercial: [41357, 41700, 42074],
  clientes_novos: [33, 35, 38],
  marketing: [52250, 52250, 52250],
  vendas_inbound: [31, 33, 35],
  ticket_inbound: [1000, 1050, 1100],
  vendas_outbound: [2, 2, 3],
  ticket_outbound: [1800, 2160, 1728],
  clientes_inbound: [31, 33, 35],
  clientes_outbound: [2, 2, 3],
  invest_equipe: [20000, 20000, 20000],
  invest_comissoes: [14857, 15200, 15574],
  invest_softwares: [5000, 5000, 5000],
  invest_consultorias: [1500, 1500, 1500],
  leads_inbound: [422, 430, 438],
  conv_lead_mql: [80, 80, 80],
  mql_inbound: [337, 344, 350],
  conv_mql_sql: [40, 40, 40],
  sql_inbound: [135, 138, 140],
  conv_sql_venda: [23, 24, 25],
  empresas_mailing: [7500, 7500, 7500],
  empresas_manual: [2050, 2050, 2050],
  contatos_sucesso: [300, 300, 350],
  contatos_por_reuniao: [10, 10, 10],
  reunioes_agendar: [30, 30, 30],
  comparecimento: [85, 85, 85],
  reunioes_realizadas: [25, 25, 25],
  conv_reuniao_venda: [8, 8, 12],
};

/** Compromissos individuais (MRR novo por vendedor).
 * v1.4: nomes COMPLETOS, a grafia exata dos responsáveis cadastrados (a mesma
 * do preset Remuneração Variável) — "Gabriella", "Paulo Vitor" e "Marcus
 * Vinicius" não casavam com ninguém: as metas eram puladas no apply e as
 * linhas da tabela ficavam "Responsável não encontrado". */
export const METAS_4T26_SELLERS: Record<string, readonly [number, number, number]> = {
  "Gabriella Salles": [15000, 15500, 16000],
  "Paulo Vitor Santos": [10000, 12500, 15000],
  "Daniela Drielsma": [6000, 7000, 8000],
  "Marcus Barcelos": [2000, 2500, 3000],
  "Marcos Hernandes": [2000, 2500, 3000],
};

export const METAS_4T26_GOALS: PresetGoal[] = [
  ...Object.entries(TARGETS).flatMap(([indicator, vals]) =>
    MONTHS.map((month, i) => ({ indicator, year: YEAR, month, target: vals[i] }))
  ),
  ...Object.entries(METAS_4T26_SELLERS).flatMap(([responsibleName, vals]) =>
    MONTHS.map((month, i) => ({
      indicator: "mrr_novo",
      year: YEAR,
      month,
      target: vals[i],
      responsibleName,
    }))
  ),
];

// ---- o mapa da Tree ----------------------------------------------------------
const ind = (
  key: string,
  parentKey: string | undefined,
  label: string,
  payload: Record<string, unknown>,
  direction?: "h" | "v"
): PresetMapNode => ({ key, parentKey, kind: "indicator", label, payload, ...(direction ? { direction } : {}) });
const note = (key: string, parentKey: string, label: string, extra: Partial<PresetMapNode> = {}): PresetMapNode => ({
  key,
  parentKey,
  kind: "note",
  label,
  ...extra,
});
const step = (key: string, parentKey: string, label: string) => note(key, parentKey, label, { status: "pendente" });

const RITUAL_WINDOW = { anchor: "2026-10-01", until: "2026-12-31" };

const NODES: PresetMapNode[] = [
  // N0
  note("resultado", "", "Resultado do 4T26 — MRR e CAC", { goal: true, parentKey: undefined, body: "Diretoria valida a ligação N3 → N2 → N1 → N0 e os planos." }),
  ind("mrr_final", "resultado", "N0 · MRR final", { indicator: "mrr_final", level: "N0", hint: "abertura + novos + expansão − perda" }),
  ind("mrr_abertura", "mrr_final", "MRR de abertura", { indicator: "mrr_abertura", level: "N1" }),
  ind("mrr_novo", "mrr_final", "N1 · MRR novo (oficial)", { indicator: "mrr_novo", level: "N1", childrenOp: "+", hint: "inbound + outbound" }),
  ind("mrr_inbound", "mrr_novo", "N1 · MRR novo inbound", { indicator: "mrr_novo_inbound", level: "N1", childrenOp: "×", hint: "Vendas × ticket" }),
  ind("vendas_inbound", "mrr_inbound", "N2 · Vendas inbound", { indicator: "vendas_inbound", level: "N2", childrenOp: "×", hint: "SQL realizados × conversão" }),
  ind("sql_inbound", "vendas_inbound", "N3 · SQL", { indicator: "sql_inbound", level: "N3" }),
  ind("conv_sql_venda", "vendas_inbound", "N3 · Conversão SQL → venda", { indicator: "conv_sql_venda", level: "N3" }),
  note("n3_revisar_sql", "vendas_inbound", "Revisar SQLs e cadências semanalmente"),
  ind("ticket_inbound", "mrr_inbound", "N2 · Ticket inbound", { indicator: "ticket_inbound", level: "N2", hint: "MRR novo inbound ÷ vendas" }),
  note("n3_ticket_inbound", "ticket_inbound", "Acompanhar ticket médio de entrada e propostas comerciais"),
  ind("mrr_outbound", "mrr_novo", "N1 · MRR novo outbound", { indicator: "mrr_novo_outbound", level: "N1", childrenOp: "×", hint: "Vendas × ticket" }),
  ind("vendas_outbound", "mrr_outbound", "N2 · Vendas outbound", { indicator: "vendas_outbound", level: "N2", childrenOp: "×", hint: "Reuniões × conversão (8 a 12%)" }),
  ind("reunioes_ob", "vendas_outbound", "N3 · Reuniões realizadas", { indicator: "reunioes_realizadas", level: "N3" }),
  ind("conv_reuniao", "vendas_outbound", "N3 · Conversão reunião → venda", { indicator: "conv_reuniao_venda", level: "N3" }),
  ind("ticket_outbound", "mrr_outbound", "N2 · Ticket outbound", { indicator: "ticket_outbound", level: "N2" }),
  note("n3_ticket_outbound", "ticket_outbound", "Prospectar empresas no porte adequado. Critérios definidos na criação das listas"),
  ind("mrr_expansao", "mrr_final", "MRR de expansão", { indicator: "mrr_expansao", level: "N1" }),
  ind("mrr_perda", "mrr_final", "MRR perdido", { indicator: "mrr_perda", level: "N1" }),
  ind("cac", "resultado", "N0 · CAC", { indicator: "cac", level: "N0", hint: "(Marketing + Comercial) ÷ clientes" }),
  ind("investimento", "cac", "N1 · Investimento comercial", { indicator: "investimento_comercial", level: "N1", childrenOp: "+", hint: "equipe + comissões + softwares + consultorias" }),
  ind("inv_equipe", "investimento", "Equipe", { indicator: "invest_equipe", level: "N2", hint: "pessoas × custo médio" }),
  ind("inv_comissoes", "investimento", "Comissões", { indicator: "invest_comissoes", level: "N2", hint: "soma por contrato" }),
  ind("inv_softwares", "investimento", "Softwares", { indicator: "invest_softwares", level: "N2", hint: "licenças × preços" }),
  ind("inv_consultorias", "investimento", "Consultorias", { indicator: "invest_consultorias", level: "N2", hint: "soma dos contratos" }),
  ind("marketing", "cac", "Marketing", { indicator: "marketing", level: "N1" }),
  ind("clientes_novos", "cac", "N1 · Clientes novos", { indicator: "clientes_novos", level: "N1", childrenOp: "+", hint: "inbound + outbound" }),
  ind("clientes_inbound", "clientes_novos", "N2 · Clientes inbound", { indicator: "clientes_inbound", level: "N2" }),
  note("n3_clientes_inbound", "clientes_inbound", "N3: 134,78 / 137,50 / 140 SQL × 23% / 24% / 25%"),
  ind("clientes_outbound", "clientes_novos", "N2 · Clientes outbound", { indicator: "clientes_outbound", level: "N2" }),
  note("n3_clientes_outbound", "clientes_outbound", "N3: 25 / 25 / 30 reuniões com conversão entre 8 e 10%"),

  // Planos de ação (slides 10–12)
  note("planos", "", "Planos de ação"),
  {
    key: "plano_1",
    parentKey: "planos",
    kind: "plan" as const,
    label: "1. Implantar ciclo completo com foco no lead",
    payload: {
      oQue: "Atribuir cada lead a um vendedor responsável por todo o ciclo, com carteira e agenda definidas.",
      porQue: "Atenção contínua reduz perdas entre etapas e sustenta as conversões projetadas.",
      resultado: "Cinco vendedores em ciclo completo; 33/35/38 clientes e MRR oficial R$ 33.820/38.650/42.750.",
      comoMedir: "Bitrix: MRR, clientes, conversão e tempo até contato por vendedor e canal.",
      prazo: "Início em 01/10. Gestão diária, revisão semanal e fechamento em 31/10, 30/11 e 31/12.",
      comoAcontecer: "Bruno distribui leads, orienta a equipe e revisa funil e agenda. Alinha recursos previstos com Alice.",
      responsible: "Bruno",
      indicators: ["mrr_novo", "clientes_novos"],
    },
  },
  step("p1_distribuir", "plano_1", "Bruno distribui leads com carteira e agenda por vendedor"),
  step("p1_revisar", "plano_1", "Orientar a equipe e revisar funil e agenda"),
  step("p1_recursos", "plano_1", "Alinhar recursos previstos com Alice"),
  {
    key: "plano_2",
    parentKey: "planos",
    kind: "plan" as const,
    label: "2. Converter inbound com ticket e qualificação",
    payload: {
      oQue: "Aplicar roteamento, qualificação, cadência e revisão de propostas desde o primeiro dia.",
      porQue: "O mesmo vendedor acompanha o lead até o fechamento, base para a conversão projetada de 23%/24%/25%.",
      resultado: "31/33/35 vendas; conversão SQL-venda 23%/24%/25%; ticket R$ 1.000/1.050/1.100.",
      comoMedir: "Bitrix: leads, SQL, vendas, tempo de resposta e ticket médio de entrada por cliente.",
      prazo: "Início em 01/10. Contato diário, revisão semanal e fechamento em 31/10, 30/11 e 31/12.",
      comoAcontecer: "Contato em 15 min e cadência até o 5º dia. Bruno qualifica e revisa propostas; Felipe acompanha a geração.",
      responsible: "Bruno",
      indicators: ["mrr_novo_inbound", "vendas_inbound", "conv_sql_venda", "ticket_inbound"],
    },
  },
  step("p2_contato", "plano_2", "Contato em até 15 minutos"),
  step("p2_cadencia", "plano_2", "Cadência até o 5º dia"),
  step("p2_propostas", "plano_2", "Bruno qualifica e revisa propostas"),
  step("p2_geracao", "plano_2", "Felipe acompanha a geração de demanda"),
  {
    key: "plano_3",
    parentKey: "planos",
    kind: "plan" as const,
    label: "3. Gerar outbound com listas qualificadas",
    payload: {
      oQue: "Executar prospecção com empresas únicas, critérios de perfil e agenda por vendedor.",
      porQue: "O acompanhamento individual preserva o contexto do prospect. A taxa de 14% segue como premissa a medir.",
      resultado: "2/2/3 vendas; MRR R$ 3.600/4.320/5.184; ticket R$ 1.800/2.160/1.728; 15/15/22 reuniões.",
      comoMedir: "Bitrix: empresas únicas, reuniões, conversão e ticket. Medir duplicidade e rendimento da lista.",
      prazo: "Início em 01/10. Prospecção diária, revisão semanal e fechamento em 31/10, 30/11 e 31/12.",
      comoAcontecer: "Bruno prioriza ICP, indicações e Apollo; distribui listas, acompanha abordagens e revisa propostas e perdas.",
      responsible: "Bruno",
      indicators: ["mrr_novo_outbound", "vendas_outbound", "reunioes_realizadas", "ticket_outbound"],
    },
  },
  step("p3_icp", "plano_3", "Priorizar ICP, indicações e Apollo"),
  step("p3_listas", "plano_3", "Distribuir listas por vendedor"),
  step("p3_abordagens", "plano_3", "Acompanhar abordagens"),
  step("p3_perdas", "plano_3", "Revisar propostas e perdas"),

  // Ritmo de acompanhamento (slide 13)
  note("ritmo", "", "Ritmo de acompanhamento e diagnóstico"),
  {
    key: "ritual_diario",
    parentKey: "ritmo",
    kind: "ritual" as const,
    label: "Acompanhar ações e agenda",
    payload: {
      schedule: { cadence: "diario_util", ...RITUAL_WINDOW },
      responsible: "Bruno",
      reading: "Desde 01/10: acompanhar ações e agenda diariamente.",
    },
  },
  {
    key: "ritual_semanal",
    parentKey: "ritmo",
    kind: "ritual" as const,
    label: "Revisar conversão, ticket e causas",
    payload: {
      schedule: { cadence: "semanal", weekday: 5, ...RITUAL_WINDOW },
      responsible: "Bruno",
      reading: "Revisar conversão, ticket e causas toda semana.",
    },
  },
  {
    key: "ritual_mensal",
    parentKey: "ritmo",
    kind: "ritual" as const,
    label: "Fechar os quatro N1",
    payload: {
      schedule: { cadence: "mensal", monthDay: "ultimo_util", ...RITUAL_WINDOW },
      responsible: "Bruno",
      reading: "Fechar os quatro N1, avaliar conversão, receita e recursos usados frente ao plano.",
    },
  },
  {
    key: "ritual_n0",
    parentKey: "ritmo",
    kind: "ritual" as const,
    label: "Reunião N0 (Bruno / Felipe)",
    payload: {
      schedule: { cadence: "mensal", monthDay: "ultimo_util", ...RITUAL_WINDOW },
      responsible: "Bruno",
      reading:
        "MRR: Bruno; CAC: Felipe. Diretoria valida a ligação N3 → N2 → N1 → N0 e os planos. Desvios >5%: fato, causa e ação.",
    },
  },
  note("correcao", "ritmo", "Correção — dono do ramo", {
    body:
      "Volume abaixo: demanda/agenda. Conversão abaixo: resposta e qualificação. Ticket abaixo: mix/proposta. Recursos: verificar disponibilidade.",
  }),
];
export const METAS_4T26_NODES: PresetMapNode[] = NODES.map((n) =>
  n.parentKey === "" ? { ...n, parentKey: undefined } : n
);

// ---- widgets / abas = slides ---------------------------------------------
// v1.2: cores da capa escura (quase-preto quente, texto a ~90%).
const COVER_BG = "#1c1b19";
const COVER_INK = "#ebe7e0";
// v1.3: cada aba-slide tem um TÍTULO-CONCLUSÃO (headline) — a frase que o
// slide defende, no topo do esqueleto de slide. A capa fica sem esqueleto.
const TABS: NonNullable<NonNullable<PresetDashboard["settings"]>["tabs"]> = [
  { id: "capa", name: "Capa", frame: false, background: { mode: "solid", color: COVER_BG } },
  {
    id: "destaque",
    name: "Destaque",
    kicker: "Receita",
    headline: "O trimestre se decide em MRR novo: R$ 115 mil de meta oficial",
  },
  {
    id: "painel",
    name: "Painel estratégico",
    kicker: "Painel estratégico",
    headline: "MRR final chega a R$ 585 mil em dezembro com CAC abaixo de R$ 2,5 mil",
  },
  {
    id: "vendedores",
    name: "Vendedores",
    kicker: "Equipe",
    headline: "Cinco vendedores em ciclo completo, do primeiro contato ao fechamento",
  },
  {
    id: "mrr_inbound",
    name: "MRR inbound",
    kicker: "Inbound",
    headline: "Inbound responde por R$ 102 mil de MRR novo: vendas × ticket",
  },
  {
    id: "inbound",
    name: "Inbound: demanda e conversão",
    kicker: "Inbound",
    headline: "A meta pede mais SQL com conversão crescente até 25%",
  },
  {
    id: "mrr_outbound",
    name: "MRR outbound",
    kicker: "Outbound",
    headline: "Outbound soma R$ 13 mil de MRR novo no trimestre",
  },
  {
    id: "outbound",
    name: "Outbound",
    kicker: "Outbound",
    headline: "Outbound depende de listas qualificadas e de comparecimento",
  },
  {
    id: "clientes",
    name: "Clientes novos",
    kicker: "Clientes",
    headline: "106 clientes novos no trimestre, somando inbound e outbound",
  },
  {
    id: "investimento",
    name: "Investimento",
    kicker: "Investimento",
    headline: "Investimento comercial estável em torno de R$ 42 mil por mês",
  },
  {
    id: "plano_1",
    name: "Plano 1 · Ciclo completo",
    kicker: "Plano de ação",
    headline: "1. Implantar o ciclo completo com foco no lead",
  },
  {
    id: "plano_2",
    name: "Plano 2 · Inbound",
    kicker: "Plano de ação",
    headline: "2. Converter inbound com ticket e qualificação",
  },
  {
    id: "plano_3",
    name: "Plano 3 · Outbound",
    kicker: "Plano de ação",
    headline: "3. Gerar outbound com listas qualificadas",
  },
  {
    id: "ritmo",
    name: "Ritmo",
    kicker: "Acompanhamento",
    headline: "Ritmo de acompanhamento e diagnóstico",
  },
  { id: "fontes", name: "Fontes e critérios", kicker: "Fontes" },
  { id: "arvore", name: "Árvore completa" },
  // v1.2: aba de TRABALHO — o lançamento do realizado não é slide.
  { id: "lancamentos", name: "Lançamentos (trabalho)" },
];

/** v1.1: os meses da apresentação, fixos (nada depende da barra de período). */
export const METAS_4T26_MONTH_KEYS = MONTHS.map((m) => `${YEAR}-${String(m).padStart(2, "0")}`);

// v1.1: grade fina — cada slide ocupa 120 × SLIDE_H células (linha quadrada,
// ~16:9 em qualquer largura; o modo Apresentar ainda ajusta à altura da tela).
const SLIDE_W = 120;
const SLIDE_H = 64;
const MAIN_W = 84; // coluna principal quando o slide tem nota ao lado
const SIDE_X = MAIN_W + 1;
const SIDE_W = SLIDE_W - SIDE_X;
const full = { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H };

const base = (key: string, tab: string, title: string, visual: PresetWidget["visual_type"], settings: WidgetSettings, pos: PresetWidget["grid_position"]): PresetWidget => ({
  presetKey: `${METAS_4T26_KEY}.${tab}.${key}`,
  title,
  visual_type: visual,
  sources: [],
  dimensions: [],
  metrics: [],
  filters: [],
  settings: { tab, ...settings },
  grid_position: pos,
});

// v1.3: recorte de dados do slide Destaque — o MESMO do preset Inbound
// (vendas assinadas + vendas do site; MRR pelo campo unificado; data de
// referência unificada), fixado em 2026 (a barra de período deste board é
// desligada).
const VENDAS_MRR_2026: Pick<PresetWidget, "sources" | "metrics" | "filters"> = {
  sources: ["vendas_assinadas", "vendas_site"],
  metrics: [{ field: "unified:mrr_venda", agg: "sum", label: "MRR novo" }],
  filters: [
    { field: "unified:data_ref", op: "gte", value: `${YEAR}-01-01` },
    { field: "unified:data_ref", op: "lte", value: `${YEAR}-12-31` },
  ],
};

const nota = (tab: string, key: string, title: string, text: string, pos: PresetWidget["grid_position"], ap?: NonNullable<WidgetSettings["appearance"]>["note"]) =>
  base(key, tab, title, "nota", { note: { text }, ...(ap ? { appearance: { note: ap } } : {}) }, pos);

/** v1.1: a nota "como ler" ao lado da tabela (sem px fixo — escala no slide).
 * v1.2: COLUNA DE COMENTÁRIO — sem fundo, filete à esquerda, texto secundário;
 * o título vira o kicker do próprio texto (a variante não tem barra). */
const lado = (tab: string, title: string, text: string) =>
  nota(
    tab,
    "como_ler",
    title,
    `^^ ${title.toLocaleUpperCase("pt-BR")}\n${text}`,
    { x: SIDE_X, y: 0, w: SIDE_W, h: SLIDE_H },
    { variant: "comentario", valign: "center" }
  );

const tree = (tab: string, rootRef: string | null, title: string, h = SLIDE_H): PresetWidget =>
  base("tree", tab, title, "tree", {
    tree: {
      source: "livre",
      layout: "livre",
      mapKey: METAS_4T26_MAP,
      view: "root",
      rootDirection: "h",
      months: METAS_4T26_MONTH_KEYS,
      ...(rootRef ? { rootRef } : {}),
    },
  }, { ...full, h });

const table = (
  tab: string,
  title: string,
  goalTable: NonNullable<WidgetSettings["goalTable"]>,
  pos: PresetWidget["grid_position"] = { x: 0, y: 0, w: MAIN_W, h: SLIDE_H }
): PresetWidget =>
  base("tabela", tab, title, "metas", { goalTable: { ...goalTable, months: METAS_4T26_MONTH_KEYS } }, pos);

const rows = (list: [string, string, boolean?][]) =>
  list.map(([indicator, label, bold]) => ({ indicator, label, ...(bold ? { bold: true } : {}) }));

export const METAS_4T26_WIDGETS: PresetWidget[] = [
  // v1.2: capa — kicker, filete, título grande em serifa e o período, no
  // terço inferior (valign bottom) sobre o fundo escuro da aba.
  nota(
    "capa",
    "titulo",
    "Capa",
    "^^ Comercial · 4T26\n---\n# Metas e desdobramentos\n4º trimestre de 2026 · outubro a dezembro",
    full,
    { variant: "texto", valign: "bottom", color: COVER_INK, fontSize: 30, padding: 24 }
  ),

  // v1.3: slide DESTAQUE — número-herói + gráfico com a técnica do destaque
  // e uma anotação. A métrica/dimensão é a mesma do preset Inbound (vendas
  // assinadas + site, MRR por data de referência) — nada novo no engine.
  {
    ...base("kpi_mrr_ano", "destaque", "MRR novo em 2026", "kpi", {
      appearance: { kpiCompact: true, title: { kicker: "Acumulado do ano" } },
    }, { x: 0, y: 0, w: 36, h: 24 }),
    ...VENDAS_MRR_2026,
    dimensions: [],
  },
  nota(
    "destaque",
    "meta_trimestre",
    "Meta do trimestre",
    "^^ Meta oficial do trimestre\n" +
      "**R$ 115 mil** de MRR novo: outubro R$ 33,8 mil, novembro R$ 38,7 mil e dezembro R$ 42,8 mil.\n\n" +
      "As metas individuais somam mais (R$ 120 mil): a operação segue a oficial.",
    { x: 0, y: 27, w: 36, h: 37 },
    { variant: "comentario", valign: "top" }
  ),
  {
    ...base("mrr_por_mes", "destaque", "MRR novo por mês em 2026", "barra", {
      appearance: {
        highlight: { categories: ["Outubro/26"] },
        annotations: [{ x: "Outubro/26", text: "Novo desenho comercial" }],
        dataLabels: { show: true, position: "top" },
      },
    }, { x: 38, y: 0, w: SLIDE_W - 38, h: SLIDE_H }),
    ...VENDAS_MRR_2026,
    dimensions: [{ field: "unified:data_ref", transform: "month_year", label: "Mês" }],
  },

  table("painel", "Painel estratégico", {
    mode: "indicadores",
    rows: rows([
      ["mrr_novo_inbound", "N1 MRR novo inbound (R$)"],
      ["mrr_novo_outbound", "N1 MRR novo outbound (R$)"],
      ["investimento_comercial", "N1 Investimento comercial (R$)"],
      ["clientes_novos", "N1 Clientes novos"],
      // v1.2: as linhas N0 são a CONCLUSÃO do painel (destaque com filete).
      ["mrr_final", "N0 MRR final (R$)", true],
      ["cac", "N0 CAC (R$/cliente)", true],
    ]),
    editable: true,
  }),
  lado(
    "painel",
    "Como ler o painel",
    "Cada célula traz a meta do mês; abaixo dela, o realizado e o atingimento.\n\n" +
      "MRR final = abertura + novos + expansão − perda.\n" +
      "CAC = (Marketing + Comercial) ÷ clientes novos.\n\n" +
      "Donos: MRR — Bruno; CAC — Felipe; expansão e perda — Ricardo.\n\n" +
      "Marketing: R$ 52.250/mês."
  ),

  table("vendedores", "Cinco vendedores em ciclo completo", {
    mode: "por_responsavel",
    indicator: "mrr_novo",
    responsibles: Object.keys(METAS_4T26_SELLERS),
    headerLabel: "Vendedor",
    totalRowLabel: "Compromissos individuais (R$)",
    editable: true,
  }),
  lado(
    "vendedores",
    "Ciclo completo",
    "Cada vendedor acompanha seus leads do primeiro contato ao fechamento.\n\n" +
      "As metas individuais são arredondadas e somam mais que a meta oficial: a operação segue as metas oficiais do painel."
  ),

  tree("mrr_inbound", "preset:mrr_inbound", "N1 MRR novo inbound — vendas × ticket"),

  table("inbound", "Inbound: demanda e conversão necessárias", {
    mode: "indicadores",
    headerLabel: "Etapa ou premissa",
    rows: rows([
      ["leads_inbound", "Leads necessários"],
      ["conv_lead_mql", "Conversão lead para MQL"],
      ["mql_inbound", "MQL necessários"],
      ["conv_mql_sql", "Conversão MQL para SQL"],
      ["sql_inbound", "SQL realizados necessários"],
      ["conv_sql_venda", "Conversão SQL para venda"],
      ["vendas_inbound", "Vendas inbound", true],
    ]),
    editable: true,
  }),
  lado(
    "inbound",
    "Premissas do inbound",
    "SQL → venda: 23%, 24% e 25%.\n\n" +
      "O novo desenho pressupõe mais atenção por lead.\n\n" +
      "Taxas e capacidade são premissas. Metas operacionais inteiras arredondam para cima."
  ),

  tree("mrr_outbound", "preset:mrr_outbound", "N1 MRR novo outbound — vendas × ticket"),

  table("outbound", "Outbound", {
    mode: "indicadores",
    headerLabel: "Etapa ou premissa",
    rows: rows([
      ["empresas_mailing", "Empresas prospectadas (mailing)"],
      ["empresas_manual", "Empresas prospecção manual"],
      ["contatos_sucesso", "Contatos bem sucedidos necessários"],
      ["contatos_por_reuniao", "Contatos bem sucedidos para gerar 1 reunião"],
      ["reunioes_agendar", "Reuniões a agendar"],
      ["comparecimento", "Comparecimento"],
      ["reunioes_realizadas", "Reuniões realizadas"],
      ["conv_reuniao_venda", "Conversão reunião para venda"],
      ["vendas_outbound", "Vendas outbound", true],
    ]),
    editable: true,
  }),
  lado(
    "outbound",
    "Premissas do outbound",
    "Em média 2 pessoas por empresa em mailing.\n\n" +
      "Taxas e capacidade são premissas. Metas operacionais inteiras arredondam para cima."
  ),

  tree("clientes", "preset:clientes_novos", "N1 Clientes novos — inbound + outbound"),

  table(
    "investimento",
    "N1 investimento comercial",
    {
      mode: "indicadores",
      headerLabel: "N2 e fórmula N3 (R$)",
      rows: rows([
        ["invest_equipe", "Equipe: pessoas × custo médio"],
        ["invest_comissoes", "Comissões: soma por contrato"],
        ["invest_softwares", "Softwares: licenças × preços"],
        ["invest_consultorias", "Consultorias: soma dos contratos"],
        ["investimento_comercial", "N1 investimento comercial", true],
      ]),
      editable: true,
    }
  ),
  lado(
    "investimento",
    "De onde vem o realizado",
    "O realizado sai da **Base manual**: os valores do mês são lançados na aba *Lançamentos*, que fica fora da apresentação.\n\n" +
      "Investimento comercial = equipe + comissões + softwares + consultorias."
  ),
  // v1.2: interface de trabalho na aba própria (fora dos slides) — também
  // marcada para não aparecer caso a aba seja incluída na apresentação.
  base("lancamentos", "lancamentos", "Lançar o realizado (Base manual)", "base_manual", {
    baseManual: {
      series: ["investimento_comercial", "marketing", "mrr_abertura", "mrr_expansao", "mrr_perda"],
      defaultMonth: METAS_4T26_MONTH_KEYS[0],
    },
    hideInPresentation: true,
  }, full),

  tree("plano_1", "preset:plano_1", "1. Implantar ciclo completo com foco no lead"),
  tree("plano_2", "preset:plano_2", "2. Converter inbound com ticket e qualificação"),
  tree("plano_3", "preset:plano_3", "3. Gerar outbound com listas qualificadas"),
  tree("ritmo", "preset:ritmo", "Ritmo de acompanhamento e diagnóstico"),
  // v1.2: slide de TEXTO com hierarquia — título, fontes em lista com o nome
  // em negrito, e os critérios numa coluna de comentário ao lado. O lembrete
  // dos links é comentário de autor: aparece só no modo edição.
  nota(
    "fontes",
    "criterios",
    "Fontes e critérios de cálculo",
    "^^ Fontes\n" +
      "# Cálculos auditáveis, com metas oficiais separadas das propostas\n\n" +
      "- **Metas e desdobramentos** — regras: slides 2, 4, 5 e 6. Metas: slide 9. Árvores e plano: slides 11–19.\n" +
      "- **Novo Desenho Comercial** — papéis, cadências e listas. Metas por vendedor: slides 16–18.\n" +
      "- **Metas Quadrimestre** — somente outubro a dezembro, colunas E:G. Fórmulas e conciliação na aba *Racional Comercial 4T26*.\n\n" +
      "(( Cole aqui os links das planilhas no formato [rótulo](https://…) — este lembrete só aparece no modo edição. ))",
    { x: 0, y: 0, w: MAIN_W, h: SLIDE_H },
    { variant: "texto", valign: "center", fontSize: 18 }
  ),
  nota(
    "fontes",
    "premissas",
    "Premissas",
    "^^ Premissas\n" +
      "Taxas e capacidade são premissas.\n\n" +
      "Metas operacionais inteiras arredondam para cima.\n\n" +
      "A fonte original e o orçamento permanecem preservados.",
    { x: SIDE_X, y: 0, w: SIDE_W, h: SLIDE_H },
    { variant: "comentario", valign: "center" }
  ),
  tree("arvore", null, "Árvore completa (trabalho)", 96),
];

export const METAS_4T26_PRESET: PresetDashboard = {
  presetKey: METAS_4T26_KEY,
  // v1.2: 3 — estilo Editorial, palco 16:9 e a composição de slide nova.
  // v1.3: 4 — esqueleto de slide, headlines por aba e o slide Destaque.
  version: 4,
  name: "Comercial — Metas e desdobramentos 4T26",
  visible_to_roles: ["admin", "gestor"],
  settings: {
    tabs: TABS,
    // v1.1: barra DESLIGADA — os quadros têm meses fixos (out–dez/2026), então
    // toda aba já abre no período certo.
    // v1.4: o padrão é "todo o período". Com a barra oculta o resolver APLICA
    // o padrão (lib/widgets/period-resolve.ts) — "este_trimestre" virava AND
    // com os filtros de 2026 do slide Destaque e o deixava vazio (01–02/10).
    periodBar: { enabled: false, defaultPreset: "all", scope: "global" },
    // v1.1: grade fina com linha quadrada (proporção de slide).
    canvas: { gridVersion: 2 },
    // v1.2: palco 16:9 com entrada suave; a aba de lançamentos é trabalho.
    presentation: { hiddenTabs: ["arvore", "lancamentos"], fit: "palco", transition: "suave" },
    // v1.2: estilo Editorial (papel off-white, serifa nos títulos, um destaque).
    style: { key: "editorial" },
    // v1.3: esqueleto de slide — o mesmo topo e rodapé em todas as abas-slide.
    slide: {
      kicker: "Comercial · 4T26",
      footer: "Fontes: Metas Quadrimestre, Novo Desenho Comercial e CRM",
      showDate: true,
      showNumber: true,
    },
  },
  // Reusa as dependências declaradas pelos presets Inbound/Outbound (ensure
  // por key — nunca sobrescreve): sub-bases de MQL/SQL/vendas/reuniões e o
  // campo calculado mrr_contrato.
  fields: [...(INBOUND_PRESET.fields ?? []), ...(OUTBOUND_PRESET.fields ?? [])],
  subSources: [...(INBOUND_PRESET.subSources ?? []), ...(OUTBOUND_PRESET.subSources ?? [])],
  correspondences: INBOUND_PRESET.correspondences,
  indicators: METAS_4T26_INDICATORS,
  goals: METAS_4T26_GOALS,
  manualFamilies: [
    {
      key: "componente_investimento",
      label: "Componente do investimento",
      members: [
        { key: "equipe", label: "Equipe" },
        { key: "comissoes", label: "Comissões" },
        { key: "softwares", label: "Softwares" },
        { key: "consultorias", label: "Consultorias" },
      ],
    },
  ],
  manualSeries: [
    { key: "investimento_comercial", label: "Investimento comercial", families: ["componente_investimento"] },
    { key: "marketing", label: "Investimento em marketing" },
    { key: "mrr_abertura", label: "MRR de abertura" },
    { key: "mrr_expansao", label: "MRR de expansão" },
    { key: "mrr_perda", label: "MRR perdido" },
  ],
  maps: [{ mapKey: METAS_4T26_MAP, nodes: METAS_4T26_NODES }],
  widgets: METAS_4T26_WIDGETS,
};

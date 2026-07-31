// Versão: 2.0 | Data: 31/07/2026
// Preset "Remuneração Variável": monta o CONTROLE de remuneração do comercial
// — árvore de operações AEs/SDR-BDR COM os vínculos de responsáveis, 5 planos
// de remuneração (comp_plans, ensure por config.presetKey), a base espelho
// "Remuneração" (ensureCompMirror) e um dashboard de acompanhamento em 4
// abas. O payout AUTORITATIVO vive em /configuracoes/remuneracao (grade
// mensal + Publicar) — a aba Remuneração exibe o ESPELHO publicado.
// v2 (31/07/2026): vínculos automáticos por responsibleNames (Gabriella/
// Daniela/Paulo Vitor/Marcus/Marcos — grafias conferidas na base viva),
// cards POR PESSOA via sentinela `@responsible:<Nome>` (o apply resolve o
// UUID canônico; AEs filtram responsible_id — os campos ae_responsavel/
// sdr_responsavel subcontariam, ~24 assinados de 2026 vazios), métrica
// calculada de Valor gerado nos gráficos, abas novas "AEs" e "Remuneração"
// (espelho — popula após o 1º Publicar) e comparação `previous_period_bd`
// nos KPIs.
//
// Regras codificadas (pedido de 31/07/2026):
// - AEs: % escalonada do VALOR GERADO por atingimento da meta — <75% ⇒ 30%,
//   75–<100% ⇒ 40%, ≥100% ⇒ 50%. Metas: AE Closer R$ 35.000; AE Full Cycle
//   US$ 10.000 (convertidos pela cotação do trimestre — Campos → Moedas).
// - Valor gerado = MRR do contrato (licenças × valor/licença — campo
//   calculado mrr_contrato) + Implementação + Adicional ao MRR (tudo em
//   `vendas_assinadas`) + Vendas do site (`vendas_site`, soma de mrr).
// - SDR/BDR: 20% sobre o valor gerado (padrão do plano; exceções por membro
//   via memberTiers — qualquer taxa) + prêmio por reuniões qualificadas.
//   Reunião qualificada = lead em "Lead Qualificado" com Data Reunião
//   (sub-fonte `reunioes_qualificadas`); o crédito do SDR sai do campo
//   `sdr_reuniao` (dropdown vivo de responsáveis — memberField, engine).
//   · Inbound FC: R$ POR REUNIÃO com faixa por VOLUME (0→10, 26→12,50,
//     50→15, 60→17,50) — tierBy "realized" + kind "per_unit".
//   · Outbound FC: prêmio FIXO por atingimento da meta de 10 reuniões
//     (50%→500, 75%→750, 100%→1.000, 120%→1.500) — kind "flat".
//   · Outbound Simples: só o prêmio fixo, meta de 20 reuniões.
//   (Percentuais são autoritativos; os campos ganho_sdr_* vivos confirmam os
//   limiares — com meta 20, 120% = 24+.)
// - Fatores com weightPct 0: o payout vem SÓ dos blocos de comissão; a base
//   variável fica de fora (baseAmountDefault null).
// - Fatores de valor dos SDRs usam memberField custom:sdr_responsavel (campo
//   do NEGÓCIO) — a perna vendas_site não tem o campo e contribui 0 para
//   SDRs (limitação documentada; o admin pode limpar o memberField do fator
//   p/ creditar por responsible_id).
// Vínculos declarados são re-garantidos a cada Atualizar (ensure-if-absent;
// remover permanentemente = tirar daqui); vínculos manuais nunca são tocados.
import type { Formula, FormulaToken } from "@/lib/records/formulas";
import type { Metric } from "@/lib/widgets/types";
import type {
  PresetCompPlan,
  PresetDashboard,
  PresetField,
  PresetOperation,
  PresetSubSource,
  PresetWidget,
} from "./definitions";
import {
  DATA_REF_CORRESPONDENCE,
  MRR_CONTRATO_FIELD,
  MRR_VENDA_CORRESPONDENCE,
  VENDAS_ASSINADAS_SUB,
  VENDAS_SITE_SUB,
} from "./inbound";

const fld = (ref: string): FormulaToken => ({ kind: "field", ref });
const op = (o: "+" | "-" | "*" | "/"): FormulaToken => ({ kind: "op", op: o });

// Data Reunião do lead (mesma chave-gatilho dos mocks 0051/0052).
const F_DATA_REUNIAO = "custom:bitrix_uf_crm_1743441331";

// Pessoas por sub-operação (pedido de 31/07/2026; grafias EXATAS da base
// viva — divergência vira erro visível no apply, nunca silêncio).
const AE_CLOSER = "Gabriella Salles";
const AE_FULL_CYCLE = "Daniela Drielsma";
const SDR_INBOUND = "Paulo Vitor Santos";
const SDR_OUTBOUND_FC = "Marcus Barcelos";
const SDR_OUTBOUND_SIMPLES = "Marcos Hernandes";

// Badge "vs. período anterior (mesmo dia útil)" dos KPIs (padrão do Inbound).
const CMP_BD = {
  comparison: {
    enabled: true,
    base: "previous_period_bd" as const,
    format: "pct" as const,
    style: "both" as const,
  },
};

// ---- dependências -----------------------------------------------------------

const FIELDS: PresetField[] = [
  MRR_CONTRATO_FIELD,
  {
    // Já existe no ambiente de produção com ESTA chave (criado à mão) — o
    // ensure pula lá e cria idêntico em ambiente novo. Preenchido à mão/import.
    field_key: "adicional_ao_mrr",
    label: "Adicional ao MRR",
    data_type: "moeda",
    options: [],
    visible_to_roles: ["admin", "gestor", "vendedor"],
    editable_by_roles: ["admin", "gestor", "vendedor"],
    is_local: true,
    currency_mode: "inherit",
    applies_to: ["negocio"],
  },
  {
    // Dropdown VIVO (0113): options reescritas com os responsáveis ativos
    // principais no apply/sync/actions de Responsáveis. Preenchido por lead.
    field_key: "sdr_reuniao",
    label: "SDR da Reunião",
    data_type: "selecao",
    options: [],
    options_source: "responsibles",
    visible_to_roles: ["admin", "gestor", "vendedor"],
    editable_by_roles: ["admin", "gestor", "vendedor"],
    is_local: true,
    applies_to: ["lead"],
  },
];

const SUB_SOURCES: PresetSubSource[] = [
  VENDAS_ASSINADAS_SUB,
  VENDAS_SITE_SUB,
  {
    // Byte-igual à sub viva de produção (criada à mão) — ensure pula lá.
    // Difere da `sqls` do Inbound: SEM gate de fonte (Outbound conta junto).
    key: "reunioes_qualificadas",
    parent_key: "leads",
    label: "Reuniões Qualificadas (SDR)",
    short_label: "Reuniões",
    default_period_field: F_DATA_REUNIAO,
    filter: [
      { field: "stage", op: "eq", value: "Lead Qualificado" },
      { field: F_DATA_REUNIAO, op: "not_null" },
    ],
  },
];

// Pais ANTES dos filhos (resolve sequencial do ensurePresetOperations);
// vínculos re-garantidos a cada apply (ensure-if-absent).
const OPERATIONS: PresetOperation[] = [
  { name: "AEs" },
  { name: "AE Closer", parentName: "AEs", responsibleNames: [AE_CLOSER] },
  {
    name: "AE Full Cycle",
    parentName: "AEs",
    responsibleNames: [AE_FULL_CYCLE],
  },
  { name: "SDR/BDR" },
  {
    name: "SDR Inbound Full Cycle",
    parentName: "SDR/BDR",
    responsibleNames: [SDR_INBOUND],
  },
  {
    name: "SDR Outbound Full Cycle",
    parentName: "SDR/BDR",
    responsibleNames: [SDR_OUTBOUND_FC],
  },
  {
    name: "SDR Outbound Simples",
    parentName: "SDR/BDR",
    responsibleNames: [SDR_OUTBOUND_SIMPLES],
  },
];

// ---- fórmulas dos fatores ---------------------------------------------------

// Valor gerado: cada operando é ESCOPADO na própria sub (período pela coluna
// de data DELA — assinatura p/ vendas AE, criação p/ vendas do site); o
// filtro de membro injetado pelo engine constrói TODAS as pernas auxiliares.
const VALOR_GERADO: Formula = {
  tokens: [
    fld("agg:sum:custom:mrr_contrato@vendas_assinadas"),
    op("+"),
    fld("agg:sum:custom:implementacao@vendas_assinadas"),
    op("+"),
    fld("agg:sum:custom:adicional_ao_mrr@vendas_assinadas"),
    op("+"),
    fld("agg:sum:mrr@vendas_site"),
  ],
};

const REUNIOES: Formula = {
  tokens: [fld("agg:count:*@reunioes_qualificadas")],
};

// Valor gerado como MÉTRICA de gráfico (barra por AE / linha mensal): cada
// bucket soma os componentes da própria fatia — padrão METRIC_SQL_CALC do
// Inbound (operandos escopados por sub, avaliados por bucket).
const METRIC_VALOR_CALC: Metric = {
  field: "calc:formula",
  agg: "sum",
  calc: true,
  label: "Valor gerado",
  formula: VALOR_GERADO,
};

// ---- planos (comp_plans; ensure por config.presetKey) ------------------------

// Bloco de 30/40/50% dos AEs (trigger e base = o próprio fator de valor).
const AE_COMMISSION = {
  id: "perc_valor",
  label: "% sobre o valor",
  triggerFactorId: "valor",
  basisKind: "factor" as const,
  basisFactorId: "valor",
  tierBy: "attainment" as const,
  kind: "pct" as const,
  tiers: [
    { fromPct: 0, ratePct: 30 },
    { fromPct: 75, ratePct: 40 },
    { fromPct: 100, ratePct: 50 },
  ],
};

// 20% dos SDRs: faixa única a partir de 0 do REALIZADO (o fator de valor dos
// SDRs não tem meta — seleção por atingimento nunca dispararia). Exceções por
// membro (outra taxa/zerar) via memberTiers na grade.
const SDR_PERC_VALOR = {
  id: "perc_valor",
  label: "% sobre o valor",
  triggerFactorId: "valor",
  basisKind: "factor" as const,
  basisFactorId: "valor",
  tierBy: "realized" as const,
  kind: "pct" as const,
  tiers: [{ fromPct: 0, ratePct: 20 }],
};

// Prêmio fixo por atingimento da meta de reuniões (Outbound FC e Simples).
const PREMIO_META_REUNIOES = {
  id: "premio_meta",
  label: "Prêmio por meta de reuniões",
  triggerFactorId: "reunioes",
  basisKind: "base" as const,
  tierBy: "attainment" as const,
  kind: "flat" as const,
  tiers: [
    { fromPct: 50, amount: 500 },
    { fromPct: 75, amount: 750 },
    { fromPct: 100, amount: 1000 },
    { fromPct: 120, amount: 1500 },
  ],
};

const valorFactor = (
  metricKey: string,
  extra: Partial<{
    defaultTarget: number;
    targetCurrency: string;
    memberField: string;
  }> = {}
) => ({
  id: "valor",
  label: "Valor gerado",
  weightPct: 0,
  metricKey,
  money: true,
  formula: VALOR_GERADO,
  sources: [] as string[],
  ...extra,
});

const reunioesFactor = (metricKey: string, defaultTarget?: number) => ({
  id: "reunioes",
  label: "Reuniões qualificadas",
  weightPct: 0,
  metricKey,
  money: false,
  formula: REUNIOES,
  sources: [] as string[],
  memberField: "custom:sdr_reuniao",
  ...(defaultTarget != null ? { defaultTarget } : {}),
});

const COMP_PLANS: PresetCompPlan[] = [
  {
    presetKey: "rv_ae_closer",
    name: "Remuneração — AE Closer",
    baseAmountDefault: null,
    memberOperationNames: ["AE Closer"],
    config: {
      v: 1,
      factors: [valorFactor("comp_valor_ae_closer", { defaultTarget: 35000 })],
      commissions: [AE_COMMISSION],
    },
  },
  {
    presetKey: "rv_ae_full_cycle",
    name: "Remuneração — AE Full Cycle",
    baseAmountDefault: null,
    memberOperationNames: ["AE Full Cycle"],
    config: {
      v: 1,
      factors: [
        valorFactor("comp_valor_ae_fc", {
          defaultTarget: 10000,
          targetCurrency: "USD",
        }),
      ],
      commissions: [AE_COMMISSION],
    },
  },
  {
    presetKey: "rv_sdr_inbound_fc",
    name: "Remuneração — SDR Inbound Full Cycle",
    baseAmountDefault: null,
    memberOperationNames: ["SDR Inbound Full Cycle"],
    config: {
      v: 1,
      factors: [
        valorFactor("comp_valor_sdr_in_fc", {
          memberField: "custom:sdr_responsavel",
        }),
        reunioesFactor("comp_reunioes_sdr_in_fc"),
      ],
      commissions: [
        SDR_PERC_VALOR,
        {
          id: "premio_reuniao",
          label: "Prêmio por reunião",
          triggerFactorId: "reunioes",
          basisKind: "factor" as const,
          basisFactorId: "reunioes",
          tierBy: "realized" as const,
          kind: "per_unit" as const,
          tiers: [
            { fromPct: 0, amount: 10 },
            { fromPct: 26, amount: 12.5 },
            { fromPct: 50, amount: 15 },
            { fromPct: 60, amount: 17.5 },
          ],
        },
      ],
    },
  },
  {
    presetKey: "rv_sdr_outbound_fc",
    name: "Remuneração — SDR Outbound Full Cycle",
    baseAmountDefault: null,
    memberOperationNames: ["SDR Outbound Full Cycle"],
    config: {
      v: 1,
      factors: [
        valorFactor("comp_valor_sdr_out_fc", {
          memberField: "custom:sdr_responsavel",
        }),
        reunioesFactor("comp_reunioes_sdr_out_fc", 10),
      ],
      commissions: [SDR_PERC_VALOR, PREMIO_META_REUNIOES],
    },
  },
  {
    presetKey: "rv_sdr_outbound_simples",
    name: "Remuneração — SDR Outbound Simples",
    baseAmountDefault: null,
    memberOperationNames: ["SDR Outbound Simples"],
    config: {
      v: 1,
      factors: [reunioesFactor("comp_reunioes_sdr_out_s", 20)],
      commissions: [PREMIO_META_REUNIOES],
    },
  },
];

// ---- widgets ----------------------------------------------------------------

const VISAO: PresetWidget[] = [
  {
    presetKey: "remuneracao_variavel.visao.kpi_valor",
    title: "Valor gerado (total)",
    visual_type: "kpi",
    dimensions: [],
    metrics: [],
    filters: [],
    settings: {
      tab: "visao",
      card: { mode: "formula", formula: VALOR_GERADO },
      label: "Valor gerado",
      ...CMP_BD,
    },
    grid_position: { x: 0, y: 0, w: 4, h: 4 },
  },
  {
    presetKey: "remuneracao_variavel.visao.kpi_mrr",
    title: "MRR do contrato",
    visual_type: "kpi",
    sources: ["vendas_assinadas"],
    dimensions: [],
    metrics: [{ field: "custom:mrr_contrato", agg: "sum" }],
    filters: [],
    settings: { tab: "visao", ...CMP_BD },
    grid_position: { x: 4, y: 0, w: 2, h: 4 },
  },
  {
    presetKey: "remuneracao_variavel.visao.kpi_impl",
    title: "Implementação",
    visual_type: "kpi",
    sources: ["vendas_assinadas"],
    dimensions: [],
    metrics: [{ field: "custom:implementacao", agg: "sum" }],
    filters: [],
    settings: { tab: "visao", ...CMP_BD },
    grid_position: { x: 6, y: 0, w: 2, h: 4 },
  },
  {
    presetKey: "remuneracao_variavel.visao.kpi_adicional",
    title: "Adicional ao MRR",
    visual_type: "kpi",
    sources: ["vendas_assinadas"],
    dimensions: [],
    metrics: [{ field: "custom:adicional_ao_mrr", agg: "sum" }],
    filters: [],
    settings: { tab: "visao", ...CMP_BD },
    grid_position: { x: 8, y: 0, w: 2, h: 4 },
  },
  {
    presetKey: "remuneracao_variavel.visao.kpi_site",
    title: "Vendas do site",
    visual_type: "kpi",
    sources: ["vendas_site"],
    dimensions: [],
    metrics: [{ field: "mrr", agg: "sum" }],
    filters: [],
    settings: { tab: "visao", ...CMP_BD },
    grid_position: { x: 10, y: 0, w: 2, h: 4 },
  },
  {
    presetKey: "remuneracao_variavel.visao.tabela_ae",
    title: "Produção por vendedor",
    visual_type: "tabela",
    sources: ["vendas_assinadas"],
    dimensions: [{ field: "responsible_id" }],
    metrics: [
      { field: "custom:mrr_contrato", agg: "sum", label: "MRR" },
      { field: "custom:implementacao", agg: "sum", label: "Implementação" },
      { field: "custom:adicional_ao_mrr", agg: "sum", label: "Adicional" },
      { field: "*", agg: "count", label: "Vendas" },
    ],
    filters: [],
    settings: { tab: "visao" },
    grid_position: { x: 0, y: 4, w: 7, h: 9 },
  },
  {
    presetKey: "remuneracao_variavel.visao.valor_mes",
    title: "Valor de venda por mês",
    visual_type: "barra",
    sources: ["vendas_assinadas", "vendas_site"],
    dimensions: [{ field: "unified:data_ref", transform: "month_year" }],
    metrics: [{ field: "unified:mrr_venda", agg: "sum", label: "MRR" }],
    filters: [],
    settings: { tab: "visao" },
    grid_position: { x: 7, y: 4, w: 5, h: 9 },
  },
];

// Cards por PESSOA: filtro responsible_id com a sentinela resolvida no apply
// (UUID canônico) — preciso mesmo com ae_responsavel vazio no negócio.
const AES: PresetWidget[] = [
  {
    presetKey: "remuneracao_variavel.aes.kpi_gabriella",
    title: `Valor gerado — ${AE_CLOSER}`,
    visual_type: "kpi",
    dimensions: [],
    metrics: [],
    filters: [
      {
        field: "responsible_id",
        op: "eq",
        value: `@responsible:${AE_CLOSER}`,
      },
    ],
    settings: {
      tab: "aes",
      card: { mode: "formula", formula: VALOR_GERADO },
      label: "AE Closer · meta R$ 35 mil",
      ...CMP_BD,
    },
    grid_position: { x: 0, y: 0, w: 4, h: 4 },
  },
  {
    presetKey: "remuneracao_variavel.aes.kpi_daniela",
    title: `Valor gerado — ${AE_FULL_CYCLE}`,
    visual_type: "kpi",
    dimensions: [],
    metrics: [],
    filters: [
      {
        field: "responsible_id",
        op: "eq",
        value: `@responsible:${AE_FULL_CYCLE}`,
      },
    ],
    settings: {
      tab: "aes",
      card: { mode: "formula", formula: VALOR_GERADO },
      label: "AE Full Cycle · meta US$ 10 mil",
      ...CMP_BD,
    },
    grid_position: { x: 4, y: 0, w: 4, h: 4 },
  },
  {
    presetKey: "remuneracao_variavel.aes.kpi_vendas",
    title: "Vendas assinadas (contagem)",
    visual_type: "kpi",
    sources: ["vendas_assinadas"],
    dimensions: [],
    metrics: [{ field: "*", agg: "count" }],
    filters: [],
    settings: { tab: "aes", ...CMP_BD },
    grid_position: { x: 8, y: 0, w: 4, h: 4 },
  },
  {
    presetKey: "remuneracao_variavel.aes.valor_por_ae",
    title: "Valor gerado por vendedor",
    visual_type: "barra_horizontal",
    sources: ["vendas_assinadas", "vendas_site"],
    dimensions: [{ field: "responsible_id" }],
    metrics: [METRIC_VALOR_CALC],
    filters: [],
    settings: { tab: "aes" },
    grid_position: { x: 0, y: 4, w: 6, h: 9 },
  },
  {
    presetKey: "remuneracao_variavel.aes.evolucao_mensal",
    title: "Evolução mensal do valor gerado",
    visual_type: "linha",
    sources: ["vendas_assinadas", "vendas_site"],
    dimensions: [{ field: "unified:data_ref", transform: "month_year" }],
    metrics: [METRIC_VALOR_CALC],
    filters: [],
    settings: { tab: "aes" },
    grid_position: { x: 6, y: 4, w: 6, h: 9 },
  },
];

const SDR: PresetWidget[] = [
  {
    presetKey: "remuneracao_variavel.sdr.kpi_reunioes",
    title: "Reuniões qualificadas",
    visual_type: "kpi",
    sources: ["reunioes_qualificadas"],
    dimensions: [],
    metrics: [{ field: "*", agg: "count" }],
    filters: [],
    settings: { tab: "sdr", ...CMP_BD },
    grid_position: { x: 0, y: 0, w: 3, h: 4 },
  },
  {
    presetKey: "remuneracao_variavel.sdr.kpi_paulo",
    title: `Reuniões — ${SDR_INBOUND}`,
    visual_type: "kpi",
    sources: ["reunioes_qualificadas"],
    dimensions: [],
    metrics: [{ field: "*", agg: "count" }],
    filters: [{ field: "custom:sdr_reuniao", op: "eq", value: SDR_INBOUND }],
    settings: { tab: "sdr", label: "Inbound FC · R$/reunião", ...CMP_BD },
    grid_position: { x: 3, y: 0, w: 3, h: 4 },
  },
  {
    presetKey: "remuneracao_variavel.sdr.kpi_marcus",
    title: `Reuniões — ${SDR_OUTBOUND_FC}`,
    visual_type: "kpi",
    sources: ["reunioes_qualificadas"],
    dimensions: [],
    metrics: [{ field: "*", agg: "count" }],
    filters: [
      { field: "custom:sdr_reuniao", op: "eq", value: SDR_OUTBOUND_FC },
    ],
    settings: { tab: "sdr", label: "Outbound FC · meta 10", ...CMP_BD },
    grid_position: { x: 6, y: 0, w: 3, h: 4 },
  },
  {
    presetKey: "remuneracao_variavel.sdr.kpi_marcos",
    title: `Reuniões — ${SDR_OUTBOUND_SIMPLES}`,
    visual_type: "kpi",
    sources: ["reunioes_qualificadas"],
    dimensions: [],
    metrics: [{ field: "*", agg: "count" }],
    filters: [
      { field: "custom:sdr_reuniao", op: "eq", value: SDR_OUTBOUND_SIMPLES },
    ],
    settings: { tab: "sdr", label: "Outbound Simples · meta 20", ...CMP_BD },
    grid_position: { x: 9, y: 0, w: 3, h: 4 },
  },
  {
    presetKey: "remuneracao_variavel.sdr.reunioes_sdr",
    title: "Reuniões por SDR",
    visual_type: "barra_horizontal",
    sources: ["reunioes_qualificadas"],
    dimensions: [{ field: "custom:sdr_reuniao" }],
    metrics: [{ field: "*", agg: "count", label: "Reuniões" }],
    // not_null: mocks/leads sem o campo novo não poluem a dimensão.
    filters: [{ field: "custom:sdr_reuniao", op: "not_null" }],
    settings: { tab: "sdr" },
    grid_position: { x: 0, y: 4, w: 6, h: 9 },
  },
  {
    presetKey: "remuneracao_variavel.sdr.reunioes_mes",
    title: "Reuniões por mês",
    visual_type: "barra",
    sources: ["reunioes_qualificadas"],
    dimensions: [{ field: F_DATA_REUNIAO, transform: "month_year" }],
    metrics: [{ field: "*", agg: "count", label: "Reuniões" }],
    filters: [],
    settings: { tab: "sdr" },
    grid_position: { x: 6, y: 4, w: 6, h: 9 },
  },
  {
    presetKey: "remuneracao_variavel.sdr.producao_sdr",
    title: "Produção creditada ao SDR (negócios)",
    visual_type: "tabela",
    sources: ["vendas_assinadas"],
    dimensions: [{ field: "custom:sdr_responsavel" }],
    metrics: [
      { field: "custom:mrr_contrato", agg: "sum", label: "MRR" },
      { field: "custom:implementacao", agg: "sum", label: "Implementação" },
      { field: "custom:adicional_ao_mrr", agg: "sum", label: "Adicional" },
      { field: "*", agg: "count", label: "Vendas" },
    ],
    filters: [{ field: "custom:sdr_responsavel", op: "not_null" }],
    settings: { tab: "sdr" },
    grid_position: { x: 0, y: 13, w: 12, h: 8 },
  },
];

// Espelho publicado (base `remuneracao` — ensureCompMirror garante a infra;
// os dados aparecem após o 1º "Publicar" da grade). closed_at = último dia
// do mês ⇒ a barra de período mensal recorta o mês certo.
const REMUNERACAO: PresetWidget[] = [
  {
    presetKey: "remuneracao_variavel.rem.kpi_folha",
    title: "Folha variável (publicada)",
    visual_type: "kpi",
    sources: ["remuneracao"],
    dimensions: [],
    metrics: [{ field: "value", agg: "sum" }],
    filters: [],
    settings: { tab: "remuneracao", ...CMP_BD },
    grid_position: { x: 0, y: 0, w: 4, h: 4 },
  },
  {
    presetKey: "remuneracao_variavel.rem.kpi_comissao",
    title: "Comissões (publicadas)",
    visual_type: "kpi",
    sources: ["remuneracao"],
    dimensions: [],
    metrics: [{ field: "custom:rem_comissao", agg: "sum" }],
    filters: [],
    settings: { tab: "remuneracao", ...CMP_BD },
    grid_position: { x: 4, y: 0, w: 4, h: 4 },
  },
  {
    presetKey: "remuneracao_variavel.rem.kpi_atingimento",
    title: "Atingimento médio",
    visual_type: "kpi",
    sources: ["remuneracao"],
    dimensions: [],
    metrics: [{ field: "custom:rem_atingimento", agg: "avg", label: "Ating. (%)" }],
    filters: [],
    settings: { tab: "remuneracao" },
    grid_position: { x: 8, y: 0, w: 4, h: 4 },
  },
  {
    presetKey: "remuneracao_variavel.rem.tabela",
    title: "Remuneração por pessoa",
    visual_type: "tabela",
    sources: ["remuneracao"],
    dimensions: [{ field: "responsible_id" }],
    metrics: [
      { field: "value", agg: "sum", label: "Total" },
      { field: "custom:rem_comissao", agg: "sum", label: "Comissão" },
      { field: "custom:rem_bonus", agg: "sum", label: "Bônus" },
      { field: "custom:rem_atingimento", agg: "avg", label: "Ating. (%)" },
    ],
    filters: [],
    settings: { tab: "remuneracao" },
    grid_position: { x: 0, y: 4, w: 7, h: 9 },
  },
  {
    presetKey: "remuneracao_variavel.rem.por_pessoa",
    title: "Total por pessoa",
    visual_type: "barra_horizontal",
    sources: ["remuneracao"],
    dimensions: [{ field: "responsible_id" }],
    metrics: [{ field: "value", agg: "sum", label: "Total" }],
    filters: [],
    settings: { tab: "remuneracao" },
    grid_position: { x: 7, y: 4, w: 5, h: 9 },
  },
  {
    presetKey: "remuneracao_variavel.rem.evolucao",
    title: "Evolução mensal da folha variável",
    visual_type: "barra",
    sources: ["remuneracao"],
    dimensions: [{ field: "closed_at", transform: "month_year" }],
    metrics: [{ field: "value", agg: "sum", label: "Total" }],
    filters: [],
    settings: { tab: "remuneracao" },
    grid_position: { x: 0, y: 13, w: 12, h: 8 },
  },
];

export const REMUNERACAO_VARIAVEL_PRESET: PresetDashboard = {
  presetKey: "remuneracao_variavel",
  version: 2,
  name: "Remuneração Variável",
  visible_to_roles: ["admin", "gestor"],
  settings: {
    tabs: [
      { id: "visao", name: "Visão geral" },
      { id: "aes", name: "AEs" },
      { id: "sdr", name: "SDRs" },
      { id: "remuneracao", name: "Remuneração" },
    ],
    periodBar: { enabled: true, defaultPreset: "este_mes", scope: "global" },
    canvas: { cols: 12, rowHeight: 30 },
  },
  fields: FIELDS,
  subSources: SUB_SOURCES,
  correspondences: [DATA_REF_CORRESPONDENCE, MRR_VENDA_CORRESPONDENCE],
  operations: OPERATIONS,
  compPlans: COMP_PLANS,
  ensureCompMirror: true,
  widgets: [...VISAO, ...AES, ...SDR, ...REMUNERACAO],
};

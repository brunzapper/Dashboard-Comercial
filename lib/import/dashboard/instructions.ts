// Versão: 1.9 | Data: 07/08/2026
// v1.9 (07/08/2026): dimensão condicional — a seção Dimensões documenta
//   `dimensions[].case_formula_text` (expressão SE/E/OU que reclassifica os
//   valores em rótulos; multi-campo permitido; proibições e o preserva-cru
//   do SE sem "senão"). Ponto MANUAL como o closedWeek: chave de DIMENSÃO,
//   fora dos dicionários de settings-docs; validador aceita texto OU tokens
//   (round-trip do export) e remove incompatibilidades com aviso.
// v1.8 (03/08/2026): Semana Fechada — a seção Dimensões documenta
//   `dimensions[].closedWeek` ("seg_dom" | "sab_sex", só week_year/week_month;
//   regra da maioria, weekMode efetivo "full"). Ponto MANUAL: closedWeek é
//   chave de DIMENSÃO (fora dos dicionários de settings-docs); o validador a
//   aceita/remove com aviso desde a mesma entrega (validate.ts v1.5).
// v1.7 (31/07/2026): filtros sobre relações por NOME — a seção Filtros e a
//   regra 6 documentam que responsible_id/operation_id aceitam o nome exato do
//   cadastro como "value" (o engine resolve nome→id em runtime); nunca
//   inventar UUID.
// v1.6 (25/07/2026): grade fina (espaço de grid v2) — regra 8 documenta as
//   DUAS escalas: JSON sem canvas.gridVersion segue na clássica de 12 colunas
//   (convertida ao aplicar); ESTADO ATUAL carimbado (gridVersion 2) usa a
//   grade fina de 120 colunas e o delta deve manter a MESMA escala.
// v1.5 (25/07/2026): SPEC DERIVADO do código — enums interpolados das
//   constantes de runtime (VISUAL_TYPE_LABELS, AGG_LABELS, DATE_TRANSFORMS,
//   FILTER_OPS, PERIOD_PRESETS, PALETTES, DATA_TYPE_LABELS, DATE_TOKENS,
//   FormulaFuncName) e settings/appearance renderizados dos dicionários
//   EXAUSTIVOS de settings-docs.ts (chave nova no tipo sem entrada lá quebra o
//   typecheck). Fim da sincronia manual: feature nova do construtor se
//   documenta no DICIONÁRIO, nunca em prosa duplicada aqui. Guarda:
//   instructions.test.ts (enums presentes + dicionários renderizados + exemplo
//   validado pelo validador real). Corrige de quebra as mentiras acumuladas:
//   coexistSubSources é ARRAY de keys (não booleano), "table.groupBy" vive em
//   appearance.table (a chave raiz "table" não existe e era inerte) e as
//   chaves antes ausentes (gridLines, categoryOrder/Sort, seriesAxis,
//   table.*, fonts, background, fontScale…) agora são geráveis. As novidades
//   da v1.4 (linha_divisoria, barFillPct/chartInset/filter, dataLabels da
//   barra horizontal) entram DERIVADAS: enum via interpolação e chaves novas
//   nos dicionários.
// v1.4 (25/07/2026): novo tipo linha_divisoria (a Forma "linha" virou widget
//   próprio); appearance ganha barFillPct/chartInset (gráficos) e filter
//   (fundo/borda/abinha dos widgets de filtro); comentário de dataLabels
//   documenta a semântica da barra horizontal ("top" = Fora + auto-flip do
//   "inside").
// v1.3 (24/07/2026): bloco "appearance" corrigido/alinhado a AppearanceSettings
//   (removido o sub-objeto "chart"; enabled→show; chaves de COR documentadas —
//   a IA não sabia editar cores porque as chaves nunca eram mencionadas).
// v1.2 (23/07/2026): regras 12-14 (eixo de tempo sem dateAgg; resultCurrency
//   só p/ converter; reuso de Sub-bases existentes + escopo @sub ↔ sources).
// v1.1 (23/07/2026): multi-Base — envelope com `bases: []`, seções "MODELO
//   DAS BASES"/"AMOSTRAS (por Base)" e regra semântica de dashboards
//   multi-Base.
// Manual de instruções COPIADO para o clipboard no modo "Importar dashboard
// via JSON (IA)": especificação completa do formato + regras semânticas
// condensadas + exemplo. O chamador (import-prompt-actions) injeta o MODELO DA
// BASE selecionada e a AMOSTRA de registros; a variante "completo" anexa o
// manual de construção de dashboards inteiro (docs/) para IAs menos capazes.
import { DATA_TYPE_LABELS } from "@/lib/records/types";
import { DATE_TRANSFORMS } from "@/lib/widgets/fields";
import { FILTER_OPS } from "@/lib/widgets/filter-ops";
import { PALETTES } from "@/lib/widgets/palettes";
import { DATE_TOKENS } from "@/lib/widgets/period";
import {
  AGG_LABELS,
  TRANSFORM_LABELS,
  VISUAL_TYPE_LABELS,
  type VisualType,
} from "@/lib/widgets/types";
import {
  DASHBOARD_SETTINGS_DOC,
  WIDGET_SETTINGS_DOC,
  enumKeys,
  enumKeysLabeled,
  formulaFuncsIn,
  renderDocBlock,
} from "./settings-docs";

export interface ImportPromptParts {
  basesLabel: string; // ex.: 'Leads do Bitrix ("leads"), Deals do Bitrix ("deals")'
  baseModelJson: string; // JSON do modelo das Bases (campos/tipos/opções/subs/conexões)
  sampleJson: string; // JSON das amostras (por Base; ~20 linhas com cobertura cada)
  sampleNote: string; // observações das amostras (colunas sem dado etc.)
  manual?: string; // variante "completo": manual de construção inteiro
}

// Tipos de widget que consultam DADOS (dimensions/metrics/filters). O
// `satisfies` garante que só contém tipos existentes (remoção no union quebra
// aqui); tipo NOVO de dados precisa ser acrescentado à mão.
const DATA_VISUAL_TYPES = [
  "tabela",
  "barra",
  "barra_horizontal",
  "linha",
  "pizza",
  "funil",
  "kpi",
  "calculado",
] as const satisfies readonly VisualType[];

const transformList = DATE_TRANSFORMS.filter((t) => t !== "none")
  .map((t) => `${t} (${TRANSFORM_LABELS[t].toLowerCase()})`)
  .join(", ");

const filterOpList = FILTER_OPS.map((o) => `${o.op} (${o.label})`).join(" | ");

const paletteList = Object.entries(PALETTES)
  .map(([k, v]) => `${k} (${v.label})`)
  .join(" | ");

// Exemplo mínimo do SPEC — exportado para o teste de paridade VALIDÁ-LO com o
// validador real (instructions.test.ts): se o validador evoluir e o exemplo
// ficar inválido, o CI acusa.
export const SPEC_EXAMPLE = String.raw`{
  "formato": "dashboard-import", "versao": 1,
  "chave": "comercial_mes", "bases": ["deals", "leads"],
  "dashboard": {
    "name": "Comercial — Mês",
    "visible_to_roles": ["admin", "gestor"],
    "settings": {
      "tabs": [{ "id": "geral", "name": "Visão geral" }],
      "periodBar": { "enabled": true, "defaultPreset": "este_mes", "field": "closed_at",
                     "fieldBySource": { "deals": "closed_at", "leads": "source_created_at" } },
      "canvas": { "cols": 12, "rowHeight": 30 }
    }
  },
  "widgets": [
    { "key": "kpi_mrr", "title": "MRR do mês", "visual_type": "kpi",
      "sources": ["deals"], "dimensions": [],
      "metrics": [{ "field": "mrr", "agg": "sum", "label": "MRR" }],
      "filters": [{ "field": "closed", "op": "eq", "value": true }],
      "grid_position": { "x": 0, "y": 0, "w": 4, "h": 4 },
      "settings": { "tab": "geral",
        "comparison": { "enabled": true, "base": "previous_period", "format": "pct" } } },
    { "key": "conv", "title": "Conversão lead → negócio", "visual_type": "calculado",
      "dimensions": [], "metrics": [
        { "formula_text": "[agg:count:*@deals] / [agg:count:*@leads]",
          "resultPercent": true, "label": "Conversão" } ],
      "filters": [], "grid_position": { "x": 4, "y": 0, "w": 4, "h": 4 },
      "settings": { "tab": "geral" } },
    { "key": "mrr_mensal", "title": "MRR por mês", "visual_type": "barra",
      "sources": ["deals"],
      "dimensions": [{ "field": "closed_at", "transform": "month_year" }],
      "metrics": [{ "field": "mrr", "agg": "sum" }], "filters": [],
      "grid_position": { "x": 0, "y": 4, "w": 8, "h": 8 },
      "settings": { "tab": "geral",
        "periodWindow": { "options": ["3m","6m","12m"], "default": "6m" },
        "goalLine": { "enabled": true, "metric": "mrr", "mode": "pace" },
        "appearance": { "seriesColors": { "metric_1": "#16a34a" },
                        "dataLabels": { "show": true, "format": "value" } } } }
  ]
}`;

const SPEC = String.raw`
# Tarefa

Você vai GERAR UM JSON que, importado no sistema "Dashboard Comercial", vira um
dashboard completo: abas, widgets (gráficos, tabelas, cards, fórmulas), campos
calculados e Sub-bases necessárias. O usuário vai te descrever o dashboard que
quer; você responde com O JSON e nada mais.

## Contrato de saída (obrigatório)

- Responda com UM ÚNICO bloco de código JSON válido (sem comentários, sem
  vírgulas sobrando, sem texto fora do bloco).
- Use EXATAMENTE as chaves e enums desta especificação. Chaves/valores fora
  dela são rejeitados pelo validador com mensagens de erro — se o usuário te
  trouxer erros, corrija o JSON e devolva-o inteiro de novo.
- Strings de rótulo/título em português.

## Envelope

{
  "formato": "dashboard-import",
  "versao": 1,
  "chave": "meu_dashboard",            // slug estável; REIMPORTAR a mesma chave ATUALIZA o dashboard
  "bases": ["<keys das Bases>"],       // as Bases usadas (do MODELO DAS BASES abaixo; "base" singular também é aceito)
  "dashboard": {
    "name": "Nome do dashboard",
    "visible_to_roles": ["admin","gestor","vendedor"],   // vazio/ausente = pessoal
    "settings": { ... }                                   // ver "Settings do dashboard"
  },
  "fields": [ ... ],                   // opcional: campos personalizados a criar
  "subSources": [ ... ],               // opcional: Sub-bases a criar
  "correspondences": [ ... ],          // opcional: campos unificados a criar
  "widgets": [ ... ]                   // obrigatório: pelo menos 1
}

## Referências de campo (refs) — usadas em dimensões, métricas, filtros

- Coluna do núcleo: o nome cru (ex.: "stage", "value", "mrr", "closed_at",
  "responsible_id", "pipeline", "channel", "sale_type", "title", "closed",
  "opened_at", "source_created_at", "lead_time_days", "currency").
- Campo personalizado: "custom:<field_key>" (existente no MODELO DA BASE ou
  declarado em "fields").
- Campo unificado: "unified:<key>" (existente ou declarado em "correspondences").
- Campo do registro casado de outra Base: "match:<base>:<ref>".
- Datas em FILTROS aceitam tokens dinâmicos: ${DATE_TOKENS.map(
  (t) => `"${t}"`
).join(", ")}.

## Settings do dashboard

"settings": {
${renderDocBlock(DASHBOARD_SETTINGS_DOC)}
}

REGRA IMPORTANTE: em dashboard multi-Base, configure "fieldBySource" para cada
Base filtrar pela SUA coluna de data (ex.: negócios por "closed_at", leads por
"source_created_at") — sem isso, registros sem a data primária somem.

## "fields" — campos personalizados a criar

{
  "field_key": "ticket_medio",         // slug único (minúsculas/underscore)
  "label": "Ticket médio",
  "data_type": "${Object.keys(DATA_TYPE_LABELS).join("|")}",
  "options": ["A","B"],                // só p/ selecao
  "applies_to": ["<record_type>"],     // ausente = todas as Bases
  "is_local": true,
  "formula_text": "..."                // OBRIGATÓRIA p/ calculado/calculado_agg
}

- "calculado" = fórmula POR REGISTRO (enxerga um registro só): operandos são os
  campos do registro ([Valor], [custom:desconto], [match:leads:source_created_at],
  [Data atual]); SEM agregações/SOMASE. Datas: [data] - [data] = dias.
- "calculado_agg" = fórmula de TOTAIS (avaliada por grupo/subtotal/total do
  widget): operandos são agregados — [Contagem de registros], [Σ Valor],
  [Média Valor], [Contagem de <Campo>] (= registros com o campo preenchido) —
  cada um aceitando escopo de Base com "@": [agg:count:*@leads]. Aceita
  ${formulaFuncsIn("cond_agg").join("/")},
  ${formulaFuncsIn("logica").join("/")},
  ${formulaFuncsIn("pura").join("/")},
  ${formulaFuncsIn("comparacao").join("/")} (comparação com período anterior;
  VARPCT já sai ×100). Campo cru SÓ dentro de SOMASE/CONT.SE/MÉDIASE.
  Aceita também o VALOR DA META cadastrada: [Meta: <rótulo>] ou
  [meta:<chave>] (chaves em goal_metrics do modelo) — meta GLOBAL do período
  da consulta (mensal quando o período cabe num mês; senão anual do ano
  inicial; "todo período" = mês corrente); meta não cadastrada exibe "—".
  Ex.: [agg:sum:value] / [meta:mrr] = fração da meta atingida.
- Sintaxe: operandos entre colchetes [Rótulo] ou [ref] (ex.: [custom:forecast],
  [agg:sum:value], [agg:count:*@leads]); argumentos separados por ";" (vírgula
  é decimal: 1,5); texto "entre aspas"; comparadores = <> < > <= >=.
- Se em dúvida entre rótulo e ref, USE A REF CRUA entre colchetes — sempre
  resolve. Refs agregadas: agg:sum:<campo>, agg:avg:<campo>, agg:count:<campo>,
  agg:count:* (contagem de registros), com sufixo @<baseKey> opcional; meta:
  meta:<chave>.

## "subSources" — Sub-bases a criar

Uma Sub-base = as linhas da Base-mãe recortadas por um filtro fixo, com campo
de data próprio (essencial p/ métricas tipo "reuniões"):

{
  "key": "reunioes",
  "parent_key": "<key de Base raiz>",
  "label": "Reuniões",
  "default_period_field": "custom:data_reuniao",  // coluna core de data OU custom:<key> tipo data
  "filter": [ { "field": "custom:data_reuniao", "op": "not_null" } ],
  "ignore_period": true                // opcional: a Sub-base NÃO respeita o filtro de período do dashboard (linhas sempre em "todo período" — ex.: "todos os ativos hoje")
}

## "correspondences" — campos unificados a criar

Ligam colunas equivalentes de Bases diferentes numa coluna só ("unified:<key>"):

{ "key": "fonte_unificada", "label": "Fonte", "data_type": "texto",
  "members": [ { "source_key": "leads", "field_ref": "custom:fonte" },
               { "source_key": "deals", "field_ref": "custom:fonte" } ] }

## "widgets"

{
  "key": "mrr_mes",                    // slug ESTÁVEL (identidade no reimporte)
  "title": "MRR do mês",
  "visual_type": "barra",              // ver lista completa abaixo
  "sources": ["deals"],                // ausente/vazio = TODAS as Bases
  "split_by_source": false,            // true = uma série por Base
  "dimensions": [ { "field": "closed_at", "transform": "month_year", "label": "Mês" } ],
  "metrics":    [ { "field": "mrr", "agg": "sum", "label": "MRR" } ],
  "filters":    [ { "field": "stage", "op": "eq", "value": "Ganhou" } ],
  "grid_position": { "x": 0, "y": 0, "w": 6, "h": 8 },
  "settings": { ... }                  // ver "Settings do widget"
}

### visual_type (todos): ${enumKeysLabeled(VISUAL_TYPE_LABELS)}.
Tipos de DADOS (usam dimensions/metrics/filters): ${DATA_VISUAL_TYPES.join(
  ", "
)}.
"linha_divisoria" é uma linha livre de separação (a antiga Forma "linha",
promovida a tipo próprio).

### Dimensões
- "transform" (só campo de data): ${transformList}.
  Só p/ week_month: "weekMode": "restricted" (recorta na virada do mês) |
  "full" (semana cheia seg→dom).
- Só p/ week_year/week_month: "closedWeek": "seg_dom" | "sab_sex" — Semana
  Fechada: o período da consulta expande p/ semanas COMPLETAS nas bordas
  (a semana entra se 4+ dos 7 dias caem no período); com week_month o
  weekMode passa a valer como "full". Omitir = desligada.
- NÃO inclua "dateAgg" aqui (ver regra semântica 12 — só em lista de registros).
- "case_formula_text" (opcional, só widget AGREGADO): expressão SE/E/OU que
  RECLASSIFICA os valores da dimensão em rótulos e agrupa por eles — ex.:
  'SE([Fruta] = "Mamão"; "Doce"; SE(OU([Fruta] = "Pera"; [Fruta] = "Maçã");
  "Dura"; "Outros"))'. SE sem "senão" preserva o valor original do "field".
  Pode combinar OUTROS campos do registro (E/OU entre campos); "field" segue
  sendo o campo PRINCIPAL da dimensão. Proibido com "transform"/"dateAgg",
  em campo de data/relação e com refs de data/relação na expressão
  (removida com aviso).
- Gráficos usam a 1ª dimensão como eixo; tabela agregada aceita várias.

### Métricas
- "agg": ${enumKeys(AGG_LABELS)}. "field": "*" = contagem de registros
  (agg count). count de um campo = registros com o campo PREENCHIDO.
- Métrica de FÓRMULA própria: use "formula_text" (contexto de totais — mesmas
  regras do calculado_agg) + opcionais "resultPercent": true (exibe ×100 + "%")
  ou "resultCurrency": "BRL". Ex.: taxa de conversão entre Bases:
  { "formula_text": "[agg:count:*@deals] / [agg:count:*@leads]", "resultPercent": true }
- "sources" NA MÉTRICA = a métrica agrega sobre essas Bases (pode ser diferente
  das Bases do widget; os grupos/linhas continuam vindo das Bases do widget).
- "percent": true só ANEXA "%" (não multiplica ×100).

### Filtros
- "op": ${filterOpList}.
  Para "in", "value" é uma lista (["A","B"]); is_null/not_null vão sem "value".
- Vários filtros = E (AND). "sources" no filtro = restringe SÓ essas Bases
  (as outras passam livres).
- responsible_id/operation_id aceitam o NOME exato do cadastro como "value"
  ("in" = lista de nomes) — NUNCA invente UUID; nome inexistente é erro.

### Settings do widget (todos opcionais; omitir = padrão)

"settings": {
${renderDocBlock(WIDGET_SETTINGS_DOC)}
}
Paletas: ${paletteList}.

### REGRAS SEMÂNTICAS (não viole)

1. Comparação e businessDayAlign são MUTUAMENTE EXCLUSIVOS (align vence).
2. businessDayAlign / periodWindow / goalLine exigem dimensão de data MENSAL
   ("month_name" ou "month_year") e período ativo (defaultPreset ≠ "all").
3. Comparação não funciona com período "all" (não há base de comparação).
4. Fórmula de totais NUNCA usa [Data atual]; fórmula por registro NUNCA usa
   agregados/SOMASE nem [Meta: …]; [Meta: …] nunca dentro de SOMASE/CONT.SE/
   MÉDIASE (é um valor por consulta, não uma coluna).
5. Widget kpi/calculado: use UMA métrica (a primeira é a exibida).
6. Filtro por operação/responsável em widget: filtro FIXO usa o NOME exato do
   cadastro como "value" (ex.: { "field": "responsible_id", "op": "eq",
   "value": "Maria Silva" }); quando o LEITOR deve escolher, prefira
   quickFilters. Nunca invente UUID.
7. Condições de SOMASE/CONT.SE sobre responsible_id/operation_id comparam por
   NOME exato do cadastro (ex.: [responsible_id] = "Maria Silva").
8. Grid: SEM "settings.canvas.gridVersion" o JSON usa a escala CLÁSSICA de 12
   colunas — w×h típicos: cards 4×4, gráficos/tabelas 6×8; organize por linhas
   (y crescente), sem sobreposição (o sistema converte para a grade fina ao
   aplicar). Se o ESTADO ATUAL trouxer "settings.canvas.gridVersion": 2, as
   posições dele estão na grade FINA (120 colunas; cards ~39×15, gráficos/
   tabelas ~59×31) — use a MESMA escala do estado e não misture as duas.
9. Se a análise precisa de um recorte fixo reutilizável com data própria
   (ex.: reuniões), crie uma Sub-base em "subSources" e use a key dela em
   "sources" — não replique o filtro em cada widget.
10. Campos que os widgets referenciam DEVEM existir no MODELO DAS BASES
    abaixo ou ser declarados em "fields"/"correspondences".
11. Dashboard com 2+ Bases: configure SEMPRE "periodBar.fieldBySource" com o
    campo de data de CADA Base (sem isso, registros sem a data primária
    somem); para agrupar/filtrar um conceito que existe nas duas Bases, use
    um campo unificado ("unified:<key>" — existente no modelo ou declarado em
    "correspondences"), nunca o campo de uma Base só; refs "match:<base>:<ref>"
    só funcionam entre Bases com Conexão listada no modelo ("conexoes").
12. EIXO DE TEMPO: para "por mês/trimestre/semana", basta a dimensão com um
    campo de DATA + "transform" — o agrupamento pelo bucket é automático.
    NUNCA use "dateAgg" em gráficos ou tabelas agregadas (ele é EXCLUSIVO de
    tabela com "rowMode": "records", e nunca com métrica de fórmula) — o
    validador o remove com aviso.
13. MOEDA DO RESULTADO: use "resultCurrency" SOMENTE quando precisar
    CONVERTER moedas (exige taxas cadastradas em Campos → Moedas; sem
    taxa o widget exibe "—"). Para razões e valores já em R$, OMITA
    (resultado numérico é o seguro); percentual = "resultPercent": true.
14. SUB-BASES: REUTILIZE as Sub-bases existentes do MODELO quando o recorte
    desejado for o mesmo — use a key EXISTENTE em "sources"/escopos "@" e NÃO
    declare de novo (nunca crie variantes tipo "_v2"). O escopo "@sub" das
    fórmulas deve apontar para as MESMAS keys usadas em "sources" da métrica.
    (O validador descarta Sub-bases de recorte idêntico e remapeia as
    referências, com aviso.)

## Exemplo mínimo completo

${SPEC_EXAMPLE}
`;

function section(title: string, body: string): string {
  return `\n\n============================================================\n# ${title}\n============================================================\n\n${body.trim()}\n`;
}

/** Monta o prompt final copiado para o clipboard. */
export function buildImportPromptText(parts: ImportPromptParts): string {
  const head = [
    "INSTRUÇÕES PARA GERAR UM DASHBOARD IMPORTÁVEL (JSON)",
    "",
    `Base(s) selecionada(s): ${parts.basesLabel}`,
    "Leia a especificação, estude o MODELO DAS BASES e as AMOSTRAS DE DADOS",
    "ao final, e aguarde a descrição do dashboard desejado pelo usuário.",
    "Então responda com UM único bloco de código JSON no formato especificado.",
  ].join("\n");
  const out = [
    head,
    SPEC.trim(),
    section(
      "MODELO DAS BASES (campos disponíveis — use estas refs)",
      parts.baseModelJson
    ),
    section(
      "AMOSTRAS DE DADOS (por Base; ~20 registros reais cada, escolhidos para cobrir todas as colunas)",
      `${parts.sampleNote}\n\n${parts.sampleJson}`
    ),
  ];
  if (parts.manual) {
    out.push(
      section(
        "ANEXO — Manual de construção de dashboards (referência completa da semântica)",
        parts.manual
      )
    );
  }
  return out.join("\n");
}

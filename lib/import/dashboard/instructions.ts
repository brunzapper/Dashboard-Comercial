// Versão: 1.2 | Data: 23/07/2026
// v1.2 (23/07/2026): regras 12-14 (eixo de tempo sem dateAgg; resultCurrency
//   só p/ converter; reuso de Sub-bases existentes + escopo @sub ↔ sources) —
//   respostas aos erros observados nos primeiros dashboards gerados por IA.
// v1.1 (23/07/2026): multi-Base — envelope com `bases: []`, seções "MODELO
//   DAS BASES"/"AMOSTRAS (por Base)" e regra semântica de dashboards
//   multi-Base (fieldBySource sempre; unified: nas dimensões compartilhadas;
//   match: só onde há Conexão cadastrada).
// Manual de instruções COPIADO para o clipboard no modo "Importar dashboard
// via JSON (IA)": especificação completa do formato + regras semânticas
// condensadas + exemplo. O chamador (import-prompt-actions) injeta o MODELO DA
// BASE selecionada e a AMOSTRA de registros; a variante "completo" anexa o
// manual de construção de dashboards inteiro (docs/) para IAs menos capazes.
// Mantenha os enums daqui em dia com lib/widgets/types.ts (fonte da verdade) —
// mudanças de UI/semântica do construtor incluem este arquivo (AGENTS.md).

export interface ImportPromptParts {
  basesLabel: string; // ex.: 'Leads do Bitrix ("leads"), Deals do Bitrix ("deals")'
  baseModelJson: string; // JSON do modelo das Bases (campos/tipos/opções/subs/conexões)
  sampleJson: string; // JSON das amostras (por Base; ~20 linhas com cobertura cada)
  sampleNote: string; // observações das amostras (colunas sem dado etc.)
  manual?: string; // variante "completo": manual de construção inteiro
}

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
- Datas em FILTROS aceitam tokens dinâmicos: "@today", "@month_start",
  "@month_end", "@year_start", "@year_end".

## Settings do dashboard

"settings": {
  "tabs": [ { "id": "geral", "name": "Visão geral", "color": "#eef2ff" } ],
  "periodBar": {
    "enabled": true,
    "defaultPreset": "este_mes",       // hoje|ultimos_7|ultimos_30|ultimos_90|esta_semana|semana_passada|este_mes|mes_passado|este_trimestre|este_ano|ano_passado|all
    "field": "closed_at",              // campo de data primário
    "fieldBySource": { "<baseKey>": "<campo de data daquela Base>" },
    "scope": "global"                  // "global" | "tab"
  },
  "canvas": { "cols": 12, "rowHeight": 30 },
  "dateFormat": "dd/mm/aaaa"           // dd/mm/aaaa | dd/mm/aa | mm/aa
}

REGRA IMPORTANTE: em dashboard multi-Base, configure "fieldBySource" para cada
Base filtrar pela SUA coluna de data (ex.: negócios por "closed_at", leads por
"source_created_at") — sem isso, registros sem a data primária somem.

## "fields" — campos personalizados a criar

{
  "field_key": "ticket_medio",         // slug único (minúsculas/underscore)
  "label": "Ticket médio",
  "data_type": "texto|numero|data|selecao|moeda|booleano|calculado|calculado_agg",
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
  SOMASE/SOMASES/CONT.SE/CONT.SES/MÉDIASE, SE/E/OU, SOMA/MÉDIA/MÍN/MÁX/ARRED/
  ABS, ANTERIOR/VARPCT/VARABS (comparação com período anterior; VARPCT já sai
  ×100). Campo cru SÓ dentro de SOMASE/CONT.SE/MÉDIASE.
- Sintaxe: operandos entre colchetes [Rótulo] ou [ref] (ex.: [custom:forecast],
  [agg:sum:value], [agg:count:*@leads]); argumentos separados por ";" (vírgula
  é decimal: 1,5); texto "entre aspas"; comparadores = <> < > <= >=.
- Se em dúvida entre rótulo e ref, USE A REF CRUA entre colchetes — sempre
  resolve. Refs agregadas: agg:sum:<campo>, agg:avg:<campo>, agg:count:<campo>,
  agg:count:* (contagem de registros), com sufixo @<baseKey> opcional.

## "subSources" — Sub-bases a criar

Uma Sub-base = as linhas da Base-mãe recortadas por um filtro fixo, com campo
de data próprio (essencial p/ métricas tipo "reuniões"):

{
  "key": "reunioes",
  "parent_key": "<key de Base raiz>",
  "label": "Reuniões",
  "default_period_field": "custom:data_reuniao",  // coluna core de data OU custom:<key> tipo data
  "filter": [ { "field": "custom:data_reuniao", "op": "not_null" } ]
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

### visual_type (todos): tabela, tabela_editavel (Tabela Livre), barra,
barra_horizontal, linha, pizza, funil, kpi (Card), calculado (Métrica
calculada), calculadora, nota, forma, imagem, filtro (Filtro de período),
filtro_campo (Filtro por campo), kanban, agenda.
Tipos de DADOS (usam dimensions/metrics/filters): tabela, barra,
barra_horizontal, linha, pizza, funil, kpi, calculado.

### Dimensões
- "transform" (só campo de data): weekday (dia da semana), week_year (semana do
  ano), week_month (semana do mês; "weekMode": "restricted"|"full"), month_name
  (nome do mês), month_year (mês/ano), quarter (trimestre), year (ano).
- NÃO inclua "dateAgg" aqui (ver regra semântica 12 — só em lista de registros).
- Gráficos usam a 1ª dimensão como eixo; tabela agregada aceita várias.

### Métricas
- "agg": sum | count | avg | min | max. "field": "*" = contagem de registros
  (agg count). count de um campo = registros com o campo PREENCHIDO.
- Métrica de FÓRMULA própria: use "formula_text" (contexto de totais — mesmas
  regras do calculado_agg) + opcionais "resultPercent": true (exibe ×100 + "%")
  ou "resultCurrency": "BRL". Ex.: taxa de conversão entre Bases:
  { "formula_text": "[agg:count:*@deals] / [agg:count:*@leads]", "resultPercent": true }
- "sources" NA MÉTRICA = a métrica agrega sobre essas Bases (pode ser diferente
  das Bases do widget; os grupos/linhas continuam vindo das Bases do widget).
- "percent": true só ANEXA "%" (não multiplica ×100).

### Filtros
- "op": eq | neq | ilike (contém) | gt | gte | lt | lte | in (lista CSV) |
  is_null (é vazio, sem value) | not_null (não vazio, sem value).
- Vários filtros = E (AND). "sources" no filtro = restringe SÓ essas Bases
  (as outras passam livres).

### Settings do widget (todos opcionais; omitir = padrão)

"settings": {
  "tab": "geral",                            // id da aba
  "quickFilters": [                          // dropdowns no card (seleção compartilhada)
    { "id": "qf1", "field": "responsible_id" },
    { "id": "qf2", "field": "operation_id" },
    { "id": "qf3", "field": "closed_at" },                          // dropdown de período
    { "id": "qf4", "field": "closed_at", "transform": "month_name" } // multi-seleção de meses
  ],
  "comparison": {                            // variação vs outro período
    "enabled": true,
    "base": "previous_period",               // previous_period | previous_period_bd | previous_year | window_avg | window_median
    "window": "last_12m",                    // só window_*: quarter|semester|ytd|last_12m
    "format": "pct",                         // pct | abs | both
    "style": "both",                         // color | arrow | both
    "showBaseValue": false, "invertColors": false,
    "ghostSeries": false, "chartLabels": false,
    "tablePlacement": "inline"               // tabela: inline | column
  },
  "businessDayAlign": { "enabled": true, "reference": "today" },  // "today"|"period_end"
  "periodWindow": { "options": ["3m","6m","12m"], "default": "6m", "showAlignToggle": true },
  "goalLine": { "enabled": true, "metric": "mrr", "mode": "pace", "label": "Meta" },  // mode: monthly|pace; só barra/linha
  "mode": "meta",                            // Card de META (kpi): compara com a meta cadastrada
  "metric": "mrr", "scope": "global", "period": "month",          // config do Card de meta
  "card": { "mode": "topn", "labelField": "responsible_id",       // Card: value|record|topn|list|formula
            "metric": { "field": "mrr", "agg": "sum" }, "limit": 5 },
  "rowMode": "records",                      // tabela: lista de registros individuais
  "table": { "groupBy": "dim_1" },           // tabela agregada: agrupar pelo 1º nível
  "coexistSubSources": false,
  "subSeriesMode": "stacked",                // 2+ sub-bases no widget: stacked (empilhado, default) | total (somado, some a coluna Base) | grouped (lado a lado)
  "autoSize": { "width": false, "height": false },
  "appearance": {                            // aparência (tudo opcional)
    "decimals": 0,
    "chart": { "palette": "design", "stacked": false,
               "categoryLimit": { "n": 8, "others": true },
               "dataLabels": { "enabled": true, "format": "value" },
               "legend": { "enabled": true } },
    "conditional": { "rules": [ { "target": "metric_1", "op": "lt", "value": 0.2,
                                  "scope": "cell", "color": "#dc2626", "bold": true } ] }
  }
}
Paletas: design | vivid | ocean | sunset | forest | gray | inbound.

### REGRAS SEMÂNTICAS (não viole)

1. Comparação e businessDayAlign são MUTUAMENTE EXCLUSIVOS (align vence).
2. businessDayAlign / periodWindow / goalLine exigem dimensão de data MENSAL
   ("month_name" ou "month_year") e período ativo (defaultPreset ≠ "all").
3. Comparação não funciona com período "all" (não há base de comparação).
4. Fórmula de totais NUNCA usa [Data atual]; fórmula por registro NUNCA usa
   agregados/SOMASE.
5. Widget kpi/calculado: use UMA métrica (a primeira é a exibida).
6. Filtro por operação/responsável em widget: prefira quickFilters (o leitor
   escolhe) em vez de filtro fixo com UUID.
7. Condições de SOMASE/CONT.SE sobre responsible_id/operation_id comparam por
   NOME exato do cadastro (ex.: [responsible_id] = "Maria Silva").
8. Grid: 12 colunas (padrão); w×h típicos — cards 4×4, gráficos/tabelas 6×8;
   organize por linhas (y crescente), sem sobreposição.
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
    CONVERTER moedas (exige taxas cadastradas em Configurações → Moedas; sem
    taxa o widget exibe "—"). Para razões e valores já em R$, OMITA
    (resultado numérico é o seguro); percentual = "resultPercent": true.
14. SUB-BASES: REUTILIZE as Sub-bases existentes do MODELO quando o recorte
    desejado for o mesmo — use a key EXISTENTE em "sources"/escopos "@" e NÃO
    declare de novo (nunca crie variantes tipo "_v2"). O escopo "@sub" das
    fórmulas deve apontar para as MESMAS keys usadas em "sources" da métrica.
    (O validador descarta Sub-bases de recorte idêntico e remapeia as
    referências, com aviso.)

## Exemplo mínimo completo

{
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
        "goalLine": { "enabled": true, "metric": "mrr", "mode": "pace" } } }
  ]
}
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

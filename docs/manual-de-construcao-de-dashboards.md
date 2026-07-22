<!-- Versão: 1.0 | Data: 22/07/2026 -->
<!-- v1.0 (22/07/2026): criação. Manual exaustivo e autossuficiente de construção
     de dashboards, escrito para ser ingerido por uma IA (Obsidian/Notion) que
     instruirá terceiros na montagem de dashboards completos pela UI. -->

# Manual de Construção de Dashboards

> **Para quem é este documento.** Este manual ensina a montar dashboards no
> sistema "Dashboard Comercial — Zapper" usando exclusivamente a interface.
> Ele foi escrito para ser lido por uma IA (num cérebro tipo Obsidian/Notion)
> que precisa instruir uma pessoa com **certeza absoluta**: cada peça do
> construtor, cada opção, cada cálculo e cada regra de combinação está descrita
> por extenso. Não é preciso (nem esperado) ter acesso ao código ou ao banco.
>
> **Como usar.** As combinações possíveis são infinitas; o manual não tenta
> enumerá-las. Em vez disso, descreve o funcionamento completo de cada peça e
> as regras que governam como as peças interagem (capítulos 7 e 15). Dominando
> as peças e as regras, qualquer combinação pode ser montada e explicada.
>
> **Convenções.** Rótulos exatos da interface aparecem "entre aspas". Chaves
> internas (úteis para identificar opções sem ambiguidade) aparecem em
> `código`. Quando um valor é padrão, isso é dito explicitamente. Listas
> fechadas (agregações, operadores, períodos…) estão SEMPRE completas — se uma
> opção não está listada, ela não existe.

## Sumário

1. [O que é o sistema e conceitos fundamentais](#1-o-que-é-o-sistema-e-conceitos-fundamentais)
2. [Cadastros de apoio (pré-requisitos do construtor)](#2-cadastros-de-apoio-pré-requisitos-do-construtor)
3. [Anatomia de um dashboard](#3-anatomia-de-um-dashboard)
4. [Período e filtros no nível do dashboard](#4-período-e-filtros-no-nível-do-dashboard)
5. [Referência completa dos 17 tipos de widget](#5-referência-completa-dos-17-tipos-de-widget)
6. [O editor de widget, seção por seção](#6-o-editor-de-widget-seção-por-seção)
7. [Como os números são calculados (semântica)](#7-como-os-números-são-calculados-semântica)
8. [Fórmulas — referência completa](#8-fórmulas--referência-completa)
9. [Aparência e formatação](#9-aparência-e-formatação)
10. [Interatividade e persistência: o que é de quem](#10-interatividade-e-persistência-o-que-é-de-quem)
11. [Snapshots públicos](#11-snapshots-públicos)
12. [Kanban e Agenda](#12-kanban-e-agenda)
13. [Presets (dashboards prontos)](#13-presets-dashboards-prontos)
14. [Guia prático: um dashboard comercial completo, passo a passo](#14-guia-prático-um-dashboard-comercial-completo-passo-a-passo)
15. [Regras de ouro e armadilhas](#15-regras-de-ouro-e-armadilhas)
16. [Glossário e tabelas de referência rápida](#16-glossário-e-tabelas-de-referência-rápida)

---

## 1. O que é o sistema e conceitos fundamentais

### 1.1 O produto

O sistema é um **construtor de dashboards comerciais** — não um dashboard
fixo. A equipe monta os próprios painéis a partir de registros de vendas
(leads, negócios, fechamentos) que o sistema mantém num núcleo próprio de
dados. As fontes externas (Bitrix24, planilha "Estudo de Fechamentos",
importação CSV, API de ingestão) apenas **alimentam** esse núcleo; toda
consulta de dashboard lê o núcleo, nunca a fonte externa diretamente.

Consequência prática para quem monta dashboards: os dados exibidos são os do
núcleo, atualizados pela sincronização. Um dado alterado no Bitrix aparece no
dashboard após o próximo ciclo de sync (ou em tempo quase real, via
atualização automática da tela).

### 1.2 Registros

Tudo que os widgets contam, somam e agrupam são **registros**: uma linha por
lead, negócio ou fechamento. Todo registro tem:

- **Campos do núcleo** (existem em todos os registros): título, responsável,
  operação, pipeline, etapa (stage), tipo de venda, canal, valor, MRR, moeda,
  datas (data de fechamento `closed_at`, data de abertura `opened_at`, data de
  criação na origem `source_created_at`, data de modificação na origem
  `source_modified_at`, além de carimbos internos).
- **Campos personalizados** (variam por Base): criados na aba "Campos" ou
  trazidos da fonte externa — por exemplo "Fonte" (canal de aquisição do CRM),
  "Data Reunião", "Forecast", "Potencial".

### 1.3 Base e Sub-base (terminologia importante)

- **"Base"** é o nome, na interface, de uma fonte de dados do sistema — um
  conjunto de registros do mesmo tipo. Exemplos padrão: **Leads do Bitrix**,
  **Deals do Bitrix** (negócios), **Estudo de Fechamentos**. Outras Bases podem
  ser criadas dinamicamente (via importação CSV, API ou cadastro).
- **"Sub-base"** é uma Base derivada: as MESMAS linhas de uma Base-mãe,
  recortadas por um filtro fixo, com um campo de data próprio para o período.
  Exemplo: uma Sub-base "Reuniões" = Leads cujo campo "Data Reunião" está
  preenchido, usando "Data Reunião" como campo de período. Sub-bases aparecem
  indentadas (com `↳`) nas listas de seleção.
- **Atenção à palavra "Fonte"**: na interface, "Fonte" designa APENAS o campo
  do CRM que indica o canal de aquisição do lead (campo `custom:fonte`). A
  fonte de dados do sistema chama-se sempre "Base". (Em documentos técnicos
  antigos, "fonte" também era usada para Base — este manual usa a terminologia
  atual da UI.)

Cada Base tem um **campo de data padrão** para o filtro de período:
Leads → data de criação na origem; Deals → data de fechamento;
Estudo de Fechamentos → data de criação na origem. Isso importa muito no
capítulo 4.

### 1.4 Campos unificados e registros casados

- **Campo unificado** ("Correspondências", aba Campos): liga colunas
  equivalentes de Bases diferentes para que funcionem como UMA coluna nos
  widgets. Exemplo: unificar "Fonte" do Lead com "Fonte" do Negócio permite
  agrupar um widget de várias Bases por um único campo "Fonte". Nos dropdowns
  do construtor, o campo unificado aparece como um campo normal.
- **Registro casado** ("Conexões", aba Campos): regra que conecta um registro
  de uma Base ao registro correspondente de outra (ex.: o negócio ao lead que
  o originou). Isso habilita, em fórmulas e colunas, os campos do registro
  casado — identificados pelo prefixo visual **`↪ <Base>: <Campo>`** (ex.:
  "↪ Leads: Data de criação").

### 1.5 Papéis e permissões que afetam a construção

O acesso é por papéis (ex.: admin, gestor, vendedor). Para o construtor de
dashboards importa saber:

- **Criar dashboards** exige a permissão de criação (`create_dashboards`).
- **Editar um dashboard** (layout, widgets) é do dono/admin; a
  **visibilidade** é configurada por papéis no menu do dashboard
  ("Compartilhamento"). Dashboard sem papel marcado é pessoal.
- **Gerir campos** (aba "Campos", correspondências, conexões) exige
  `manage_field_definitions`.
- Configurações administrativas (Operações, Responsáveis, Metas, Bases,
  Presets, Snapshots globais, Integrações, Usuários) são de admin.
- Alguns recursos de exibição respeitam permissões por campo: um campo pode
  ser visível/editável só para certos papéis (definido na aba Campos).

### 1.6 O ciclo de vida de um dashboard (visão geral)

1. (Se necessário) preparar os **cadastros de apoio**: campos, correspondências,
   conexões, Sub-bases, metas, feriados, moedas (capítulo 2).
2. **Criar o dashboard** na Home ("Workspace") — nome + visibilidade.
3. Estruturar **abas** e a **área de trabalho** (capítulo 3).
4. Configurar a **barra de período** e widgets de filtro (capítulo 4).
5. **Adicionar widgets** um a um pelo editor (capítulos 5 e 6).
6. Ajustar **aparência e formatação** (capítulo 9).
7. (Opcional) publicar um **snapshot público** (capítulo 11).

---

## 2. Cadastros de apoio (pré-requisitos do construtor)

Nada aqui é obrigatório para um dashboard simples (contagens e somas dos
campos existentes funcionam de imediato). Mas cada recurso abaixo, quando
cadastrado, **habilita opções novas no construtor** — e vários widgets
avançados dependem deles.

### 2.1 Aba "Campos" (menu lateral → Campos)

Página com três sub-abas: **Campos**, **Correspondências** e **Conexões**.
Requer a permissão de gestão de campos.

#### 2.1.1 Sub-aba Campos

Tabela de todos os campos, organizada em abas por Base (mais "Núcleo" e
"Gerais (todas as bases)"). Colunas: Rótulo, Chave, Tipo, Origem (badge
Núcleo/Bitrix/Local/App), Exibir (toggle do "olho"), Visível, Ações.

**Os 8 tipos de campo** (lista completa):

| Tipo (rótulo na UI) | O que é | Uso em widgets |
|---|---|---|
| "Texto" | texto livre | dimensão, filtro |
| "Número" | numérico; opção "exibir como percentual" | métrica (soma/média/mín/máx), dimensão, filtro, operando de fórmula |
| "Data" | data (calendário) ou data+hora | dimensão com formatos de data, campo de período, filtro |
| "Seleção" | lista de opções (uma por linha no cadastro) | dimensão, filtro com dropdown de opções |
| "Moeda" | valor monetário; moeda **herdada do registro** (padrão) ou **fixa** | métrica monetária (com todas as opções de conversão do §6.3) |
| "Booleano" | verdadeiro/falso | dimensão, filtro |
| "Calculado (por registro)" | fórmula avaliada registro a registro e materializada (recalculada no sync/edição); formato número, percentual ou moeda (auto/fixa); pode permitir/bloquear negativo | vira um campo numérico normal: métrica, dimensão, operando |
| "Calculado (totais do recorte)" | fórmula sobre agregados (Σ/Média/Contagem) avaliada **no widget**, por grupo, subtotal e total | vira uma métrica reutilizável ("Calculado (totais)" no dropdown de métricas) |

Notas importantes:

- Ao criar campos calculados há **receitas guiadas** ("Ciclo de vendas",
  "Taxa de conversão") que geram uma fórmula normal, 100% editável depois.
- Campos calculados podem referenciar outros calculados (aninhamento); o
  sistema impede ciclos.
- **Configurações por campo**: papéis que veem (`visible_to_roles`), papéis
  que editam (`editable_by_roles`), "Exibir" no construtor
  (`show_in_builder` — o "olho"; campo oculto não aparece nos dropdowns do
  construtor), "só do app" (`is_local`), gravação de volta no Bitrix
  (`write_back`), ordem (`sort_order`).
- **Campos do núcleo na aba Campos**: as colunas do núcleo (pipeline, etapa,
  canal…) aparecem como linhas de origem "Núcleo" apenas para gestão de
  rótulo/visibilidade/ordem — não são campos personalizados, não podem ser
  excluídas e são visíveis a todos os papéis. Pipeline, etapa, tipo de venda e
  canal podem alternar entre texto e seleção; as opções do pipeline são
  reescritas automaticamente a cada sync (não adianta editá-las à mão).

#### 2.1.2 Sub-aba Correspondências (campos unificados)

Cria um **campo unificado** escolhendo, para cada Base, qual coluna equivale.
O campo unificado passa a aparecer nos dropdowns do construtor como um campo
único e funciona em dimensões, filtros, período e fórmulas. Cada Base
contribui com no máximo uma coluna; uma Base sem membro simplesmente não
alimenta aquele campo (os registros dela ficam de fora de agrupamentos por
esse campo). Sub-bases podem ter membro próprio, diferente do da Base-mãe.

#### 2.1.3 Sub-aba Conexões (match entre Bases)

Define regras de **casamento** entre registros de duas Bases: até 2 pares de
campos (com fallback — se o primeiro par não casar, tenta o segundo) e um
botão de auto-match. Depois de casados, os campos do registro conectado ficam
disponíveis em fórmulas e colunas com o prefixo `↪`.

### 2.2 Configurações → Bases (rota "fontes")

- **Bases dinâmicas**: criação/edição de Bases além das três padrão (nome,
  rótulo curto, permissão de criação manual de registros, fuso horário da
  origem — datas com hora vindas de fora são normalizadas para o horário de
  Brasília na entrada).
- **Sub-bases** (gerenciador próprio): escolher a Base-mãe, o **filtro** que
  recorta as linhas (mesma sintaxe dos filtros de widget, §6.4) e o **campo de
  data** próprio para o período. Ex.: Sub-base "Reuniões" = Leads com
  "Data Reunião" não vazio, período por "Data Reunião".
- **Rótulos curtos** por Base (usados em espaços apertados da UI).

### 2.3 Configurações → Operações e Responsáveis

- **Operações**: unidades comerciais organizadas em árvore (uma operação pode
  ter operações-filhas). Cada operação pode ter um **filtro de perfil** — um
  filtro fixo (mesma sintaxe dos filtros de widget) que define o "recorte de
  dados" daquela operação.
- **Responsáveis**: ativar/desativar quem aparece nos dropdowns e mapear cada
  responsável às suas operações (a de prioridade 1 é a padrão).
- **Por que isso importa nos dashboards**: quando um widget/filtro filtra por
  "Operação", o sistema NÃO compara a coluna de operação gravada no registro
  (ela pode estar vazia/defasada). Ele traduz para: *registros cujos
  responsáveis pertencem à operação (incluindo sub-operações da árvore)* +
  o filtro de perfil da operação. Detalhes no §7.5.

### 2.4 Configurações → Metas (e dias não úteis)

- **Metas**: cadastradas por período (ano, ou ano+mês; sem mês = meta anual) e
  por **escopo**: global, por operação ou por responsável, com um valor-alvo
  por **métrica de meta**. Métricas de meta disponíveis: as embutidas
  **`mrr`** (monetária) e **`clientes`** (contagem), mais métricas
  personalizadas cadastradas pelo admin (chaves minúsculas, ex.: `sql`).
- **Roll-up ("as metas se comunicam")**: ao resolver a meta de um escopo, vale
  a meta explícita se existir; senão: meta de operação = soma das metas dos
  responsáveis da sua subárvore; meta global = soma das metas de operação (na
  falta, soma das metas de responsável). Meta de responsável sem cadastro
  explícito = sem meta.
- **Dias não úteis**: calendário global de feriados/pontos facultativos.
  Alimenta tudo que envolve "dia útil": alinhamento por dia útil, comparação
  "mesmo dia útil", meta em modo "ritmo" (§6.7, §7.7). Sem cadastro, dia útil
  = segunda a sexta.

### 2.5 Configurações → Moedas

Tabela de taxas de conversão por moeda, **ano e trimestre** (trimestre 0 =
taxa anual). Taxa = **reais por 1 unidade da moeda estrangeira**. Moedas
suportadas (lista completa): Real (R$) `BRL`, Dólar (US$) `USD`, Euro (€)
`EUR`, Libra (£) `GBP`, Peso argentino ($) `ARS`. O botão **"Atualizar
agora"** busca as cotações de fechamento PTAX (Banco Central) e preenche a
taxa anual + 4 trimestrais usando a média de venda do período (no ano
corrente, cada janela vai só até hoje). Sem taxa cadastrada para uma
combinação (moeda, ano/trimestre), o widget mostra indisponibilidade em vez
de um número errado. A semântica completa de conversão está no §7.6.

### 2.6 Configurações → Presets, Snapshots, Integrações, Usuários

- **Presets**: geração/atualização dos 4 dashboards prontos (capítulo 13).
- **Snapshots**: gestão global dos links públicos (capítulo 11).
- **Integrações**: chaves de API de entrada e webhooks de saída (fora do
  escopo deste manual).
- **Usuários**: contas, papéis, mapeamento com o Bitrix.

---

## 3. Anatomia de um dashboard

### 3.1 Criação

Na Home ("Workspace"), o botão **"Criar"** abre um menu com duas opções:
**Dashboard** e **Kanban** (quadro dedicado — capítulo 12). Para Dashboard:
nome + visibilidade por papel (checkboxes). Sem nenhum papel marcado, o
dashboard é **pessoal** (só o dono vê). O dono pode excluir o dashboard na
Home. A Home também reabre automaticamente o último painel visitado ao voltar
ao app.

### 3.2 Cabeçalho e modos

No topo da página do dashboard:

- **Título** editável inline (clique no texto).
- **Desfazer/Refazer** — histórico em memória da sessão (até 10 estados
  completos: nome, configurações, widgets e células). Vale para edições de
  estrutura; não desfaz seleções de filtro compartilhadas.
- **"Editar layout"** — alterna o modo edição: arrastar/redimensionar widgets,
  editar abas, acessar menus de contexto, editar nota/Tabela Livre in-loco.
- **"Conectar"** (submodo do modo edição) — desenhar linhas/setas entre
  widgets (§9.6).
- **"Adicionar widget"** — abre o editor de widget (capítulo 6).
- **Menu "⋮"** do dashboard (§3.6).

### 3.3 Abas

Um dashboard pode ter **abas** (chips no topo). No modo edição: **"+"**
adiciona, duplo-clique renomeia, seletor de cor muda a cor do chip, "×"
exclui (com confirmação). Cada widget pertence a uma aba (campo "Aba" no
editor de widget; novo widget nasce na aba ativa). A aba ativa fica na URL
(`?tab=`), então um link pode apontar direto para uma aba.

### 3.4 Grid (área de trabalho)

- O dashboard é um **grid** configurável: **colunas** de 12 a 48 (padrão 12) e
  **altura da linha** de 10 a 200 px (padrão 30), em "⋮ → Área de trabalho".
  No modo edição, alças na borda inferior/direita da área aumentam
  linhas/colunas diretamente (linhas de 8 a 200).
- **Posicionamento é livre nos dois eixos** (nada "sobe" sozinho). Ao soltar
  um widget sobre outro, o vizinho é **empurrado** na direção do movimento.
- **Arrastar**: pela barra de título do widget (modo edição). **Pan**: clicar
  e arrastar uma área vazia move a viewport ("mãozinha").
- **Redimensionar**: alças nas bordas do widget (modo edição).
- **Tamanho dinâmico**: widgets com "Largura dinâmica"/"Altura dinâmica"
  (§6.9) crescem visualmente para caber o conteúdo; o tamanho gravado no grid
  é o mínimo.

### 3.5 As 5 formas de criar um widget

1. **"Adicionar widget"** no cabeçalho → editor completo (capítulo 6).
2. **Clique-direito em área vazia → "Inserir ▸"** → menu com os 17 tipos (com
   busca); o widget é criado centrado na célula clicada e, se o tipo exigir
   configuração, o editor abre em seguida.
3. **Modo "Posicionar"**: ao salvar um widget novo pelo editor com o botão
   "Posicionar", um fantasma tracejado segue o cursor; clique posiciona
   (Esc = posiciona automaticamente no primeiro espaço livre).
4. **"Desenhar no painel"** (exclusivo da Tabela Livre): arrasta-se um
   retângulo na área; o tamanho desenhado vira o tamanho do widget e define a
   grade inicial (aprox. 1 coluna a cada 120 px e 1 linha a cada 32 px;
   limites 1–12 colunas, 1–50 linhas). Sem desenhar, a grade padrão é 3×3.
5. **Clique-direito → "Colar widget"**: cola um widget copiado (o menu "⋮" do
   card tem "Copiar"). A cópia carrega título, tipo, Bases, dimensões,
   métricas, filtros, configurações e tamanho — e pode ser colada em OUTRO
   dashboard (a área de transferência sobrevive entre páginas no mesmo
   navegador).

**Tamanhos iniciais por tipo** (largura×altura em células): Tabela, Tabela
Livre, Barra, Barra horizontal, Linha, Pizza, Funil, Nota, Kanban e Agenda =
6×8; Card e Métrica calculada = 4×4; Calculadora = 4×9; Forma e Imagem =
4×6; Filtro de período = 6×3; Filtro por campo = 6×4.

**Tipos que abrem o editor automaticamente ao criar**: todos, EXCETO Tabela
Livre, Calculadora, Nota e Forma (esses quatro funcionam de imediato e são
editados no próprio card).

### 3.6 Menu "⋮" do dashboard

- **Modo tela cheia** — fullscreen do navegador.
- **Aparência**:
  - **Fundo**: Padrão (tema) / Cor sólida / Gradiente (com cores "De"/"Até" e
    ângulo 0–360°, padrão 135°).
  - **Formato de data padrão** do dashboard: `dd/mm/aaaa` (padrão) /
    `dd/mm/aa` / `mm/aa` — usado por toda data exibida que não tenha formato
    próprio.
  - **Escala da fonte**: 90% / 100% (padrão) / 115% / 130% / 150% —
    multiplica os textos de todos os widgets. Tamanhos fixados em px num
    widget específico (§9.1) NÃO são afetados.
- **Área de trabalho**: colunas do grid e altura da linha (§3.4).
- **Compartilhamento**: papéis que veem o dashboard.
- **Snapshots**: painel de links públicos congelados (capítulo 11).

### 3.7 Modo foco e atalhos

Formas (§5.6) e links dentro de Notas (§5.5) podem apontar para um widget de
qualquer dashboard/aba. Ao clicar, o sistema navega (se preciso), seleciona a
aba e **centraliza o widget-alvo** ("modo foco"). É a ferramenta para criar
painéis-índice ou fluxos guiados.

---

## 4. Período e filtros no nível do dashboard

Este capítulo cobre os controles que afetam vários widgets de uma vez. Os
filtros embutidos num único widget estão no §6.4–6.5.

### 4.1 Barra de período global

Barra no topo do dashboard com um dropdown de período + campo de data. É
configurada pela engrenagem da própria barra:

- **Período padrão** — o que vale quando o usuário ainda não escolheu nada.
- **Campo de data padrão** (primário) — ex.: "Data de fechamento".
- **Campo de data por Base** — override individual: cada Base pode filtrar
  pela SUA coluna de data (ex.: Deals por fechamento, Estudo por criação).
  Essencial em dashboards multi-Base; ver §7.2.
- **Escopo**: **global** (uma seleção para o dashboard inteiro) ou **por aba**
  (cada aba tem sua própria seleção).
- **Ocultar** a barra (o período padrão continua valendo).

**As 13 opções do dropdown de período** (idênticas na barra global, no widget
"Filtro de período" e nos filtros rápidos de período dos cards):

| # | Rótulo | Chave interna | Intervalo resolvido |
|---|---|---|---|
| 1 | "Todo o período" | `all` | sem filtro de data |
| 2 | "Hoje" | `hoje` | o dia de hoje |
| 3 | "Últimos 7 dias" | `ultimos_7` | hoje−6 → hoje |
| 4 | "Últimos 30 dias" | `ultimos_30` | hoje−29 → hoje |
| 5 | "Últimos 90 dias" | `ultimos_90` | hoje−89 → hoje |
| 6 | "Esta semana" | `esta_semana` | segunda → domingo da semana atual |
| 7 | "Semana passada" | `semana_passada` | segunda → domingo da semana anterior |
| 8 | "Este mês" | `este_mes` | dia 1 → último dia do mês atual |
| 9 | "Mês passado" | `mes_passado` | mês anterior completo |
| 10 | "Este trimestre" | `este_trimestre` | trimestre civil atual |
| 11 | "Este ano" | `este_ano` | 1/jan → 31/dez do ano atual |
| 12 | "Ano passado" | `ano_passado` | ano anterior completo |
| 13 | "Personalizado" | — | inputs "De"/"até" |

Os presets são resolvidos **no momento da consulta** (um dashboard aberto
ontem em "Hoje" mostra os dados de hoje ao recarregar). O limite superior
sempre inclui o dia inteiro (até 23:59:59). "Hoje" é o dia no horário de
Brasília.

**Período personalizado é rascunho + aplicar**: escolher "Personalizado" abre
os inputs De/até sem disparar consulta. O intervalo é aplicado
automaticamente quando fica **completo** (as duas datas), ou pelo botão
**"Aplicar"**/Enter para intervalos deliberadamente abertos (só De, ou só
até). Digitar datas parciais nunca recalcula o dashboard.

**Persistência**: a seleção vai para a URL (compartilhável) e é lembrada por
usuário (ao voltar ao dashboard, vale o último período que ESTE usuário
usou). Ordem de prioridade quando há conflito: URL > preferência do usuário >
padrão configurado do dashboard.

**Sincronização com os cards**: ao mudar a barra, os filtros rápidos de
período dos widgets que usam o MESMO campo de data acompanham a barra
(sincronização de mão única, barra → card).

### 4.2 Widget "Filtro de período" (dentro do painel)

Um widget que replica o dropdown de período dentro da área do dashboard e
pode mirar widgets específicos:

- **"Campo de data"** — qual coluna filtra (padrão: data de fechamento).
- **"Período padrão"** — "Todo o período" ou qualquer preset da tabela acima.
- **"Vincular a"** — checklist de widgets-alvo; sem seleção = o dashboard
  inteiro. Quando um Filtro de período mira um widget, a seleção dele
  **sobrepõe** a barra global para aquele widget.

### 4.3 Widget "Filtro por campo"

Painel de busca + filtros estruturados que afeta outros widgets:

- **"Bases"** — em quais Bases ele atua (sem seleção = todas).
- **"Campos de busca (texto)"** — quais campos a caixa de busca varre
  (padrão: título). A busca usa "contém".
- **"Campos filtráveis"** — lista de controles exibidos; cada linha define
  Campo + Operador (os mesmos 10 do §6.4) + "Opções visíveis" (esconder
  opções específicas do dropdown — só estética, não muda a consulta). Um
  campo com operador "em (lista)" vira multi-seleção por checkbox; um campo
  de seleção vira dropdown com "— todos —".
- **"Aplicar a"** — checklist dos widgets afetados (desmarcar exclui um
  widget do efeito do filtro).

A seleção do usuário no Filtro por campo é **individual** (cada usuário tem a
sua, lembrada entre visitas) e também vive na URL (URL vence). Contraste com
os filtros rápidos de card, que são compartilhados (§4.4, capítulo 10).

### 4.4 Filtros rápidos do card

Qualquer widget de dados pode exibir dropdowns próprios no topo do card
(configurados na seção "Filtros" do editor — §6.5). Dois comportamentos:

- **Multi-seleção** (responsável, operação, ou buckets de um campo de data
  com formato — ex.: meses): popover com checkboxes.
- **Período** (campo de data no formato padrão): dropdown com as mesmas 13
  opções do §4.1, incluindo Personalizado com rascunho.

**A seleção é COMPARTILHADA entre todos os usuários** do dashboard e
sobrevive a recarregamentos (persistida no banco, não na URL). Exceção:
visitantes de snapshot público — a seleção deles fica só na URL do visitante
(capítulo 11).

### 4.5 Busca e filtros embutidos das tabelas

Widgets de Tabela exibem (a menos que desligado no editor — "Mostrar barra de
busca/filtro na tabela") uma barra com busca textual e filtros estruturados,
visível a todos os visualizadores. Os mesmos 10 operadores do §6.4. Essas
seleções vivem **na URL** (prefixo `tf_` + id do widget) — compartilháveis
por link, não persistidas.

### 4.6 Como os filtros se combinam

Regra geral: **tudo é E (AND)**. Período ativo + filtros fixos do widget +
filtros rápidos + Filtro por campo + busca da tabela se acumulam; um registro
precisa passar por todos. As exceções e sutilezas (mocks de Data Reunião,
filtro de Operação, filtros segmentados por Base) estão no capítulo 7.

**Agenda ignora os filtros do dashboard por design** (barra de período,
filtros rápidos etc. não afetam widgets Agenda).

---

## 5. Referência completa dos 17 tipos de widget

O campo **"Visual"** do editor define o tipo. Lista completa (rótulo na UI /
chave interna):

| Grupo | Tipos |
|---|---|
| Dados (consultam registros) | "Tabela" `tabela`, "Barra" `barra` (padrão de widget novo), "Barra horizontal" `barra_horizontal`, "Linha" `linha`, "Pizza" `pizza`, "Funil" `funil`, "Card" `kpi`, "Métrica calculada" `calculado` |
| Utilitários | "Calculadora" `calculadora`, "Nota (post-it)" `nota`, "Forma" `forma`, "Imagem" `imagem`, "Tabela Livre" `tabela_editavel` |
| Filtros | "Filtro de período" `filtro`, "Filtro por campo" `filtro_campo` |
| Operacionais | "Kanban" `kanban`, "Agenda" `agenda` |

Os tipos de dados compartilham o **bloco de dados** do editor (Bases,
Dimensões, Métricas, Filtros… — capítulo 6). Abaixo, o que cada tipo tem de
específico.

### 5.1 Tabela (`tabela`)

Tabela agregada (uma linha por combinação de dimensões) OU lista de registros
individuais. Recursos exclusivos (seção "Opções da tabela" do editor, §6.6):

- **Modo lista** ("Linhas = registros individuais"): cada linha é um
  registro; as Dimensões viram as COLUNAS; colunas podem ser editáveis
  (inclusive com gravação de volta no Bitrix); a base das linhas pode ser
  Registros, Responsáveis ou Operações.
- **Orientação transposta** ("Cabeçalho à esquerda"), com escolha da dimensão
  que vira as colunas do topo.
- **"Agrupar por"** hierárquico (multi-nível) com seções recolhíveis e
  **subtotais por grupo** (e formato de data próprio por nível de grupo).
- Barra de busca/filtro embutida (ligável/desligável).
- Comparação com período anterior (inline na célula ou coluna exclusiva).
- No modo agregado, a última linha é o **Total geral** (respeitando a
  matemática exata de fórmulas — §7.8).

### 5.2 Barra (`barra`) e Barra horizontal (`barra_horizontal`)

Gráfico de barras vertical/horizontal. Uma dimensão vira o eixo de
categorias; cada métrica vira uma série. Específicos (maioria na Aparência,
§9.2): empilhar séries, colorir por categoria com paleta, limite Top-N com
"Outros", ordenação das categorias, eixo esquerdo/direito por série (combo),
rótulos de valores, série fantasma da comparação, rótulo de variação nas
barras, linha de meta (§6.7 — barra/linha apenas).

### 5.3 Linha (`linha`)

Gráfico de linhas — mesmas capacidades da Barra (menos "colorir por
categoria"), ideal para séries temporais. Suporta linha de meta, série
fantasma de comparação, alinhamento por dia útil.

### 5.4 Pizza (`pizza`) e Funil (`funil`)

- **Pizza**: uma dimensão (fatias) + uma métrica. Aparência: paleta, limite
  de fatias Top-N (padrão 5) com "Outros", ordenação, legenda, cor por fatia,
  rótulos (fora/dentro; valor, percentual ou ambos).
- **Funil**: mesma estrutura, exibida como funil (etapas). Dica clássica:
  dimensão = etapa, métrica = contagem.

### 5.5 Card (`kpi`)

O widget de número grande. Tem **modos** (seção "Modo do Card" no editor):

| Modo (rótulo) | Chave | O que mostra |
|---|---|---|
| "Número (agregação)" | `value` (padrão) | o resultado do bloco de dados (métrica 1) |
| "Valor de um registro (maior/menor)" | `record` | um campo do registro com maior/menor valor em outro campo — configura "Classificar pelo campo" (número ou data), "Maior ou menor?" e "Exibir o campo" |
| "Ranking (Top N)" | `topn` | ranking: "Campo do rótulo" + "Métrica do ranking" + agregação + "Limite" (padrão 5) + ordem (maiores/menores primeiro) |
| "Lista de valores" | `list` | lista simples: "Campo da lista" + "Limite" (padrão 10) |
| "Fórmula" | `formula` | resultado de uma fórmula agregada (aceita SE/E/OU, SOMASE/CONT.SE/MÉDIASE, ANTERIOR/VARPCT/VARABS — capítulo 8) |

- Nos modos ≠ "Número": campos extras "Prefixo", "Sufixo" e "Texto
  secundário". Esses modos **ignoram** Dimensões/Métricas do bloco de dados,
  mas **respeitam** Bases, Filtros e o período.
- **"Card de Data atual"** (toggle próprio): card sintético que mostra o dia
  de hoje (horário de Brasília) com rótulo configurável; ignora dados.
- **Modos avançados sem UI no editor** (existem via presets/JSON, chave
  `settings.mode`): **meta** (`meta` — compara o realizado com a meta
  cadastrada: mostra realizado, meta, % atingido e quanto falta; o realizado
  vem da métrica configurada no próprio widget; a meta acompanha o período —
  mensal quando o período cabe num mês, senão anual; escopo global/operação/
  responsável) e **razão** (`ratio` — numerador ÷ denominador, com opção de
  exibir ×100 + "%"). Os presets de fábrica usam o modo meta (capítulo 13).
- Card suporta comparação com período anterior, incluindo a opção exclusiva
  "Mostrar só a variação".

### 5.6 Métrica calculada (`calculado`)

Card cujo valor é uma **fórmula agregada** (capítulo 8): escrita no próprio
widget OU reutilizada de um campo salvo do tipo "Calculado (totais do
recorte)". Tem receita pronta "Taxa de conversão" e formato do resultado
(número / percentual ×100 / moeda). Suporta filtros rápidos e comparação
(exceto bases de janela — §6.8).

### 5.7 Calculadora (`calculadora`)

Calculadora interativa no card (+ − × ÷ e parênteses). Diferencial:
**variáveis** definidas no editor — cada variável tem um nome e uma fórmula
agregada; no card, o usuário insere `[NomeDaVariável]` nas contas e o valor
vem dos dados vivos do dashboard. Ex.: variável "MRR" = soma do MRR do
período → o usuário digita `[MRR] * 12`.

### 5.8 Nota (post-it) (`nota`)

Papel de recado. O texto é editado direto no card (no modo "Editar layout").
Recursos dentro do texto:

- **Expressões dinâmicas**: trechos `{= … }` são avaliados como fórmula
  agregada (aceita SE, SOMASE, ANTERIOR/VARPCT…) e exibem o resultado no
  meio do texto — uma nota pode dizer "Fechamos {= SOMA…} este mês".
- **Links**: o botão "Link…" transforma palavras selecionadas em atalhos para
  um widget (de qualquer dashboard/aba — modo foco, §3.7).
- Aparência: cor do papel (padrão amarelo), cor do texto/links, tamanho da
  fonte, opção "Sem moldura (só o papel)".

### 5.9 Forma (`forma`)

Elemento visual de diagramação. Opções: **"Forma"** — Retângulo, Retângulo
arredondado (padrão), Elipse, Losango, Triângulo, Seta, Hexágono; **"Texto na
forma"** (opcional); **"Atalho para widget"** (clique navega/foca o alvo —
§3.7). Aparência: preenchimento, contorno (cor + espessura), texto (cor +
tamanho).

### 5.10 Imagem (`imagem`)

- **"URL da imagem"** (somente https).
- **"Ajuste no card"**: "Conter (imagem inteira)" (padrão) / "Cobrir
  (preenche, corta sobras)" / "Esticar (deforma p/ caber)" / "Tamanho
  original (reduz se faltar espaço)".
- **"Ao clicar (fora do modo edição)"**: "Não faz nada" / "Amplia
  (lightbox)" / "Abre um link (nova aba)" (com campo de URL https).
- **"Texto alternativo"** (acessibilidade).

### 5.11 Tabela Livre (`tabela_editavel`)

Grade tipo planilha, editada direto no card. Cada coluna tem um **tipo**:

| Tipo de coluna | O que faz |
|---|---|
| "Livre (digitação)" | células digitáveis; opção "Restringir quem pode editar" por papel (sem papéis marcados, só admin edita) |
| "Dimensão (dados do sistema)" | valores de um campo (com formato de data e opção de **pivot** — "Expandir valores em colunas") |
| "Métrica (agregação)" | um número agregado por linha (campo + agregação, incluindo "Contagem de registros") |

Mais: rótulo do cabeçalho por coluna, exibir/ocultar linha de cabeçalho,
excluir coluna/linha. Os valores digitados são **compartilhados** (todos os
usuários veem o mesmo conteúdo). É o único tipo com criação por desenho
(§3.5). Não usa o bloco de dados do editor — a estrutura é toda in-card.

### 5.12 Filtro de período (`filtro`) e Filtro por campo (`filtro_campo`)

Já detalhados no §4.2 e §4.3.

### 5.13 Kanban (`kanban`) e Agenda (`agenda`)

Detalhados no capítulo 12. Em resumo: Kanban = quadro de colunas com cards de
registros (colunas por valores de um campo, por períodos de uma data, ou
livres) ou de tarefas; Agenda = calendário mensal/semanal com registros
alocados por um campo de data (+ tarefas com vencimento).

---

## 6. O editor de widget, seção por seção

O editor abre num painel lateral (largura ajustável pela borda). No topo,
para qualquer tipo: **"Título"**, **"Aba"** (quando o dashboard tem abas) e
**"Visual"** (o tipo — capítulo 5). No rodapé, **"Salvar widget"** (ou
**"Posicionar"**, na criação). As seções abaixo aparecem para os tipos de
DADOS (Tabela, Barra, Barra horizontal, Linha, Pizza, Funil, Card, Métrica
calculada), em acordeões recolhíveis com badge de resumo.

### 6.1 Seção "Bases de dados"

Checklist das Bases do catálogo.

- **Sem nenhuma marcada = TODAS as Bases** (badge "Todas"). Essa é uma
  escolha válida e comum (ex.: contar leads + negócios juntos).
- **Sub-bases** aparecem indentadas (`↳`) sob a Base-mãe.
  - Sub-base marcada **sozinha**: o widget usa só as linhas do recorte dela,
    e o período usa o campo de data DELA.
  - Sub-base + Base-mãe marcadas: por padrão a Sub-base é **absorvida** pela
    mãe (a mãe já contém as linhas; nada duplica). Aparece então o toggle
    **"Conviver com a pai (série própria…)"**: ligado, a Sub-base vira uma
    **série separada** ao lado da mãe (use quando quiser as duas como linhas/
    barras distintas; quem liga garante que a leitura faz sentido).
- **"Quebrar por base (uma série por base)"** (`splitBySource`): transforma a
  Base em dimensão líder — cada Base vira uma série/linha própria.

### 6.2 Seção "Dimensões"

Dimensões definem o agrupamento (eixo de categorias, linhas da tabela,
fatias). Por linha de dimensão:

- **Campo da dimensão** — qualquer campo visível no construtor (núcleo,
  personalizado, unificado). No modo lista da tabela, há também campos
  sintéticos como "Data atual".
- **"Formato"** (só para campo de data) — transforma a data num bucket. Lista
  completa (ordem da UI):

| Rótulo | Chave | Exemplo de bucket |
|---|---|---|
| "—" | `none` | a data em si (formato de data do dashboard) |
| "Dia da semana" | `weekday` | Segunda-feira … Domingo |
| "Semana do ano" | `week_year` | "5ª semana" |
| "Semana do mês" | `week_month` | "1ª semana de Janeiro" |
| "Nome do mês" | `month_name` | Janeiro … Dezembro |
| "Mês/ano" | `month_year` | "Janeiro/26" |
| "Trimestre" | `quarter` | "T1/26" |
| "Ano" | `year` | "2026" |

  (Existem chaves legadas `day`/`week`/`month` aceitas por widgets antigos,
  fora da lista atual da UI.)

- **"Semana"** (só com "Semana do mês"): **"Restrita"** (padrão — a semana é
  recortada na virada do mês) ou **"Cheia"** (segunda→domingo inteira; a
  semana pertence ao mês da sua quinta-feira).
- **"Nome exibido"** — rótulo estético da dimensão (não muda o campo).
- **"Agrupar período"** (só campo de data COM formato): colapsa os registros
  de cada bucket usando uma agregação por período — opções: "Individual (por
  registro)" (padrão em listas: uma linha por registro), "Soma", "Contagem",
  "Média", "Mediana", "Moda". Mediana e moda são calculadas no aplicativo
  (não no banco). Em widgets agregados a opção inicial é "Padrão (agregado)".
- **No modo lista da Tabela**, cada "dimensão" é uma COLUNA e ganha opções
  extras: **"Editável"** (a célula pode ser editada por quem tem permissão no
  campo), **"Gravar no Bitrix"** (write-back), e — para coluna de campo
  unificado com 2+ Bases candidatas — **"Base do dado"** (ordem de
  prioridade/fallback de qual Base preenche a célula).
- **"Adicionar dimensão"** acrescenta níveis (tabela agregada aceita várias
  dimensões; gráficos usam a primeira como eixo e as demais compõem grupos).
  Admins veem também **"Novo campo"** (abre o cadastro de campo inline).

### 6.3 Seção "Métricas"

Cada métrica vira uma coluna (tabela) ou série (gráficos). Por linha:

- **Campo da métrica** — opções: **"Contagem de registros"** (conta linhas;
  chave `*`), qualquer campo numérico/moeda/calculado-por-registro, um campo
  salvo "Calculado (totais)" ou **"ƒ Métrica calculada (fórmula própria)…"**
  (escreve uma fórmula só deste widget — capítulo 8).
- **Agregação** — lista completa: "Soma" (`sum`), "Contagem" (`count`),
  "Média" (`avg`), "Mínimo" (`min`), "Máximo" (`max`). Com "Contagem de
  registros" a agregação é travada em Contagem. Notas: "Contagem" de um CAMPO
  conta registros com o campo **preenchido**; métrica de fórmula não tem
  agregação (mostra o chip "Fórmula").
- **"Nome exibido"** — rótulo da métrica (padrão: "Agregação · campo").
- **"Exibir com '%'"** — anexa o símbolo % **sem multiplicar por 100** (para
  valores que já são percentuais). Não confundir com o formato "Percentual"
  das fórmulas, que multiplica por 100. Oculto em métricas monetárias.
- **Fórmula ad-hoc** (quando o campo é "ƒ Métrica calculada…"): editor de
  fórmula em contexto agregado + receita "Taxa de conversão" + **"Formato do
  resultado"**: "Número (sem moeda)" / "Percentual (%) — exibe ×100" /
  "Moeda — <moeda>". Admins têm "Salvar como campo reutilizável…".
- **Opções de moeda** (só métrica monetária — Valor, MRR, campo moeda ou
  fórmula com formato moeda). Bloco recolhível com 4 controles:

| Controle | Opções | Padrão |
|---|---|---|
| "Base da taxa" | Ano do registro / Trimestre do registro / Ano do período / Trimestre do período | Ano do registro |
| Exibição com UMA moeda no grupo | "Só a moeda original" / "Só convertido (R$)" / "US$ original → R$ convertido" | original |
| Exibição com VÁRIAS moedas no grupo | "Converter tudo (R$)" / "Totais por moeda (separados)" / "US$ total → R$ convertido" | converter |
| "Total geral" | "Total convertido (R$)" / "Total em US$" | convertido |

  A semântica exata da conversão está no §7.6.

- **"Bases da métrica"** (bloco recolhível; aparece quando o catálogo tem 2+
  Bases): permite que ESTA métrica agregue sobre um conjunto de Bases
  **diferente** do widget — inclusive Bases que o widget não usa (o checklist
  mostra o catálogo inteiro). Uso típico: widget com linhas de Negócios +
  uma métrica de conversão que conta Leads. Nenhuma marcada = usa as Bases do
  widget. Entenda o efeito exato no §7.1 ("universo de linhas vs fontes da
  métrica").

### 6.4 Seção "Filtros"

Filtros fixos do widget (sempre aplicados, invisíveis ao leitor). Por linha:
**Campo** + **Operador** + **valor**. Os 10 operadores (lista completa):

| Rótulo | Chave | Semântica |
|---|---|---|
| "=" | `eq` | igual |
| "≠" | `neq` | diferente |
| "contém" | `ilike` | contém o texto (sem diferenciar maiúsculas) |
| ">" | `gt` | maior que |
| "≥" | `gte` | maior ou igual |
| "<" | `lt` | menor que |
| "≤" | `lte` | menor ou igual |
| "em (lista)" | `in` | igual a qualquer item (valores separados por vírgula) |
| "é vazio" | `is_null` | campo sem valor (não pede valor) |
| "não vazio" | `not_null` | campo com valor (não pede valor) |

- Vários filtros = **E** (todos precisam valer).
- **"Bases"** do filtro (quando o widget toca 2+ Bases): o filtro pode mirar
  só algumas Bases — as linhas das Bases-alvo são restringidas e as das
  demais **passam livres**. (Diferente de "Bases da métrica": aqui é
  segmentação do filtro, não ampliação de universo.) Se as Bases-alvo não
  intersectam as do widget, o filtro é descartado.
- **Datas em filtros** aceitam os tokens `@today`, `@month_start`,
  `@month_end`, `@year_start`, `@year_end` (resolvidos na consulta — é assim
  que presets criam "fechamento ≥ início do mês" sem data fixa).
- **"Mostrar barra de busca/filtro na tabela"** (só Tabela): liga/desliga a
  barra do §4.5.

### 6.5 Bloco "Filtros rápidos" (dropdowns no card)

Disponível em Tabela, Barra, Barra horizontal, Linha, Pizza, Funil, Card e
Métrica calculada. Cada entrada configura um dropdown exibido no card:

- **Campo** — apenas: responsável (`responsible_id`), operação
  (`operation_id`) ou um campo de DATA (incluindo unificados e campos do
  registro casado).
- **"Formato"** (só data): "Padrão (período)" → o dropdown é um seletor de
  período (13 opções do §4.1); OU um formato de bucket (tabela do §6.2) → o
  dropdown é multi-seleção de buckets (ex.: meses específicos).
- **"Semana"** (só "Semana do mês"): restrita/cheia.
- **"Rótulo"** (opcional).
- **"Opções visíveis"** (só responsável/operação): checklist para OCULTAR
  opções do dropdown. É só exibição — nunca altera a consulta; opções novas
  entram visíveis; valores já selecionados nunca somem da consulta.

Lembre: seleções de filtro rápido são **compartilhadas** entre usuários
(§4.4, capítulo 10).

### 6.6 Seção "Opções da tabela" (só Tabela)

- **"Linhas = registros individuais (permite editar valores)"** — liga o
  modo lista (§5.1).
- **"Base das linhas"** (modo lista): "Registros" (padrão) / "Responsáveis" /
  "Operações" — as duas últimas geram uma linha por responsável/operação
  (lista de entidades).
- **"Orientação"**: "Cabeçalho acima (resultados em linhas)" (padrão) /
  "Cabeçalho à esquerda (transposta)". Transposta pede **"Colunas do topo"**
  (qual dimensão vira as colunas).
- **"Agrupar por"**: um ou mais níveis (dimensões, ou colunas no modo lista)
  que viram seções recolhíveis com **subtotais**. Cada nível de data aceita
  **"Formato do grupo"**: "Herdar da dimensão (padrão)", um formato de bucket
  ou uma máscara de data (`dd/mm/aaaa`, `dd/mm/aa`, `mm/aa`).

### 6.7 Seção "Dia útil e meta"

Aparece em Barra/Linha e Tabela agregada (alinhamento) e Barra/Barra
horizontal/Linha (meta). Três recursos independentes:

**a) "Janela de meses no card (períodos equivalentes)"** (`periodWindow`) —
adiciona um dropdown NO CARD para o leitor trocar a janela de meses exibida,
replicando o recorte do período atual nos meses anteriores:

- **"Opções do dropdown"** (checklist; lista completa): "3 meses" (`3m`),
  "Este trimestre" (`trimestre`), "6 meses" (`6m`), "Este semestre"
  (`semestre`), "Últimos 12 meses" (`12m`), "Este ano" (`ano`). Chaves `3m/
  6m/12m` = N meses rolantes terminando no mês do fim do período; as demais =
  calendário (trimestre/semestre/ano do fim do período).
- **"Janela padrão"** (default "6 meses" ao ligar).
- **"Expor no card o seletor 'dia útil × dia cheio'"** — deixa o leitor
  alternar o corte equivalente entre mesmo dia útil e mesmo dia corrido.
- A escolha do leitor no card é **compartilhada** entre usuários (como os
  filtros rápidos). Cada mês da janela recebe o recorte EQUIVALENTE ao
  período da barra (detalhes §7.7).

**b) "Alinhar meses pelo mesmo dia útil"** (`businessDayAlign`) — cada mês
exibido é consultado só até o N-ésimo dia útil, onde N = dia útil corrente da
referência. Serve para comparar meses no mesmo estágio ("mês x mês" de
acompanhamento diário). Opções: **"Dia útil de referência"** = "Hoje
(limitado ao fim do período)" (padrão) ou "Fim do período selecionado".
Requisitos e efeitos:

- Exige **dimensão de data mensal** ("Nome do mês", "Mês/ano" ou legado mês)
  e **período ativo**; sem isso é ignorado em silêncio (o editor avisa).
- **Mutuamente exclusivo com Comparação** (§6.8): com o alinhamento ativo, a
  comparação é ignorada — o próprio gráfico já é a comparação.
- O N usado sai no card como badge **"Nº dia útil"**.
- Ignorado quando a dimensão usa "Agrupar período".

**c) "Linha de meta no gráfico"** (`goalLine`; só Barra e Linha) — desenha a
meta cadastrada (§2.4) como linha:

- **"Métrica da meta"**: chave do cadastro de metas (padrão `mrr`; embutidas
  `mrr` e `clientes` + personalizadas).
- **"Modo"**: "Meta mensal cheia" (`monthly`, padrão) ou "Ritmo (ideal por
  dia útil)" (`pace` — meta ÷ dias úteis do mês × N, acompanhando o
  alinhamento por dia útil quando ativo).
- **"Rótulo"** (padrão "Meta") e **"Cor"** (opcional).
- Também exige dimensão mensal + período ativo. (Por JSON/preset a meta pode
  ainda ser escopada a uma operação/responsável específico.)

### 6.8 Seção "Comparação" (variação vs outro período)

Disponível em Tabela agregada, Barra, Barra horizontal, Linha, Pizza, Funil e
Card. Configura `settings.comparison`:

- **"Comparar com um período de comparação"** — liga/desliga.
- **"Comparar com"** (lista completa):

| Rótulo | Chave | Base de comparação |
|---|---|---|
| "Período anterior" | `previous_period` (padrão) | o período imediatamente anterior de mesma duração — presets deslocam SEMANTICAMENTE ("Este mês" → mês passado inteiro; "Hoje" → ontem; semanas → −7 dias; "Este trimestre" → trimestre anterior; anos → ano anterior); intervalos personalizados/últimos-N deslocam pela duração em dias, terminando na véspera |
| "Período anterior (mesmo dia útil)" | `previous_period_bd` | igual ao anterior, mas recortado no mesmo Nº de dia útil do mês (usa o calendário de dias não úteis) |
| "Mesmo período do ano passado" | `previous_year` | mesmo intervalo, um ano antes (29/02 vira 28/02) |
| "Média de uma janela anterior" | `window_avg` | média por bucket equivalente numa janela maior |
| "Mediana de uma janela anterior" | `window_median` | mediana por bucket equivalente numa janela maior |

- **"Janela"** (só bases de janela): "Último trimestre" (`quarter`) / "Último
  semestre" (`semester`) / "Ano até agora" (`ytd`) / "Últimos 12 meses"
  (`last_12m`, padrão). O tamanho do bucket sai da duração do período atual:
  até 1 dia → dia; até 10 → semana; até 45 → mês; acima → trimestre.
- **"Formato"**: "Percentual" (`pct`, padrão) / "Absoluto" (`abs`) /
  "Percentual + absoluto" (`both`).
- **"Estilo"**: "Número colorido" / "Setinha" / "Cor + setinha" (padrão).
- **"Exibir o valor do período de comparação"** (`showBaseValue`).
- **"Inverter cores (queda é bom — ex.: churn)"** (`invertColors`).
- **"Mostrar só a variação (no lugar do valor)"** (só Card).
- **"Posição na tabela"** (só Tabela): "Na mesma célula do valor" (padrão) /
  "Coluna exclusiva de variação".
- **"Série do período de comparação no gráfico (fantasma)"** (gráficos).
- **"Rótulo de variação nas barras"** (Barra/Barra horizontal).

Regras: **sem período ativo ("Todo o período") não há comparação** (não
existe "anterior" de um período infinito). Mutuamente exclusiva com o
alinhamento por dia útil. No widget Métrica calculada, as bases de janela
(média/mediana) não são oferecidas. Semântica fina (alinhamento de linhas,
métricas intensivas × extensivas) no §7.9.

### 6.9 Seção "Opções avançadas"

- **"Largura dinâmica"** / **"Altura dinâmica"** (`autoSize`): o card cresce
  na tela para caber o conteúdo (nunca encolhe abaixo do tamanho do grid).

---

## 7. Como os números são calculados (semântica)

Este capítulo é o coração do manual: as regras que permitem afirmar, com
certeza, o que um widget vai mostrar em qualquer combinação.

### 7.1 Universo de linhas × Bases da métrica

- As **Bases do widget** definem o **universo de linhas**: quais registros
  podem virar linhas/categorias/fatias e quais grupos existem.
- As **"Bases da métrica"** (§6.3) mudam apenas **sobre quais registros
  aquela métrica agrega**. Uma métrica com Bases próprias roda como uma
  **consulta separada** ("perna"), com os mesmos filtros/período, e o
  resultado é **encaixado nos grupos existentes** casando os valores das
  dimensões (a "tupla de dimensões").
- Consequência 1: um grupo que só existiria nos dados da métrica (e não nos
  do widget) **não aparece** — o universo de linhas manda.
- Consequência 2: para o encaixe funcionar, os registros da Base extra
  precisam TER os campos usados nas dimensões (ou o campo unificado
  correspondente). Sem o campo, os valores não têm onde se encaixar.
- Operandos de fórmula com escopo de Base (`@<base>`, §8.5) também contam
  como Bases da métrica para este fim.

### 7.2 Período: cada Base filtra pela própria data

O filtro de período usa o **campo de data configurado** (barra global, widget
de filtro ou filtro rápido). Em dashboards multi-Base, cada Base pode ter seu
próprio campo (§4.1). A resolução:

- Todas as Bases cobertas usam o mesmo campo → filtro simples único.
- Bases com campos diferentes → o período é aplicado POR BASE (internamente,
  um "OU" por tipo de registro: Deals pela data de fechamento E Estudo pela
  data de criação, cada qual no mesmo intervalo).
- **Sub-base** usa sempre o campo de data DELA (ex.: "Data Reunião").
- Campo unificado como campo de período → é traduzido para o membro concreto
  de cada Base antes da consulta.
- Sem configuração, o padrão global é a data de fechamento (`closed_at`) — o
  que **exclui registros sem fechamento**; por isso os defaults por Base
  existem (Leads/Estudo usam a data de criação na origem).

### 7.3 Datas e horário de Brasília

- Datas com hora vindas de fontes externas são convertidas para o horário de
  Brasília **na entrada** dos dados. Campos de data "puros" (sem hora) nunca
  são convertidos. Resultado prático: o dia exibido/agrupado é o dia de
  Brasília, sempre.
- "Hoje", nos presets e no token `@today`, é o dia corrente em Brasília.
- Agrupamentos por dia/semana/mês leem o dia calendário do valor — não há
  surpresa de fuso ("registro pulou para o dia anterior") em nenhuma coluna.

### 7.4 A regra dos mocks de "Data Reunião"

Existem registros **simulados (mocks)** de reunião, criados para compor
métricas de reuniões sem sujar as contagens gerais. A regra:

- Um mock **só entra** numa consulta que **referencia o campo "Data Reunião"**
  (do Lead ou do Negócio) — como dimensão, filtro, campo de período do widget
  ou membro de um campo unificado usado na consulta.
- Consultas que não tocam Data Reunião **nunca** contam mocks.
- A referência NÃO isenta o mock dos demais filtros: ele precisa passar por
  todos os filtros do widget e pelos recortes de Sub-base normalmente (tudo
  segue sendo E). Mocks só contam numa Sub-base segmentada se carregarem os
  campos usados no recorte dela.
- Sintoma clássico: um widget de reuniões "perde" registros ao trocar o
  período para "Todo o período" **se** isso remover a única referência a
  Data Reunião da consulta (ver capítulo 11 para o caso dos snapshots).

### 7.5 Filtro por Operação (nunca é a coluna literal)

Quando um filtro de visualização (filtro rápido, Filtro por campo) filtra por
**Operação**, o sistema traduz para:

- registros cujo **responsável pertence à operação** (vínculo vivo do
  cadastro, incluindo TODAS as sub-operações da árvore), **mais**
- o **filtro de perfil** da operação (quando uma única operação é
  selecionada; perfis de operações diferentes não são combinados).

Implicações: mudar o vínculo de um responsável reclassifica **retroativamente**
os registros dele nos dashboards; uma operação sem responsáveis vinculados e
sem perfil resulta em zero registros (proposital); a coluna "operação"
gravada no registro é usada apenas como DIMENSÃO (agrupar por operação), não
como filtro.

### 7.6 Moeda e conversão

- Valores monetários carregam a moeda do registro. Widgets monetários
  convertem usando a tabela de taxas (§2.5): **valor × taxa = R$**.
- **"Base da taxa"** (§6.3): a taxa usada pode ser a do **ano/trimestre do
  registro** (cada registro converte pela taxa da sua época — padrão: ano do
  registro) ou a do **ano/trimestre do período do dashboard** (tudo converte
  pela taxa da janela exibida).
- Resolução da taxa: pede trimestre → se não houver, usa a anual → se não
  houver, a anual mais recente cadastrada; sem nada, o valor fica
  indisponível (nunca soma moedas sem converter).
- Modos de exibição (§6.3) decidem O QUE aparece: original, convertido,
  "US$ → R$", totais por moeda separados, e o formato do Total geral.
- A conversão é feita com exatidão em todos os níveis (grupo, subtotal,
  total): converter os subtotais equivale a converter registro a registro.
- Campo "Moeda" com moeda **fixa** ignora a moeda do registro; campo
  calculado por-registro pode herdar a moeda do registro ou fixar uma.
- Fórmulas: ver §8.7 (moeda do resultado).

### 7.7 Dia útil, meta e janela de períodos

- **Dia útil** = segunda a sexta, excluindo os dias do calendário "Dias não
  úteis" (§2.4). Tudo abaixo usa essa definição.
- **Alinhamento por dia útil** (§6.7b): com N = dia útil corrente (da
  referência), cada mês exibido é consultado do dia 1 até o SEU N-ésimo dia
  útil. Meses já encerrados (N maior que os dias úteis do mês) aparecem
  cheios. Máximo de 13 meses processados. O N aparece no badge "Nº dia útil".
- **Meta "Ritmo"** (§6.7c): meta do mês ÷ dias úteis do mês × N — a linha
  mostra onde a meta "deveria estar" no mesmo estágio. Com alinhamento ativo,
  usa o mesmo N do badge. Sem alinhamento, apenas o mês corrente é rateado
  (meses passados mostram a meta cheia; futuros não mostram linha).
- **Meta mensal × anual**: a meta exibida acompanha o bucket (meta do mês
  para bucket mensal). No Card de meta, o período do dashboard decide: cabe
  num único mês → meta mensal; senão → anual.
- **Janela de períodos equivalentes** (§6.7a): cada mês da janela recebe o
  recorte EQUIVALENTE ao período da barra — com alinhamento: corte no mesmo
  dia útil; sem: mesmo intervalo de DIAS quando a barra está num único mês
  (senão meses cheios), sempre respeitando o fim do período no mês final.

### 7.8 Subtotais de fórmulas ("subtotal de razão não é soma")

Métricas de fórmula são recalculadas EXATAMENTE em cada nível: o sistema
guarda, por linha, as somas e contagens que compõem a fórmula (a "base" da
fórmula) e, para o subtotal/total, **funde as bases e reavalia a fórmula** —
não soma a coluna. Exemplo: coluna "conversão = negócios ÷ leads" com linhas
50% (1/2) e 50% (2/4): o total é 3/6 = 50%, e não 100%. Isso é correto e
intencional; explique assim quando alguém "conferir na calculadora" somando a
coluna.

### 7.9 Semântica fina da comparação

- **Casamento de linhas**: em dimensões cronológicas (datas), a linha do
  período atual casa com a do período de comparação pela **posição ordinal**
  (1º mês ↔ 1º mês, 2ª semana ↔ 2ª semana), não pelo rótulo. Em dimensões não
  cronológicas (canal, responsável…), casa pelo **valor exato**.
- **Extensiva × intensiva**: somas e contagens são extensivas — na base
  "média de janela", o total da janela é dividido pelo nº de buckets (buckets
  vazios contam 0). Médias, mínimos, máximos e fórmulas são intensivos — o
  valor comparado é o agregado da janela como um todo (não se divide por N).
- **Variação**: absoluta = atual − comparação; percentual = absoluta ÷
  |comparação| (indisponível quando a comparação é 0); direção
  (sobe/desce/estável) colore verde/vermelho (invertível para métricas de
  queda-é-bom).
- "Período anterior (mesmo dia útil)" requer o calendário de dias não úteis;
  na ausência dele, degrada para "Período anterior" simples.

### 7.10 O que o leitor NÃO controla (e por que os números são estáveis)

- Filtros fixos do widget e recortes de Sub-base não são visíveis nem
  removíveis pelo leitor.
- Seleções de filtro rápido e janela de períodos são compartilhadas — dois
  usuários olhando o mesmo dashboard veem os mesmos números (capítulo 10).
- Snapshots públicos congelam os dados (capítulo 11): o número do snapshot
  não muda quando o dado vivo muda (só quando o snapshot é atualizado).

---

## 8. Fórmulas — referência completa

Fórmulas aparecem em: campos "Calculado (por registro)" e "Calculado (totais
do recorte)" (aba Campos), métrica de fórmula de widget ("ƒ Métrica calculada
(fórmula própria)…"), widget "Métrica calculada", Card em modo "Fórmula",
variáveis da Calculadora e expressões `{= … }` de Notas. O editor e as regras
são os MESMOS em todos esses lugares — muda apenas o **contexto**.

### 8.1 Os dois contextos

| Contexto | Onde | O que os operandos são | O que é proibido |
|---|---|---|---|
| **Por registro** | campo "Calculado (por registro)" | campos DO PRÓPRIO registro (e do registro casado `↪`), "Data atual" | agregações (Σ/Média/Contagem) e SOMASE/CONT.SE/MÉDIASE — a fórmula enxerga UM registro; para condição use `SE(...)`. ANTERIOR/VARPCT/VARABS avaliam para vazio |
| **Agregado** | todos os demais | AGREGADOS do recorte atual: "Contagem de registros", "Contagem de <Campo>", "Σ <Campo>", "Média <Campo>" — com escopo de Base opcional | "Data atual" (o agregado roda no banco, que não conhece "hoje") — a opção aparece desabilitada com o motivo |

No contexto agregado, a fórmula é reavaliada para CADA célula/grupo/subtotal/
total do widget, sempre sobre os agregados daquele recorte (§7.8).

### 8.2 O editor (dois modos)

- **Modo visual (builder)**: botões para inserir operandos, operadores e
  funções — impossível errar sintaxe.
- **Modo texto**: digitação estilo planilha. O editor valida em tempo real e
  explica os erros. Os dois modos são intercambiáveis (uma fórmula criada por
  texto reabre em texto).
- Operandos proibidos no contexto atual aparecem **desabilitados com o
  motivo** — nunca escondidos.

### 8.3 Sintaxe do modo texto

- **Operandos entre colchetes**, pelo rótulo exibido: `[Valor]`,
  `[Σ Valor]`, `[Contagem de Data Reunião]`, `[↪ Leads: Data de criação]`.
  Rótulo ambíguo gera erro pedindo a referência exata — a referência interna
  crua também é aceita entre colchetes (ex.: `[custom:forecast]`,
  `[agg:sum:value]`, `[agg:count:*@leads]`).
- **Números**: `1.5` ou `1,5` (vírgula decimal aceita).
- **Texto**: `"assim"` ou `'assim'` (aspas duplas escapam duplicando: `""`).
- **Booleanos**: `VERDADEIRO`/`FALSO` (ou `TRUE`/`FALSE`).
- **Separador de argumentos: ponto-e-vírgula** `;` (a vírgula é reservada
  para decimais — usar vírgula como separador é erro).
- Nomes de função aceitam variantes sem acento e em inglês (`sum` → SOMA,
  `count` → CONT.NÚM, `round` → ARRED, `if` → SE etc.).

### 8.4 Todas as funções (lista completa)

**Condicionais** (qualquer contexto):

| Função | Assinatura | Notas |
|---|---|---|
| `SE` | `SE(condição; então; senão)` | o `senão` é opcional (2 ou 3 argumentos); ramos podem ser texto |
| `E` | `E(cond1; cond2; …)` | mínimo 2 condições |
| `OU` | `OU(cond1; cond2; …)` | mínimo 2 condições |

**Agregações condicionais** (SÓ contexto agregado):

| Função | Assinatura | Semântica |
|---|---|---|
| `SOMASE` | `SOMASE([Campo]; condição)` | soma o campo nos registros que passam na condição |
| `SOMASES` | `SOMASES([Campo]; cond1; cond2; …)` | idem com várias condições (E implícito) |
| `CONT.SE` | `CONT.SE(condição)` | conta registros que passam |
| `CONT.SES` | `CONT.SES(cond1; cond2; …)` | idem com várias condições |
| `MÉDIASE` | `MÉDIASE([Campo]; condição)` | média do campo nos registros que passam |

Regras rígidas dessas cinco: o 1º argumento de SOMASE/SOMASES/MÉDIASE deve
ser uma COLUNA numérica; cada condição é exatamente `[Coluna] operador
literal` (ex.: `[Etapa] = "Ganhou"`); um campo cru (não agregado) SÓ pode
aparecer dentro delas — fora, use os operandos agregados (Σ/Média/Contagem).

**Puras** (operam sobre os próprios argumentos, em qualquer contexto):

| Função | Assinatura | Notas |
|---|---|---|
| `SOMA` | `SOMA(a; b; …)` | ignora não-números |
| `MÉDIA` | `MÉDIA(a; b; …)` | ignora não-números |
| `MÍN` / `MÁX` | `MÍN(a; b; …)` | ignora não-números |
| `CONT.NÚM` | `CONT.NÚM(a; b; …)` | conta argumentos numéricos |
| `CONT.VALORES` | `CONT.VALORES(a; b; …)` | conta argumentos não vazios |
| `ARRED` | `ARRED(valor; casas)` | vazio permanece vazio |
| `ABS` | `ABS(valor)` | vazio permanece vazio |
| `CONCATENAR` | `CONCATENAR(a; b; …)` | vazio vira "" |

**Comparação com período anterior** (SÓ contexto agregado):

| Função | Assinatura | Semântica |
|---|---|---|
| `ANTERIOR` | `ANTERIOR(expr; base?)` | a MESMA expressão avaliada no período de comparação |
| `VARPCT` | `VARPCT(expr; base?)` | variação percentual, JÁ multiplicada por 100 |
| `VARABS` | `VARABS(expr; base?)` | variação absoluta (atual − anterior) |

O 2º argumento opcional é `"anterior"` (período imediatamente anterior —
padrão) ou `"ano"` (mesmo período do ano passado). Essas funções seguem a
mesma semântica de deslocamento do §6.8/§7.9 e exigem período ativo.

**Operadores**: aritméticos `+ - * /`; comparação `=`, `<>`, `<`, `>`, `<=`,
`>=`. Regras de avaliação: divisão por zero → vazio; **data − data = número
de dias**; qualquer outra aritmética com data → vazio; comparações de texto
não diferenciam maiúsculas.

### 8.5 Operandos com escopo de Base (contexto agregado)

Cada operando agregado pode ser restrito a UMA Base: no catálogo, a versão
escopada aparece com o sufixo **"· <Base>"** (ex.: "Contagem de registros ·
Leads"; referência interna `agg:count:*@leads`). Semântica:

- O operando agrega SÓ as linhas daquela Base (ou Sub-base), com o período
  aplicado pela coluna de data DELA — mesmo que o widget nem use essa Base.
- Operando SEM escopo agrega o universo em escopo no ponto de uso (as Bases
  do widget/campo).
- É o mecanismo por trás da taxa de conversão entre Bases:
  `Contagem de registros · Negócios ÷ Contagem de registros · Leads`.
- Limitações: escopo só existe para Soma/Contagem/Média (não Mín/Máx); se o
  recorte da Sub-base usar o operador "contém", o operando escopado fica
  indisponível e a célula mostra **"—"** (o sistema nunca responde com o
  número sem escopo no lugar). O editor avisa esses casos ao salvar.

### 8.6 Erros e degradações que o editor explica

- Agregação/SOMASE em campo por-registro → bloqueado com mensagem dedicada.
- "Data atual" em fórmula agregada → operando desabilitado com o motivo.
- Campo cru fora de SOMASE/CONT.SE/MÉDIASE em contexto agregado → erro.
- Condição sobre coluna inválida (ex.: campo calculado agregado) → erro.
- Vírgula como separador de argumentos → erro (use `;`).
- Avisos (não bloqueiam o salvamento) apontam operandos escopados que
  degradariam para "—".

### 8.7 Formato e moeda do resultado

- **"Formato do resultado"**: "Número (sem moeda)", "Percentual (%) — exibe
  ×100" (0,35 → "35%") ou "Moeda — <moeda>".
- Moeda em fórmulas: operandos preservam a moeda; misturar moedas converte o
  resultado para R$; formato de moeda FIXA converte o resultado para a moeda
  escolhida pela taxa do período do dashboard. Moedas diferentes nunca se
  somam sem conversão.
- Percentual e moeda são excludentes (percentual só em resultado numérico
  puro).
- Campos calculados podem bloquear resultado negativo (trava em 0) — opção do
  cadastro do campo.

### 8.8 Receitas

Atalhos que GERAM uma fórmula normal (100% editável depois):

- **"Taxa de conversão"** (contexto agregado): contagem escopada de uma Base
  ÷ contagem escopada de outra, formato percentual.
- **"Ciclo de vendas"** (por registro): data de fim do registro − data de
  início do registro casado (`↪`), resultado em dias.

### 8.9 Exemplos prontos (copiáveis)

| Objetivo | Fórmula (modo texto, contexto agregado) |
|---|---|
| Ticket médio | `[Σ Valor] / [Contagem de registros]` |
| Conversão lead → negócio | `[Contagem de registros · Negócios] / [Contagem de registros · Leads]` (formato Percentual) |
| Reunião → venda | `[Contagem de Data da assinatura] / [Contagem de Data Reunião]` |
| Só vendas "Ganhou" | `SOMASE([Valor]; [Etapa] = "Ganhou")` |
| Crescimento vs mês anterior | `VARPCT([Σ MRR])` |
| MRR anualizado | `[Σ MRR] * 12` |
| Meta batida? (texto no card) | `SE([Σ MRR] >= 100000; "Meta batida"; "Em andamento")` |

| Objetivo | Fórmula (por registro) |
|---|---|
| Ciclo de vendas (dias) | `[Data de fechamento] - [↪ Leads: Data de criação]` |
| Comissão condicionada | `SE([Valor] > 50000; [Valor] * 0,07; [Valor] * 0,05)` |
| Idade do registro | `[Data atual] - [Data de criação (origem)]` |

---

## 9. Aparência e formatação

A aparência de um widget é editada no menu **"⋮"** do card → planilha de
aparência. As seções variam por tipo. Além disso, tabelas e gráficos aceitam
**ajustes in-loco** (§9.5) e há **formatação condicional** (§9.4).

### 9.1 Seções transversais (quase todos os tipos)

- **"Números" → "Casas decimais"**: Auto / 0 / 1 / 2 / 3 / 4.
- **"Texto"** — tamanho de fonte POR ELEMENTO (Auto ou 10–64 px): "Título do
  widget"; "Valor (número grande)" (Card/Métrica calculada); "Rótulos"
  (Card); "Textos do gráfico"; "Corpo da tabela". Tamanhos fixados aqui não
  são afetados pela escala de fonte do dashboard (§3.6).
- **"Título e borda"**: cor do texto do título, fundo da barra de título, cor
  da borda/contorno do card.

### 9.2 Gráficos (Barra/Linha; Pizza/Funil onde indicado)

- **"Fundo do gráfico"**; **"Linhas de grade"**: Padrão / Nenhuma /
  Horizontais / Verticais / Ambas; **"Preenchimento das barras"**: Sólido /
  Gradiente (sutil).
- **"Limite de categorias (Top-N)"** + **"Agrupar o resto em 'Outros'"**
  (padrão ligado). Em Pizza/Funil: "Limite de fatias" (padrão 5).
- **"Empilhar as séries (barras empilhadas)"** (2+ métricas).
- **"Colorir barras por categoria (paleta)"** (Barra com série única) +
  escolha de paleta.
- **"Ordenação das categorias"** (quando o eixo não é cronológico): Padrão /
  Crescente (A→Z) / Decrescente (Z→A) / Maior→menor (valor) / Menor→maior
  (valor); com 2+ métricas, escolhe-se a métrica da ordenação.
- **"Cores das séries"** (uma cor por métrica); **"Eixo por série"** (2+
  métricas): Esquerda / Direita — cria gráfico combo com dois eixos.
- **"Legenda de dados (rótulos de valores)"**: exibir valores + formato
  (Valor / Percentual / Valor + percentual) + posição (Barra: Acima/Dentro;
  Linha: Acima/Abaixo; Pizza: Fora/Dentro) + cor do rótulo.
- **"Legenda do gráfico (séries)"**: exibir (padrão: ligada com 2+ séries; em
  Pizza a legenda de fatias vem ligada) + cor do texto.
- Pizza/Funil: **paleta**, **ordenação das fatias**, **cor por fatia**.

**As 7 paletas** (lista completa): "Design system" (padrão), "Vibrante",
"Oceano", "Pôr do sol", "Floresta", "Tons de cinza", "Inbound (roxo &
verde)".

### 9.3 Tabela, Card, Calculadora, Nota, Forma, Kanban

- **Tabela**: cores globais (fundo/texto do cabeçalho, fundo/texto do corpo,
  bordas); "Linhas de grade" (Ambas/Horizontais/Verticais/Nenhuma); "Texto
  que excede a célula": Cortar (…) / Quebrar linha; "Alinhamento das
  colunas": Padrão/Esquerda/Centro/Direita.
- **Card (KPI)**: fundo, borda, cor de destaque (a "abinha").
- **Calculadora**: fundo do card, fundo/texto do visor, fundo/texto das
  teclas, fundo/texto das teclas de operação.
- **Nota**: fundo do papel (padrão amarelo), cor do texto, cor dos links,
  tamanho da fonte (padrão 14 px), "Sem moldura (só o papel)".
- **Forma**: preenchimento, contorno, espessura do contorno (padrão 2 px),
  cor e tamanho do texto.
- **Kanban**: fundo do quadro; colunas (fundo, borda, cabeçalho, raio);
  cards (fundo, texto, borda, raio, fonte, "faixa lateral colorida");
  contadores e métrica; abas de visão.

### 9.4 Formatação condicional

Disponível quando o widget tem alvos (colunas de tabela, métricas de
gráfico, valor do Card). Dois mecanismos:

**Regras** — cada regra tem: **Alvo** (coluna/métrica/valor; com comparação
ativa, também a variação) + **Operador** (lista completa): maior que / maior
ou igual a / menor que / menor ou igual a / igual a / diferente de / entre
(valor "até" adicional) / contém / vazio / não vazio / variação positiva /
variação negativa (os dois últimos só com Comparação ativa) + **Valor** +
**"Aplicar em"** (só tabelas): Célula (padrão) / Linha inteira / Coluna
inteira + **Estilo**: cor do texto, cor do fundo, negrito e (só escopo
célula) ícone: — sem ícone — / ▲ / ▼ / ● / ⚠.

**Escalas de cor (heatmap)** — para colunas numéricas: cor do menor valor,
cor do meio (opcional) e cor do maior; o gradiente é calculado por valor.

Precedência quando várias coisas colorem a mesma célula: cor manual da
célula > regra de célula > escala de cor > regra de linha > regra de coluna >
cores chapadas da tabela.

### 9.5 Ajustes in-loco (direto na tabela/gráfico)

No modo de edição, sem abrir nenhum painel:

- **Arrastar** colunas/linhas para reordenar; arrastar bordas para
  redimensionar largura/altura.
- **Duplo-clique** em cabeçalhos/células/categorias abre mini-controles:
  ordenar, colorir coluna/linha/célula/categoria, casas decimais e
  alinhamento por coluna/linha/célula, formato de data por coluna.
- Tudo isso persiste com o widget (todos os usuários veem).

### 9.6 Conectores entre widgets

No modo "Conectar" (§3.2): clique na âncora de um widget (4 lados) e depois
na do destino. Cada conexão tem painel próprio: **"Forma"** (Reta / Curva —
padrão Curva), **cor**, **espessura** (1–8, padrão 2), **"Tracejada"**,
**"Seta no destino"** (padrão ligada), **"Rótulo"** e **"Excluir conexão"**.
Use para transformar um dashboard em fluxograma (ex.: funil de etapas com
setas).

---

## 10. Interatividade e persistência: o que é de quem

Tabela-resumo de ONDE cada estado vive — essencial para explicar "por que
mudou para todo mundo" ou "por que só eu vejo assim":

| Estado | Alcance | Onde vive |
|---|---|---|
| Estrutura do dashboard (widgets, abas, layout, aparência, conectores) | todos | banco (a edição é do dono/admin) |
| Valores digitados em Tabela Livre | todos | banco (células compartilhadas) |
| Seleção de **filtro rápido** de card (§4.4) | **todos (compartilhado)** | banco (células do dashboard) |
| Seleção da **janela de períodos** no card (§6.7a) | **todos (compartilhado)** | banco (células do dashboard) |
| **Período da barra** (§4.1) | individual | URL + preferência do usuário |
| Seleção no **Filtro por campo** (§4.3) | individual | URL + preferência do usuário (URL vence) |
| Busca/filtros embutidos de tabela (§4.5) | só o link | URL (`tf_…`) |
| Seleções do widget Filtro de período (§4.2) | só o link | URL (`pf_…`) |
| Interações do visitante de snapshot | só o visitante | URL do visitante (nada persiste) |
| Área de transferência de widget (copiar/colar) | só o navegador | armazenamento local do navegador |

Regras derivadas:

- **Filtro rápido é uma decisão coletiva**: se o gestor seleciona "março", a
  equipe inteira passa a ver março naquele card. Para filtros pessoais, use o
  widget "Filtro por campo" ou a barra de período.
- **URL compartilha tudo o que está nela**: copiar o link envia o período da
  barra, a aba ativa, os filtros de tabela e do Filtro por campo — ótimo para
  "olha exatamente isto".
- O **desfazer/refazer** cobre a estrutura do dashboard, não as seleções
  compartilhadas de filtro rápido/janela.

---

## 11. Snapshots públicos

Um **snapshot** é uma cópia congelada de UMA ABA de um dashboard, publicada
num link público (`/s/<código>`) que não exige login. Uso típico: divulgar
resultados a quem não tem conta (diretoria, cliente, TV do escritório).

### 11.1 Criação (menu "⋮" do dashboard → Snapshots)

- Escolhe-se a **aba** a publicar e as opções (restrições, interatividade).
- O snapshot **captura o período ativo** do dashboard no momento da criação e
  o congela como período padrão do link (o visitante enxerga o mesmo recorte
  que o criador via na tela).
- O **link aparece UMA ÚNICA VEZ** na criação — o sistema não guarda o
  endereço completo (por segurança, guarda apenas uma impressão digital).
  Copie e guarde o link; perdeu = revogar e criar outro.

### 11.2 O que o snapshot mostra

- Os **dados são congelados** no momento da criação/última atualização. O
  dado vivo pode mudar; o snapshot não acompanha.
- **Exceções ao congelamento**: metas e o calendário de dias não úteis são
  lidos ao vivo (linhas de meta e cortes por dia útil ficam atuais).
- **Restrições** opcionais (definidas na criação/edição) limitam o que o
  visitante vê (ex.: só uma operação). Registros simulados de reunião
  (mocks, §7.4) entram no dataset congelado por inteiro, ignorando as
  restrições — a regra do §7.4 continua decidindo quando eles CONTAM.
- O visitante pode interagir (trocar período dentro do congelado, usar
  filtros rápidos/da tabela) conforme a interatividade permitida; as
  seleções dele ficam SÓ na URL do próprio visitante e validadas contra as
  opções congeladas — nada persiste, nada afeta outros visitantes.

### 11.3 Gestão

- No painel do dashboard: **atualizar agora** (recongela com os dados
  atuais), **pausar/retomar**, **editar** (restrições/interatividade/agenda)
  e **revogar** (apaga o congelado; o link morre).
- Em Configurações → Snapshots, o admin gerencia TODOS os snapshots do
  sistema.

### 11.4 Armadilha clássica (períodos e mocks)

O período congelado existe também para proteger a regra dos mocks: um
snapshot criado "em todo o período" perderia a referência a Data Reunião nas
consultas em que ela vem só do período — e os widgets de reunião cairiam.
Por isso, crie snapshots com um período ativo na barra (ex.: "Este mês").

---

## 12. Kanban e Agenda

### 12.1 Kanban — duas formas

- **Quadro dedicado** (Home → Criar → Kanban): página própria, com nome e
  visibilidade por papel.
- **Widget Kanban** dentro de um dashboard: mesmas capacidades, em card.

### 12.2 Configuração do Kanban

- **"Tipo de quadro"**: **"Registros de uma base"** ou **"Tarefas (fases de
  execução)"**.
- **Registros**: escolher a **Base** e o modelo de **"Colunas do quadro"**:
  - **"Valores de um campo (ex.: etapa)"** — colunas = valores do campo
    (Etapa, Pipeline, Tipo de venda, Canal ou campo personalizado de
    seleção/texto). Arrastar um card entre colunas MUDA o valor do campo no
    registro; a opção "Gravar alterações de volta no Bitrix (write-back)"
    (desligada por padrão) propaga a mudança ao Bitrix.
  - **"Períodos de um campo de data"** — colunas por: "Dia da semana" /
    "Mês do ano" / "Mês/Ano".
  - **"Personalizar (colunas livres)"** — colunas manuais (até 30).
- **Tarefas**: escolher "Minhas tarefas (todas visíveis)" ou um quadro de
  tarefas existente. Opções: alerta "vence em breve" (dias, padrão 3) e
  "novas tarefas nascem travadas".
- **Card**: "Métrica no cabeçalho (soma por coluna)" (nenhuma / Valor / MRR /
  campo numérico ou moeda), até 4 "campos extras" exibidos no card, "Cor do
  card por campo".
- **Por coluna** (popover de configuração no quadro): ordem, rótulo, cor,
  limite WIP, ocultar (colunas de campo), adicionar/remover (colunas livres/
  tarefas).
- Aparência completa no §9.3.

### 12.3 Agenda

Widget de calendário:

- **"Base dos registros"**: uma Base ou "— nenhuma (só tarefas) —".
- **"Campo de data (aloca o registro no dia)"**: Data de fechamento / Data de
  abertura / Data de criação (origem) / campo personalizado de data.
- **"Mostrar tarefas (vencimento)"** (padrão ligado).
- **"Visão inicial"**: "Mês" (padrão) / "Semana".
- **A Agenda ignora os filtros do dashboard por design** (período, filtros
  rápidos etc. não a afetam) — ela é um calendário operacional, não um
  gráfico filtrável.

---

## 13. Presets (dashboards prontos)

Em Configurações → Presets, o admin pode **gerar** dashboards de fábrica.
Lista completa:

1. **"Performance comercial do mês"** — visão geral do mês (cards de meta de
   MRR e clientes, gráficos de acompanhamento).
2. **"Forecast do mês"** — usa campos gerados pelo preset (Forecast,
   Potencial, Desconto (%)).
3. **"MRR por vendedor"**.
4. **"MRR por canal"**.

Comportamento:

- **Gerar** cria o dashboard com abas, widgets e TODAS as dependências
  (campos personalizados, Sub-bases, correspondências que o preset precisa).
- **Atualizar** reaplica a definição de fábrica **apenas nos widgets do
  preset** (identificados internamente), preservando ids e SEM tocar widgets
  que o usuário adicionou por conta própria. Ou seja: é seguro personalizar
  um dashboard de preset acrescentando widgets — só os de fábrica são
  sobrescritos na atualização.
- Presets são também a melhor **referência viva de configuração avançada**
  (cards de meta em modo `meta`, filtros com tokens de data como
  `@month_start`, fórmulas de ticket médio) — abra o editor dos widgets
  gerados para estudar como foram montados.

---

## 14. Guia prático: um dashboard comercial completo, passo a passo

Exercício integrador que usa as principais peças. Objetivo: um dashboard
"Comercial — Diretoria" com visão do mês, funil de conversão, MRR com meta e
um snapshot público.

**Passo 0 — pré-requisitos** (uma única vez, admin):

1. Metas: cadastrar a meta mensal de `mrr` (global ou por operação) em
   Configurações → Metas; conferir o calendário de dias não úteis.
2. Campos: garantir que "Data Reunião" está visível no construtor (olho
   ligado) e, se quiser conversão entre Bases, que a correspondência de
   "Fonte" (Leads ↔ Negócios) existe.
3. (Opcional) Sub-base "Reuniões": Base-mãe Leads, filtro "Data Reunião não
   vazio", campo de data "Data Reunião".

**Passo 1 — criar o dashboard**: Home → Criar → Dashboard, nome
"Comercial — Diretoria", papéis de diretoria/gestão marcados.

**Passo 2 — abas e período**: criar abas "Visão do mês" e "Funil". Na barra
de período: período padrão "Este mês", campo primário "Data de fechamento",
e em "Campo de data por Base": Leads → Data de criação (origem); escopo
global.

**Passo 3 — cards do topo (aba Visão do mês)**:

- Card "MRR do mês": Visual "Card", Bases = Deals, métrica Soma de MRR;
  Comparação ligada ("Período anterior", formato "Percentual + absoluto",
  "Exibir o valor do período de comparação").
- Card "Novos clientes": Contagem de registros em Deals com filtro
  `Etapa = Ganhou` (operador "=").
- Métrica calculada "Conversão do mês": fórmula
  `[Contagem de registros · Negócios] / [Contagem de registros · Leads]`,
  formato "Percentual".

**Passo 4 — gráfico principal**: Visual "Barra", Bases = Deals, dimensão =
Data de fechamento com formato "Mês/ano", métrica = Soma de MRR. Em "Dia
útil e meta": ligar "Janela de meses no card" (opções "3 meses"/"6
meses"/"Este ano", padrão 6 meses; expor o seletor dia útil × dia cheio),
ligar "Alinhar meses pelo mesmo dia útil" e a "Linha de meta" (métrica
`mrr`, modo "Ritmo (ideal por dia útil)"). Resultado: barras comparáveis mês
a mês no mesmo estágio, com a meta-ritmo e o badge "Nº dia útil". (Note que
NÃO ligamos Comparação aqui — o alinhamento a substituiria de qualquer
forma, §6.7b.)

**Passo 5 — funil (aba Funil)**: Visual "Funil", Bases = Leads + Deals (com
a correspondência de etapa/fase apropriada ou usando `splitBySource` +
tabela, conforme os dados), dimensão = Etapa, métrica = Contagem. Ao lado,
tabela de apoio: dimensão Responsável, métricas Contagem (Leads via "Bases
da métrica"), Contagem (Deals) e a fórmula de conversão — cada linha um
vendedor, com o Total geral recalculando a razão exata (§7.8).

**Passo 6 — filtros para o leitor**: no gráfico e na tabela, adicionar
filtros rápidos de "Operação" e "Responsável" (lembrando: seleção
compartilhada). Para filtro individual, adicionar um widget "Filtro por
campo" mirando os widgets do funil.

**Passo 7 — acabamento**: formatação condicional na coluna de conversão
(escala de cor, ou regra "menor que 0,2 → texto vermelho"); uma Nota com
texto dinâmico, ex.: `Status: {= SE([Σ MRR] >= 100000; "Meta batida";
"Em andamento") }`; conectores ligando os cards ao gráfico; escala de fonte
do dashboard se for para TV.

**Passo 8 — snapshot**: com a barra em "Este mês", menu ⋮ → Snapshots →
criar a partir da aba "Visão do mês"; copiar o link (aparece uma vez).
Agendar-se para "Atualizar agora" quando quiser recongelar.

---

## 15. Regras de ouro e armadilhas

Checklist de verdades que evitam 95% dos enganos. Cada item tem a seção de
referência.

**Exclusões mútuas e pré-requisitos**

1. Comparação e "Alinhar meses pelo mesmo dia útil" **não convivem** — com o
   alinhamento ativo a comparação é ignorada (§6.7b, §6.8).
2. Janela de meses, alinhamento por dia útil e linha de meta exigem
   **dimensão de data mensal** ("Nome do mês"/"Mês/ano") **e período ativo**;
   sem isso, são ignorados em silêncio (§6.7).
3. Comparação em **"Todo o período" fica indisponível** (não há "anterior" de
   um período infinito) (§6.8).
4. Alinhamento por dia útil é ignorado quando a dimensão usa "Agrupar
   período" (§6.7b).
5. "Período anterior (mesmo dia útil)" sem calendário de feriados degrada
   para "Período anterior" simples (§7.9).

**Números que surpreendem**

6. "Exibir com '%'" NÃO multiplica por 100; o formato "Percentual" de
   fórmula SIM (§6.3, §8.7).
7. Subtotal/total de fórmula reavalia a fórmula — não é a soma da coluna
   (§7.8).
8. "Contagem" de um campo conta registros com o campo **preenchido**;
   "Contagem de registros" conta tudo (§6.3).
9. VARPCT já sai multiplicado por 100 — não aplique "%×100" de novo (§8.4).
10. Variação percentual é indisponível quando o período de comparação vale 0
    (§7.9).
11. Moedas nunca se somam sem conversão; sem taxa cadastrada o valor fica
    indisponível (§7.6). Confira a "Base da taxa" antes de comparar com
    relatórios externos.

**Bases, métricas e filtros**

12. "Bases da métrica" muda o que a métrica agrega, mas NÃO cria grupos
    novos: o universo de linhas é sempre o das Bases do widget (§7.1).
13. Nenhuma Base marcada = TODAS as Bases (§6.1).
14. Sub-base + mãe marcadas sem "Conviver" = a Sub-base é absorvida (não
    duplica; também não vira série própria) (§6.1).
15. Filtro por Operação é traduzido para responsáveis + perfil; a coluna
    "operação" do registro serve só para agrupar (§7.5).
16. Registros simulados de reunião só contam quando a consulta referencia
    "Data Reunião" — e mesmo assim obedecem aos demais filtros (§7.4).
17. Filtros se combinam por E; a segmentação "Bases" de um filtro deixa as
    outras Bases passarem livres (§6.4).
18. Um campo com o "olho" fechado na aba Campos some dos dropdowns do
    construtor (§2.1.1).

**Compartilhado × individual**

19. Filtro rápido de card e janela de períodos são COMPARTILHADOS entre
    usuários; barra de período e Filtro por campo são individuais (capítulo
    10).
20. "Opções visíveis"/opções ocultas são estética de dropdown — nunca mudam
    a consulta (§6.5).

**Snapshots e Agenda**

21. Snapshot congela dados (menos metas/feriados, lidos ao vivo); crie com
    período ativo na barra; o link aparece uma única vez (capítulo 11).
22. Agenda ignora os filtros do dashboard por design (§12.3).

**Fórmulas**

23. Argumentos separam-se com `;` — vírgula é decimal (§8.3).
24. Campo cru só dentro de SOMASE/CONT.SE/MÉDIASE; fora, use Σ/Média/
    Contagem (§8.4).
25. "Data atual" não entra em fórmula agregada; agregações não entram em
    campo por-registro (§8.1).
26. Operando escopado a Sub-base com recorte "contém" mostra "—" (§8.5).
27. data − data = dias; qualquer outra conta com data = vazio (§8.4).

---

## 16. Glossário e tabelas de referência rápida

### 16.1 Glossário

| Termo | Definição |
|---|---|
| **Base** | fonte de dados do sistema (Leads, Deals, Estudo, dinâmicas) |
| **Sub-base** | Base derivada: linhas da mãe recortadas por filtro fixo, com campo de data próprio |
| **Fonte** | campo do CRM com o canal de aquisição (não confundir com Base) |
| **Campo unificado** | correspondência que une colunas equivalentes de Bases diferentes numa só |
| **Registro casado / `↪`** | registro de outra Base conectado pela regra de Conexões |
| **Dimensão** | campo de agrupamento (eixo, linha, fatia) |
| **Métrica** | número agregado (campo + agregação) ou fórmula |
| **Bases da métrica** | conjunto de Bases próprio de uma métrica (≠ Bases do widget) |
| **Filtro rápido** | dropdown no card, seleção compartilhada |
| **Transform / Formato (de data)** | bucket de data de uma dimensão (mês, semana…) |
| **Agrupar período** | colapso dos registros de cada bucket por soma/média/… |
| **Comparação** | segunda consulta num período-base para exibir variação |
| **Alinhamento por dia útil** | cada mês cortado no mesmo Nº de dia útil |
| **Janela de períodos** | dropdown do card que replica o recorte em N meses |
| **Linha de meta** | meta cadastrada desenhada no gráfico (cheia ou ritmo) |
| **Snapshot** | cópia congelada de uma aba, publicada em link público |
| **Preset** | dashboard de fábrica gerado/atualizado pelo admin |
| **Mock (Data Reunião)** | registro simulado que só conta quando a consulta referencia Data Reunião |
| **Write-back** | gravação de uma edição de volta no Bitrix |

### 16.2 Enumerações completas (uma linha por lista)

- **Tipos de widget (17)**: Card, Métrica calculada, Calculadora, Nota
  (post-it), Forma, Imagem, Tabela, Tabela Livre, Barra, Barra horizontal,
  Linha, Pizza, Funil, Filtro de período, Filtro por campo, Kanban, Agenda.
- **Agregações de métrica (5)**: Soma, Contagem, Média, Mínimo, Máximo.
- **Agregações de "Agrupar período" (6)**: Individual (por registro), Soma,
  Contagem, Média, Mediana, Moda.
- **Operadores de filtro (10)**: =, ≠, contém, >, ≥, <, ≤, em (lista), é
  vazio, não vazio.
- **Períodos (13)**: Todo o período; Hoje; Últimos 7/30/90 dias; Esta
  semana; Semana passada; Este mês; Mês passado; Este trimestre; Este ano;
  Ano passado; Personalizado.
- **Formatos de data de dimensão (8)**: — (data), Dia da semana, Semana do
  ano, Semana do mês (restrita/cheia), Nome do mês, Mês/ano, Trimestre, Ano.
- **Máscaras de data (3)**: dd/mm/aaaa, dd/mm/aa, mm/aa.
- **Bases de comparação (5)**: Período anterior; Período anterior (mesmo dia
  útil); Mesmo período do ano passado; Média de uma janela anterior; Mediana
  de uma janela anterior. **Janelas (4)**: Último trimestre, Último
  semestre, Ano até agora, Últimos 12 meses.
- **Janela de períodos do card (6)**: 3 meses, Este trimestre, 6 meses, Este
  semestre, Últimos 12 meses, Este ano.
- **Modos do Card (5 + 3)**: Número (agregação), Valor de um registro,
  Ranking (Top N), Lista de valores, Fórmula; + meta, razão e Data atual
  (via preset/JSON, exceto Data atual que tem toggle próprio).
- **Funções de fórmula (20)**: SE, E, OU; SOMASE, SOMASES, CONT.SE,
  CONT.SES, MÉDIASE; SOMA, MÉDIA, MÍN, MÁX, CONT.NÚM, CONT.VALORES, ARRED,
  ABS, CONCATENAR; ANTERIOR, VARPCT, VARABS.
- **Tipos de campo (8)**: Texto, Número, Data, Seleção, Moeda, Booleano,
  Calculado (por registro), Calculado (totais do recorte).
- **Moedas (5)**: BRL, USD, EUR, GBP, ARS (taxas por ano/trimestre; PTAX).
- **Paletas (7)**: Design system, Vibrante, Oceano, Pôr do sol, Floresta,
  Tons de cinza, Inbound (roxo & verde).
- **Formas (7)**: Retângulo, Retângulo arredondado, Elipse, Losango,
  Triângulo, Seta, Hexágono.
- **Tokens de data em filtros (5)**: `@today`, `@month_start`, `@month_end`,
  `@year_start`, `@year_end`.
- **Métricas de meta embutidas (2)**: `mrr`, `clientes` (+ personalizadas do
  admin).
- **Presets de fábrica (4)**: Performance comercial do mês, Forecast do mês,
  MRR por vendedor, MRR por canal.
- **Escalas de fonte do dashboard (5)**: 90%, 100%, 115%, 130%, 150%.
- **Grid**: colunas 12–48 (padrão 12); altura da linha 10–200 px (padrão
  30); linhas 8–200.

### 16.3 Mapa mental de decisão (para a IA que orienta)

1. **Que pergunta o widget responde?** → escolhe o Visual (número → Card;
   evolução → Linha/Barra; composição → Pizza/Funil; detalhe → Tabela;
   operação → Kanban/Agenda).
2. **De quais registros?** → Bases (e Sub-bases; §6.1) + Filtros (§6.4).
3. **Recortado no tempo como?** → período (barra/campo por Base; §4.1, §7.2).
4. **Agrupado por quê?** → Dimensões (+ formato de data; §6.2).
5. **Medindo o quê?** → Métricas (agregação, moeda, Bases da métrica,
   fórmula; §6.3, cap. 8).
6. **Comparando com quê?** → Comparação OU alinhamento por dia útil OU
   janela de períodos (+ meta; §6.7–6.8).
7. **Quem mexe no quê?** → filtros rápidos (compartilhados) vs Filtro por
   campo (individual) (cap. 10).
8. **Como fica bonito?** → aparência, formatação condicional, conectores
   (cap. 9).
9. **Quem vê?** → papéis do dashboard; público → snapshot (cap. 11).

---

*Fim do manual. Mantenha-o atualizado junto com mudanças de UI/semântica do
construtor (ver também `docs/arquitetura.md`, `docs/banco-de-dados.md` e
`docs/manual-de-manutencao.md` para a visão técnica de mantenedor).*

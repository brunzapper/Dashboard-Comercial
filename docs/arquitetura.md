<!-- Versão: 1.52 | Data: 01/08/2026 -->
<!-- v1.52 (01/08/2026): §4.18 + invariante 26 — CONDIÇÕES DO RECORTE POR FATOR
     (factor.filters com UI no plan-editor): recorte configurável do realizado
     aplicado ANTES do filtro de membro na mesma consulta; parse restrito aos
     10 ops de FILTER_OPS, `in` → array, sources por-filtro descartado,
     operation_id proibido no savePlan; o save RE-EMITE os filtros (antes o
     round-trip do editor os destruía) e a prévia da fórmula os aplica. -->
<!-- v1.51 (31/07/2026): §4.18 + invariante 26 — APURAÇÃO SOBRE O MÊS ANTERIOR
     (comp_plans.config.apuracao: "mes_anterior"; padrão da Zapper/preset):
     lançamento M apura realizado/metas/taxas de M-1 via apuracaoRef, com o
     deslocamento DENTRO dos loaders (contrato anti-dupla-conversão);
     entry/espelho ficam no mês de pagamento; computed.ref carimba a janela.
     UI da Remuneração: navegação de mês leve (rascunho + commit debounced,
     picker mês/ano + "Hoje", replace + useNavPending, grade travada durante a
     troca), aba via ?aba=plano com catálogo do editor condicional
     (editorCatalog), piso de ano 2020 na page (URLs presas em 2000). -->
<!-- v1.50 (31/07/2026): (a) §4.17 + invariante 25 — assistente "Atualizar com
     IA" (contrato registros-update v1): atualização em MASSA por filtros +
     alterações; prévia server-side OBRIGATÓRIA via runRecordListWindow
     (contagem exata + amostra; IA nunca emite ids; sub-fontes aceitas), apply
     re-resolve ids e escreve SÓ pelo novo choke point updateRecordValuesBulk
     (client RLS; teto 200 = MAX_AI_UPDATE_RECORDS; mocks pulados; sync-field
     local-only); ops de filtro = FILTER_OPS estrito. (b) §4.15 + invariante
     23 — ação set_field nas automações do kanban: idempotente no snapshot
     (decideActions), alvos proibidos por setFieldTargetError (avaliação +
     save + picker), executor único executeFieldWrites (moves + sets), teto
     único MAX_ACTIONS_PER_RUN. RPCs intocados; sem migração. -->
<!-- v1.49 (31/07/2026): recursos SOB DEMANDA por org (0114) — org_features
     (linha por org; escrita service-role-only) + lib/config/org-features
     (parse fail-closed) + AREA_FEATURES em access.ts (feature-off vence até
     override allow; barra page/aba/escrita/matriz) + requiresFeature no
     PresetDashboard (lista/applyPreset/generatePresets) + toggle no console
     /owner. Remuneração vira config custom da Zapper; §4.18 atualizado.
     UI: seletor de plano da Remuneração vira pills visíveis (nome + nº de
     membros) — o combobox escondia os demais planos. -->
<!-- v1.48 (31/07/2026): §4.7 preset Remuneração Variável v3 — dashboard de
     CONFERÊNCIA em 5 abas: Visão geral vira resumo da remuneração sobre o
     espelho (KPIs + tabela records-mode de conferência + total por
     rem_plano), valor gerado migra p/ a aba AEs e nasce a aba Atribuição
     (1ª records-table de preset: coluna custom:sdr_reuniao editable:true —
     dropdown vivo; colunas custom read-only exigem editable:false explícito
     pelo legado do modo registros). Zero mudança de engine/RPC. -->
<!-- v1.47 (31/07/2026): §4.10 + invariante 27 — filtros de relação por NOME:
     resolveFkFilterNames no ENGINE (nome→id→canon; strings e arrays; UUID
     passthrough; FK_NO_MATCH p/ desconhecido) nos choke points runWidget/
     pernas por métrica/record-list/espelhos de operação; FilterValuePicker
     nos 6 editores (builder/tf_ gravam NOME; sub-base/perfil/automações
     gravam ID com rótulo); validador de import checa nomes (erro amigável;
     sub-base exige UUID), SPEC atualizado e export emite nome
     (loadExportFkNames). §4.7: sentinela @responsible removida do preset
     (nome puro). RPCs intocados. -->
<!-- v1.46 (31/07/2026): §4.9 — operando de META (`meta:<chave>`) nas fórmulas
     agregadas: valor de goals.target ABAIXADO p/ const nos choke points
     (lowerGoalOperands; nunca basis/RPC), período pela regra do card
     (goalPeriodScope extraída byte-idêntica), registry obrigatório no
     AggCatalogInput (10 sítios), meta ausente ⇒ "—". RPCs intocados. -->
<!-- v1.45 (31/07/2026): fix §4.10/invariante 12 — o fingerprint dos widgets
     DEFERIDOS (deferredScopeById) ganha a CONFIG do widget
     (lib/widgets/deferred-fingerprint.ts; posição/ordem fora do hash):
     editar widget deferido re-busca sem F5 (antes o payload velho do lote
     ficava na tela — regressão do deferimento automático de engine). -->
<!-- v1.46 (31/07/2026): §4.7 preset v2 — vínculos automáticos
     (PresetOperation.responsibleNames, ensure-if-absent), sentinela
     @responsible:<Nome> em filtro de widget (resolvida no apply de fábrica),
     ensureCompMirror (base espelho no apply) e preset Remuneração Variável
     com 4 abas (cards por pessoa, métrica calculada de valor gerado, aba do
     espelho). §4.18: rem_atingimento cai em média simples com pesos 0. -->
<!-- v1.45 (31/07/2026): (a) §4.18 — comissão MULTI-BLOCO (commissions[];
     legado normalizado no parse; kinds pct/flat/per_unit; tierBy realized),
     memberField (match de membro por CONJUNTO DE NOMES via memberFilterFor),
     defaultTarget (alvo fallback de leitura) e targetCurrency (alvo em moeda
     convertido na leitura via targetRates dos callers; taxa ausente =
     fail-closed); (b) §4.7 — seções de ORG do preset (operations/compPlans,
     ensure-only, SÓ caminho de fábrica via allowOrgSections) +
     options_source 'responsibles' (dropdown vivo, 0113) + preset
     "Remuneração Variável" (árvore AEs/SDR-BDR, 5 planos, dashboard de
     insumos). Invariante 26 estendida. RPCs intocados. -->
<!-- v1.44 (31/07/2026): (a) §4.18 — membros do plano por OPERAÇÃO
     (config.memberOperationIds: subárvore viva via loadOperationScopes +
     canonicalização nos callers; helpers puros resolveOperationMembers/
     explicitMemberIds no model; presença ⇒ nunca fallback "todos");
     (b) §4.17 — 4ª superfície: assistente de IA de OPERAÇÕES (contrato
     operacoes-edit v1 por NOME, sem delete, automáticas intocáveis,
     PROFILE_OPS extraído p/ lib/config/operation-profile.ts, apply pelos
     choke points; fluxo copiar-prompt/colar-JSON de IA externa no MESMO
     contrato). Invariantes 25/26 estendidas. RPCs intocados. -->
<!-- v1.43 (31/07/2026): §4.18 — comissão por FAIXAS de atingimento
     (config.commission, sem migração): gatilho + base + tabela de faixas
     (maior limiar >= vence sobre o atingimento EFETIVO), tabela por membro
     (memberTiers) substitui a do plano inteira, cálculo NATIVO em
     computeEntry (nunca fórmula gerada), ref comp:comissao na fórmula livre
     (sem soma automática), override overrides.commission por célula e campo
     rem_comissao no espelho. Invariante 26 estendida. RPCs intocados. -->
<!-- v1.42 (30/07/2026): §4.18 Remuneração variável (0112) — comp_plans/
     comp_entries (config jsonb fail-closed; efetivo = manual ?? calculado
     derivado por computeEntry na leitura; recompute nunca toca inputs),
     realizado por fator SÓ via runCalculatedWidget, alvos como linhas de
     goals (id canônico, lib/metas/upsert.ts), fórmula livre de total via
     evaluateFormula sobre o mapa comp:*, espelho "Publicar" via
     createRecord/updateRecord (dedup mirror_record_id) e visão do vendedor
     por auth_responsible_ids(). Invariante 26. RPCs intocados. -->
<!-- v1.41 (30/07/2026): §4.11.2 — MESCLA no modo "Criar a partir de"
     (multi-referência): além da base (copiada fielmente), até 4 referências
     ADICIONAIS entram SÓ na geração — fuseExtraReferences (multi-ref.ts)
     prefixa as keys (rN_), une as bases e emite uma section de prompt por
     extra; o rewrite ganha refWidgets (origem de copy_of fora do merge por
     key e do bottomByTab). Apply/duplicateBoard/RPCs intocados. -->
<!-- v1.40 (30/07/2026): §4.17 Assistentes de IA de registros e campos —
     inserir até 10 registros em bases manuais (prévia interativa só com
     colunas preenchidas, edição inline + troca de coluna, duplicados por
     título como aviso, apply via createRecord), sugestão de mapeamento de CSV
     no wizard (preenche `plans`; revisão obrigatória) e criação de campos
     (inclusive calculados — fórmula validada pelos módulos únicos extraídos
     p/ lib/records/formula-server.ts; apply via createField). Laço de
     autocorreção compartilhado (lib/ai/json-loop.ts); sampleForBase movido p/
     lib/import/sample-db.ts; coerceCore passa a ancorar data core em Brasília
     (invariante 11, write side — fix do form manual). Invariante 25.
     RPCs intocados. -->
<!-- v1.39 (29/07/2026): §4.10 — camada de feedback de FALHA fora de form:
     Toaster global (sonner) no layout autenticado + notifyOnError
     (lib/feedback/notify.ts) nos escritores que descartavam resultado;
     actions void→ActionState (operações/responsáveis/metas/moedas/
     deleteWidget); ConfirmDialog padronizado nas exclusões desprotegidas;
     boundaries error/not-found (app + /s/[token]) e loading.tsx nas rotas
     lentas — no viewer público o skeleton é <Suspense> IN-PAGE (validação do
     token antes do streaming preserva o STATUS 404 real do 404 uniforme;
     loading.tsx de segmento responderia 200); títulos de aba por página
     (template no layout (app)); botão de menu acessível na sidebar
     desafixada. RPCs intocados. -->
<!-- v1.38 (28/07/2026): Redesign da AGENDA (0111): célula com altura fixa por
     densidade + scroll por dia + ordem cronológica (lib/agenda/day-items.ts);
     tasks.due_time_end (hora final); agenda_notes (anotação do dia — post-it;
     org-scoped raiz, SELECT org-wide, escrita autor/admin/gestor; realtime);
     drag & drop de tarefas/anotações entre dias (rescheduleTask/moveAgendaNote
     — otimista, mime application/x-agenda-item); quick-create por dia;
     CardDetailSheet no clique do chip; aparência em
     settings.agenda.appearance (canStyle inclui agenda); página /agenda do
     Workspace (fetchWorkspaceAgenda — mistura de agendas com Operação
     traduzida via operation-scope; prefs em user_settings.agendaHub).
     RPCs intocados. -->
<!-- v1.37 (26/07/2026): §4.8 — Pastas de bases (0107): source_folders +
     folder_id/sort_order (exibição pura; groupSourcesByFolder único;
     navegação Pasta → Base → Sub-base em /registros e /campos; headings nos
     pickers; ↑/↓ em Registros → Bases). RPCs intocados. -->
<!-- v1.36 (26/07/2026): §4.11.3 — raciocínio AO VIVO no painel "Editar com
     IA": turno via rota de streaming /api/dashboards/<id>/ai-turn (NDJSON;
     runAiEditTurnCore em lib/ai/edit-session.ts — mesmo gate/persistência das
     actions, que viraram wrappers) + onThought no contrato dos adaptadores
     (Gemini streamGenerateContent + includeThoughts; sem custo extra — nunca
     ligar thinking onde está desligado). Título do painel = MODELO
     configurado (1ª letra maiúscula). -->
<!-- v1.35 (26/07/2026): §4.14 Parcerias (0104–0106) — match de bases
     dinâmicas (helpers com lookup em data_sources), auto-match INCREMENTAL
     pós-sync do Bitrix + recalc direcionado, fusão de perfis de operação
     (in_ci; operation-scope batelado com roll-up do pai) e sub-operações
     automáticas por registro (source_auto_operations +
     operations.auto_source_record_id); invariantes 21/22. -->
<!-- v1.34 (26/07/2026): §4.10 — deferimento AUTOMÁTICO dos widgets de engine
     (runDeferredWidgets em lote via widget-scope em bundle; page entrega só
     fingerprints; env de escape DEFER_ENGINE_WIDGETS=0) e §4.1 — janela
     incremental do modo lista full-fetch (runRecordListWindow +
     fetchWidgetRecordsWindow; env RECORD_LIST_WINDOW, default 1000). -->
<!-- v1.33 (26/07/2026): §4.1 — cache TTL de run_widget_query ENTRE
     requisições (lib/widgets/rpc-cache.ts, sob o withRpcMemo; chave por
     escopo de autorização u:<userId>/s:<snapshotId>; env
     WIDGET_RPC_CACHE_TTL_MS, default 45s, 0 desliga; erro nunca em cache). -->
<!-- v1.32 (26/07/2026): §4.13 — agrupamento de responsáveis por exibição
     (responsibles.canonical_id, 0101): apelido → principal ("nome usado"),
     resolvido 100% no engine/loaders (lib/config/responsible-canon.ts) —
     dropdowns colapsam, filtros expandem p/ o grupo, dimensões fundem no
     merge client-side, restrição de snapshot grava expandida e
     auth_responsible_ids devolve o grupo. Invariante 20. RPCs intocados. -->

<!-- v1.31 (26/07/2026): §4.2 — alvos do "Filtro de período" DINÂMICOS
     (settings.excludedTargets, espelho do filtro_campo; widget novo entra
     sozinho; whitelist legada `targets` honrada sem excludedTargets — ramo
     permanente; runbook backfill-filter-targets.sql) e Aparência ganha
     "Ocultar barra de título" (appearance.title.hidden — só a barra some;
     grip flutuante + ⋮ em hover no modo edição). RPCs intocados. -->

<!-- v1.30 (25/07/2026): §4.12 — espaço de grid v2 (grade FINA: base 120 sem
     margens, linha quadrada default, controle "Largura da coluna"; conversão
     runtime normalizeGridSpace keyed em canvas.gridVersion + migração lazy
     ensureFineGrid no write-path + runbook backfill-grid-v2.sql) e PÁGINAS de
     widget (mescla settings.pages: host renderiza a página ativa, pager acima
     do card, diálogo "Adicionar página?" no drop quase-em-cima, ⋮ Adicionar
     página/Desfazer mescla). Invariantes 18 e 19. RPCs intocados. -->

<!-- v1.29 (25/07/2026): §4.7 — "Linha divisória" vira visual_type próprio
     (linha_divisoria, 0100 — CHECK + backfill; settings.shape inalterado);
     identidade SÓ por isLineShapeWidget (braço legado forma+kind linha é
     permanente: snapshots congelados/clipboard antigos). Rótulos de barra
     horizontal: reserva de margem medida p/ rótulo externo + auto-flip do
     "Dentro" que não cabe; appearance barFillPct/chartInset/filter (aparência
     dos widgets de filtro) — tudo client-side, RPCs intocados. -->
<!-- v1.28 (24/07/2026): §4.8 — pernas de sub-base EXIBÍVEIS: (a) operando
<!-- v1.28 (24/07/2026): §4.8 — pernas de sub-base EXIBÍVEIS: (a) operando
     escopado em fonte-IRMÃ é ZERADO por perna no branch multi-perna
     (zeroSiblingScopedOperands; cada perna mostra a própria contribuição —
     antes toda perna repetia o total global) + backfill 0 na basis p/ o
     re-eval client-side; (b) settings.subSeriesMode (stacked default | total |
     grouped): stacked/grouped mantêm a Base como dim líder e o CHART pivota as
     pernas em séries (lib/widgets/sub-series.ts + WidgetData.subSeries);
     total funde por tupla no ENGINE (foldRowGroup) sem a dim Base; pizza/funil
     com dim e KPI/card fundem SEMPRE (antes: KPI mostrava só a 1ª perna);
     goalLine/businessDayRef propagados pelo branch. limitCategories ganha
     rankKey (top-N pelo total da categoria no pivot). Fix: export/paginação
     de registros passavam sem o catálogo (predicado de sub nunca aplicado).
     RPCs intocados. -->
<!-- v1.27 (24/07/2026): §4.11.2 — a IA LÊ melhor o estado: `copy_of` (cópia de
     widget por delta, resolvida em normalizeImportRaw — key nova + key da
     origem; grid ausente empilha abaixo do fundo da aba), `baseWidgets` também
     no modo from (validação do laço = semântica do apply) e a prévia pendente
     não aplicada entra no system do turno seguinte (a resposta SUBSTITUI a
     prévia inteira). -->
<!-- v1.26 (24/07/2026): §4.11.3 — painel "Editar com IA" DENTRO do dashboard
     (AiEditPanel, não-modal/recolhível) com sessão PERSISTIDA por usuário×board
     (dashboard_ai_sessions, 0098): turnos server-owned (cliente envia só a
     mensagem nova), prévia pendente no banco, snapshot pré-turno persistido
     como "Desfazer edição da IA" (sobrevive a F5), Recomeçar preserva o undo.
     ai-session-actions.ts embrulha generateDashboardWithAi/applyGenerated-
     Dashboard sem tocá-los; fluxo da Home inalterado. -->
<!-- v1.25 (24/07/2026): §4.11.2 — PRESERVAR conteúdo na edição/cópia por IA.
     Modo Editar: merge por widget no estágio bruto (normalizeImportRaw ganha
     baseWidgets do export; deep-merge por key — settings mescla, arrays
     substituem, null limpa) ⇒ a IA manda só o delta do widget e o resto é
     preservado. Modo Criar a partir de: applyFromReference = cópia fiel via
     duplicateBoard + delta aditivo aplicado como Edição (FROM_RULES reescrito),
     no lugar de importDashboardJson que recriava tudo. RPCs de widget
     intocados; sem migração. -->
<!-- v1.24 (23/07/2026): §4.1 — merge por bucket client-side p/ dimensão
     custom:+transform (bucket-merge.ts em computeRows; RPC agrupava pelo
     valor cru; canônico estilo-núcleo; avg simples aproximado). Import (IA):
     validador remove dateAgg fora de lista, remapeia Sub-base de recorte
     idêntico p/ a existente e avisa sobre resultCurrency/escopo≠sources;
     spec ganha as regras 12-14 (valem também p/ a geração direta, que reusa
     o mesmo prompt/validador). -->
<!-- v1.24 (23/07/2026): §4.11.2 — export de estrutura (lib/import/dashboard/
     export.ts + "Exportar JSON" no ⋮) e CONVERSA de IA com 3 modos (novo/a
     partir de/editar): identidade forçada no servidor (rewrite.ts), modo
     Editar sem GC com adoção de presetKey + snapshot p/ Desfazer
     (applyDashboardEditJson; applyPresetDefinition ganha targetDashboardId e
     fontScale gerida), truncamento tipado nos adapters de IA. -->
<!-- v1.23 (23/07/2026): §4.11.1 — geração DIRETA de dashboard por IA via API:
     adaptadores multi-provedor em lib/ai/* (Gemini/Claude/OpenAI, fetch), chave
     cifrada por org (ai_provider_config, 0096), action generateDashboardWithAi
     com laço de autocorreção, reuso de buildImportPrompt + validate +
     importDashboardJson; contexto extraído p/ lib/import/dashboard/context.ts. -->
<!-- v1.22 (23/07/2026): §4.11 — REGRA: nunca `.insert(...).select()` em
     `dashboards` (a policy de SELECT auth_board_visible/0088 é função STABLE
     sobre a própria tabela e não vê a linha do próprio comando → 42501);
     padrão = id gerado no app + insert sem RETURNING (duplicateBoard);
     createBoard/applyPresetDefinition corrigidos; erro real do banco passa a
     ser propagado pelos chamadores do applyPresetDefinition. -->
<!-- v1.21 (23/07/2026): §4.11 — Importar aceita VÁRIAS Bases (modelo/amostra
     por Base + Conexões no prompt; envelope `bases: []`). -->
<!-- v1.20 (23/07/2026): §4.11 — Importar dashboard via JSON gerado por IA
     (botão Importar na Home; validador puro em lib/import/dashboard/*;
     aplicação pelo applyPresetDefinition com identidade import:<chave>;
     prompt com modelo da Base + amostra com cobertura de colunas). -->
<!-- v1.19 (23/07/2026): escopo do VALOR do "Filtro por campo" configurável
     (§4.7/§4.10; invariante 12) — settings.valueScope 'all' compartilha a
     seleção entre todos os usuários via célula __ff__/sel de
     dashboard_table_cells (mesma semântica do __qf__; saveSharedFieldFilter;
     fora do Desfazer/Refazer); no modo shared o cliente NÃO escreve a URL
     (transporte = banco, padrão QuickFiltersBar) e ressincroniza do seed;
     ausente/'user' = por usuário (lastFieldFilters), como antes. -->

<!-- v1.18 (23/07/2026): MULTI-ORGANIZAÇÃO + acessos (0088–0094; §4.6
     reescrito; invariantes 15–17): organizations/members/app_owner com
     triggers de proteção; organization_id nas raízes + RLS org-scoped;
     fluxo Owner (/owner, env OWNER_USER_ID, seed_org_defaults/
     delete_organization); acesso por pessoa aos boards (board_access,
     ⋮ → Acesso); escopo de BASES por board (settings.sourceScope, ⋮ →
     Bases — catálogo efetivo via applySourceScope, page/widget-scope/
     viewer); overrides individuais (user_access_overrides, Configurações →
     Acessos); branding editável (organizations.name/app_name no sidebar). -->

<!-- v1.17 (22/07/2026): ciclo de vida de boards no hub (0087 — §4.7 +
     invariante 14): menu ⋮ com Duplicar/Arquivar/Excluir (soft → Lixeira,
     purga 14d via pg-cron-purge-trash; trashed não abre em rota nenhuma),
     duplicateBoard com remap de ids + strip de preset. Grid: allowOverlap —
     nada se move durante o gesto; resolveDropCollisions abre espaço MÍNIMO só
     no drop (dashboard-grid v2.12). -->
<!-- v1.16 (22/07/2026): (a) comparação nos Cards de FÓRMULA (§4.9) — o
     runCardWidget roda a mesma fórmula no range deslocado (comparisonSpec,
     inclusive previous_period_bd com feriados; bases de janela ficam de fora
     — escalar único) e anexa WidgetData.comparison + card.value/cmpValue p/ o
     VariationBadge; RPCs intocados; snapshot herda (mesmo runCardWidget +
     PASSTHROUGH de feriados). (b) ordenação DINÂMICA por valor
     (categorySort.by/metric — barra/pizza/funil; helper único orderCategories;
     eixo cronológico não oferece; "Outros" fica no fim) e colorByCategory
     (barra de série única colore por índice da paleta; off por padrão).
     (c) Preset Inbound v5: cards de SAL removidos (sub `sals` fica),
     comparação em TODOS os cards, cores da marca como dados de aparência +
     paleta nomeada "inbound" (validada p/ contraste/CVD). -->
<!-- v1.15 (22/07/2026): linhas core de field_definitions (0086 — invariante 13:
     overrides das colunas núcleo, split em lib/records/core-defs.ts) e nota de
     terminologia "Base" (= fonte de dados do sistema, na UI). -->
<!-- v1.14 (21/07/2026): sincronia filtros → widgets deferidos + rascunho do
     período personalizado (§4.10; invariante 12) — (a) intervalo
     personalizado (barra global e filtro rápido do card) vira RASCUNHO com
     commit (completo auto-debounced / aberto via "Aplicar"): digitar não
     dispara mais consulta com período parcial; (b) escopo das actions
     deferidas (runQuickTable/runKanbanWidget) sai da assembly ÚNICA do
     widget-scope (resolveWidgetViewScope) — quick-table e kanban passam a
     aplicar __qf__/ff_ (com lastFieldFilters)/operação traduzida; (c)
     re-fetch dos deferidos por FINGERPRINT de escopo da page
     (deferredScopeById → prop scopeKey), cobrindo filtros persistidos no
     banco que não mudam a URL; (d) feedback: estado "Atualizando…" (dim +
     spinner) nos deferidos, period-window/nota no transition compartilhado;
     (e) guards de resposta obsoleta (agenda, pager server-side). -->
<!-- v1.13 (21/07/2026): dia de BRASÍLIA no read side dos widgets (0085, §4.1/
     §4.2/§4.5; invariantes 7/11) — colunas timestamptz do núcleo comparavam/
     bucketizavam na sessão UTC do banco (limites de dia deslocados 3h; registro
     21h+ BRT caía no dia/mês seguinte). RPCs recriados (par espelhado):
     bounds do @period ancorados com -03:00 SÓ p/ colunas do núcleo, bucketing
     via _widget_local_ts (núcleo = wall time BRT; custom = prefixo de 10
     chars, casando com o parseYmd do client), coalesce de unificados idem;
     client ancora bounds core em period.ts/engine.ts/record-list.ts. Campos
     custom (texto) seguem byte-idênticos. Badge "Nº dia útil" (§4.9):
     WidgetData.businessDayRef expõe o N de corte do businessDayAlign
     (compartilhado entre os meses) e o card exibe ao lado do toggle
     (BusinessDayBadge; funciona também no viewer de snapshot). -->
<!-- v1.12 (20/07/2026): sync inicial do "Filtro por campo" é RASO (§4.7) —
     seed lastFieldFilters sem parâmetro na URL espelha a URL com
     history.replaceState, sem navegação RSC (o servidor já aplicou o seed);
     overlay/persistência só em mudança do usuário. Corrige o dashboard de
     preset preso em "Carregando…" na montagem sob refreshes do realtime. -->
<!-- v1.11 (20/07/2026): mocks × predicados de sub-fonte (§4.4) — a regra 0052
     não isenta os mocks dos predicados (AND puro); 0084 dá custom:fonte aos
     mocks Inbound p/ contarem na sub sqls. Preset Inbound v4: Mês x Mês abre
     em "dia cheio" (reuniões agendadas visíveis; toggle p/ dia útil). -->
<!-- v1.10 (20/07/2026): (a) periodWindow (§4.9) — janela de períodos
     equivalentes com dropdown no card ("3 meses"/"Este trimestre"…), corte
     por dia útil OU dia cheio, seleção compartilhada na célula __pw__;
     windowMonths vira alias legado; (b) persistência por usuário do widget
     "Filtro por campo" (user_preferences.lastFieldFilters, §4.7 — URL vence). -->
<!-- v1.9 (20/07/2026): correções pós-preset — (a) coalesce dos unificados
     ordena refs `custom:` (esparsos) antes das colunas do núcleo (densas;
     §4.8 — coluna densa sombreava o membro custom de outro record_type);
     (b) businessDayAlign.windowMonths = janela própria "últimos N meses" do
     card (§4.9); (c) filtro de OPERAÇÃO da visualização resolve vínculo +
     PERFIL no server (operations.filter, 0083; lib/config/operation-scope.ts)
     — nunca a coluna derivada records.operation_id (§4.7). -->
<!-- v1.8 (20/07/2026): operandos escopados estendidos (§4.7 — predicado de sub
     com in/is_null/*_ci; aux como perna da fonte do escopo: período pela data
     DELA + correspondências DELA; chave aggif com 4º elemento scope) + preset
     Inbound (lib/presets/inbound.ts) e deps novas do aplicador (campos
     calculados com fórmula, correspondências). RPCs intocados. -->
<!-- v1.7 (20/07/2026): dias úteis e metas (§4.9) — non_working_days (0081) +
     utilitários de dia útil; businessDayAlign (pernas por mês no engine);
     base de comparação previous_period_bd; goalLine (meta/ritmo como série);
     metas por métrica arbitrária (registry goal_metrics); preset engine v2
     (§4.7 — aplicação idempotente por presetKey); sub-fonte com campo de
     período custom (0082, §4.8). RPCs intocados em tudo. -->
<!-- v1.6 (20/07/2026): unificados SEMPRE por perna — o mapa p_correspondences
     de TODA consulta sai de correspondenceMapForSources (fallback perna →
     raízes → todos); buildCorrespondenceMap fica só p/ opções de bucket;
     unifiedMembers é raiz-primeiro (§4.8; invariante 10). Corrige o membro de
     sub-fonte vazando no coalesce de widget só-pai. -->
<!-- v1.5 (20/07/2026): top-up de mocks das pernas COBERTAS — fontes da métrica
     dentro das do widget (inclusive "todas as fontes") recebem os mocks de
     Data Reunião via fetch is_mock=true no engine (§4.1; invariante 9). -->
<!-- v1.4 (19/07/2026): fuso da fonte (0079/0080) — data_sources.timezone;
     datetimes ingeridos normalizam p/ Brasília na entrada (§4.5); nova
     invariante 11. -->
<!-- v1.3 (19/07/2026): sub-fontes (0078) — fonte derivada de uma pai, recortada
     por um filtro, com data própria; resolvida no engine (§4.8) sem tocar nas
     RPCs; nova invariante 10. -->
<!-- v1.2 (18/07/2026): fontes por métrica (Metric.sources) — universo de
     cálculo próprio por métrica via "pernas" no engine (§4.1); nova invariante
     em §5 (nunca resolver fonte por métrica no RPC). -->
<!-- v1.1 (18/07/2026): edição inline reconcilia no cliente (célula otimista +
     refresh debounced + realtime) em vez de revalidatePath por edição; badge
     de write-backs pendentes em /registros. -->


# Arquitetura do sistema

Visão geral para quem vai **manter o sistema manualmente** (sem IA). Este documento
explica o que o sistema é, como as peças se encaixam e — mais importante — as
**invariantes que não podem ser quebradas**. Leia junto com:

- [`banco-de-dados.md`](./banco-de-dados.md) — schema consolidado, funções e RLS.
- [`manual-de-manutencao.md`](./manual-de-manutencao.md) — setup do zero, rotina de
  mudanças seguras e troubleshooting.
- [`../supabase/README.md`](../supabase/README.md) — runbook de aplicação das migrações.
- [`webhooks.md`](./webhooks.md) — referência da API de webhooks (entrada e saída).

## 1. O que é o sistema

Um **construtor de dashboards comerciais** (não um dashboard fixo) para gestão de
leads e negócios de vendas. O usuário monta dashboards por configuração
(fonte → dimensões → métricas → filtros → visual); nenhum widget novo exige código.

O núcleo é a tabela genérica **`records`** — a única fonte de verdade da UI. As fontes
externas apenas a alimentam:

- **Bitrix24** (leads e deals) — sync incremental/retomável via API REST;
- **Planilha "Estudo de Fechamentos"** — push horário via Google Apps Script;
- **CSV** — wizard de importação na página Registros;
- **API de ingestão** (`/api/ingest/<fonte>` + chaves de API) — webhooks de entrada.

> **Terminologia (21/07/2026):** na **UI**, o conceito de fonte de dados do
> sistema (`data_sources`/`sub_sources`) chama-se **"Base"** ("Sub-base",
> "todas as bases") — renomeado para desfazer a ambiguidade com o campo CRM
> **"Fonte"** (SOURCE_ID do Bitrix → `custom_fields.fonte`, que mantém o nome).
> No código, no schema e nesta documentação o termo interno segue sendo
> "fonte"/"sub-fonte" — só os rótulos visíveis mudaram.

## 2. Stack e infraestrutura

| Camada | Tecnologia | Onde |
|---|---|---|
| Framework | Next.js 16 (App Router, RSC, TypeScript 5, React 19) | `app/`, `next.config.ts` |
| Banco/Auth | Supabase (Postgres + Auth + RLS) | `lib/supabase/{browser,server,service}.ts` |
| UI | Tailwind CSS v4 + shadcn/ui (Radix) + lucide-react | `components/ui/` |
| Gráficos/Grid | Recharts 3 + react-grid-layout 2 | `components/dashboards/charts/`, `dashboard-grid.tsx` |
| CSV | papaparse | `lib/import/csv.ts` |
| Deploy | Vercel (plano Hobby — rotas com teto de 60s, `maxDuration = 60`) | push → deploy automático; CI versionado em `.github/workflows/ci.yml` (lint + typecheck + testes) |
| Testes | Vitest (unidades puras + componentes jsdom + engine com cliente fake + guarda estática de paridade RPC) · Playwright (`e2e/`) · paridade RPC EXECUTADA (`tests/live/`, stack Supabase local) | `npm test` sem banco; `test:e2e`/`test:live` com o stack local (manual §2.1) |
| Agendamento | `pg_cron` + `pg_net` **dentro do Postgres**, chamando rotas da Vercel | `supabase/apply/pg-cron-*.sql` |

Pontos não-óbvios (conhecimento tribal — não descubra do jeito difícil):

- **No Next 16 o "middleware" chama-se `proxy`** — o arquivo é `proxy.ts` na raiz,
  não `middleware.ts`.
- **Não existe `.env.local`.** As variáveis vivem nas Environment Variables da
  Vercel e no painel do Supabase. `.env.example` é o checklist comentado;
  `lib/env.ts` falha com erro claro em runtime se faltar variável.
- **O código nunca conecta ao banco em build/deploy.** Toda migração é SQL aplicado
  manualmente no SQL Editor do Supabase (ver `supabase/README.md`).
- **Testes e CI (24/07/2026).** `npm test` roda o Vitest SEM banco: unidades
  dos módulos puros (colocated `lib/**/*.test.ts` — datas/fuso, dias úteis,
  período, fórmulas, calc-metrics, sub-fontes, regra 0052, import de IA), a
  **guarda estática de paridade das RPCs** (`tests/rpc-parity.test.ts`,
  espelho executável da invariante 1), **componentes** em jsdom (opt-in por
  arquivo — FormulaEditor/preview, badges, Combobox) e o **engine com
  cliente Supabase FAKE** (`tests/helpers/fake-supabase.ts`, mesmo shape do
  snapshotClient — pernas por métrica, correspondências por perna,
  businessDayAlign, comparação, top-up de mocks, aux de operando @fonte). O CI
  (`.github/workflows/ci.yml`) tem dois jobs: `verify` (lint + typecheck +
  `npm test`) e `e2e` — sobe um **stack Supabase LOCAL** (CLI pinado; as
  migrações dependem só de pgcrypto), semeia dados determinísticos
  (`scripts/e2e-seed.ts`), roda os smokes SSR do Playwright (`e2e/`: login,
  dashboard, viewer público `/s/[token]`) e a **paridade EXECUTADA das RPCs**
  (`tests/live/rpc-parity-live.test.ts`: mesma config nos dois lados, snapshot
  sem restrições → resultados devem ser IDÊNTICOS). Segue SEM cobertura:
  widgets de gráfico/grid (ResizeObserver), kanban/agenda no viewer. As
  queries de conferência do `supabase/README.md` continuam valendo.

## 3. Mapa de pastas

```
app/
  (auth)/login/          Login email/senha (não há signup público)
  (app)/                 Área autenticada
    page.tsx             Home = lista de dashboards
    dashboards/[id]/     Página do dashboard (orquestra a leitura dos widgets)
    kanbans/[id]/        Kanbans dedicados (reusam dashboards com kind='kanban')
    kanbans/w/[widgetId] Página cheia de um WIDGET kanban (mesma config/placements
                         do widget; barra de período própria — ignora o pai)
    registros/           Grid de dados por fonte + importação CSV + painel de sync
                         + bases/ (config das bases, ex-/configuracoes/fontes)
                         + log/ (sincronizações/write-back, ex-/configuracoes/log)
    tarefas/             Tarefas standalone
    campos/              Colunas dinâmicas + correspondências (admin) + aba
                         Moedas (ex-/configuracoes/moedas)
    configuracoes/       acessos, conta, integracoes, metas, operacoes,
                         organizacao, presets, responsaveis, snapshots, tema,
                         usuarios
  s/[token]/             Viewer PÚBLICO de snapshots (única rota sem auth além do login)
  api/
    ingest/[source]/     Webhook de entrada (chaves de API)
    sync/                tick, bitrix-backfill, bitrix-reconcile, recalc-daily, sheets
    snapshots/tick/      Refresh agendado de snapshots
    webhooks/tick/       Drenagem do outbox de webhooks de saída
lib/
  widgets/               O CORAÇÃO: engine.ts, types.ts, period.ts, period-resolve.ts,
                         calc-metrics.ts, currency.ts, mock-reuniao.ts, widget-scope.ts, ...
  records/               formulas.ts (motor de fórmulas), recalc.ts, matching-engine.ts
  sync/bitrix/           Adaptador Bitrix: sync.ts, mapper, catalog, writeback, runner
  snapshots/             db-adapter.ts (client fail-closed), refresh.ts, token.ts, schedule.ts
  import/                ingest.ts (motor único de ingestão), csv.ts
  webhooks/              Eventos de saída, assinatura HMAC, retenção
  auth/, config/, metas/, kanban/, tasks/, agenda/, comments/, export/, crypto/
components/
  dashboards/            widget-builder.tsx, charts/widget-chart.tsx, widget-card.tsx,
                         dashboard-grid.tsx, dashboard-client.tsx, ...
  registros/, kanban/, snapshots/, configuracoes/, campos/, importacao/, ui/ (shadcn)
supabase/
  migrations/            0001–0074 (SQL manual, idempotente)
  apply/                 Blocos consolidados por fase + scripts pg-cron + undo
integrations/apps-script/  push_estudo_fechamentos.gs (setup no cabeçalho do arquivo)
docs/                    Este documento e os demais
```

Server Actions ficam colocalizadas com as páginas (`actions.ts` por pasta).

## 4. Fluxos principais

### 4.1 Widgets e o RPC `run_widget_query`

O subsistema mais crítico. A config do widget (JSONB: `p_source`, `p_dimensions`,
`p_metrics`, `p_filters`, `p_correspondences`) é enviada à função PL/pgSQL
`run_widget_query`, que **monta SQL dinâmico** (SELECT/GROUP BY/WHERE) contra
`records`, com:

- whitelist de colunas (nada de injeção via config);
- campos custom (`custom:<key>` em `records.custom_fields`) e **unificados**
  (`unified:<key>` = coalesce das colunas correspondidas entre fontes);
- buckets de data (dia/semana/mês/`month_name`/`weekday`...) — a chave canônica
  do bucket **DEVE bater com `canonicalBucketKey`** no cliente;
- filtros sintéticos `@period` (barra de período) e `@rate_date`;
- agregações (sum/avg/count/count não-vazio/min/max) e conversão de moeda.

O lado TypeScript é `lib/widgets/engine.ts` (chama o RPC, resolve rótulos de FK,
pós-processa). A função foi **recriada 18 vezes** ao longo das migrações — a versão
vigente é a da migração `0085_widget_rpc_brasilia_day.sql`.

**Duas camadas de client em volta do RPC (26/07/2026):** toda page que computa
widgets envolve o client em `withRpcMemo(withRpcTtlCache(...))`
(`lib/widgets/rpc-memo.ts` + `lib/widgets/rpc-cache.ts`). O memo dedupa args
idênticos dentro de UM render; o cache TTL (default 45s, env
`WIDGET_RPC_CACHE_TTL_MS`, `0` desliga) reusa resultados ENTRE requisições da
mesma instância serverless — F5/navegação/segundo viewer do mesmo dashboard
custam ~0 ao banco dentro da janela. A chave é prefixada pelo ESCOPO DE
AUTORIZAÇÃO (`u:<userId>` na page — o RPC é SECURITY INVOKER e a tradução de
operação é por usuário; `s:<snapshotId>` no viewer público) — entradas nunca
cruzam escopos. Erros não ficam em cache; `structuredClone` na leitura (o
engine muta rows in place). É melhor esforço (instâncias não compartilham o
store) e implica staleness de até o TTL após sync/edição — aceitável, o
reconcile é horário.

**Merge por bucket p/ dimensão `custom:` + transform (23/07/2026):** o ramo
`custom:` da DIMENSÃO no RPC agrupa pelo VALOR CRU de `custom_fields->>key`
(o transform é só rótulo) — valores com hora viravam um grupo POR REGISTRO
(barras/chips duplicados, incl. snapshots). O engine funde as linhas pelo
bucket no retorno de `computeRows` (`lib/widgets/bucket-merge.ts` — choke
point único: principal/comparação/pernas do align/card/quick-table/snapshot),
com a semântica do Total geral: sum/count somam, min/max reduzem, calculadas
reavaliam sobre `foldBasis`, monetárias fundem `__money` e replotam (exato
até p/ média — o breakdown carrega count). A dim fundida grava o valor
CANÔNICO estilo-núcleo (`bucketCanonicalValue`, byte-compatível com o
`date_trunc`/`extract` das colunas core), o que alinha ordenação
cronológica, casamento ordinal da comparação e a regex mensal do goalLine.
ÚNICA aproximação: média SIMPLES não-monetária = média das médias (a linha
do RPC não carrega peso — mesma limitação do Total geral). RPCs INTOCADAS
(não aciona a invariante 1).

**Dia de Brasília no read side (0085):** a sessão do banco é UTC, então colunas
`timestamptz` do núcleo (`source_created_at`…) comparadas a literais naive
deslocavam o limite do dia em 3h, e o `date_trunc` bucketizava registros de
21h+ BRT no dia/mês seguinte — divergindo do cliente (prefix-based). Desde a
0085: bounds do `@period` em coluna do núcleo ganham offset explícito
(`-03:00`) DENTRO do RPC (e no client — ver §4.2); todo transform de data passa
por `_widget_local_ts` (overload timestamptz → wall time de
America/Sao_Paulo; overload text → prefixo de 10 chars, byte-igual ao
`parseYmd`); e o coalesce textual dos unificados serializa coluna de data do
núcleo via o mesmo helper. Comparações de campos **custom seguem textuais e
byte-idênticas** (valores já normalizados p/ `-03:00` na entrada — invariante
11). `transform: none` em coluna crua do núcleo/match ainda serializa em UTC
(agrupamento por instante é bijetivo; só o rótulo cru — follow-up conhecido).

**Fontes por métrica (`Metric.sources`, 18/07/2026):** o universo de LINHAS/
dimensões/registros de um widget é sempre `widgets.sources`; cada métrica pode
opcionalmente declarar as próprias fontes (`sources` no jsonb `widgets.metrics`)
e passa a ser calculada sobre elas — super/subconjunto ou disjunto do widget
(ex.: linhas só de Deals + conversão contando Leads E Deals). Implementação
inteira no engine (`lib/widgets/metric-sources.ts`): a métrica vira uma "perna"
— chamada RPC separada com o pipeline de filtros (segmentação por fonte,
`@period` byType e `record_type in (...)`) reconstruído para as fontes DELA —
mesclada às linhas da principal por tupla de dims. Grupos que só existem nas
fontes extras não viram linha; grupo ausente na perna: contagem 0, demais "—".
A basis das calculadas de perna vai em `WidgetRow.__calcOpsBy` (por métrica;
os renderizadores leem `__calcOpsBy[key] ?? __calcOps`). No modo registros, o
fetch extra (`runRecordListWithExtras`) traz os registros das fontes que
faltam SÓ para a basis dos subtotais (nunca como linha; a regra dos mocks do
fetch extra inspeciona as métricas das pernas). Pernas com fontes JÁ COBERTAS
pelo widget (subconjunto das fontes dele, inclusive widget em "todas as
fontes") reusam os registros de exibição — cuja regra dos mocks nunca vê as
métricas das pernas — e recebem um **top-up de mocks** (20/07/2026,
`runCoveredLegMockTopUp` em `lib/widgets/record-list.ts`): fetch só de
`is_mock = true` com o mesmo pipeline, mesclado ao stream de extras nos dois
caminhos client-side (`runWidgetByPeriod` e `runRecordListWithExtras`), com
gates que exigem que a config das pernas referencie Data Reunião
(`recordListIncludesMocks`) e que a exibição NÃO tenha servido os mocks (senão
duplicaria). Assim "fonte na métrica" = "fonte no widget" também nos caminhos
sem RPC — mocks na basis sem virar linha. Restrições `allowed_sources`
de snapshot podem excluir fontes de uma métrica — ela degrada para "—"
(comportamento documentado, não é bug). KPI razão ignora
`numerator/denominator.sources` no v1.

**Janela incremental do modo lista full-fetch (26/07/2026):** listas
inelegíveis à paginação server-side (`serverPaginatedList` false — agrupadas/
ordem manual/sort exótico) e sem `settings.limit` não buscam mais o conjunto
inteiro: a page carrega a 1ª janela (default 1000, env `RECORD_LIST_WINDOW`,
`0` = teto desligado) via `runRecordListWindow` (`record-list.ts` v2.0 —
offset + count exato, desempate estável por `id`) e o WidgetCard anexa as
próximas com "Carregar mais" (`fetchWidgetRecordsWindow`, mesmo recorte via
widget-scope — invariante 12). Grupos/subtotais/busca client-side valem sobre
o CARREGADO (rodapé avisa "grupos e totais parciais"). Exceções que mantêm o
full fetch: pernas de `Metric.sources` (basis dos subtotais precisa do
conjunto completo), filtro `@bucket` (pós-fetch — offset/count do servidor
não valem) e o viewer de snapshot (dataset congelado + pós-filtro de
`partner_only` quebraria o total; payload já limitado na captura). Export CSV
do widget = janelas carregadas; export server-side segue completo.

### 4.2 Filtros de período

`lib/widgets/period.ts` + `lib/widgets/period-resolve.ts`. O período efetivo de cada
widget combina: **barra global** (URL > preferência do usuário > config do dashboard),
escopo por aba e **widgets de filtro de período** que sobrescrevem alvos vinculados.
A mesma lógica roda na página do dashboard, na action da Tabela Rápida e no viewer de
snapshot — foi extraída para um módulo puro justamente para não divergir. O escopo
do widget é **reconstruído no servidor** (`lib/widgets/widget-scope.ts`) — nunca se
confia em config vinda do client.

**Alvos do filtro de período (26/07/2026):** o vínculo é DINÂMICO, espelho do
filtro_campo — `settings.excludedTargets` guarda os widgets DESMARCADOS na
edição e o alvo efetivo é "todos os widgets de dados menos estes" (widget novo
entra sozinho). A whitelist LEGADA `settings.targets` (ids congelados no save)
segue honrada quando `excludedTargets` está ausente — snapshots congelados a
guardam; ramo permanente em `computeWidgetPeriods`. Re-save no editor migra
(grava `excludedTargets` e apaga `targets`); runbook p/ migrar em massa:
`supabase/apply/backfill-filter-targets.sql` (rodar só APÓS o deploy).

Fontes dinâmicas (`data_sources`, criáveis via UI sem migração) precisam estar
cobertas no mapa `fieldBySource` do resolver — o `@period` do RPC **exclui**
`record_types` fora do mapa.

**Bounds ancorados no dia de Brasília (0085):** quando o campo de período é
coluna do núcleo (`CORE_DATE_COLS`, espelho do `v_date_cols` do RPC), os bounds
saem com offset explícito (`anchorCoreDateBound`: from → `T00:00:00-03:00`,
to → `T23:59:59-03:00`; idempotente) em TRÊS pontos: caminho uniforme do
`applyPeriodToFilters` (period.ts), filtros salvos gt/gte/lt/lte em
`resolveFilters` (engine.ts — choke point do RPC E do modo lista) e o ramo
`@period` do PostgREST (record-list.ts). Campos custom ficam NAIVE de
propósito: a comparação é textual e um offset no lower bound excluiria valores
date-only. O sentinel `@period` (caminho misto) viaja naive — RPC e record-list
ancoram POR COLUNA ao expandir o byType.

### 4.3 Snapshots públicos (`app/s/[token]`)

Congela uma aba de dashboard num link público:

- token de 256 bits vive **só na URL**; o banco guarda apenas o sha256
  (`snapshots.token_hash`);
- `proxy.ts` isola `/s/*` (sem `getUser`, com `Referrer-Policy: no-referrer` e
  `X-Robots-Tag: noindex`);
- a página valida o token via **service role** e lê exclusivamente por
  `lib/snapshots/db-adapter.ts` — client **fail-closed** que bloqueia qualquer
  tabela/RPC fora do conjunto do snapshot;
- os dados congelados vivem em `snapshot_records` (cópia atômica via
  `snapshot_refresh_copy`), consultados pela RPC gêmea `run_widget_query_snapshot`;
- `snapshots.default_period` (0059) reaplica no viewer o período que o dashboard
  tinha na criação — é filtro de **consulta**, não restrição;
- refresh agendado via `POST /api/snapshots/tick` (pg_cron a cada 5min).

### 4.4 Mocks de "Data Reunião"

302 leads fictícios (270 Inbound + 32 Outbound; `records.is_mock`, migrações
0051/0053) com uma regra peculiar: **só contam em consultas que referenciam o campo
Data Reunião** (chaves `bitrix_uf_crm_1743441331` — Lead — e
`bitrix_uf_crm_67eacefcccd98` — Negócio), direto ou via campo unificado. Qualquer
outra consulta os ignora por construção.

A detecção é **textual por substring** e existe em **três lugares que precisam ficar
idênticos**:

1. `run_widget_query` (SQL, 0052+);
2. `run_widget_query_snapshot` (SQL, 0057+);
3. `lib/widgets/mock-reuniao.ts` (TypeScript, client-side).

**A regra só remove o gate `not is_mock`** — ela NÃO isenta os mocks dos
demais predicados do WHERE (filtros do widget, predicado de sub-fonte via
`_widget_wrap_record_types`, tudo em AND puro). Consequência prática: um mock
precisa CARREGAR os campos usados na segmentação das sub-fontes que devem
contá-lo. A 0084 dá `custom:fonte = "Formulário de CRM"` aos 270 mocks
Inbound (lote 0051) para satisfazerem a sub `sqls` do preset
(`custom:fonte in (…)`); os 32 Outbound (0053) ficam SEM fonte de propósito —
não podem vazar no SQL Inbound — e receberão a deles com o preset Outbound.
(As subs mqls/sals não passam a contá-los: consultam por `source_created_at`,
NULL nos mocks, e sem referência a Data Reunião o gate `not is_mock` segue
ativo.)

Um trigger no banco (`enforce_reuniao_freeze`) **congela o campo**: sync, recálculo e
edição não conseguem gravar Data Reunião anterior a 01/06/2026 (tentativas são
descartadas em silêncio; pode gerar ruído inofensivo no `audit_log`). Undo previsto:
`supabase/apply/undo-mock-reuniao.sql`.

### 4.5 Sincronização e ingestão

Todos os caminhos de entrada convergem no motor único `lib/import/ingest.ts`
(`ingestRows`): upsert idempotente por `(source_system, source_id)`, dedup por hash e
**conflito por campo** — `records.field_modified_at` guarda o timestamp de cada edição
manual, e o sync **não sobrescreve** campos editados manualmente (campos calculados são
exceção: sempre recomputados).

- **Bitrix**: backfill/reconcile resumíveis por cursor (`sync_jobs`, uma página por
  requisição — cabe nos 60s da Vercel). O tick por minuto (`/api/sync/tick`, via
  pg_cron) drena a fila de write-back (`bitrix_writeback_queue`), avança o job ativo
  e dispara um reconcile automático a cada ≥1h. IDs viram nomes em
  `lib/sync/bitrix/lookups.ts` (etapas, enums, usuários, empresas e — desde a 0075 —
  origens: `SOURCE_ID` → campo `fonte`, resolvido via `crm.status.list`
  `ENTITY_ID='SOURCE'`). "Implementação" (`implementacao`) é sincronizado de
  `UF_CRM_1778094396888` desde a 0075 (antes era campo local dos presets).
- **Fuso da fonte (0079)**: `data_sources.timezone` (IANA, ex. `Europe/Moscow`;
  editável em Registros → Bases) declara o fuso em que a ORIGEM expressa
  datas/horas. O mapper do Bitrix normaliza valores **datetime** para
  America/Sao_Paulo na entrada (`lib/date/normalize.ts`) — o read side inteiro é
  prefix-based (lê o `YYYY-MM-DD` literal), então sem a conversão uma reunião às
  18h+ BRT cai no dia seguinte (Moscou = BRT+6). Campo Bitrix tipo `date`
  (calendário puro, ex. `data_assinatura`) NUNCA converte — recuaria um dia.
  Date-only e fontes sem `timezone` passam inalterados. Backfill dos valores
  antigos: 0080 (chaves datetime explícitas; o resto normaliza no próximo
  Backfill do sync). CSV/API não carregam offset (`coerceDate` emite naive) —
  não são afetados. Desde a 0085, as colunas `timestamptz` do NÚCLEO também
  leem no dia de Brasília (bounds ancorados + `_widget_local_ts`, §4.1) — os
  dois regimes (texto custom e instante do núcleo) finalmente concordam no
  mesmo dia.
- **Sheets**: o Apps Script (`integrations/apps-script/push_estudo_fechamentos.gs`)
  faz POST horário em `/api/sync/sheets`, protegido por `SYNC_SECRET`.
- **API/webhooks de entrada**: `/api/ingest/<fonte>` com chaves de API
  (`api_keys`, hash sha256) — ver `docs/webhooks.md`.
- **Write-back**: campos com `field_definitions.write_back = true` editados no app
  entram na fila e são gravados de volta no Bitrix pelo tick. A edição nunca
  espera o Bitrix; /registros mostra um badge "N aguardando envio"
  (`components/sync/writeback-pending-badge.tsx`) com link para o Log.

### 4.6 Papéis, permissões, RLS e MULTI-ORGANIZAÇÃO (0088–0094)

**Organizações (tenants):** o sistema atende N empresas isoladas no MESMO
banco/deploy. `organizations` guarda o branding editável (`app_name`/`name`,
exibidos no sidebar/título — Configurações → Organização);
`organization_members` vincula usuários (flag `is_org_admin` = Administrador
de Organização, ÚNICO por org e protegido por trigger); `app_owner` é o Owner
do sistema (1 linha; + env `OWNER_USER_ID`; guard fail-closed em
`lib/auth/owner.ts`). Isolamento: `organization_id` nas tabelas-raiz (default
Zapper; triggers de stamp cobrem sync/CSV/API) + RLS org-gated em TUDO
(`auth_org_ids()` prefixado, inclusive nos ramos admin) — as RPCs de widget
são SECURITY INVOKER e herdam sem serem tocadas (invariante 15). A org ATIVA
é um cookie httpOnly SEMPRE revalidado contra membership (`lib/auth/org.ts`);
pós-login, usuário comum entra direto e Owner/multi-org escolhe em
`/escolher-organizacao`. O console `/owner` (só o Owner) cria org (admin = o
próprio ou conta nova; `seed_org_defaults` — org nasce VAZIA) e exclui
(`delete_organization`; a org inicial só via SQL direto).

Três papéis de APP (`roles` + `user_roles`, POR org desde a 0092): **admin**
(tudo NA org), **gestor** (vê tudo, edita), **vendedor** (só os próprios
registros). Permissões-chave: `view_all_records`, `edit_record_values`,
`manage_field_definitions`, `view_forecast`. Só o org_admin concede/remove o
papel `admin` (`auth_can_grant_admin`). org_admin/Owner NÃO são linhas de
`roles` (`SPECIAL_ROLE_LABELS` é só rótulo).

**Acesso por pessoa aos boards (⋮ → Acesso, 0088):** `board_access` guarda
`view`/`edit`/`blocked` por usuário×board — override vence o papel
(`visible_to_roles` segue como camada por função); dono/admin nunca
bloqueáveis. Resolução ÚNICA nos helpers `auth_board_visible/editable/
manageable` (policies de dashboards/widgets/células/placements); as pages só
refletem (`canEdit`/`canConfig`).

**Overrides individuais (Configurações → Acessos, 0094):**
`user_access_overrides` concede (allow) ou revoga (deny) por usuário — áreas
de Configurações (deny esconde a aba/page E barra a ESCRITA das server actions
via `isSettingsAreaDenied`; allow concede só a VISUALIZAÇÃO além do papel, nunca
a escrita, que segue o papel) e bases (deny some dos pickers via RLS de
`data_sources` e dos DADOS via `records_select`). Fonte única dos gates por
área: `AREA_GATES` (`lib/auth/access.ts`); guard `requireSettingsArea` nas
sub-pages, `isSettingsAreaDenied` nos guards de escrita das actions;
`checkSettingsArea` é a variante sem redirect (condiciona LINKS, ex.:
botões Bases/Log no header de Registros). **As chaves de área são HISTÓRICAS
e desacopladas da rota** (27/07/2026): `fontes` vive em `/registros/bases`,
`log` em `/registros/log` e `moedas` na aba Moedas de `/campos` — NUNCA
renomear uma chave (os overrides gravados a referenciam); a matriz de Acessos
mostra a nova casa no rótulo ("Bases (Registros)" etc.). Estreitamento aceito
em Moedas: as taxas eram visíveis a qualquer autenticado; hoje só quem chega
a `/campos` (`manage_field_definitions`) as vê — o deny de `moedas` esconde a
aba e segue barrando a escrita.

**Escopo de BASES por board (⋮ → Bases, Fase 1 desta entrega):**
`DashboardSettings.sourceScope` define o catálogo EFETIVO do board —
`applySourceScope`/`collectBoardSourceKeys` (`lib/config/source-scope.ts`)
recortam as ofertas dos pickers E o universo dos widgets em "todas as bases",
preservando fontes já referenciadas (config antiga nunca quebra). Aplicado na
page do dashboard (re-provê `<SourcesProvider>` escopado), page do kanban,
`loadWidgetScope` (invariante 12), kanban-actions, snapshot-form e viewer
público. É restrição de OFERTA por board, não autorização (autorização é o
deny por usuário da 0094).

Helpers SQL (`auth_roles`, `auth_has_role`, `auth_has_permission`,
`auth_responsible_ids`) são SECURITY DEFINER e, desde a 0068, **sempre chamados como
`(select ...)`** nas policies (InitPlan — uma avaliação por statement, não por linha).

**A visibilidade de `records` segue o vínculo vivo** `records.responsible_id →
responsibles.user_id` (0037) — não o `owner_user_id` histórico, que é legado e não
deve ser usado para autorização. Reatribuir um registro ou vincular usuário a
responsável muda a visibilidade na hora, sem re-sync.

Tabelas de segredos (`api_keys`, `webhook_endpoints`, `snapshots`, `sync_jobs`) têm
RLS ligado com **zero políticas de escrita** — escrita só via service role.

### 4.7 Outros subsistemas

- **Tema visual (27/07/2026):** modo claro/escuro/sistema + cor de destaque
  (`--brand*`, default `#7431B3`), configurados em Configurações → Tema.
  Precedência: preferência do USUÁRIO (`user_settings.settings.theme/
  accentColor`) ?? padrão da ORG (`organizations.theme`, 0108 — só org_admin
  edita) ?? padrão do app — resolvida SÓ por `resolveTheme` (`lib/theme.ts`,
  também dono das whitelists de sanitização; nada cru de cookie vai a
  style/script). Os cookies `theme_mode`/`theme_accent` guardam os valores
  EFETIVOS: o root layout (`app/layout.tsx`) os lê e aplica `--brand-base` no
  style do `<html>` (portais Radix herdam) + a classe `.dark` via script
  inline pré-paint (sem FOUC); `ThemeSync` (layout autenticado) reconcilia
  cookie × banco (dispositivo novo/padrão da org alterado). O viewer público
  `/s/*` NUNCA escurece (cores congeladas foram escolhidas no claro — o
  script ignora o prefixo). Tokens em `app/globals.css`: `--brand` clareia no
  `.dark` via `color-mix`; `--ring` aponta p/ `--brand`; `bg-brand`/
  `text-brand`/`border-brand` via `@theme inline`. A cor entra SÓ em detalhes
  sutis (abas ativas, chips, foco, seleção, checkbox, barras de progresso,
  affordances de edição do grid) — `--primary` (botões/badges) segue quase
  preto. Cores SALVAS pelo usuário em widgets (seriesColors, notas, paletas
  fixas) ficam literais — limitação documentada, não bug.
- **Metas** (`goals`): escopo global/operação/responsável; comunicam-se por
  **roll-up na leitura** (`lib/metas/`); operações aninham via
  `parent_operation_id` + `operation_subtree`. Métricas de meta são chaves do
  registry (`lib/metas/metrics.ts` + `sync_config` `goal_metrics`) — arbitrárias
  desde 20/07/2026 (ver §4.9).
- **Operações como SEGMENTO (20/07/2026):** `records.operation_id` é uma cópia
  DERIVADA (operação priority=1 do responsável no momento do sync; update só
  preenche quando NULL) — pode estar NULL/defasada. Por isso o **filtro de
  Operação da visualização** (filtro_campo/filtro rápido) NUNCA compara a
  coluna literal: a page e o widget-scope resolvem no server
  (`lib/config/operation-scope.ts`) para `responsible_id in (vínculo vivo da
  subárvore — responsible_operations, qualquer priority)` + os **FILTROS DE
  PERFIL** da operação (`operations.filter`, 0083 — WidgetFilter[] com
  fonte-alvo opcional por condição, editados em Configurações → Operações;
  listas de exclusão serializam como `neq_ci` por valor, null conta). Com 2+
  operações selecionadas aplica-se só a união dos vínculos (perfis de
  operações diferentes não se combinam em AND). Dimensões/agrupamentos "por
  Operação" e restrições de snapshot seguem na coluna derivada — rode
  `supabase/apply/backfill-operation-id.sql` após mexer nos vínculos.
- **Persistência do "Filtro por campo" POR USUÁRIO (20/07/2026):** o estado
  vivo continua na URL (`ff_<widgetId>`), mas o debounce do
  `FieldFilterControls` também grava
  `user_preferences.settings.lastFieldFilters[widgetId]`
  (`saveLastFieldFilter`; valor vazio LIMPA a chave — filtro removido não
  ressuscita). Ao abrir o dashboard SEM o parâmetro na URL, page e
  `widget-scope` reidratam desse mapa (**URL sempre vence**) e a page manda o
  seed ao cliente (`fieldFilterSeedById`) p/ os controles montarem
  preenchidos — o primeiro debounce só ESPELHA a URL com
  `history.replaceState` raso (integrado ao router; sem navegação RSC nem
  persistência: o servidor já aplicou o seed). Navegar na montagem recomputava
  o dashboard à toa e, sob rajadas de `router.refresh()` do realtime (ex.:
  pós-recalc do preset), prendia o overlay "Carregando…" indefinidamente. O
  controle guarda a forma canônica encode∘parse do valor inicial
  (`serverAppliedRef`): `run(router.replace)` + `saveLastFieldFilter` só quando
  `encoded` diverge dela (mudança real do usuário — ou seed que não round-tripa
  numa config antiga dos fields, que precisa mesmo renavegar). Viewer de snapshot:
  URL-only (gate `useSnapshotMode` — visitante não tem sessão e usuário
  autenticado não pode poluir o dashboard vivo). Contraste: filtros rápidos
  do card e a janela de períodos (`__qf__`/`__pw__` em
  `dashboard_table_cells`) são COMPARTILHADOS entre usuários; o filtro por
  campo é preferência INDIVIDUAL por padrão, como o último período
  (`lastPeriod`).
- **Escopo do VALOR do "Filtro por campo" configurável (23/07/2026):**
  `settings.valueScope: "all"` (checkbox "Aplicar filtro para todos os
  usuários" na edição do widget; a chave NÃO pode se chamar `scope` —
  colidiria com `KpiSettings.scope` na interseção `WidgetSettings`) troca a
  persistência per-user pela célula compartilhada `__ff__`/`sel` de
  `dashboard_table_cells` (`saveSharedFieldFilter`; value = a MESMA string
  codificada de `ff_`/`lastFieldFilters`; mesma RLS/semântica do `__qf__` —
  quem muda o filtro muda para todos; propagação eventual, no próximo
  re-render RSC do outro viewer). No modo shared o cliente NÃO escreve a URL
  (transporte = banco, padrão `QuickFiltersBar`; espelhar a URL pinaria cada
  viewer no valor do mount) e ressincroniza do seed do servidor
  (`fieldFilterSeedById`, agora vindo da célula); um `ff_` residual de
  bookmark é honrado naquele render (URL ainda vence no servidor) e removido
  na primeira edição. Alternar para "all" deixa as entradas
  `lastFieldFilters` INERTES (nunca apagadas); voltar a "user" ignora (não
  apaga) a célula. `__ff__` fica fora do Desfazer/Refazer (como `__qf__`) e o
  viewer de snapshot segue URL-only por visitante. Ausente/`"user"` =
  comportamento per-user acima, byte-idêntico.
- **Opções visíveis dos dropdowns de filtro (22/07/2026):** `hiddenOptions`
  (blacklist por entry em `FieldFilterEntry`/`QuickFilterEntry`,
  `widgets.settings` jsonb — sem migração) oculta opções dos dropdowns do
  Filtro por campo (responsável/operação/etapa/campos `selecao`, inclusive a
  lista do op `in`) e dos filtros rápidos de responsável/operação (buckets de
  data ficam de fora — `cleanQuickFilters` descarta a chave p/ outros campos).
  SÓ exibição: nunca entra na consulta ("— todos —" segue sem filtro); valor
  selecionado que ficou oculto SEGUE aplicando e permanece na lista (conjunto
  `keep`) até o usuário trocar; opção nova (novo responsável, options do
  pipeline reescritas no sync) entra visível por padrão. A filtragem é no
  CLIENTE (`lib/widgets/hidden-options.ts`, aplicada em
  `field-filter-controls`/`quick-filters-bar` DEPOIS da decisão dropdown×texto
  pela lista crua — "tudo oculto" nunca degrada p/ input livre) — o viewer de
  snapshot herda de graça (settings congelados em `cfg.widgets`). O picker
  "Opções visíveis" do construtor (`VisibleOptionsPicker`,
  widget-builder-rows) carrega as candidatas lazy: `selecao` sai das defs
  locais; responsável/operação/etapa via `listFilterOptionCandidates`
  (dashboards/actions — espelha as consultas de opções da page, RPC existente;
  nenhum RPC novo); valores da blacklist que sumiram da lista aparecem como
  "(valor antigo)" p/ limpeza; trocar o campo/op zera a blacklist.
- **Presets de dashboard** (`lib/presets/definitions.ts` + `applyPreset`/
  `generatePresets` em `app/(app)/dashboards/actions.ts`, motor v2 20/07/2026):
  `PresetDashboard` declara settings completos (abas, periodBar/fieldBySource,
  canvas, background), widgets com `WidgetSettings` completo e dependências
  (campos — inclusive CALCULADOS com `formula`/`applies_to`, que disparam
  `recalcAllFormulaFields` best-effort ao serem criados —, sub-fontes e
  CORRESPONDÊNCIAS `PresetCorrespondence` — criadas após as subs, com o
  `record_type` dos membros resolvido pelo catálogo; chaves de métrica de meta
  são registradas no registry). Aplicação IDEMPOTENTE: dashboard identificado
  por `settings.preset.key` (adoção por nome p/ legado), widgets por
  `settings.presetKey` com UPDATE in-place (ids preservados →
  conectores/links/células sobrevivem), GC dos presetKeys órfãos do próprio
  preset; widgets sem `presetKey` e sub-fontes/campos/correspondências já
  existentes NUNCA são tocados. UI: **Configurações → Presets**
  (`configuracoes/presets/page.tsx` + `presets-manager.tsx`) — status por
  preset (marcador `settings.preset`) e botões Gerar/Atualizar (por preset e
  global). **Preset "Inbound"** (`lib/presets/inbound.ts`, v5 21/07/2026):
  porta as abas inbound do dashboard legado de pré-vendas — 7 sub-fontes com
  data própria (SQLs por Data Reunião aciona os mocks 0052; a sub `sals`
  segue existindo SEM cards desde a v5), campo calculado `mrr_contrato`,
  correspondências `data_ref`/`fonte_venda`/`mrr_venda` e 20 widgets (TODOS
  os cards com badge `previous_period_bd` — inclusive os de fórmula e o de
  razão, ver §4.9; SQL total/% de conversão via Card fórmula com operandos
  escopados, Mês x Mês com `periodWindow` (dropdown de janela, padrão 6
  meses) + `businessDayAlign` + `goalLine` métrica `sql` em modo pace, coorte
  via dimensão `match:`). Desde a v5 a identidade VISUAL é dado do preset:
  `settings.background` cinza `#E9ECEF`, faixa `appearance.kpi.accent` roxa
  `#A98AC0` nos cards, `seriesColors` roxo/verde/âmbar nos gráficos e paleta
  nomeada `inbound` (`lib/widgets/palettes.ts` — matizes da marca
  aprofundados, validados p/ contraste/CVD) nas barras `colorByCategory` e na
  pizza. ATENÇÃO: o update por `presetKey` sobrescreve o `settings` INTEIRO
  do widget gerido — ajustes manuais de aparência em widgets do preset se
  perdem no re-apply. Pré-requisitos de DADO no runbook (manual §4.7).
  **Seções de ORG (31/07/2026):** `PresetDashboard` aceita `operations`
  (árvore ensure-BY-NAME — pais declarados antes dos filhos; existente nunca
  é renomeada/religada; filho com pai não resolvido é pulado com erro),
  `compPlans` (`PresetCompPlan` — plano de remuneração com identidade
  `config.presetKey`, ensure-only: plano existente NUNCA sobrescrito; o
  `config` declarado passa pelo `parseCompPlanConfig` como sanidade e é
  gravado PARSEADO; `memberOperationNames` resolve por nome na org — nome
  ausente PULA o plano com erro em `orgSectionErrors`, nunca plano ligado a
  "todos os ativos"; métricas dos fatores entram no registry como no
  savePlan) e `ensureCompMirror` (chama `ensureMirrorSource` no apply — a
  aba de espelho do preset referencia a key literal `remuneracao`; key com
  sufixo de colisão vira erro visível). `PresetOperation.responsibleNames`
  (v2): vínculos responsável↔operação garantidos a CADA apply —
  ensure-if-absent (`priority = max+1` do responsável; nunca remove nem
  reordena; vínculos manuais intocados; remover permanentemente = tirar do
  preset), nome resolvido por `display_name` exato com preferência à linha
  CANÔNICA (alvo apelido canonicaliza — `loadResponsibleIdByName`). Filtro
  de widget de preset por responsável usa o NOME PURO como valor — resolvido
  pelo ENGINE em runtime como qualquer filtro (§4.10, filtros de relação por
  nome); a antiga sentinela `@responsible:<Nome>` (resolvida no apply) foi
  REMOVIDA em 31/07/2026 — widgets de prod com UUID seguem funcionando
  (passthrough) e o re-apply do preset reescreve para o nome.
  As seções aplicam SÓ com `opts.allowOrgSections`, que APENAS o
  `applyPreset`/`generatePresets` de fábrica passa — os callers do import/IA
  nunca, o que torna o caminho da IA estruturalmente incapaz de criar
  operações/planos. `PresetField.options_source: "responsibles"` (0113)
  declara campo seleção de dropdown VIVO — options reescritas com os
  responsáveis ativos PRINCIPAIS por `refreshResponsibleOptionFields`
  (`lib/config/responsible-options.ts`; chamado no apply, no fim do
  `syncFieldCatalog` — padrão do refresh do `pipeline` — e nas actions de
  Responsáveis; por-org, best-effort, SÓ options; não editar à mão).
  **Preset "Remuneração Variável"** (`lib/presets/remuneracao-variavel.ts`,
  v3 31/07/2026): monta o controle de remuneração do comercial — árvore
  AEs/SDR-BDR (2 raízes + 5 sub-operações) COM os vínculos das pessoas
  (responsibleNames: Gabriella Salles, Daniela Drielsma, Paulo Vitor Santos,
  Marcus Barcelos, Marcos Hernandes), 5 planos (`rv_ae_closer`,
  `rv_ae_full_cycle` com meta em USD, `rv_sdr_inbound_fc` com R$/reunião
  per_unit por volume, `rv_sdr_outbound_fc` e `rv_sdr_outbound_simples` com
  prêmio flat por atingimento — ver §4.18), campos `adicional_ao_mrr` e
  `sdr_reuniao` (dropdown vivo), sub `reunioes_qualificadas` (Data Reunião ×
  "Lead Qualificado"), a base espelho (`ensureCompMirror`) e dashboard de
  CONFERÊNCIA (repasse ao RH) em 5 abas: **Visão geral** = resumo da
  REMUNERAÇÃO sobre o espelho publicado (KPIs folha/comissões/prêmios/
  atingimento com comparação de mês cheio; tabela de conferência por membro
  em MODO REGISTROS — exibe o plano/composição linha a linha, colunas custom
  com `editable: false` EXPLÍCITO porque o legado do modo registros deixaria
  custom editável; "por operação" agrupa por `custom:rem_plano`, 1 plano ↔ 1
  sub-operação — determinístico, ao contrário do `operation_id` derivado);
  **AEs** = valor gerado completo (KPIs de componentes + cards POR PESSOA com
  filtro `responsible_id` pelo NOME + métrica calculada — padrão
  METRIC_SQL_CALC + produção por vendedor); **SDRs** (cards por SDR filtrando
  `custom:sdr_reuniao` por nome + produção creditada por
  `custom:sdr_responsavel`); **Atribuição** (v3) = 1ª records-table de preset:
  tabela sobre `reunioes_qualificadas` com a coluna `custom:sdr_reuniao`
  `editable: true` (Combobox das options vivas — grava o NOME que cards e
  memberField leem; exige `edit_record_values`; mocks de Data Reunião
  aparecem, mesmo universo dos KPIs) + KPIs de pendência (`is_null`/
  `not_null`); **Remuneração** = detalhe do espelho (por pessoa e evolução —
  popula após o 1º Publicar). O payout autoritativo segue em Configurações →
  Remuneração. Compartilha com o Inbound as declarações de `mrr_contrato`,
  `vendas_assinadas`/`vendas_site` e `data_ref`/`mrr_venda` (consts
  exportadas — declaração única, sem drift). Fiscalizado por
  `lib/presets/remuneracao-variavel.test.ts` (planos parseiam; fórmulas
  validam no catálogo agregado REAL; prefixo/unicidade de presetKeys; ordem
  pais→filhos; vínculos/filtros-por-nome/abas pinados; tabela de atribuição
  editável e conferência read-only pinadas).
- **Moedas** (`currencies`/`currency_rates`, `lib/widgets/currency.ts`): conversão
  BRL/USD por taxas **ano/trimestre** (PTAX), com breakdown por moeda; agregações
  não-lineares (min/max monetário) exibem o valor cru, sem breakdown.
- **Matching entre fontes** (`match_rules`/`record_matches`,
  `lib/records/matching-engine.ts`): casa registros de fontes diferentes (ex.: venda
  do site ↔ lead de origem por e-mail); o RPC expõe campos do registro casado.
- **Campos calculados** (`field_definitions.formula`, `lib/records/formulas.ts`):
  materializados em `records.custom_fields`; recalc diário via
  `/api/sync/recalc-daily` (fórmulas com "Data atual"), em lote via
  `recalc_apply_updates` (0070).
- **Aninhamento de campos calculados** (19/07/2026,
  `lib/records/formula-deps.ts`): um calculado pode referenciar outro, nos dois
  tipos. **Ciclos são rejeitados no salvamento** (`findFormulaCycle`, grafo
  unificado calculado + calculado_agg; os catálogos excluem o campo em edição +
  dependentes transitivos) e a **exclusão de campo referenciado por fórmula é
  bloqueada** (`deleteField`). Por registro: `computeFormulaFields` ordena os
  defs topologicamente e injeta cada resultado no contexto (com a moeda do
  resultado em `operandCurrency` — herança/conversão em cadeia); ciclo residual
  no banco materializa null. Agregados: o ref é o plano `custom:<key>` e o
  engine **expande tokens em runtime** (`expandAggFormula`, aplicada em
  `resolveCalcMetric` e `runCalculatedWidget` — cobre widgets, subtotais/Total,
  snapshots, calculadora/nota/cards/tabela rápida) — nada muda nos RPCs
  `run_widget_query*`. Semântica: referenciar = embutir a FÓRMULA do campo
  entre parênteses; o formato do campo referenciado (moeda fixa,
  `allow_negative`, percentual) NÃO se aplica dentro do campo externo — valem
  os do campo externo. Refs aninhados dentro de SOMASE/CONT.SE/MÉDIASE
  continuam proibidos (argumentos são estruturais). O catálogo do widget-builder
  (`calcRefs` — métrica ad-hoc, variáveis, Card e o FieldForm inline) oferece o
  operando aninhado desde 19/07/2026 (`aggNestedOperandRefs`), como o `/campos`.
- **Operandos com ESCOPO DE FONTE** (19/07/2026, `lib/widgets/calc-metrics.ts`):
  um operando agregado pode mirar UMA fonte: ref `agg:<agg>:<campo>@<fonte>`
  (rótulo `… · <Fonte>`, gerado por `sourceScopedAggOperandRefs` para cada fonte
  RAIZ onde o campo se aplica). Resolve o clássico "Contagem de Data de criação
  de Leads ÷ a de Deals dá 1" — antes as duas escolhas compilavam para a MESMA
  ref agnóstica de fonte e caíam numa única chave de basis. Em runtime o ref é
  ABAIXADO (`lowerSourceScopedOperands`, nos mesmos choke points do
  `expandAggFormula`: `resolveCalcMetric` + `runCalculatedWidget`) para a chave
  condicional `aggif:` com o predicado da fonte (`record_type =` da raiz; sub
  soma o `filter` quando expressável como `[Coluna] op literal` — senão o
  operando resolve null, nunca um recorte mais largo). Reusa TODO o caminho das
  agregações condicionais (consulta auxiliar com filtros anexados, fold aditivo
  exato em subtotais, viewer de snapshot) — **nada muda nos RPCs** (invariantes
  1/9/10). Ref bare (sem `@`) segue = universo em escopo (compat total; sem
  migração de configs). O escopo conta como fonte da métrica no planejamento:
  `formulaScopedSources`/`metricScopedSources` entram em `widgetQuerySources`
  (@period) e `metricLegSources` (perna própria quando a fonte está fora do
  universo do widget). Limitações v1: soma monetária com escopo degrada p/ soma
  crua entre moedas (mesma das condicionais) e `min`/`máx` não têm forma com
  escopo.
  **Extensão 20/07/2026 (base do preset Inbound):** (a) o predicado da sub
  aceita também `in` (lista), `is_null`/`not_null` e `eq_ci`/`neq_ci` — só
  `ilike`/op desconhecido degradam (aviso no validador); (b) a chave `aggif:`
  ganha um 4º elemento OPCIONAL `scope` (source-key — chaves sem escopo
  seguem byte-idênticas); (c) a consulta AUXILIAR de um operando escopado
  roda como perna SÓ da fonte do escopo: período aplicado na coluna de DATA
  dela (`scopedAuxPeriod` reescreve o `fieldBySource`; `patchAuxPeriodByType`
  cobre o `@period` pré-sintetizado) e `p_correspondences` com o membro DELA
  (um `unified:` de data bucketiza pela data da sub, não da pai). Isso permite
  no MESMO widget operandos de duas subs do mesmo `record_type` com datas
  diferentes (ex.: `@sqls` por Data Reunião + `@clientes_lite` por mudança de
  etapa — o "SQL total" e os % de conversão do Inbound). Implementado nos 3
  choke points com o período DA RODADA (atual/perna do businessDayAlign/
  comparação): `computeRows`+pernas por métrica (`engine.ts`) e
  `runCalculatedWidget` (`formula-metric.ts`). O catálogo de operandos
  escopados passa a ofertar sub-fontes (`sourceScopedAggOperandRefs`).
  Caminhos client-side (`dateAgg`/listas) avaliam o predicado estendido mas
  NÃO rejanelam pela data da sub (limitação documentada); a aux do `@sqls`
  referencia a chave de Data Reunião no filtro → regra dos mocks 0052 segue
  valendo.
  **Correção 01/08/2026 (realizado da Remuneração zerado):** em modo ciente de
  moeda (`auto`/`fixed`), a aux monetária substitui o número cru do operando
  pelo `MoneyBreakdown` — e um recorte legitimamente VAZIO (ex.: perna
  `@vendas_site` de um AE sem venda no site) virava detalhamento sem moedas,
  que `rawTotal` traduzia para null = "operando ausente" e a fórmula INTEIRA
  caía para null (realizado/cards fórmula por pessoa zerados, sem erro
  registrado — não é falha de consulta). Agora recorte vazio vale **0**
  (identidade aditiva, igual ao `?? 0` do `aggregate` e ao caminho convertido
  `.brl`, que já dava 0); null fica reservado a operando AUSENTE (chave não
  resolvida / consulta que falhou). Efeito visível: card fórmula só de somas
  sobre recorte todo vazio exibe R$ 0,00 em vez de "—" (razões seguem "—"
  pela guarda de divisão por zero).
- **Catálogo por-registro ÚNICO** (19/07/2026, `lib/records/calc-operands.ts`):
  `perRecordCalcOperands` monta os operandos do campo calculado POR-REGISTRO
  para os DOIS editores (página `/campos` e o FieldForm inline do
  widget-builder) e para a validação do servidor (`serverOperandCatalog` em
  `campos/actions.ts` deriva dele; `validateFormula` recebe o MESMO conjunto).
  Inclui números (núcleo + custom + **casados**, `matchNumericOperands` — novo),
  datas (próprias + casadas + hoje) e condicionais no editor de texto. Antes o
  inline era numérico-only e uma fórmula com datas/casados abria como refs cruas
  (`[custom:…] - [match:…]`) irrecriáveis. Não monte listas de operando
  por-registro fora deste módulo.
- **Relações em fórmulas por NOME** (19/07/2026): `[Responsável]`/`[Operação]`
  entram como condição (`CORE_COND_REFS` += `responsible_id`/`operation_id`) e
  comparam pelo NOME, nunca pelo UUID: por-registro, o contexto recebe o
  `display_name` (recalc + `applyCalcFields`); no agregado
  (SOMASE/CONT.SE/CONT.SES), o literal é resolvido nome→id ANTES do RPC
  (`resolveFkCondFilters` no engine; aplicado também no caminho agrupado e nos
  folds client-side via rótulos id→nome). Nome inexistente: recorte vazio em
  runtime e **erro claro no save** do `/campos` (`validateFkCondNames`).
- **Condições agregadas ampliadas** (19/07/2026): `condAggOperandRefs` passou a
  aceitar colunas do registro CASADO (`match:<fonte>:*` — o loop de filtro dos
  RPCs já resolvia via `_widget_match_expr`; custo: subquery por linha, 0077) e
  campos UNIFICADOS (`unified:<key>`, texto/seleção/data) como condição de
  SOMASE/CONT.SE. "Data atual" fica no catálogo mas NUNCA compila em fórmula
  agregada (não é coluna) — `validateCondAggRefs` devolve mensagem dedicada em
  vez de degradar para "—" silencioso.
- **Redesign do editor de fórmulas** (20/07/2026 — UX de campos/métricas
  calculadas; nenhum RPC tocado, formato `Formula {tokens, source}` intacto):
  - **Catálogo AGREGADO com builder único** (`lib/widgets/agg-catalog.ts`):
    `buildAggOperandCatalog` + `availableAggCatalogInput` (sítios de widget) /
    `defsAggCatalogInput` (/campos e servidor) substituem as SEIS montagens
    copiadas (widget-builder, fields-manager, campos/actions,
    quick-table-actions, Nota/widget-card, viewer de snapshot). Paridade
    ref|label|group verificada por script na migração. NÃO monte o catálogo
    agregado chamando as quatro funções de calc-metrics na mão — derive o input
    e chame o builder.
    - **Casados no lado defs** (20/07/2026): `defsAggCatalogInput` inclui os
      campos do registro CASADO (`match:<fonte>:<ref>`) em `numeric`/
      `countable`, derivados do `buildMatchFields` exportado
      (`lib/widgets/fields.ts`) — a MESMA construção dos sítios de widget, para
      ref+rótulo (`↪ <Fonte>: <Campo>`) idênticos byte a byte; nunca remonte
      esses rótulos à mão. Antes o servidor rejeitava ("Coluna inválida na
      fórmula: agg:*:match:…") fórmulas que os editores de widget ofereciam e o
      RPC suporta (count/sum/avg sobre `_widget_match_expr`, 0042). Os casados
      entram de TODAS as defs, não só das não-proibidas: `match:` não cria
      aresta de dependência/ciclo (`refCustomKey` → null), como já valia no
      catálogo por-registro. Lacuna conhecida (deferida): agregado sobre campo
      UNIFICADO (`agg:*:unified:<key>`) segue rejeitado no save de campo
      reutilizável — o lado defs não carrega correspondências.
  - **Validação de contexto única** (`lib/records/formula-validate.ts`):
    `validateFormulaForContext(formula, {kind: "record"|"aggregate", catalog,
    sources?})` concentra estrutura+refs (`validateFormula`), colocação de
    SOMASE/… (`validateCondAggRefs`) e as mensagens dedicadas do por-registro
    (agg:/SOMASE proibidos). O servidor (`resolveAndValidateFormula`) e os
    editores rodam O MESMO módulo — validação AO VIVO com as mensagens do save.
    `warnings` (não bloqueiam) apontam operandos que degradariam para "—"
    (escopo `@fonte` não abaixável).
  - **FormulaEditor unificado** (`components/formula/`; 30/07/2026: as views
    Visual|Texto foram FUNDIDAS numa única superfície de TEXTO assistido —
    chips/botões removidos): usado nas 6 superfícies (FieldForm
    calculado/calculado_agg, widget "calculado", métrica ad-hoc, variáveis da
    calculadora, Card-fórmula). Assistência em `lib/records/formula-assist.ts`
    (helpers PUROS sobre texto+caret: `activeCall` → assinatura VIVA com o
    argumento ativo destacado (`SignatureHelp`), `bracketRangeAt` → o
    autocomplete do `[` substitui a ref INTEIRA sob o caret (sem `]` órfão),
    `funcWordAt`/`matchFunctions` → autocomplete de FUNÇÕES por nome/alias,
    `normalizeSearch` → busca sem acentos). Metadados das funções no catálogo
    ÚNICO `lib/records/formula-funcs.ts` (`FORMULA_FUNCS satisfies
    Record<FormulaFuncName, …>` — paleta ƒ, assinatura viva e o
    `FORMULA_FUNC_GROUPS` do SPEC da IA derivam DELE; exemplos fiscalizados
    por formula-funcs.test.ts contra o parser real). Dropdown de sugestões em
    Radix Popover ancorado no textarea (portal não cortado pelo overflow do
    Sheet e registrado na pilha de layers do Dialog modal — clicável/rolável
    com o Sheet aberto; portal manual em `document.body` herdaria o
    `pointer-events: none` do body); Enter/Tab só são
    interceptados com a lista aberta; Escape fecha até a próxima digitação
    (fecha SÓ a lista — o Sheet fica; guard real em
    `e2e/formula-editor.spec.ts`, que exige hit-testing de verdade).
    Operandos proibidos (ciclo, "Data atual" no agregado) aparecem
    DESABILITADOS com o motivo (`disabledReason` em OperandRef/
    ComboboxOption) — política: explicar, nunca esconder. O tipo `RefOption` é
    alias de `OperandRef` em `lib/records/date-operands.ts` (a lib não importa
    de componente). Contrato de form do FieldForm preservado
    (`formula`/`formula_text`/`formula_mode` — mode agora SEMPRE "text"; o
    servidor já re-tokenizava `formula_text`, "builder" ficou como valor
    legado aceito). Serialização token-only → texto emite ref CRUA para rótulo
    duplicado (senão o texto não re-tokenizaria); fórmula legada sem `source`
    ganha `source` no primeiro save sem mudança de tokens.
  - **Prévia ao vivo pelos choke points** (nunca caminho paralelo):
    por-registro via `app/(app)/campos/preview-actions.previewRecordFormula`
    — usa `lib/records/record-eval-context.ts` (montagem de contexto EXTRAÍDA
    do recalc; `recalcAllFormulaFields` consome o mesmo módulo, então prévia e
    materialização são idênticas) + `computeFormulaFields` sobre até 30
    registros reais, com nota "sem registro casado de <fonte>"; agregada via
    `app/(app)/dashboards/formula-preview-actions.previewAggregateFormula` —
    `runCalculatedWidget` com fontes/filtros do builder, SEM o período da
    barra (selo avisa), opt-in por clique (custa RPCs como um widget).
  - **Receitas guiadas** (`lib/records/formula-recipes.ts` +
    `components/formula/recipe-strip.tsx`): "Ciclo de vendas" ([data fim] −
    [`match:<fonte>:<data início>`], campo por-registro) e "Taxa de conversão"
    (`agg:count:…@A ÷ agg:count:…@B`, agregado, %). São ATALHOS por cima do
    editor livre — geram fórmula normal, 100% editável; opções derivadas dos
    catálogos vivos (nada de lista paralela). A de ciclo consulta
    `getMatchCoverage` e orienta para Campos → Conexões quando o casamento não
    existe (nunca bloqueia). Entradas: FieldForm (a receita escolhe o TIPO do
    campo), métrica ad-hoc e widget calculado.
  - **Promoção de fórmula ad-hoc a campo**: "Salvar como campo reutilizável…"
    na métrica ad-hoc abre o FieldForm inline pré-preenchido
    (`initialDataType`/`initialFormula`); ao criar, a métrica de origem passa a
    apontar para o campo salvo (rótulo/fontes preservados).
- **Kanban/Tarefas/Agenda/Feed**: kanbans reusam `dashboards` (`kind='kanban'`);
  posições em `kanban_placements`; tarefas em `tasks` (RLS espelha registros; trava
  `locked` via trigger); comentários/subtarefas em `comments` + colunas de 0066.
  **Widgets kanban na seção Kanbans do hub (26/07/2026):** a seção lista TAMBÉM
  os widgets `visual_type='kanban'` de dashboards comuns ATIVOS (query
  `widgets` + `dashboards!inner` na Home; mapeamento puro em
  `lib/kanban/hub.ts`; a RLS de `widgets` — `auth_board_visible` do pai — já
  recorta a visibilidade). O card ("No dashboard X", SEM menu ⋮ — o ciclo de
  vida é do dashboard/widget) abre a página cheia `/kanbans/w/[widgetId]`, que
  renderiza o MESMO kanban do widget: mesma config `widgets.settings.kanban`
  (salvar lá reflete no dashboard e vice-versa, via `saveWidgetSettings`) e
  mesmos `kanban_placements.widget_id` — SEM linha espelho em `dashboards`.
  A página cheia reusa `kanban-page-client.tsx` (prop `widgetCtx`); Agenda e
  Aparência ficam de fora (board-only — aparência do widget se edita no
  builder). Pai arquivado sai do hub mas a URL direta segue abrindo (paridade
  com boards); pai na Lixeira → 404.
- **Agenda redesenhada (28/07/2026, 0111):** o calendário (`AgendaView`,
  compartilhado por widget, 3ª visão do kanban dedicado e `/agenda`) tem
  célula de ALTURA FIXA por densidade (`gridTemplateRows`; presets
  compacta/normal/espaçosa — dia cheio rola NA célula, a semana não estica),
  cabeçalho fixo por célula ("+" de criação rápida + nº do dia; faixa Seg–Dom
  sticky) e ordem CRONOLÓGICA intra-dia via helpers puros de
  `lib/agenda/day-items.ts` (`extractTimeHHMM` — prefixo naive, 00:00 = sem
  hora; `sortDayItems` — com hora primeiro, desempate nota→tarefa→registro;
  `mergeAgendaItems` — dedupe de registro por id|dia nas pernas do Workspace).
  Itens: tarefas (hora `due_time` + FINAL opcional `due_time_end`, 0111 —
  chip "14:00–15:30"), registros (hora extraída do valor bruto) e **anotações
  do dia** (`agenda_notes`, 0111 — post-it: chip tintado; clique abre o
  `NotePostIt` via BodyPortal com edição inline/cor/exclusão; org-wide na
  leitura, escrita autor/admin/gestor — attempt-and-fail). Clique no corpo do
  chip de tarefa/registro abre UMA instância içada de `CardDetailSheet`
  (Feed default — comentários a um gesto; aba Dados edita). **Drag & drop**
  nativo de tarefas/anotações entre dias (mime `application/x-agenda-item`;
  otimista via `pendingMoves` com limpeza só quando o reload REFLETE o
  movimento; falha reverte + mensagem; `rescheduleTask` muda só `due_date` —
  horas preservadas; registros NÃO arrastam — a data vem do campo). Aparência
  em `settings.agenda.appearance` (`AgendaAppearance` — cabeçalho/células/
  hoje/fim de semana/densidade/chips; cores de STATUS e a cor da anotação
  vencem a estética), editada no sheet de Aparência (canStyle inclui agenda;
  o save branch do builder preserva `widget.settings` — paridade com kanban).
  **Página `/agenda` do Workspace:** acesso pelo item "Agenda" do nav
  lateral (o card fixo da Home foi removido em 28/07/2026 — redundante);
  `fetchWorkspaceAgenda` mistura os record-legs de TODOS os widgets agenda
  visíveis (dedupe por `(source, dateField)`, teto de 12 legs) ou de um
  específico, ou só entradas diretas (tarefas + anotações); recortes por
  Responsável e por Operação TRADUZIDA no server (`loadOperationScopes` +
  `operationFilterSet` — nunca `operation_id` literal; perfil profile-only
  recorta só registros; anotações nunca filtram). Prefs por usuário em
  `user_settings.agendaHub`; `validateLastView` aceita o literal `/agenda`.
  A agenda segue FORA dos filtros de dashboard (invariante 12) e FORA de
  snapshots (`agenda_notes`/`tasks` fora de `PASSTHROUGH_TABLES`). `classifyDue`
  segue por DIA CIVIL (hora é exibicional — decisão registrada). RPCs
  intocados.
- **Ciclo de vida de boards no hub (22/07/2026, 0087):** o card do hub
  (`app/(app)/page.tsx` + `board-card-menu.tsx`) tem menu "⋮" com Duplicar/
  Arquivar/Excluir (dashboards E kanbans). **Excluir é SOFT** (`trashBoard` →
  `status='trashed'` + `trashed_at`): o board cai na seção recolhida "Lixeira",
  não abre (404 em `/dashboards/[id]`, `/kanbans/[id]` e `/s/[token]`; fora de
  `validateLastView`, dos pickers `listWidgetLinkTargets`/`listTaskBoards`, do
  lookup de preset e o refresh de snapshot aborta), pode ser restaurado ou
  excluído em definitivo (`deleteBoardPermanently`, só `status='trashed'`) e é
  purgado após 14 dias (`apply/pg-cron-purge-trash.sql`; o hub esconde vencidos
  mesmo sem o cron). **Arquivar** (`archiveBoard`) só tira da tela principal —
  segue abrindo por tempo indeterminado (seção "Arquivados"). **Duplicar**
  (`duplicateBoard`): qualquer usuário que ENXERGA o board e tem
  `create_dashboards` — a cópia nasce privada/ativa do usuário, com ids NOVOS
  de widgets e settings REMAPEADOS (connectors, `shape.link`, links de nota
  `[..](@id)`, `excludedTargets` — substituição literal de uuids no JSON),
  identidade de preset REMOVIDA (`settings.preset`/`presetKey` — o applyPreset
  nunca adota/sobrescreve a cópia), células (`dashboard_table_cells`) e
  `kanban_placements` copiados; snapshots/user_preferences/tasks NÃO.
- **Realtime** (0071): `records`/`tasks`/`comments` publicam em
  `supabase_realtime`; o app usa os eventos só como sinal de "algo mudou"
  (`components/realtime-refresher.tsx`).
- **Formato do grupo nas tabelas** (18/07/2026):
  `widgets.settings.appearance.table.groupDateFormats` (opcional; chave = field
  do nível nas listas, `dim_<n>` na agregada) funde/rotula o grupo de um nível
  de data do "Agrupar por" por formato próprio (`bucketGroupDate`,
  `lib/widgets/date-buckets.ts`) sem alterar o formato da dimensão nas linhas.
  Na agregada só vale para dimensões SEM transform "por nome" (o engine troca o
  ISO da linha pelo rótulo). Client-side apenas (nada muda nos RPCs) e o viewer
  de snapshot honra por vir congelado no settings.
- **Fonte do dado das colunas unificadas** (18/07/2026):
  `RecordListColumn.unifiedSources` (opcional, modo registros) define uma
  hierarquia de fontes com fallback: por registro, o valor vem da 1ª fonte da
  lista com dado não-vazio — o próprio registro ou o registro CASADO dela
  (`__match`, sempre anexado por `attachMatches`; snapshots usam
  `snapshot_record_matches`). Ausente = membro da fonte de cada registro.
- **Edição inline sem re-render global** (18/07/2026): a edição de célula
  (`updateRecordField`) NÃO chama `revalidatePath` — a célula é otimista
  (`components/registros/use-cell-commit.ts`) e a página reconcilia no cliente
  via realtime + `router.refresh()` debounced FORA da transition da célula
  (`lib/use-debounced-refresh.ts`). Só o form lateral (`RecordEditSheet`) e
  `createRecord` revalidam no servidor. Não reintroduza `revalidatePath` (nem
  `router.refresh()` síncrono no `onSaved`) no caminho de célula: Server Actions
  serializam por cliente e o re-render RSC da rota inteira a cada blur é o que
  travava a navegação.
- **Linha divisória** (25/07/2026): a antiga Forma "linha" virou o
  `visual_type 'linha_divisoria'` (0100 — CHECK + backfill dos widgets vivos);
  os settings seguem `{ shape: { kind: "linha", line } }` e a renderização
  segue na camada livre (`line-layer.tsx` + geometria em `lib/widgets/lines.ts`).
  A identidade é decidida SÓ por `isLineShapeWidget` (chokepoint único —
  partição do grid, estado otimista, paste, aparência, `saveShapeLine`), cujo
  braço legado (forma + `shape.kind 'linha'`) é PERMANENTE: configs congeladas
  de snapshot (`snapshots.config.widgets`) e payloads antigos de clipboard não
  passam pelo backfill. Não teste `visual_type === 'linha_divisoria'` na mão.

### 4.8 Sub-fontes (fonte derivada, filtrada)

Uma **sub-fonte** (`sub_sources`, 0078) é tratada como fonte em todo o app, mas
suas linhas são as da fonte **PAI** recortadas por um `filter` (WidgetFilter[]),
com **campo de data próprio**. Motivação: um campo unificado (`unified:<key>`)
pode então mapear DUAS datas para o mesmo `record_type` — ex.: Leads → *Data
Reunião* e a sub Leads/Clientes Lite → *Data da mudança de etapa*.

- **Modelo:** tabela separada de `data_sources` (a sub compartilha o
  `record_type` da pai — não pode virar linha de `data_sources` sem quebrar o
  `record_type unique`/FK de `records`). `loadSources` une os dois num único
  `SourceDef[]` (`parentKey`/`filter`; `recordType` = o da pai). O membro de
  campo unificado passa a ser identificado por `source_key`
  (`field_correspondence_members`, unicidade `(correspondence_id, source_key)`).
- **Resolução no ENGINE (sem tocar nas RPCs):** `planSourceLegs` decide, por
  widget, a fonte **efetiva** de cada `record_type` na consulta PRINCIPAL — uma
  só. Subs **absorvidas** (a pai também está no widget) somem: a pai já cobre
  suas linhas, sem duplicar (padrão). Sub **avulsa** (pai ausente) recorta as
  linhas da pai: o predicado entra scoped via `_widget_wrap_record_types`, o
  `@period.byType[record_type]` usa a data da sub e o `coalesce` do unificado
  recebe o membro da sub (`correspondenceMapForSources` — um ref por perna,
  senão pai+sub colidiriam num mesmo coalesce). Como cada `record_type` tem UMA
  fonte efetiva, `byType`/coalesce/`record_type in` continuam chaveados por
  `record_type` e o par `run_widget_query`/`_snapshot` fica intocado.
- **Mapa de unificados SEMPRE por perna (v1.6):** TODA consulta (`runWidget`,
  `runCalculatedWidget` — calc/calculadora/nota/card/`{=…}` — e as pernas por
  métrica) monta `p_correspondences` com `correspondenceMapForSources(corrs,
  fontes efetivas, catálogo)` — nunca com o mapa global. Não é só quando há sub
  selecionada: como a sub compartilha o `record_type` da pai, o membro dela num
  campo unificado entraria no `coalesce` de um widget SÓ-PAI (o `record_type
  in` não o exclui — as linhas são as mesmas) e mudaria resultados
  silenciosamente. Fallback perna → membros de fontes RAIZ → todos (o RPC ergue
  "Correspondência sem colunas" p/ chave referenciada ausente; snapshots
  pré-0078 têm membros sem `source_key`). `buildCorrespondenceMap` (união
  global) sobrevive SÓ nos RPCs de opções de bucket (display). O espelho
  client-side `AvailableField.unifiedMembers` (por `record_type`) é
  RAIZ-primeiro: membro de sub só preenche `record_type` sem membro raiz.
- **Conviver (toggle `settings.coexistSubSources`):** marcar uma sub como
  "conviver" (com a pai também selecionada), ou selecionar 2+ subs da mesma pai,
  gera **pernas EXTRAS** — no caminho agregado, cada fonte de linha vira uma
  perna própria, calculada por recursão em `runWidget` (filtro + data + membro
  próprios). O usuário assume que os conjuntos são disjuntos. **Para
  restringir a PAI sem esvaziar a sub** (ex.: pai só "Desqualificado" × sub
  "Clientes Lite"), o filtro do widget precisa ter a PAI como fonte-alvo
  (`WidgetFilter.sources = [pai]`): filtros globais (sem alvo) valem para
  TODAS as pernas e cairiam também sobre a sub. "Agrupar período" e o modo
  lista ficam no **absorver** (a perna extra não vira série nesses tipos) —
  limitação v1.
- **Exibição das pernas (`settings.subSeriesMode`, 24/07/2026):** como o
  branch multi-perna apresenta as pernas — seletor "Exibição das sub-bases" no
  builder (seção Bases), visível só quando há pernas extras num visual que as
  plota (barra/barra_horizontal/linha/tabela).
  - **"stacked"** (ausente = default) e **"grouped"**: o engine mantém a fonte
    como dimensão LÍDER (`dim_1` = "Base", dims reais deslocadas) e carimba
    `WidgetData.subSeries.mode`; o CHART pivota (`buildSubSeriesPivot`,
    `lib/widgets/sub-series.ts`): categorias = `dim_2` (a dimensão real), uma
    série sintética por (sub-base × métrica) — empilhadas (stack POR métrica)
    ou lado a lado — com legenda pelos rótulos das subs, `keyMap` p/ a
    formatação resolver a métrica subjacente e `__cat_total:<metric>` p/ o
    top-N/ordenação ranquearem a CATEGORIA inteira (`limitCategories` ganhou o
    param `rankKey`). Tabela agregada e CSV "dados exibidos" seguem as linhas
    originais (coluna "Base"). Cores por categoria/condicional por coluna não
    se aplicam no pivot (cor é por série).
  - **"total"**: o engine funde as linhas das pernas por tupla de dims — SEM a
    dim "Base" — com a semântica do Total geral (`foldRowGroup`,
    `lib/widgets/bucket-merge.ts`): sum/count somam, min/max reduzem,
    calculadas REAVALIAM a fórmula original sobre a basis fundida (razões
    exatas), monetárias fundem `__money` e replotam; `__cmp` soma os não-nulos
    (aproximação, como o "Outros") e `__goal` NUNCA soma (é a mesma meta
    repetida por perna). Tabela/CSV perdem a coluna "Base" automaticamente.
  - **Forced total:** pizza/funil com ≥1 dim e KPI/card fundem SEMPRE (uma
    fatia/valor por categoria — antes a pizza gerava uma fatia por sub×categoria
    e o KPI simples mostrava só a 1ª perna). Subs não-disjuntas contam em
    dobro no total (mesma ressalva do conviver).
- **Operando escopado em fonte-IRMÃ é ZERADO por perna (24/07/2026):** a
  consulta auxiliar de um operando `agg:…@fonte` roda independente do universo
  da perna (perna SÓ da fonte do escopo — §4.1), então uma fórmula
  `count@subA + count@subB` repetiria o TOTAL global em toda perna (o bug do
  CSV 67/67 do "Fonte SQL"). Antes de recursar, o branch multi-perna zera na
  fórmula (métricas E defs 'calculado_agg' aninhadas —
  `zeroSiblingScopedOperands`/`zeroSiblingScopesInFields`,
  `lib/widgets/calc-metrics.ts`) os operandos cujo escopo é OUTRA perna de
  linha do mesmo widget: sum/count → literal 0 (identidade aditiva); avg →
  `(0/0)` = null (média de irmã ausente nunca vira 0 falso); min/max ficam (já
  avaliam null). O escopo da PRÓPRIA perna permanece. Depois, cada linha da
  perna recebe backfill `0` nas chaves de basis das irmãs
  (`siblingScopedBasisKeys`) — o meta da métrica carrega a fórmula ORIGINAL, e
  o re-eval client-side (células/subtotais) bate com a perna enquanto o fold
  entre pernas soma as contribuições complementares (Total geral exato p/
  fórmulas aditivas). Limitação documentada: RAZÃO entre escopos irmãos numa
  perna avalia null/0 — use o modo "total", que reavalia globalmente.
- **Arquivos:** `lib/sources.ts` (resolvers + `planSourceLegs`),
  `lib/widgets/engine.ts` (fonte efetiva + branch multi-perna + merge "total"),
  `lib/widgets/sub-series.ts` (pivot p/ o chart), `lib/widgets/bucket-merge.ts`
  (`foldRowGroup`), `lib/widgets/calc-metrics.ts` (zeroing de irmãs),
  `record-list.ts` (mesmo no modo lista), `lib/correspondences.ts`
  (`correspondenceMapForSources`), UI em
  `components/configuracoes/sub-sources-manager.tsx` e os controles (conviver +
  "Exibição das sub-bases") no `widget-builder.tsx`.
- **Ordem do coalesce dos unificados (20/07/2026):**
  `correspondenceMapForSources` ordena os refs com os `custom:` (ESPARSOS —
  só existem nas linhas do próprio record_type) ANTES das colunas do núcleo
  (DENSAS — preenchidas em todo record_type). Sem isso, `source_created_at`
  (membro do lead) sombreava `custom:data_assinatura` (membro do deal) na
  MESMA perna e o deal bucketizava pelo mês de criação. Limitação restante:
  dois membros de coluna de NÚCLEO distintos ainda se sombreiam (correção
  definitiva = CASE por record_type no RPC, migração espelhada futura).
- **Campo de período `custom:` (0082/0110):** `sub_sources.default_period_field`
  (0082) e `data_sources.default_period_field` (0110) aceitam também um campo
  personalizado de DATA (`custom:<field_key>` — ex.: sub "SQLs" da pai Leads
  datada pela *Data Reunião*; base de parceria datada por campo próprio). O
  read side já suportava (`@period.byType` aceita `custom:` e a regra dos
  mocks 0052 inspeciona o byType serializado); a validação semântica (campo
  existe, é `data`, não é override core da 0086 e o `applies_to` cobre o
  record_type da base) fica na server action de fontes. O picker de
  Registros → Bases (bases E subs) oferece "só colunas com dados": probe
  PostgREST na page (`lib/config/period-field-probe.ts` — `is_mock = false`
  sempre; NUNCA via RPC, que não filtra `is_mock` e cuja regra 0052 incluiria
  mocks) + montagem pura em `lib/source-date-fields.ts`; base sem linha
  não-mock cai nas 6 colunas core, o valor salvo segue sempre listado e o
  picker da sub usa a lista da PAI (o recorte da sub não é aplicado no probe —
  simplificação documentada).
- **Pastas de bases (0107, 26/07/2026):** `source_folders` agrupa as bases
  RAIZ em **Pastas** — agrupamento de EXIBIÇÃO puro + ordem manual
  (`data_sources.folder_id`/`sort_order`, `sub_sources.sort_order`; botões
  ↑/↓ em Registros → Bases). Navegação Pasta → Base → Sub-base em
  /registros (100% URL-driven pelo `?fonte=` de sempre — a pasta ativa DERIVA
  da base ativa; sem pasta criada, degrada para as abas planas) e /campos;
  headings por pasta nos pickers (widget-builder, diálogo Bases do board — as
  pastas viajam na PRÓPRIA action `getBoardSourcesState`, catálogo completo —,
  matriz de Acessos, import por IA, period-filter, correspondências) e nas
  tabelas de Registros → Bases. TODO agrupamento sai de
  `groupSourcesByFolder` (`lib/source-folders.ts` — implícita "Geral"
  primeiro, pastas por `sortOrder`, **grupos vazios omitidos**: catálogo
  recortado por `applySourceScope`/RLS esconde a pasta esvaziada sozinho);
  pastas chegam ao client pelo `SourceFoldersProvider` (layout; o viewer
  público não o monta). Pasta NUNCA entra em consulta/engine/RPC, no
  `sourceScope` (segue por keys) nem em permissão — excluir pasta devolve as
  bases para "sem pasta" (FK SET NULL). Sub não tem pasta própria (herda a da
  pai na exibição).

### 4.9 Dias úteis, meta ideal e alinhamento por dia útil (20/07/2026)

Peças genéricas para acompanhamento diário (base do futuro preset "Inbound"):
tudo resolvido no **ENGINE** — o par de RPCs fica intocado (mesma família das
invariantes 9/10).

- **Dias não úteis** (`non_working_days`, 0081): calendário único global —
  dia útil = seg–sex fora da tabela. Utilitários PUROS em
  `lib/date/business-days.ts` (`businessDaysInMonth`, `businessDayIndexInMonth`,
  `nthBusinessDayOfMonth`…), loader resiliente em
  `lib/config/non-working-days.ts` (falha → Set vazio = só fim de semana). UI em
  Configurações → Metas (cadastro manual, edição de rótulo e import CSV parseado
  no browser — `Papa.parse` + `coerceDate`). No viewer público, a tabela entra
  em `PASSTHROUGH_TABLES` (leitura AO VIVO, precedente das metas — cadastrar um
  feriado não exige refresh do snapshot).
- **Metas por métrica arbitrária:** `goals.metric` sempre foi texto livre; o
  vocabulário vem do registry (`lib/metas/metrics.ts` — builtins `mrr`
  monetária/`clientes` + custom do `sync_config` `goal_metrics`, criadas na tela
  de Metas). O REALIZADO do KPI modo meta é a métrica configurada no PRÓPRIO
  widget (`config.metrics[0]`; sem ela, legado por chave) — criar a métrica de
  meta "sql" não cria consulta nenhuma.
- **Alinhamento "mesmo dia útil"** (`WidgetSettings.businessDayAlign`): com
  dimensão de data MENSAL e período ativo, cada mês vira uma perna
  `computeRows` com o range recortado no N-ésimo dia útil do mês (N = dia útil
  corrente da referência — hoje limitado ao fim do período, ou o fim do
  período). Meses "encerrados" no alinhamento (N ≥ dias úteis do mês) usam o
  mês CHEIO (não perde registro datado em fim de semana). Como cada rodada só
  devolve linhas do próprio mês, o concat é o resultado — todas as métricas
  (normais/calculadas/moeda/pernas por fonte) funcionam sem código novo. Teto
  de 13 meses (acima disso o align é ignorado). Precedências: KPI/card e
  "Agrupar período" (`dateAgg`) não passam pelo align; pernas de sub-fonte
  "conviver" recursam `runWidget` e o align roda DENTRO de cada perna. Com o
  align ativo, `settings.comparison` é IGNORADA (exclusão mútua — o gráfico já
  é a comparação). **Badge "Nº dia útil" (21/07/2026):** com o align ativo e
  N ≥ 1, o engine expõe `WidgetData.businessDayRef` (`{ n, reference, date }` —
  o MESMO N de corte das pernas e da goalLine "pace", único e compartilhado
  entre os meses comparados) e o card exibe o badge (`BusinessDayBadge`,
  rótulo por `businessDayOrdinalLabel` em `lib/date/business-days.ts`) ao lado
  do toggle do `PeriodWindowControl` — ou sozinho no mesmo slot quando não há
  dropdown (align direto nos settings, viewer de snapshot). Metadado 100%
  engine (RPCs intocados); no snapshot funciona porque o viewer roda o mesmo
  `runWidget` (feriados AO VIVO via `PASSTHROUGH_TABLES`).
- **Janela de períodos equivalentes** (`WidgetSettings.periodWindow`,
  20/07/2026): "traz o equivalente ao período apurado nos meses anteriores"
  como FILTRO RÁPIDO do card. `options` (subconjunto ordenado de `3m |
  trimestre | 6m | semestre | 12m | ano`) define o dropdown no card
  (`PeriodWindowControl`); `default` é a janela sem seleção;
  `showAlignToggle` expõe o seletor "dia útil × dia cheio". Semântica:
  rolling `3m/6m/12m` = N meses terminando no mês do `to` da barra;
  `trimestre/semestre/ano` = calendário do `to`. Cada mês recebe o RECORTE
  equivalente ao período da barra — com align, o corte no N-ésimo dia útil
  (regras acima); em "dia cheio", o span de DIAS equivalente quando a barra
  cabe num único mês (dia(from)–dia(to), clampado; "Este mês" → meses
  cheios), senão meses cheios — e o mês final respeita o `to`. A SELEÇÃO do
  card é COMPARTILHADA entre usuários (célula `__pw__`/`sel` de
  `dashboard_table_cells`, `savePeriodWindowChoice`), como os filtros
  rápidos; page e `widget-scope` mesclam a escolha nos settings EFETIVOS
  antes do engine (`applyPeriodWindowChoice` → `periodWindow.active` +
  `businessDayAlign.enabled`); o engine só lê o resolvido
  (`active ?? default`) — por isso o viewer de snapshot (que congela os
  settings) cai no default. `businessDayAlign.windowMonths` (2–13) segue
  como alias LEGADO (janela fixa rolling), fora do builder. Assimetria
  estrutural documentada: o universo de meses (linhas) vem da consulta
  PRINCIPAL (fontes do widget) — mês com registro só em fonte de perna
  (`Metric.sources`) não vira barra; incluir a fonte no widget resolve.
- **Base de comparação `previous_period_bd`**: período anterior com o `to`
  recortado no N-ésimo dia útil do último mês do range ("vs. mês anterior no
  mesmo dia útil" dos KPIs). `comparisonSpec` segue pura — o contexto
  (feriados + hoje) chega por parâmetro opcional; sem contexto (chamador
  antigo, ex.: widget calculado) degrada para `previous_period`.
- **Cromo dos cards** (26/07/2026, 100% client): o texto do rótulo de
  comparação ("vs. período anterior…") no Card/KPI e o selo "Nº dia útil"
  podem ser ocultados — padrão do dashboard em
  `DashboardSettings.hideComparisonLabels`/`hideBusinessDayBadges` (⋮ ▸
  Aparência do dashboard), propagado por `BoardChromeProvider`
  (`components/dashboards/board-chrome-context.tsx`, molde do
  FontScaleProvider — vale automaticamente no viewer de snapshot); override
  POR WIDGET tri-state (`ausente` herda / `true` oculta / `false` força
  exibir) em `ComparisonSettings.hideLabel` (seção Comparação do builder) e
  `AppearanceSettings.hideBusinessDayBadge` (Aparência ▸ Título e borda).
  Só EXIBIÇÃO: o badge de variação, as tooltips de gráfico com o rótulo, o
  cálculo da comparação e `WidgetData.comparison.label`/`businessDayRef`
  seguem intactos (engine/RPCs não mudam).
- **Comparação nos Cards de FÓRMULA** (21/07/2026, `lib/widgets/card.ts`):
  com `settings.comparison` ativa, o `runCardWidget` roda a MESMA
  `runCalculatedWidget` uma segunda vez com o período deslocado pelo
  `comparisonSpec` (mesmo padrão do `runComparison` do engine — operandos
  escopados rejanelam pela data da própria sub; `previous_period_bd` carrega
  feriados como o engine, com a mesma degradação) e devolve
  `WidgetData.comparison` + `card.value/cmpValue/cmpValueText/currency` p/ o
  `VariationBadge` do chart. Bases de JANELA (`window_avg`/`window_median`)
  ficam DE FORA por design (o card é um escalar único e fórmulas típicas são
  razões — intensivas; o builder as oculta via `excludeWindowBases`); modo
  `record` segue sem comparação (seção oculta no builder); `topn`/`list` já
  herdavam `__cmp` via `runWidget`. RPCs intocados; o viewer de snapshot herda
  (mesmo `runCardWidget`; feriados AO VIVO por `PASSTHROUGH_TABLES`). As
  funções `ANTERIOR`/`VARPCT`/`VARABS` seguem um mecanismo SEPARADO, limitado
  a `previous_period`/`previous_year` (formula-metric.ts).
- **Ordenação dinâmica por valor + cor por categoria** (21/07/2026, client):
  `AppearanceSettings.categorySort` ganha `by: "label" | "value"` (ausente =
  rótulo, compat) e `metric` (chave `metric_<n>`; ausente = 1ª) — aplicado
  pelo helper ÚNICO `orderCategories` (`lib/widgets/appearance.ts`, delega a
  `sortRows`) no pipeline de barra/linha E nas fatias de pizza/funil (após o
  `topWithOther`; o sheet de aparência usa o MESMO helper p/ os índices de
  `sliceColors` baterem; "Outros" fica no fim do sort por valor). Eixo
  CRONOLÓGICO (`isChronoDim` na 1ª dimensão) não oferece as opções na UI
  (chips e sheet) — o default segue cronológico; sort salvo explícito ainda é
  honrado. `colorByCategory` (barra de SÉRIE ÚNICA) colore cada barra pelo
  índice na paleta do widget (`appearance.palette`, mesmo vocabulário
  `PALETTES` da pizza) — `categoryColors` manual e formatação condicional
  vencem; OFF por padrão (gráficos existentes não repintam). Tudo
  client-side em `widget-chart.tsx` — snapshots herdam de graça.
- **Linha de meta** (`WidgetSettings.goalLine`): o engine anexa `row.__goal`
  por bucket mensal ANTES da rotulagem, via `resolveGoal` (mesmo roll-up do
  KPI meta), e `WidgetData.goalLine` leva o metadado de exibição. Modo
  `monthly` = meta cheia; `pace` = meta ÷ dias úteis do mês × N (N do
  businessDayAlign quando ativo — linha ideal no mesmo estágio de todos os
  meses; sem align, só o mês corrente é rateado, passados = cheia, futuros =
  null). Render: linha tracejada no `linha`; em barra, o container troca p/
  `ComposedChart` SÓ com a meta ativa. Falha em qualquer ponto degrada sem a
  linha. Snapshots: meta e feriados AO VIVO pelo adapter (paridade com KPI
  meta).
- **Operando de META em fórmula (`meta:<chave>`, 31/07/2026):** o valor de
  `goals.target` entra nas fórmulas AGREGADAS como operando (grupo "Metas" do
  catálogo único; rótulo `Meta: <label>` do registry `goal_metrics`, que
  virou campo OBRIGATÓRIO de `AggCatalogInput` — sítio sem o registry é erro
  de compilação). Resolução 100% engine: as chaves são coletadas da fórmula
  EXPANDIDA (`goalOperandKeys`) e ABAIXADAS para token `const` pré-resolvido
  (`lowerGoalOperands` — molde do zeroing de irmãs) nos DOIS choke points —
  `lowerCalcGoalOperands` após montar `calcResolved` no engine e o bloco
  equivalente em `runCalculatedWidget` com o período DA INVOCAÇÃO. NUNCA via
  basis (o `foldBasis` aditivo somaria a meta nos subtotais — o const
  embutido viaja na fórmula resolvida e o re-eval client-side sai certo de
  graça) e NUNCA via RPC. Escopo v1: GLOBAL, período pela regra do card modo
  meta EXTRAÍDA byte-idêntica para `goalPeriodScope` (lib/metas/resolve.ts —
  card refatorado para usá-la; cabe num mês ⇒ mensal, senão anual do ano
  inicial, "todo período" ⇒ mês corrente). Meta ausente/falha ⇒ ref mantido
  → "—" POR CHAVE (nunca 0, nunca derruba o widget). Limitações
  documentadas: pernas de comparação/businessDayAlign usam a meta da rodada
  principal (const é const); modo lista de registros re-resolve no cliente
  sem os valores ⇒ "—"; proibido em SOMASE (allowlist de
  `validateCondAggRefs`) e no contexto por-registro (`GOAL_IN_RECORD_MSG`).
  Snapshots: valor AO VIVO (goals é passthrough org-scoped); o registry do
  catálogo do viewer sai de leitura service org-scoped de `sync_config`
  (NUNCA adicionar sync_config ao PASSTHROUGH).
- **Coorte por registro casado:** "vendas por mês de criação do lead" é uma
  dimensão `match:<fonte>:<campo>` com transform de data — suportada pelo RPC
  desde a 0042 (`_widget_match_expr`, espelhada no `_snap`) e ofertada pelo
  builder. Pré-requisito é DADO (match_rules venda→lead), não código. `match:`
  NÃO serve como campo de PERÍODO (restrição proposital —
  `period-resolve.ts`).

### 4.10 Filtros → widgets deferidos e feedback de carregamento (21/07/2026)

O dashboard tem DOIS transportes de filtro com gatilhos de recompute
diferentes:

- **URL** (`periodo/de/ate/campo`, `ff_`, `tf_`, `pf_*`): `router.replace`
  dentro do transition compartilhado (`pending-context.tsx`) → re-render RSC +
  mudança de `useSearchParams`.
- **Banco** (`__qf__` filtros rápidos do card — inclusive operação —,
  `__pw__` janela de períodos e `__ff__` valor compartilhado do "Filtro por
  campo" com `valueScope: "all"`, em `dashboard_table_cells`): server action +
  `revalidatePath` → re-render RSC **sem** mudança de URL.

Os widgets computados no RSC (hoje: listas de registros/entity lists) cobrem
os dois transportes por construção (props novas a cada render). Os widgets
**DEFERIDOS** (Tabela Livre e kanban, fetch client-side via server action —
e, desde 26/07/2026, TODOS os widgets de engine; ver abaixo) precisam de duas
garantias:

- **Escopo ÚNICO:** as actions deferidas (`runQuickTable`,
  `runKanbanWidget`) montam os filtros de visualização pela MESMA assembly da
  page — `resolveWidgetViewScope`/`loadWidgetScope`
  (`lib/widgets/widget-scope.ts`): filtros rápidos `__qf__` (com exceção do
  vendedor), `?tf_`, `?ff_` com fallback `lastFieldFilters` (ou a célula
  `__ff__` quando `valueScope: "all"`), tradução de OPERAÇÃO
  (`operation-scope.ts`) e `__pw__` nos settings efetivos. A
  cobertura do `@period` (invariante 9) usa as métricas EFETIVAS (Tabela
  Livre: colunas BI de `settings.quickTable`; kanban: a fonte do quadro).
  O kanban aplica o MESMO recorte dos demais widgets (colunas continuam
  derivadas das opções do campo — filtro só reduz cards); a **Agenda ignora
  os filtros do dashboard POR DESIGN** (range próprio mês/semana). A **página
  cheia do kanban de widget** (`/kanbans/w/[widgetId]`, 26/07/2026) é um
  contexto de visualização PRÓPRIO na mesma categoria da Agenda: RSC que chama
  `runKanban` direto (sem `runKanbanWidget`/widget-scope) e IGNORA por inteiro
  os filtros/período do dashboard pai — barra de período própria
  (`?periodo/?de/?ate`, como `/kanbans/[id]`). Não é uma remontagem parcial de
  `__qf__`/`ff_` (o que a invariante 12 proíbe): o widget renderizado NO
  dashboard segue 100% no widget-scope.
- **Gatilho de re-fetch por FINGERPRINT:** a page computa
  `deferredScopeById[widgetId] = JSON.stringify({ p: período efetivo,
  f: filtros de visualização, pw: escolha __pw__, c: CONFIG do widget
  (widgetConfigFingerprint, 31/07/2026 — hash das colunas de config;
  posição/ordem FORA para mover não re-buscar o lote) })` e o widget recebe
  como prop `scopeKey`, que é a dep REAL do effect de fetch (a URL é lida em
  call-time, `window.location.search`). Como o RSC re-renderiza em TODOS os
  caminhos (navegação, `revalidatePath`, `router.refresh` do realtime), o
  fingerprint cobre também mudanças feitas por OUTRO usuário — e o `c` cobre
  a EDIÇÃO do próprio widget (sem ele, o payload deferido velho ficava na
  tela até F5: updateWidget revalidava, mas período/filtros não mudavam e o
  effect não re-buscava). Não remova o `c` ao mexer no deferimento. Não volte
  a keyar o fetch deferido em `useSearchParams` — filtro persistido no banco
  não muda a URL e o widget ficava obsoleto até F5. Mudança de DADO (sem
  mudança de filtro) chega pelo event bus (`useDataChanged` → tick), nos dois
  widgets.

**Deferimento automático dos widgets de ENGINE (26/07/2026):** a page NÃO
computa mais gráfico/KPI/card/pizza/funil/tabela agregada/calculado/
calculadora/nota — ela entrega o fingerprint (`deferredScopeById`, o mesmo
acima) + `deferredEngineIds`, e o `DashboardClient` busca TODOS em UMA action
(`runDeferredWidgets`, `app/(app)/dashboards/deferred-widget-actions.ts`) após
o mount, com stale-while-refetch (overlay "Atualizando…" por card via
`deferredPendingIds`). A action reproduz o dispatch do `computeWidget` da page
sobre os MESMOS choke points (`runWidget`/`runCardWidget`/
`runCalculatedWidget`) com escopo do widget-scope em BUNDLE
(`loadDashboardScopeBundle` + `scopeForWidget` — as consultas compartilhadas
de catálogo/prefs/períodos rodam 1× por lote; invariante 12 intacta), o
cliente RPC em duas camadas (memo por lote + cache TTL §4.1) e o limitador
compartilhado (`lib/widgets/task-limiter.ts`). Listas de registros/entity
lists seguem inline no RSC (alimentam FK labels e a janela incremental);
snapshot viewer segue computando tudo inline (link público de leitura). Env
de escape `DEFER_ENGINE_WIDGETS=0` restaura o cômputo inline na page sem
deploy. RPCs de widget INTOCADOS.

**Filtros de relação por NOME (31/07/2026):** filtros de
`responsible_id`/`operation_id` (widget, `tf_`, JSON de import/export, preset)
aceitam o NOME do cadastro como valor — o ENGINE resolve nome→id em runtime
por `resolveFkFilterNames` (`lib/widgets/engine.ts`; generalização do antigo
`resolveFkCondFilters` de SOMASE): strings E arrays (`in`, por elemento),
loaders `cache()` por request (`loadResponsibleNameMap` — linha CANÔNICA vence
apelido homônimo e o id emitido é o PRINCIPAL; `loadOperationNameMap` — ativa
vence inativa), UUID legado passthrough e fast path sem NENHUMA consulta
quando não há nome não-UUID. Nome desconhecido resolve para o uuid-zero
`FK_NO_MATCH` (vazio silencioso em runtime; o validador de import barra antes
com erro amigável). A ordem é FIXA e vale em TODOS os choke points:
nome→id→grupo canônico (`expandResponsibleFilters` roda DEPOIS do resolver) —
`runWidget`, pernas por métrica (`formula-metric.ts`, resolvido UMA vez),
`expandConfigResponsibles` (record-list) e os espelhos de operação da page e
do widget-scope (view filters resolvidos ANTES de
`collectOperationFilterIds`). O snapshot viewer cobre de graça (adapter
PASSTHROUGH de responsibles/operations). Na UI, o `FilterValuePicker`
(`components/filters/filter-value-picker.tsx`) substitui o input cru:
builder/barra da tabela gravam NOME (`storeAs: "label"` — URL legível);
sub-bases, perfil de operação e automações do kanban gravam ID com rótulo
exibido (`storeAs: "value"` — os predicados dessas famílias comparam a coluna
CRUA fora do pipeline de filtros do engine; a avaliação local das automações
não expande o grupo canônico — limitação documentada). O export da IA emite
NOME (`loadExportFkNames` → `exportDashboardJson.fkNames`, canon-aware via
`fetchFkLabels`) e `cleanFilters` preserva array de `in` (nome com vírgula
sobrevive). Trade-off aceito: renomear responsável quebra filtro pelo nome
antigo (mitigado pelo agrupamento de apelidos, §4.13); `__qf__`/`ff_` seguem
por id (UI já era label-based). Ver invariante 27.

**Período personalizado é rascunho + commit** (`PeriodRangeDraft`,
`components/dashboards/period-range-inputs.tsx`, usado por `PeriodControls`,
`PeriodQuickFilter` e pela barra da página dedicada `/kanbans/[id]` —
`kanban-page-client.tsx`): escolher "Personalizado" só abre os inputs (nada navega
ou persiste — os widgets seguem no período anterior) e digitar as datas só
atualiza o rascunho. O commit — navegação/emissão + persist, UMA vez — sai
quando o intervalo está COMPLETO (auto, debounce ~500ms) ou pelo botão
"Aplicar"/Enter (intervalo ABERTO deliberado, "de X em diante"). Commit em
blur foi rejeitado: tabular de "De" para "Até" emitiria o intervalo parcial
que era o bug. Efeito colateral corrigido: abrir "Personalizado" e desistir
não apaga mais o `lastPeriod` salvo do usuário.

**Feedback de carregamento (política):**

- Recompute RSC (qualquer filtro): overlay global "Carregando…" + dim do grid
  (`dashboard-grid.tsx`), via transition compartilhado (`useNavPending().run`
  em TODO caminho que muda filtro/recorte — barra de período, filtros
  rápidos, filtro por campo, barra da tabela, `PeriodWindowControl` e o
  refresh pós-save da Nota).
- Widgets deferidos re-buscando com dados antigos em tela: estado
  `refreshing` próprio (dim `opacity-60` + "Atualizando…" com spinner), sem
  bloquear interação (drag do kanban continua; um resultado que aterrisse
  logo após um move é reconciliado pelo `data-changed` → novo fetch). O
  overlay global pode sumir antes de o fetch deferido terminar — o estado
  local cobre esse rabo.
- Silenciosos POR DECISÃO: `realtime-refresher` (dado de fundo, mesmo
  recorte — overlay a cada rajada de sync seria ruído), reconciliações
  cosméticas (aparência, células da Tabela Livre).
- Respostas obsoletas: fetches concorrentes usam flag `cancelled` no cleanup
  (quick-table/kanban) ou contador de geração (agenda, pager server-side do
  modo lista) — só a ÚLTIMA resposta aterrissa.
- **Falha de gravação fora de formulário → toast de ERRO (29/07/2026):**
  ações sem form por perto (drag/resize do grid, aparência, colunas da Tabela
  Livre, expressão da calculadora, excluir widget, Desfazer, toggles dos
  managers de Operações/Responsáveis/Metas/Moedas, pin da sidebar) passam por
  `notifyOnError(promise, contexto)` (`lib/feedback/notify.ts`), que toasta
  `ok:false` (com a `message` da action) e rejeição de rede — **sucesso segue
  silencioso** (esta política). O `<Toaster />` (sonner,
  `components/ui/sonner.tsx`, tema via classe `.dark` do `<html>`) monta SÓ no
  layout autenticado — o viewer `/s/` e o login ficam sem toasts. Feedback
  INLINE (`useActionState` + `state.message`) segue sendo o padrão DENTRO de
  formulários — não o troque por toast. Exceção única de toast de SUCESSO:
  enviar board à Lixeira (reversível por design, sem confirmação) toasta com
  ação "Desfazer" (`board-card-menu.tsx`). Ações destrutivas irreversíveis
  confirmam com `ConfirmDialog` (`components/ui/confirm-dialog.tsx`, casca do
  AlertDialog) — nunca `window.confirm`.

Snapshot (`app/s/[token]`): nada disso se aplica — quick filters do visitante
vão à URL (`qf_*`), kanban/Tabela Livre chegam PRECOMPUTADOS pelo RSC público
(`snapshot-mode`) e `deferredScopeById` nem é passado (o fetch é pulado por
`readOnly`).

### 4.11 Importar dashboard via JSON gerado por IA (22/07/2026)

> **REGRA (23/07/2026): nunca use `.insert(...).select(...)` em
> `dashboards`.** A policy de SELECT (`auth_board_visible`, 0088) é uma
> função STABLE que consulta a própria tabela — no RETURNING de um INSERT
> ela roda no snapshot de antes do comando, não vê a linha nova e o insert
> inteiro falha com 42501, mesmo para o dono. Padrão correto (duplicateBoard/
> createBoard/applyPresetDefinition): **id gerado no app
> (`crypto.randomUUID()`) + insert SEM RETURNING**.

Terceiro modo de criação na Home (botão "Importar" ao lado do "Criar",
`components/dashboards/import-dashboard-sheet.tsx`): o usuário copia um prompt
de instruções, uma IA externa devolve um JSON e a importação materializa o
dashboard completo. Peças:

- **Contrato/validação**: `lib/import/dashboard/{types,validate}.ts` —
  validador PURO (erros em pt-BR, pensados para serem devolvidos à IA). Reusa
  os módulos ÚNICOS de fórmula (`tokenizeFormulaText` +
  `validateFormulaForContext` + `findFormulaCycle` sobre
  `perRecordCalcOperands`/`buildAggOperandCatalog`) — uma fórmula aceita no
  import é exatamente a que os editores aceitariam. `formula_text` é a forma
  primária (tokens por compat).
- **Aplicação**: `importDashboardJson` (`app/(app)/dashboards/actions.ts`)
  materializa um `PresetDashboard` e chama o MESMO `applyPresetDefinition`
  dos presets (com `includeSupportFields:false` — não cria
  forecast/potencial/desconto). Identidade no namespace **`import:<chave>`**
  (nunca colide com os presets de fábrica): reimportar a mesma chave ATUALIZA
  (widgets manuais preservados; GC só no prefixo do próprio import). Gates
  granulares: `create_dashboards` sempre; `manage_field_definitions` p/
  fields/correspondences; admin p/ subSources — mesmos das actions de
  cadastro.
- **Prompt**: `buildImportPrompt` (`app/(app)/dashboards/import-prompt-actions.ts`)
  aceita VÁRIAS Bases (checklist no sheet; 23/07/2026) e monta espec
  (`lib/import/dashboard/instructions.ts`) + modelo POR BASE + campos
  unificados + Conexões (`match_rules` habilitadas dos pares tocados) +
  amostra de ~20 registros POR BASE com COBERTURA de colunas
  (`lib/import/dashboard/sample.ts`, guloso + busca complementar por coluna
  descoberta). O envelope do JSON aceita `bases: []` (ou `base` singular). A
  variante "completo" anexa `docs/manual-de-construcao-de-dashboards.md` lido
  do disco — `outputFileTracingIncludes` no `next.config.ts` garante o
  arquivo no bundle da Vercel. **A espec é DERIVADA do código (25/07/2026)**:
  os enums do SPEC são interpolados das constantes de runtime (as mesmas que o
  validador já usava) e as chaves de `WidgetSettings`/`AppearanceSettings`
  (+ `.table`)/`DashboardSettings` são renderizadas dos dicionários exaustivos
  de `lib/import/dashboard/settings-docs.ts` (chave nova sem entrada = erro de
  typecheck; `null` = fora do escopo da IA). Guarda textual + validação do
  exemplo do SPEC pelo validador real em
  `lib/import/dashboard/instructions.test.ts`. Ver invariante no AGENTS.md.

#### 4.11.1 Geração DIRETA por IA via API (23/07/2026)

Elimina o "hop" manual de copiar/colar: o servidor chama a IA por API entre
"montar prompt" e "validar/aplicar", reusando tudo do §4.11. Peças:

- **Provedores**: `lib/ai/*` — adaptadores por `fetch` nativo (sem SDK), um por
  provedor (`gemini.ts`/`claude.ts`/`openai.ts`) atrás de um contrato único
  (`AiTextClient.generateText`, `types.ts`); `index.ts` é a fábrica
  (`getAiClient`). Migrar de provedor = novo arquivo + case + entrada em
  `models.ts`. Gemini autentica por header `x-goog-api-key` (nunca `?key=`);
  Claude sem `temperature` (removida em Opus 4.7+).
- **Config por org**: tabela `ai_provider_config` (0096) — provedor/modelo +
  chave CIFRADA (AES-GCM, `secretbox.ts`). `lib/ai/config.ts` (server-only)
  expõe `loadOrgAiConfigPublic` (provider/model/hasKey — nunca o ciphertext) e
  `loadOrgAiConfig` (chave decifrada, SÓ na action de geração). Cadastro admin
  em Configurações → Integrações (`ai-actions.ts` + `AiProviderForm`).
- **Action**: `generateDashboardWithAi` (`app/(app)/dashboards/ai-generate-actions.ts`)
  — gate `create_dashboards`, monta o system com `buildImportPrompt` (mesmo
  modelo+amostras do manual), roda um **laço de AUTOCORREÇÃO** (máx 3): chama a
  IA → `validateDashboardImport` → se falhar, anexa os erros pt-BR como turno de
  correção e repete. Ao validar, aplica reusando `importDashboardJson` (gates +
  GC + persistência intactos) e o cliente navega ao dashboard (auto-import); se
  esgotar sem JSON válido, devolve os erros + o último rascunho para conserto
  manual no campo de JSON. O contexto de validação saiu para
  `lib/import/dashboard/context.ts` (`loadImportContext`), compartilhado com
  `importDashboardJson`. O par de RPCs de widget NÃO é tocado.

#### 4.11.2 Export de estrutura + CONVERSA de IA (Criar novo / a partir de / Editar) — 23/07/2026

Fecha o ciclo do §4.11.1: dashboards existentes viram JSON (export) e a IA os
lê/edita em conversa multi-turno. Sem migração de banco. Peças:

- **Exportador** (`lib/import/dashboard/export.ts`, puro): dashboard+widgets →
  JSON `dashboard-import` que passa LIMPO no validador (settings de dashboard/
  widget são passthrough lá — o export emite quase verbatim, removendo
  `preset`/`presetKey`/`connectors`/`kanban`). Identidade determinística:
  `importChaveForDashboard` (sufixo do `preset.key` se `import:`; senão
  `board_<8hex do id>`; preset de FÁBRICA não reusa chave) e `assignWidgetKeys`
  (sufixo do presetKey sob a chave, senão `w_<8hex>`; dedupe `_2`) — o MESMO
  mapa serve export e adoção, então keys do JSON casam 1:1 com widgets reais.
  `bases` = raízes referenciadas (sub→`parentKey`) ∪ `periodBar.fieldBySource`
  ∪ `sourceScope`; widget "todas as fontes" sem sourceScope ⇒ todas as raízes.
  Métrica calc ad-hoc exporta `formula` em TOKENS (caminho B do validador);
  `custom:`+calc degrada a field/agg/label (única perda conhecida). UI:
  `exportDashboardStructure` (`export-structure-actions.ts`) + item
  "Exportar JSON" no ⋮ do card (download; `issues` = erros de round-trip como
  aviso).
- **Identidade FORÇADA no servidor** (`lib/import/dashboard/rewrite.ts`,
  `normalizeImportRaw`): a `chave` do JSON da IA é SEMPRE sobrescrita pela
  canônica ANTES da validação (o validador então deriva todos os presetKeys
  dela). Nunca confie a chave à IA — uma chave copiada da referência
  sobrescreveria o board de ORIGEM no modo "a partir de". No modo Editar
  também injeta `visible_to_roles`/`settings.tabs` atuais quando o JSON os
  omite (ausência seria destrutiva: des-compartilhar / apagar o `tab` dos
  widgets retornados).
- **Modo Editar** (`applyDashboardEditJson`, `actions.ts`): gate dono/admin →
  normaliza → valida → gates por seção (`importSectionGateError`) →
  `captureDashboardSnapshot` (Desfazer) → ADOÇÃO (carimba `settings.presetKey`
  canônico nos widgets divergentes, via `assignWidgetKeys`) →
  `applyPresetDefinition` com **`opts.targetDashboardId`** (carrega SÓ essa
  linha — sem busca por identidade/adoção por nome, sem INSERT) e **SEM GC**
  (decisão de produto: a IA nunca exclui widget; omitido permanece ⇒ a
  resposta pode ser PARCIAL, só widgets alterados/novos). `fontScale` virou
  chave GERIDA do UPDATE (presets de fábrica não a definem — zero mudança).
  `connectors`/`sourceScope` ficam fora do alcance da IA (preservados).
  **Merge por widget (24/07/2026):** a resposta pode ser PARCIAL também DENTRO
  do widget — `applyDashboardEditJson` exporta o board e passa `baseWidgets` a
  `normalizeImportRaw`, que faz deep-merge do widget da IA (casado por `key`)
  sobre o do estado exportado: a IA manda a `key` + só os campos que mudam
  (`settings` mescla por chave; arrays substituem; `null` limpa) e o resto é
  preservado no SERVIDOR, sem re-emitir o widget inteiro (antes, campo omitido
  de um widget INCLUÍDO era apagado). Widget de key NOVA passa intacto; widget
  do estado não referenciado NÃO é adicionado (o sem-GC preserva a linha).
  **Cópia por referência — `copy_of` (24/07/2026):** widget da IA de key NOVA
  com `"copy_of": "<key existente>"` usa o widget de origem como BASE do mesmo
  deep-merge (a IA manda só o delta da cópia — "igual ao X mudando Y" sem ecoar
  a definição inteira). Resolvido e REMOVIDO em `normalizeImportRaw` ANTES da
  validação (o validador/export nunca veem o marcador). Sem `grid_position` no
  delta, a cópia empilha ABAIXO do fundo da aba dela (herdar a posição da
  origem sobreporia os dois; o auto-empilhamento do validador começa em y=0 e
  colidiria com widgets reais). `copy_of` em key JÁ existente é ignorado (merge
  normal); origem desconhecida = só remove o marcador (o laço de correção
  reporta os campos faltantes).
- **Modo Criar a partir de** (`applyFromReference`, `ai-generate-actions.ts`,
  24/07/2026): cópia FIEL da referência via `duplicateBoard` (clone por banco —
  widgets/células/placements com ids novos, sem `preset`/`presetKey`; a IA não
  reproduz nada) + o DELTA da IA aplicado como Edição na cópia
  (`applyDashboardEditJson`, reusa o merge + SEM GC). A IA responde só com o
  ADITIVO (widgets/abas NOVOS — `FROM_RULES`); mudar/remover um widget copiado é
  turno de Editar seguinte. Duplica só no APPLY (nunca em turno não aplicado ⇒
  sem cópias órfãs) e o cliente troca a sessão para Editar pelo `id` retornado.
  Substitui o antigo `importDashboardJson` do modo from (que recriava tudo do
  zero e dependia de a IA reproduzir a referência verbatim). O modo `new` segue
  em `importDashboardJson`.
  **Mescla multi-referência (30/07/2026):** além da base, o usuário pode marcar
  até `MAX_EXTRA_REFS` (4) referências ADICIONAIS
  (`GenerateDashboardInput.extraReferenceIds`). Elas existem SÓ na GERAÇÃO:
  cada extra é exportada e fundida por `fuseExtraReferences`
  (`lib/import/dashboard/multi-ref.ts`) — keys de widget prefixadas `rN_`
  (N = índice da referência; dedup contra as keys da base, convenção `_2` do
  `assignWidgetKeys`), `settings.tab` REMOVIDA (aba de outro board), união das
  bases (o `buildImportPrompt` cobre o catálogo de todas) e uma section de
  prompt `REFERÊNCIA ADICIONAL N — "<nome>" (JSON)` por extra (só `widgets`,
  sem envelope). O rewrite recebe os specs prefixados em
  `NormalizeImportRawOpts.refWidgets` — origem de `copy_of` APENAS: fora do
  merge por key e fora do `bottomByTab` (posições/abas de outro board
  poluiriam o empilhamento); em colisão de key, a base vence. Cópia de origem
  ref sem aba própria empilha no fundo da PRIMEIRA aba do JSON (com extras o
  from passa a injetar `currentTabs` — é onde o validador coloca widget sem
  aba). Como o `copy_of` é resolvido ANTES do apply (o `pendingJson` já sai
  resolvido), `applyFromReference`/`duplicateBoard` seguem single-id e
  INTOCADOS — keys `rN_` nunca chegam ao validador em operação normal.
  Fiscalizado por `multi-ref.test.ts` + bloco refWidgets em `rewrite.test.ts`.
- **Conversa** (`ai-generate-actions.ts` v2): STATELESS por turno — o servidor
  re-exporta o estado FRESCO para o system a cada turno e recebe só os textos
  de usuário anteriores (cap 10); nada de JSON de assistant acumulado. A ÚNICA
  saída de assistant reinjetada (24/07/2026) é a PRÉVIA PENDENTE não aplicada
  (`input.pendingJson` — painel: `row.pending.json`; sheet: estado local), que
  entra como seção própria do system com a semântica "a resposta deste turno
  SUBSTITUI a prévia inteira" — sem ela, "ajusta o card que você propôs" falha
  com auto-aplicar OFF (o estado re-exportado do banco não a contém). Nos modos
  from/edit o laço de geração normaliza com `baseWidgets` (24/07/2026: também
  no from — a validação do turno ganha a MESMA semântica de merge/`copy_of` do
  apply, que no from mescla sobre a cópia via `applyDashboardEditJson`). Após o
  1º apply em new/from o CLIENTE troca a sessão para `edit` +
  `targetDashboardId`. Toggle "Aplicar automaticamente": OFF ⇒ o turno devolve
  `pendingJson`+resumo e `applyGeneratedDashboard` aplica depois
  (re-valida/re-gates/re-deriva tudo — nada confiado do cliente). Truncamento
  é erro TIPADO (`AiTruncatedError`, detectado nos 3 adapters; Gemini subiu a
  32k tokens) e aborta o turno com mensagem acionável. Desfazer =
  `restoreDashboardSnapshot` com o snapshot devolvido pelo turno.
- **Consequência documentada**: editar por IA um dashboard de PRESET DE
  FÁBRICA re-identifica o board como `import:` — ele deixa de ser atualizado
  por "Gerar presets" (que recriará o de fábrica à parte). O picker avisa.

#### 4.11.3 Painel "Editar com IA" dentro do dashboard — sessão persistida (24/07/2026)

A conversa do §4.11.2 também abre DENTRO de um dashboard, sempre em modo
EDITAR (alvo = o próprio board), com a sessão persistida em banco
(`dashboard_ai_sessions`, 0098 — uma linha por usuário×board). Peças:

- **UI** (`components/dashboards/ai-edit-panel.tsx`): botão "Editar com IA" na
  toolbar do board (page passa `canAiEdit` = dono/admin + `create_dashboards`,
  e a config pública do provedor pela org do BOARD). O TÍTULO do painel aberto
  é o MODELO configurado com a 1ª letra maiúscula (ex.: "Gemini-2.5-flash";
  subtítulo mostra o rótulo do provedor; fallback "Editar com IA" sem config —
  botões de gatilho/chip seguem "Editar com IA"/"IA"). O painel é uma div FIXA
  à direita, **não-modal** (sem overlay/portal — o dashboard atrás segue
  interativo; `z-40`, abaixo dos Sheets `z-50`) e **recolhível** para um chip
  flutuante (dá para testar o dashboard com um turno em voo e voltar). O log de
  chat é o `AiChatLog` (`ai-chat-log.tsx`), extraído do sheet da Home e usado
  pelos dois. Estado do painel (aberto/recolhido) é React puro — sobrevive a
  `router.refresh()`, e F5 recarrega o CONTEÚDO do banco (reabrir é 1 clique;
  sem auto-abrir por design).
- **Actions** (`app/(app)/dashboards/ai-session-actions.ts`): o SERVIDOR é a
  fonte de verdade dos turnos — o turno carrega os turnos do banco, chama o
  MESMO núcleo de geração da Home (mode "edit"; cap de 10 turnos ao modelo
  inalterado) e persiste chat + prévia + snapshot num upsert único; o
  cliente envia só a mensagem nova e SUBSTITUI o estado pelo canônico devolvido
  (chat/pendingSummary/hasUndo — sem merge local). Desde 26/07/2026 o corpo
  do gate/linha da sessão/turno vive em `lib/ai/edit-session.ts`
  (`gateAiEdit`/`loadRow`/`saveRow`/`runAiEditTurnCore`) e o da geração em
  `lib/ai/generate-dashboard.ts` (`generateDashboardCore`) — as actions
  (`runAiEditTurn`, `generateDashboardWithAi`, …) são wrappers finos; NÃO
  recrie gate/persistência fora desses módulos. A prévia pendente
  (auto-aplicar OFF) fica no banco: `applyAiEditPending` lê o JSON de lá (nada
  bruto viaja do cliente) e ela sobrevive a F5. Gate em TODA action (antes de
  qualquer leitura): `create_dashboards` + dono/admin do board (espelho da
  geração; RLS own-row + org como muralha — ver banco §3.3). Caps de
  armazenamento: 30 turnos / 100 entradas de chat.
- **Raciocínio ao vivo (26/07/2026)**: o TURNO do painel entra pela rota de
  streaming `POST /api/dashboards/<id>/ai-turn` (server action não faz
  streaming), que roda o MESMO `runAiEditTurnCore` e devolve NDJSON — linhas
  `{type:"thought"}` com o raciocínio do modelo e uma linha final
  `{type:"state"}` com o `AiEditSessionState` canônico (inclusive erros de
  gate; anti-CSRF: cookies SameSite=Lax + checagem de `origin`). O raciocínio
  é EFÊMERO (só exibido durante a geração — `busyDetail` do `AiChatLog`; nunca
  persistido na sessão). Contrato nos adaptadores: `AiGenerateInput.onThought`
  (best-effort) — implementado no Gemini via `:streamGenerateContent` (SSE) +
  `thinkingConfig.includeThoughts` (resumos de pensamento; os modelos atuais
  já pensam por padrão, então NÃO há custo extra de tokens). Regra de custo:
  NUNCA habilitar thinking num modelo em que ele vem desligado (Claude Opus
  4.8/Haiku, gpt-4.1…) — Claude/OpenAI seguem sem raciocínio exibido. Demais
  actions (aplicar/desfazer/recomeçar/carregar) seguem server actions.
- **Desfazer/Recomeçar**: o snapshot pré-turno do último apply
  (`EditDashboardState.snapshot`) é persistido em `undo_snapshot` —
  `undoAiEditSession` restaura via `restoreDashboardSnapshot` e limpa (sempre a
  ÚLTIMA edição inteira da IA; edições manuais posteriores também voltam — o
  tooltip avisa). "Recomeçar" zera turns/chat/pending mas PRESERVA o undo (a
  última edição continua no board; apagar o snapshot deixaria o usuário sem
  como desfazê-la). Independente do Desfazer/Refazer in-memory do board
  (`history-context.tsx`), como já era no sheet da Home.
- **Limitações aceitas (v1)**: duas abas do mesmo usuário no mesmo board fazem
  last-write-wins na linha da sessão; se o upsert da sessão falhar logo após um
  apply ok, a edição fica no board sem snapshot salvo (janela rara). O fluxo da
  Home (`ImportDashboardSheet`) segue 100% client-state, inalterado.
- `app/(app)/dashboards/[id]/page.tsx` exporta `maxDuration = 300` (as actions
  do painel rodam sob o segment config DESTA rota — espelho da Home).

### 4.12 Espaço de grid v2 (grade fina) e Páginas de widget (25/07/2026)

**Grade fina (espaço v2).** A célula do grid deixou de ser ancorada em 12
colunas com margens de 12px e passou a `canvas.baseCols` (default 120) colunas
SEM margens, com linha default QUADRADA (`rowHeight` ausente = largura da
célula). Unidades de `grid_position`/`ShapeLine` ficaram 10× mais finas no X e
4× no Y. Módulo canônico: `lib/widgets/grid-space.ts` (constantes + conversões
+ `normalizeGridSpace`). Como o legado convive:

- **Detecção**: `dashboards.settings.canvas.gridVersion === 2` = espaço fino;
  AUSENTE = legado (base 12). `createDashboard` carimba o gridVersion na
  criação (board novo nasce fino, linha quadrada).
- **Leitura (runtime, obrigatória)**: TODA leitura de `grid_position`/settings
  crus passa por `normalizeGridSpace` antes de usar — page do dashboard,
  `captureDashboardSnapshot`, `exportDashboardJson` (choke dos 3 chamadores),
  refresh de snapshot e o viewer público (`app/s/[token]`). A runtime é
  PERMANENTE no viewer: `snapshots.config` é um jsonb CONGELADO que nenhum
  backfill de `widgets` alcança.
- **Escrita (migração lazy)**: `ensureFineGrid(supabase, dashboardId)`
  (actions.ts) roda no topo de TODO escritor de geometria (`saveLayout`,
  `saveShapeLine`, `createWidget`, `updateDashboardSettings`,
  `applyPresetDefinition`, merge/unmerge de páginas): lê os widgets ANTES do
  carimbo CAS (`update … where gridVersion is null`, count) e converte as
  linhas SÓ se venceu o CAS — a ordem leitura→carimbo→conversão torna a dupla
  conversão impossível (toda escrita fina de terceiro exige um CAS-fail, que
  exige um carimbo commitado, posterior à nossa leitura). Runbook:
  `supabase/apply/backfill-grid-v2.sql` converte tudo de uma vez (e é o reparo
  do caso residual "carimbo sem conversão" — crash no meio).
- **Matemática**: `x·10 | y·4 | w·10−1 | h·4−1` (o −1 preserva o vão visual
  que as margens davam); linha divisória escala fracionária sem o −1 e o bbox
  é DERIVADO do traçado fino; `rowHeight` convertido sai EXPLÍCITO
  (`(R+12)/4`, default 30 → 10.5) — sem ele o board migrado esticaria com a
  viewport (o legado era px fixo). Board novo (sem canvas) fica no quadrado
  responsivo.
- **IA/import**: JSON SEM `canvas.gridVersion` segue validado nas unidades
  legadas (12 colunas, defaults 6×8) e o preset sai CONVERTIDO do validador;
  com carimbo, valida em unidades finas. Nos modos Editar/Criar-a-partir-de o
  `normalizeImportRaw` injeta o canvas do ESTADO exportado sob o da IA
  (`currentCanvas`) — sem o carimbo herdado, o delta fino da IA seria
  re-escalado ×10. `instructions.ts` documenta as duas escalas (regra 8).
  Clipboard de widget idem (`gridVersion` no payload; antigo é convertido na
  leitura).

**Páginas de widget (mescla).** Dois ou mais widgets dividindo o MESMO espaço,
alternados por setinhas acima do card (`WidgetPager`). Vínculo:
`settings.pages: string[]` no HOST (ids dos membros; host = página 1; ordem =
2..N). Módulo puro: `lib/widgets/pages.ts`; UI: `widget-pages.tsx` +
`dashboard-grid.tsx` + itens do ⋮ no `widget-card.tsx`.

- Membros são linhas NORMAIS de `widgets` (grid_position preservado) ocultadas
  de `gridWidgets` no grid (layout/persist/children/conectores/extensão do
  canvas, tudo junto — o viewer de snapshot ganha de graça). A página ativa é
  estado EFÊMERO (`pageIndexByHost`); trocar de página REMONTA o card
  (`key={shown.id}`) e os widgets deferidos disparam o próprio fetch — a page
  computa dados de TODOS os widgets (não filtra por aba/visibilidade), então
  o dado da página oculta já chega nas props.
- **Drop quase-em-cima** (`findMergeTarget` em `persist`): sobreposição ≥65%
  da área do menor + tamanhos com |Δ| ≤ max(folga, 25%) ⇒ diálogo "Adicionar
  página?". Confirmar chama `mergeWidgetPages`; cancelar DESFAZ o arraste
  (patch otimista de volta à base — o banco nunca foi tocado). O arrastado
  não pode já ser host; o alvo pode (vira +1 página).
- **Actions**: `mergeWidgetPages` (valida elegibilidade/duplo-vínculo, força
  `settings.tab` do membro = aba efetiva do host — o refresh de snapshot
  congela POR ABA — e remove conectores com ponta no membro) e
  `unmergeWidgetPages` (devolve membros via `findFreePosition` na aba do
  host). `deleteWidget` lê settings ANTES do delete: host excluído devolve os
  membros ao canvas; membro excluído sai do `pages` de quem o referencia.
- **Serialização**: `pages` NUNCA sai no export/JSON de IA nem no clipboard
  (ids não sobrevivem — mesma razão de connectors/kanban) e é PRESERVADA pelo
  apply de edição (`applyPresetDefinition` re-injeta do settings existente).
  `duplicateBoard` não precisa de nada (o `remapJsonIds` já troca os uuids).
  `validate.ts` remove `pages` vindo por JSON com warning.

### 4.13 Agrupamento de responsáveis por exibição (canonical_id, 26/07/2026)

O mesmo responsável pode existir DUPLICADO em `responsibles` porque as chaves
de matching divergem por fonte: o Bitrix casa por `bitrix_user_id`, planilha e
CSV casam por nome normalizado (`normalizeName` — grafia um pouco diferente
cria uma segunda entidade). A unificação é por **exibição, reversível**:
`responsibles.canonical_id` (0101) marca a linha como **apelido** de um
principal ("nome usado") — `records.responsible_id` **nunca é repontado** e
limpar a coluna desfaz tudo. O grupo é sempre **plano** (apelido aponta direto
ao principal; a action `setResponsibleCanonical` de Configurações →
Responsáveis repontea filhos ao mesclar um principal e resolve alvo-apelido
para o principal dele). Na tela (01/08/2026), apelidos ficam **recolhidos**
sob o principal — o badge "N unificados" expande as linhas-filho (controles de
Ativo/desfazer/Operações preservados) — e o alvo do "Nome usado" só oferece
principais.

Resolução 100% engine/loaders (`lib/config/responsible-canon.ts` —
`loadResponsibleCanon` cacheado + helpers puros), com gate barato: sem
referência a `responsible_id` na config, nenhuma consulta extra e caminho
byte-idêntico. Superfícies:

- **Filtros** (`runWidget`/`runCalculatedWidget`/`runRecordList*`):
  `expandResponsibleFilters` reescreve `eq`/`eq_ci`/`in` de `responsible_id`
  para `in` no GRUPO — inclusive o `responsible_id in` produzido pela tradução
  de operação (que roda antes, na page/widget-scope) e as condições de SOMASE
  (pós `resolveFkCondFilters`). Expansão idempotente; uuid fora de grupo (ex.:
  o filtro impossível) passa intacto.
- **Dimensões**: `mergeRowsByBucket` (bucket-merge v1.2) funde as linhas do
  RPC apelido→principal no choke point único de `computeRows`; o caminho por
  registros canonicaliza em `dimValue`. Rótulo id→nome sai do PRINCIPAL
  (`fetchFkLabels`/`collectRecordFkLabels` canonicalizam antes do lookup).
- **Dropdowns**: `collapseResponsibleOptions` remove o apelido SÓ quando o
  principal está presente na lista (quick filters, filtro_campo, picker do
  construtor, /registros, form e refresh de snapshot). Selects de
  **write-back** (atribuir responsável) NÃO colapsam — gravam o responsável
  real.
- **Snapshots**: `responsibles` é PASSTHROUGH no adapter — o viewer lê o
  agrupamento AO VIVO (desfazer vale retroativamente); a restrição
  `allowed_responsible_ids` é gravada JÁ EXPANDIDA (create/updateSnapshot) e o
  RPC segue lendo a coluna como está.
- **RLS do vendedor** (invariante 8): `auth_responsible_ids()` (redefinida na
  0101) devolve o grupo inteiro — sem isso, registros no id do apelido
  sumiriam do vendedor. A exceção do vendedor da page/widget-scope expande o
  mesmo conjunto.
- **Kanban/tabelas**: `recordGroupKey` canonicaliza o agrupamento por
  responsável; o "Agrupar por" da tabela de registros recebe o mapa via prop
  `respCanon` (o keyOf chaveia FK por id cru de propósito — proteção contra
  homônimos preservada nas demais FKs).

Limitações documentadas: `appearance.categoryColors`/`categoryOrder` chaveiam
pelo nome exibido (cores salvas com o nome antigo deixam de casar — cosmético);
metas (`goals`) por responsável não se fundem; snapshots com restrição gravada
ANTES de mudar um grupo precisam ser re-salvos para incluir apelidos novos;
entity-list (`rowSource: responsibles`) segue exibindo apelidos como linhas.

### 4.14 Parcerias: match dinâmico, conexão reativa e sub-operações automáticas (26/07/2026)

Caso de uso: uma base "Parceiros" (CSV/API) e leads do Bitrix que carregam o
identificador do parceiro num campo (ex.: `custom:bitrix_uf_crm_1784828550`,
"Email parceiro"). Três peças, todas reutilizando a infra existente:

- **Match para bases dinâmicas (0104).** Os helpers `_widget_match_expr` /
  `_widget_match_expr_snap` resolvem a fonte do ref `match:<fonte>:<ref>` por
  lookup `data_sources.key → record_type` (fallback no mapeamento histórico
  `leads/deals/estudo`; `immutable` → `stable`). Antes, o `case` hardcoded
  erguia exceção para qualquer base nova — o construtor oferecia
  `↪ Parceiros: …` e o widget agregado explodia. Sub-fontes NUNCA casam
  (compartilham o `record_type` da pai): `buildMatchFields` itera só raízes,
  o matches-manager só oferece raízes como Base A/B e o validador de import
  da IA rejeita `match:<sub>:*`. A regra de conexão em si é a de sempre
  (`match_rules` + `record_matches`, aba Conexões em `/campos` — ex.: campo
  "Email parceiro" do lead ↔ `custom:email` da base Parceiros).
- **Conexão reativa pós-sync (A2).** O sync do Bitrix agora dispara, ao
  CONCLUIR um job que escreveu algo, `maybeAutoMatchAfterJob` (runner):
  `runAutoMatchIncremental` roda só as regras cujos `record_types` foram
  tocados — lado A restrito a `last_synced_at >= started_at` do job (índice
  `idx_records_type_synced`), lado B indexado inteiro (base de referência
  pequena); regra com só o lado B tocado roda cheia. Pares inseridos
  alimentam `recalcFormulaFieldsForRecords` (recalc DIRECIONADO — mesmo
  pipeline do geral com `.in("id", …)`). Tudo best-effort, padrão
  `maybeAnalyzeAfterJob`. Declare a regra de parcerias com `source_a = lead`
  para o custo ficar O(tocados no tick).
- **Fusão de perfis de operação (0105 + operation-scope v2).**
  `loadOperationScopes` ficou BATELADO (1 query de `operations` + 1 de
  `responsible_operations`; subárvore em JS ciclo-safe) e devolve também
  `subtreeProfiles` (filhas ATIVAS com perfil + flag de vínculo). Quando a
  seleção é 100% "profile-only" (nenhum responsável nas subárvores),
  `fuseOperationProfiles` funde perfis de condição ÚNICA sobre o MESMO campo
  (`eq`/`eq_ci`/`in`, mesmas `sources`) num único filtro: `in` quando todos
  exatos, `in_ci` (op interno novo do par de RPCs, 0105 — pertencimento com a
  normalização do `eq_ci`) quando qualquer `_ci` está presente. Cobre a
  multi-seleção de parcerias no filtro rápido (antes: perfis descartados →
  IMPOSSIBLE → dashboard zerado) e a seleção do PAI "Parceiro" (roll-up das
  filhas). Caso misto (vínculo + perfil) ou não-fundível degrada EXATAMENTE
  como antes. `updateOperation` ganhou detecção de ciclo indireto de pai.
- **Sub-operações automáticas (0106).** Config 1-por-base em
  `source_auto_operations` (`parent_operation_id`, `name_field`/`value_field`
  — refs no registro da base, `target_field`/`target_sources` — ref/alvo no
  lead, `profile_op` `eq_ci`|`eq`; RLS espelha `operations_write`; UI em
  Registros → Bases, seção "Sub-operações automáticas" + botão "Gerar
  agora"). A rotina (`lib/operations/auto-operations.ts`, service role com
  carimbo EXPLÍCITO de `organization_id` da config) materializa uma
  sub-operação por registro válido: identidade por
  `operations.auto_source_record_id` (unique parcial) — rename do parceiro
  renomeia a MESMA operação; homônima sem vínculo é ADOTADA (normalizeName,
  como o seed 0053); registro sumido/sem identificador INATIVA (nunca
  exclui); perfil gerado é PROPRIEDADE do gerador (edição manual do perfil é
  sobrescrita). Ganchos: `finalizeCsvImport`, `POST /api/ingest/<source>`,
  criação/edição manual de registros (`ensureAutoOperationsForRecordType`,
  gate barato) — todos best-effort.

Limitações documentadas: `records.operation_id` (derivada de
`responsible_operations.priority=1`) fica NULL para registros recortados só
por parcerias — a DIMENSÃO "por Operação" e a restrição
`snapshots.allowed_operation_ids` não enxergam parcerias (um lead pode
pertencer à operação do responsável E a uma parceria; a coluna é
single-valued — use filtro fixo de dashboard para snapshot restrito a
parceria). `in_ci`, como o `eq_ci`, não tem tradução no modo LISTA (widget de
lista com filtro de parceria não recorta pelo perfil). Dropdowns de operação
seguem planos (centenas de parcerias = dropdown grande). O e2e não tem
fixture de base dinâmica com match (cobertura live do caminho novo é
follow-up conhecido).

Nota (31/07/2026): o assistente de IA de operações (§4.17) NUNCA toca
operações automáticas de parceria — o validador e o apply barram edição/
vínculo/desvínculo/filha sob elas (a rotina é a dona; invariante 22).

### 4.15 Automações do kanban e ações em massa (27/07/2026)

**Automações** (`kanban_automations`, 0109): regras condicionais por quadro
(widget kanban OU kanban dedicado — XOR de dono, padrão 0067) que MOVEM cards
automaticamente. Uma regra = `{ v:1, conditions[], action }` (jsonb versionado,
parse fail-closed em `lib/kanban/automations/types.ts`): as condições valem em
E e MESCLAM 4 famílias — campo do registro (`WidgetFilter` inteiro, incl. refs
`match:`), contagem de registros CONECTADOS (`record_matches`, qualquer
direção, com filtros sobre o conectado — "parceiro com ≥ N leads ganhos"),
tarefas do card (abertas/atrasadas) e tempo em dias de calendário (desde
criação / última alteração de campo via `field_modified_at` / entrada na
coluna Personalizar via `kanban_placements.updated_at`). Regras em ordem
(`position`): a PRIMEIRA que casa vence por card; ações =
`move_to_column` e `set_field` (31/07/2026 — união extensível).

**Ação `set_field` (31/07/2026):** grava um valor FIXO num campo do registro
("toda reunião com fonte X recebe SDR Y" como regra contínua, valendo p/
registros futuros). Parse fail-closed valida SÓ a estrutura (`field`/`value`
não-vazios); o ALVO é validado na AVALIAÇÃO por `setFieldTargetError`
(`evaluate.ts` — a régua ÚNICA: campo fora do catálogo, data, calculado,
relação, `match:`/`unified:`, coluna core fora de `EDITABLE_CORE_COLUMNS` e o
campo-espelho da alocação `allocationFieldKey` — invariante 24 — viram regra
INERTE + `last_error`; o catálogo pode mudar DEPOIS da regra criada), com a
MESMA validação no save (`saveAutomation`) p/ mensagem imediata e no picker
da UI (`settableFields` do `getAutomationFieldOptions` — deriva de
`buildAvailableFields`, nunca lista paralela). IDEMPOTENTE por desenho: o
avaliador compara o valor ATUAL no snapshot da rodada (`recordRawValue`,
régua string do `updateRecord` — null ≡ '') e valor igual consome o card SEM
emitir escrita — zero churn de audit/webhook no tick por minuto. Valor
booleano/numérico é coerido no executor; campo de DATA nunca é alvo (não
idempotente — mesma razão do bucket de data).

Execução 100% no ENGINE (RPCs de widget intocados), com SERVICE ROLE e escopo
EXPLÍCITO de org em toda consulta (`opts.orgId` do `runRecordList` — v2.1 do
record-list): `runBoardAutomations` (`lib/kanban/automations/engine.ts`) reusa
`runKanban` (period null — a barra de período é filtro de VISÃO; resolução de
colunas/placements/`__match` de graça), monta os fatos que as regras pedem
(gates — tasks/fmod/placements/`countRelatedBySource` só quando usados),
decide no avaliador PURO (`evaluate.ts`/`decideActions` — decisões sobre o
snapshot original: sem ping-pong intra-rodada; mock nunca move nem recebe
escrita; alvo overflow/coluna sumida/campo proibido = erro da regra, nunca
silêncio) e executa em `move.ts`: Personalizar = upsert
de `kanban_placements` (dado da visão); escrita de CAMPO (move por valor E
`set_field`) SÓ pelo executor único `executeFieldWrites` — carimbo
`field_modified_at` + `locally_modified_at` (protege da Sync),
efeitos em LOTE (um `recalcFormulaFieldsForRecords`, um insert de `audit_log`
origin `'automation'`/user null, write-back opcional espelhando o gating do
`updateRecord`, webhook `record.updated` por registro). Teto ÚNICO
`MAX_ACTIONS_PER_RUN` (200 — moves + sets somam)/quadro/rodada;
`last_moved_count` conta AÇÕES (a UI rotula "ações"). Fora do escopo v1
(falham ALTO no
`last_error`): modo tarefas e colunas por BUCKET DE DATA (mover reescreveria
uma data real relativa a "hoje" a cada tick — não idempotente).

Gatilhos: tick por minuto (`/api/kanban-automations/tick`, pg_cron via
`supabase/apply/pg-cron-kanban-automations.sql`, SYNC_SECRET + orçamento de
45s; round-robin pelos donos mais antigos — `min(last_run_at)`), hook
pós-sync (`maybeRunKanbanAutomationsAfterJob`, deadline curto, DEPOIS do
auto-match p/ contagens verem vínculos frescos) e "Executar agora" na UI.
Autoria = gate de EDITOR do board (RLS de `kanban_automations` via
`auth_board_editable` nos dois braços + org); execução tem autoridade de
sistema (como o sync) — documentado, não bug. Bookkeeping por regra
(`last_run_at`/`last_error`/`last_moved_count`) em vez de tabela de runs. UI:
`components/kanban/automations-sheet.tsx` (página dedicada, página cheia do
widget e widget no dashboard; campos via `buildAvailableFields` +
`toFieldOptions` — nunca listas paralelas). Regras NÃO viajam no
export/IA/duplicação de board (tabela própria, fora de `settings.kanban` — o
widget-builder reconstrói o objeto `kanban` no save e derrubaria chaves
novas).

**Ações em massa** (`lib/kanban/bulk-actions.ts` + seleção no
`kanban-board.tsx`): seleção por checkbox (hover/Ctrl+clique; select-all por
coluna; Esc limpa; mock nunca selecionável) + barra flutuante — Mover para,
Gerar tarefa (uma por card), Concluir tarefas (abertas dos cards; no modo
tarefas, as selecionadas) e Excluir (registros: EXCLUSÃO REAL, gate de ADMIN
na action espelhando a RLS `records_delete` + confirmação na UI + webhook
`record.deleted`; tarefas: RLS/cadeado decidem por item). Contrato: resultado
POR ITEM (`{ id, ok, message }[]`, teto 200/chamada, cliente fatia) — é o que
permite o revert parcial. TODO movimento (card único incluso, e multi-drag
via `KanbanDragPayload.items` — retrocompatível) passa pela fila otimista
`use-kanban-bulk-queue.ts`: aplica local NA HORA, despacha em background
(chunks de 50, sequencial), reverte SÓ os itens que falharam e os acumula num
painel persistente com "Tentar novamente"; ao drenar, emite `emitDataChanged`
+ um refresh debounced. O resync `data` → estado local do board é GUARDADO
enquanto a fila está em voo (dado que chegou durante a fila é descartado como
stale — o refresh do settle traz o fresco); sem a guarda, um
`router.refresh()` no meio da fila clobraria o estado otimista.

**Métricas de card/coluna do kanban (28/07/2026)** — 100% no ENGINE (RPCs
intocados, sem migração). Config em `settings.kanban`:
`columnMetric { spec, agg }` (cabeçalho da coluna, agregação escolhível) e
`card.badges: KanbanMetricSpec[]` (até 3 indicadores por card). Um
`KanbanMetricSpec` é `field:<ref>` | `linked:<base raiz>` ("Leads
vinculados") | `tasks:open|overdue` | `age`. A leitura é normalizada em UM
lugar (`normalizeKanbanMetrics`, `lib/kanban/metrics.ts`): `columnMetric`
vence o `metric` legado (string = campo somado); `card.badges` AUSENTE =
comportamento legado (pill de tarefas abertas — o pipeline nem emite
`card.badges`, então lista/CSV/render de quadros antigos seguem
byte-idênticos); `[]` explícito = sem badges. No `runKanban`
(`lib/kanban/data.ts`) os fatos são GATEADOS pela config: sem métrica nova,
zero consulta extra. **Conectados**: `countRelatedBySource` foi movido de
`lib/kanban/automations/` para `lib/kanban/related-count.ts` (compartilhado
entre automações e métricas) e ganhou `opts.extraPairs` — pares extras
OPT-IN do gêmeo `records.related_lead_id` quando a base contada resolve p/
`record_type='lead'` (espelha o coalesce do `_widget_match_expr`, 0104; o
dedupe de par cobre gêmeo × match real). As automações (`related_count`)
seguem chamando SEM `extraPairs` — a condição mantém a semântica antiga
(divergência DOCUMENTADA: convergir é passar o opt-in lá). **Atrasadas**: a
query de tarefas do quadro passou a selecionar `due_date` e conta
abertas+atrasadas na mesma passada (régua canônica: aberta com prefixo de
`due_date` < hoje de Brasília — a mesma do engine de automações). **Idade**:
`opened_at ?? source_created_at` em dias de calendário (prefixo YYYY-MM-DD).
Falha de consulta é FAIL-SOFT: o valor vira `null` e o renderer OCULTA
(nunca 0 enganoso) — é o que acontece com `tasks` no viewer de snapshot
(adapter fail-closed); `record_matches` funciona no snapshot via
`snapshot_record_matches` (adapter de 0056). O tick de automações chama
`runKanban` com `opts.lean` (pula badges/conectados — os fatos das regras
têm gates próprios). UI: builder do widget (save path grava
`columnMetric`/`badges` explicitamente — o rebuild derrubaria chaves não
copiadas) e popover "Métricas" na página dedicada/cheia
(`components/kanban/metrics-popover.tsx`, spread completo via
`persistKanban`). Formatação única em `components/kanban/format.ts`
(dinheiro / "N d" / número pt-BR).

### 4.16 Alocação do kanban como campo do registro (28/07/2026)

Num quadro **Personalizar** a coluna de cada card é dado da VISÃO
(`kanban_placements`) — invisível a filtros fora do kanban. O toggle **"Expor
a fase como campo do registro"** (engrenagem "Colunas"; só modo Personalizar —
nos modos por campo/data a coluna já É um campo) materializa essa alocação num
campo comum do catálogo: `setKanbanAllocationField`
(`lib/kanban/allocation-actions.ts`) cria (ou ADOTA, no re-enable — off/on não
prolifera campos) um `field_definitions` "Fase — \<nome do quadro\>" (`selecao`,
`options` = rótulos das colunas visíveis em ordem, `applies_to` =
`record_type` da base, campo LOCAL: `source_system` null + `is_local`) e
guarda a `field_key` em `settings.kanban.allocationFieldKey`. A partir daí o
campo entra em `buildAvailableFields` → refs `custom:<key>` em widgets/
filtros/quick-filters/snapshots **sem nenhuma mudança de RPC/engine**.

Semântica: o campo é ESPELHO derivado — `kanban_placements` segue sendo a
fonte de verdade. Registro sem posição conta na 1ª coluna (o campo grava o
rótulo dela: o filtro bate com o que o quadro mostra); chave órfã (coluna
excluída) idem, via fallback do `runKanban`. Valor gravado = RÓTULO da coluna
(rótulos duplicados entre colunas = valor ambíguo; documentado, não
bloqueado). Mock nunca recebe escrita (0051). Edição manual do campo é
revertida pelo reconcile.

Escrita em DOIS caminhos, ambos service-role com org EXPLÍCITA, carimbo
`field_modified_at[key]` + `locally_modified_at` (protege da Sync), recalc
direcionado, e **sem audit_log/webhook** (dado derivado — o reconcile pós-sync
tocaria milhares de linhas e viraria tempestade de `record.updated`):

- **Dual-write pós-move** (`applyAllocationOnMoves`/`applyAllocationForSettings`,
  `lib/kanban/allocation-field.ts` + `allocation-reconcile.ts`): os 3
  escritores de placement (`moveRecordCardsBulk`, executor de automações,
  `moveRecordCard`) gravam o rótulo destino na mesma rodada — filtro fresco
  logo após o drag. A autorização é o upsert do placement (RLS por quadro); o
  campo é efeito derivado de sistema (o movedor pode não ter
  `edit_record_values`).
- **Reconcile** (`reconcileKanbanAllocationField`/`…All…`): reusa `runKanban`
  (period null, como as automações), sincroniza `options` e grava só DIFFS.
  Gatilhos: backfill do enable, saves de settings com colunas mudadas
  (`normalizeKanbanAllocationOnSave` — que também faz STRIP da chave ao sair
  do Personalizar ou trocar de base), hook pós-sync (DEPOIS das automações) e
  o tick por minuto (catch-all p/ registros criados no app/CSV/Sheets). Campo
  excluído em /campos → o reconcile LIMPA a chave (self-healing). Desligar o
  toggle / excluir o quadro mantém campo e valores (param de atualizar).

A chave vive em `settings.kanban` (diferente das automações, que exigiram
tabela própria) porque o builder a RE-EMITE explicitamente no branch
`isCustomCols` e a enumeração do tick é um filtro jsonb barato sobre
`dashboards`/`widgets`. `createWidget` e `duplicateBoard` fazem STRIP da chave
(cópia nunca herda o vínculo — escreveria no campo do quadro original).
Fiscalizado por `lib/kanban/allocation-field.test.ts`. Ver invariante 24.

### 4.17 Assistentes de IA de registros, campos e operações (30/07/2026)

Superfícies sobre a MESMA fundação de IA dos dashboards (config por
org 0096 → `loadOrgAiConfig`; laço de autocorreção compartilhado em
`lib/ai/json-loop.ts` — 3 tentativas, 120s/chamada, budget 240s,
`AiTruncatedError` aborta; pages com `maxDuration = 300`). Princípio comum, o
mesmo do §4.11: **a IA nunca escreve** — os cores só validam e devolvem prévia;
o apply RE-VALIDA no servidor e escreve SÓ pelos choke points existentes; o
ALVO (base) vem sempre da UI, nunca do JSON da IA; conversas são client-state
(padrão da Home — turnos de usuário + prévia pendente reinjetada no system com
semântica "a resposta SUBSTITUI a prévia inteira"); RPCs de widget intocados.

- **Inserir registros com IA** (`/registros` → botão "Inserir com IA", bases
  com `manual_entry` + org com IA): até **10 registros por leva**
  (`MAX_AI_INSERT_RECORDS`). Contrato `registros-insert`
  (`lib/import/records/types.ts`): chaves = colunas de
  `EDITABLE_CORE_COLUMNS` cruas + `custom:<field_key>` do conjunto EDITÁVEL
  (mesmo gating do `createRecord`: papel × `applies_to`, sem calculados) +
  `responsible_id`/`operation_id` por NOME (validador resolve nome→UUID;
  desconhecido/ambíguo = erro). O prompt
  (`lib/import/records/instructions.ts`, derivado de constantes reais e
  fiscalizado por `instructions.test.ts`) leva o catálogo da base e AMOSTRAS
  reais (`sampleForBase`, extraído p/ `lib/import/sample-db.ts` e
  compartilhado com o prompt de dashboards) — é assim que a IA "copia o
  formato" dos dados existentes. A geração também consulta duplicados por
  título (case-insensitive) — AVISO por linha, nunca bloqueia. A PRÉVIA
  obrigatória mostra **só colunas preenchidas** (`filledColumns`) e é
  INTERATIVA: edição inline por célula + TROCA de coluna no cabeçalho
  (realoca o dado p/ outro campo aceito) + remoção — helpers puros de
  `lib/import/records/preview.ts`; toda edição re-serializa o JSON canônico,
  que alimenta o apply E o turno seguinte. O apply
  (`applyGeneratedRecordsCore`, `lib/ai/insert-records.ts`) re-valida e
  insere UM A UM via `createRecord` (FormData idêntico ao form manual —
  herda gates, coerção com âncora de Brasília, RLS `records_insert` ramo
  manual, calc inline, audit `origin:'app'`, webhook, auto-operações);
  resultado POR ITEM (falha parcial não desfaz) + um
  `recalcFormulaFieldsForRecords(ids)` p/ assentar operandos `match:`.
- **Atualizar registros com IA (31/07/2026)** (`/registros` → botão
  "Atualizar com IA", QUALQUER base/sub visível p/ quem tem
  `edit_record_values` — o botão não depende de `manual_entry` nem de IA
  configurada, pois o fluxo copiar-prompt → colar-JSON funciona sem). Contrato
  `registros-update` v1 (`lib/import/records/update-{types,validate,
  instructions}.ts`; core `lib/ai/update-records.ts`; sheet
  `components/registros/ai-update-sheet.tsx` + wrappers em
  `app/(app)/registros/ai-update-actions.ts`): UMA operação por resposta —
  `filtros` (WidgetFilter[], ≥1 obrigatório; "todos" é recusado) +
  `alteracoes` ({chave: valor}; `null` LIMPA o campo, `title` nunca). A IA
  NUNCA emite ids: a PRÉVIA server-side obrigatória resolve os registros que
  casam via `runRecordListWindow` com config sintética (`rowMode: "records"`,
  period null) — o caminho canônico do modo lista dá de graça o predicado de
  SUB-fonte (a base "Reunião" é sub de leads), nome→id de FK
  (`resolveFkFilterNames`), expansão canônica e a regra 0052 dos mocks — e
  devolve contagem EXATA + amostra antes→depois + avisos (mocks pulados,
  campo de Sync = escrita local). Operadores = `FILTER_OPS` ESTRITO (op
  interno seria dropado em silêncio pelo modo lista ⇒ over-match); relação em
  filtro só eq/neq/in/is_null/not_null, por NOME (§4.10). Alvos de alteração
  = mesmo gating do entry context + campos de SYNC do Bitrix (flag `sync`;
  paridade com /registros via forceSync) — escrita LOCAL no v1, sem enfileirar
  write-back (carimbos protegem do reconcile). O apply re-valida com contexto
  FRESCO, RE-RESOLVE os ids (recorte > `MAX_AI_UPDATE_RECORDS` = 200, o
  precedente de `BULK_MAX_ITEMS`, aborta ALTO), pula mocks (reportados),
  deriva `operation_id` via `primaryOperationId` quando só o responsável
  muda, e escreve SÓ por `updateRecordValuesBulk` (`lib/records/bulk-update.ts`
  — client RLS do usuário com `.select("id")` por item, coerção
  `coerce`/`coerceCore` — âncora de Brasília nas datas core —, no-op
  idempotente por item, UM recalc, audit `origin:'app'` com user real em
  lote, webhook `record.updated` por registro). A UI exige confirmação
  EXPLÍCITA da contagem (checkbox) e bloqueia o apply acima do teto.
  admin): botão "Sugerir com IA" envia colunas+amostras do CSV JÁ parseado no
  browser; o core (`lib/ai/csv-mapping.ts`) valida o contrato
  `csv-mapeamento` (`lib/import/csv-mapping/validate.ts` — toda coluna
  exatamente uma vez; alvo ∈ `CORE_IMPORT_TARGETS` ∪ customs da base ∪
  `responsible`/`new`/`ignore`; `new` exige rótulo + tipo de
  `IMPORT_NEW_FIELD_TYPES`, agora fonte única em `lib/import/csv.ts`; dois
  alvos iguais = erro) e o resultado só PREENCHE o estado `plans` — a revisão
  na tabela do wizard É a confirmação; `prepareImportFields`/`importCsvChunk`/
  `ingestRows` seguem intocados.
- **Criar campos com IA** (`/campos` → botão "Criar com IA",
  `manage_field_definitions`): até 10 `field_definitions` por leva, inclusive
  **calculados** — contrato `campos-create` (`lib/import/fields/*`): rótulo
  (chave = `slugify` no servidor; colisão com campo/coluna core = erro), tipo
  de `DATA_TYPE_LABELS`, `opcoes` (selecao), `formula_texto` (estilo Sheets),
  moeda/percentual pelas mesmas regras do `createField`. A fórmula é validada
  NA GERAÇÃO pelos MESMOS módulos do editor — catálogos/tokenização/
  `validateFormulaForContext`/ciclo/nomes de FK extraídos de campos/actions p/
  `lib/records/formula-server.ts` (invariante 8 preservada) — com os campos do
  LOTE injetados como linhas sintéticas no catálogo (calculado pode
  referenciar campo simples proposto junto). O apply re-valida e cria campo a
  campo via `createField` na ordem simples → calculado → calculado_agg (o
  createField revalida com os anteriores já criados); papéis/visibilidade
  ficam nos defaults programáticos (mesmos do import de CSV). Prévia
  read-only; ajustes pelo chat.
- **Gestão de operações (31/07/2026).** Configurações → Operações → "Gerir com
  IA" (`components/admin/operations-ai-sheet.tsx` + wrappers em
  `ai-operations-actions.ts`; core `lib/ai/manage-operations.ts`, gate admin +
  área `operacoes`). Contrato `operacoes-edit` v1
  (`lib/import/operations/{types,validate,instructions}.ts`): lote de até 15
  ações `criar`/`editar`/`vincular`/`desvincular` identificadas por NOME (ids
  NUNCA vêm do JSON; 0 hits lista os cadastrados, >1 = ambiguidade), SEM ação
  de exclusão (fica na UI). O validador processa EM ORDEM com catálogo de
  TRABALHO (referência a operação criada no lote e rename valendo para o resto
  funcionam), pré-checa ciclo de pai, colisão de nome (exigência do
  assistente — a UI manual segue permissiva) e o `unique(responsible_id,
  priority)`, e barra operação AUTOMÁTICA de parceria nas 4 formas (invariante
  22; o apply re-barra com contexto fresco). Perfil passa pela MESMA
  sanitização do choke point (`lib/config/operation-profile.ts` — extração de
  `updateOperationFilter`; `PROFILE_OPS`/`NO_VALUE_OPS` únicos) e ainda exige
  `field` ∈ catálogo e `sources` ⊆ fontes (mais estrito de propósito). Apply
  item a item SÓ pelos choke points (`createOperation` — que passou a devolver
  o `id` criado —/`updateOperation`/`updateOperationFilter` +
  `addResponsibleOperation`/`removeResponsibleOperation`; vincular/desvincular
  re-passam pelo gate da área `responsaveis` — deny falha por item). **Fluxo de
  IA EXTERNA no MESMO contrato**: "Copiar prompt" (`buildOperationsPromptCore`
  — MESMO texto do system interno + catálogo atual) + colar-JSON
  (`previewOperationsCore`, sem IA) caem na MESMA prévia/apply; o manual
  funciona sem IA configurada (chat gated por `ai.hasKey`).

Testes: `lib/import/records/{validate,preview,instructions}.test.ts`,
`lib/import/records/{update-validate,update-instructions}.test.ts`,
`lib/records/bulk-update.test.ts`,
`lib/import/csv-mapping/validate.test.ts`, `lib/import/fields/validate.test.ts`,
`lib/import/operations/{validate,instructions}.test.ts` e
`lib/config/operation-profile.test.ts`
(paridade dos SPECs com as constantes reais + exemplos aceitos pelos
validadores REAIS) e `lib/records/coerce.test.ts` (âncora de Brasília + trava
anti-divergência validador↔escrita). Ver invariante 25.

### 4.18 Remuneração variável (0112, 30/07/2026)

Configurações → Remuneração calcula, edita e publica a remuneração variável do
time. Duas tabelas (0112): `comp_plans` (plano por org: nome, base variável
default e `config` jsonb VERSIONADO — parse FAIL-CLOSED em `lib/comp/model.ts`,
padrão kanban_automations) e `comp_entries` (lançamento por plano×responsável×
ano×mês: base individual, `inputs` com overrides/bônus, `computed` com o
snapshot CRU do recompute e `total` efetivo). Modelo:
`total = base (R$) × Σ(peso% × atingimento%) + bônus`, com fórmula LIVRE de
total opcional por plano.

- **Fatores e realizado.** Cada fator tem peso %, fontes (bases/sub-bases),
  cap/floor de atingimento e uma fórmula AGREGADA validada pelo MESMO caminho
  do servidor de fórmulas (`buildAggOperandCatalog` +
  `validateFormulaForContext` kind "aggregate" + `validateFkCondNames`). O
  REALIZADO por membro×fator sai SÓ de `runCalculatedWidget` (fórmula + filtro
  `responsible_id eq` — o choke point expande o grupo canônico — + período do
  mês via `monthPeriod`, com `fieldBySource` cobrindo todo o catálogo; moeda
  `fixed BRL`). RPCs de widget INTOCADOS. O recompute
  (`lib/comp/engine.ts::recomputePlanMonth`, action `recomputeMonth`) roda uma
  consulta por célula (task-limiter + rpc-memo/TTL, teto 400 células) e grava
  APENAS `computed` ({v, at, realized, errors?}) + `total` — falha de uma
  célula isola em `errors[fid]`, nunca derruba o mês.
- **Efetivo = manual ?? calculado, derivado NA LEITURA.** `computeEntry`
  (puro) deriva atingimento/valor/total a partir de config + inputs +
  `computed.realized` + alvos: override por variável (realizado, ating.%,
  valor por fator; total da linha) vive em `inputs.overrides` e NUNCA é tocado
  pelo recompute; limpar a chave restaura a derivação sem re-consulta.
  Cap/floor clampam SÓ o calculado. Grade (admin) e "Minha remuneração"
  (vendedor) usam o MESMO `computeEntry` no cliente.
- **Membros por operação (31/07/2026).** `config.memberOperationIds` soma às
  `memberIds` manuais os membros da subárvore VIVA de cada operação
  (`responsible_operations`, qualquer priority, operação inativa inclusa —
  paridade com o filtro de Operação dos dashboards): a page admin e o
  `recomputePlanMonth` resolvem via `loadOperationScopes` +
  `operationMembersFromScopes` (canonicaliza APELIDO → principal e deduplica;
  vínculo em apelido vira linha canônica na grade e alvo em goals no
  principal) e a combinação manual ∪ operações é dos helpers PUROS
  `resolveOperationMembers`/`explicitMemberIds` de `lib/comp/model.ts` —
  grade e editor usam os MESMOS helpers com os ids resolvidos via props
  (client nunca importa engine.ts nem resolve operação sozinho). Presença de
  `memberOperationIds` ⇒ lista explícita SEMPRE, mesmo resolvendo vazio
  (fail-closed: sub-operação de parceria profile-only contribui zero e o
  plano fica SEM membros — aviso no editor + "O plano não tem membros
  ativos." no recompute — em vez de virar "empresa inteira" em silêncio).
  Ambos vazios = todos os ativos (compat). `savePlan` valida a existência dos
  ids (RLS recorta a org); `publishMonth`/`deriveTotal` seguem imunes
  (derivam das entries materializadas).
- **Alvos são LINHAS de `goals`.** Cada fator vincula uma chave do registry
  `goal_metrics` (automática `comp_*` no save, ou existente escolhida pelo
  admin). A grade digita o alvo mas persiste `goals` (scope 'responsible', id
  CANÔNICO) via `lib/metas/upsert.ts` (`upsertGoalTarget`/`deleteGoalTarget` —
  a dança find-then-update extraída de `createGoal`; célula limpa EXCLUI a
  linha, nunca `target=0`). A área Metas gerencia os mesmos alvos. Leitura em
  batch (`loadTargetsByMember`) expande o grupo canônico e dobra
  apelido→canônico (linha do canônico vence). `resolveGoal`/goalLine seguem
  canon-blind (limitação documentada). Tradeoff aceito: `goals_select` é
  org-wide autenticado — alvos legíveis via API por qualquer logado (regime
  que `mrr`/`clientes` sempre tiveram; a page de Metas segue admin).
- **Comissão por faixas MULTI-BLOCO (31/07/2026).** `config.commissions[]`
  (≤ `MAX_COMMISSION_BLOCKS` = 6; sem migração; parse fail-closed estendido —
  bloco inválido, gatilho/base fantasmas, kind/tierBy desconhecidos ou id
  duplicado derrubam o config inteiro): `{id, label?, triggerFactorId,
  basisKind: "base"|"factor", basisFactorId?, tierBy?: "attainment"|
  "realized", kind?: "pct"|"flat"|"per_unit", tiers, memberTiers?}`. O jsonb
  LEGADO `commission` (objeto único, v1.1) é NORMALIZADO no parse para um
  bloco canônico `{id:"comissao", kind:"pct", tierBy:"attainment"}` de
  comportamento byte-idêntico — o tipo parseado expõe SÓ `commissions`
  (migração preguiçosa no próximo save). Seleção da faixa: o gatilho EFETIVO
  (atingimento % pós override/cap-floor; ou o REALIZADO efetivo absoluto com
  `tierBy:"realized"` — faixas por VOLUME, ex. "26+ reuniões") escolhe pela
  regra de sempre — maior `fromPct` satisfeito vence (`>=`); nenhuma faixa ou
  gatilho null ⇒ 0 (`tier: null`, nunca fabricar). Payout por `kind`: `pct` =
  `ratePct`% sobre a base (variável ou realizado EFETIVO de um fator);
  `flat` = `amount` R$ fixo; `per_unit` = `amount` R$ × realizado do
  fator-base (EXIGE `basisKind:"factor"` — parse recusa sem). Faixas são
  tabela de LOOKUP (a vencedora aplica à base INTEIRA), nunca brackets
  marginais. `memberTiers[respId CANÔNICO]` substitui a tabela do BLOCO
  inteira para o membro (config durável, não input mensal; órfã preservada e
  nunca selecionada — o editor a exibe com remover). Os blocos SOMAM no
  agregado: `CompBreakdown.commissionBlocks` traz o detalhe por bloco (sempre
  o CALCULADO) e `commission` mantém o shape antigo com `value = override ??
  Σ` (`tier`/`triggerAttainmentPct` só com bloco único) — espelho/publish
  intocados. **Memória de cálculo (01/08/2026):** cada bloco do breakdown
  carrega também `basis` (multiplicando efetivo — realizado do fator-base ou
  base variável; `null` em `flat`, que não multiplica), `basisLabel`,
  `basisMoney`, `triggerLabel`, `triggerMoney` e `memberTiersApplied` —
  campos DERIVADOS na leitura por `computeEntry` (nada persiste;
  `comp_entries.computed` segue snapshot cru). Os rótulos pt-BR da memória
  ("44 (Reuniões) × R$ 12,50 = R$ 550,00", "faixa a partir de 26…") são
  gerados SÓ por `commissionMemory` (`lib/comp/commission-label.ts`) —
  helper puro único consumido pela grade (popover clicável na célula
  Comissão: ícone próprio dentro do display do `EditableCell`, override por
  duplo-clique preservado; override da soma ganha nota calculado × manual) e
  pela visão do vendedor (`my-comp-view`). Na grade e na visão do vendedor,
  o Valor de fator com peso 0 sem override exibe "—" com title explicativo
  (display-only — a coluna nunca some: Base/Valor seguem alimentando
  `basisKind:"base"`, refs `comp:*` do `totalFormula` e overrides); Valor de
  fator com peso > 0 ganha `title` com a conta base × peso × ating.
  `inputs.overrides.commission` segue override da SOMA. Cálculo
  NATIVO em `computeEntry` (`resolveCommissionTiers(bloco, memberId)`/
  `selectCommissionTier`) — NUNCA gerar fórmula a partir das faixas. Com
  `totalFormula`, a comissão só entra via ref `comp:comissao` (sem soma
  automática; operando existe SÓ com blocos presentes).
- **Match de membro por campo, alvo padrão e alvo em moeda (31/07/2026).**
  Três extensões POR FATOR, todas resolvidas no engine/modelo (RPCs
  intocados): (a) `factor.memberField` (ref de campo texto/seleção, ex.
  `custom:sdr_reuniao`) troca o filtro injetado do recompute por
  `<campo> in (display_names do grupo canônico do membro)` — `memberFilterFor`
  no engine monta o CONJUNTO DE NOMES (canônico + apelidos, inativos
  inclusos, via `expandResponsibleIds` + nameById de TODOS os responsáveis);
  match exato (`in`, sem `_ci` — os dois lados vêm dos nomes do
  Bitrix/responsáveis); membro sem nome ⇒ `errors[fid]` (célula isola, NUNCA
  consulta sem filtro); `expandResponsibleFilters` segue exclusivo do
  `responsible_id`, intocado. O `savePlan` valida o ref contra
  `buildAvailableFields` (numérico/data/sintético/agregado recusados). (b)
  `factor.defaultTarget` = alvo FALLBACK quando não há linha de `goals` p/
  membro×mês (meta "por sub-operação"): efetivo = `goals ?? defaultTarget`;
  digitar na célula grava goal (override durável), limpar DELETA e volta ao
  padrão; `CompFactorBreakdown.targetSource` ("goal"|"default"|null) alimenta
  o itálico/tooltip da grade; nunca vira linha de goals. (c)
  `factor.targetCurrency` (`^[A-Z]{3}$`, habilitada em `currencies`) = moeda
  em que alvo/defaultTarget são DIGITADOS; a conversão a BRL acontece NA
  LEITURA: os callers resolvem `targetRates` (moeda → R$/un. no trimestre do
  fim do mês — `resolveTargetRates` no recompute;
  `loadTargetRatesForConfig` com fast path sem consulta p/ plano só-BRL em
  deriveTotal/publish/pages) e passam o 7º arg do `computeEntry` (que segue
  PURO); taxa ausente ⇒ `targetBRL` null + atingimento null +
  `targetRateMissing` (erro visível na grade/vendedor — NUNCA converter 1:1).
  O realizado já era convertido a BRL pelo choke point (moeda `fixed BRL` +
  rates) — nada muda nele. Grade/vendedor exibem o alvo na moeda digitada com
  o convertido no tooltip ("mostrar os dois"). `config.presetKey` (identidade
  de plano criado por preset — §4.7) é parseado explicitamente e RE-EMITIDO
  pelo save do plan-editor.
- **Condições do recorte por fator (01/08/2026).** `factor.filters`
  (WidgetFilter[], "Condições do recorte" no plan-editor) é o recorte
  configurável do realizado — ex.: gatilho de reuniões contando SÓ as de uma
  origem, sem código novo; um fator de peso 0 com recorte próprio serve de
  gatilho dedicado de comissão. O recompute o aplica ANTES do filtro de
  membro, na MESMA chamada `runCalculatedWidget`
  (`[...(factor.filters ?? []), memberFilter]` — pipeline completo: tokens de
  data, nome→id de FK, canon, fontes-alvo e as pernas auxiliares de operando
  escopado, que também recebem os filtros do widget). Parse do model
  FAIL-CLOSED e restrito aos 10 operadores de UI de `FILTER_OPS` (nunca lista
  paralela; internos `eq_ci`/`*_num` rejeitados), `in` normalizado p/ array
  de strings (string legada com vírgulas aceita), op sem valor perde o valor,
  `sources` POR-FILTRO é DESCARTADO (o universo da consulta é
  `factor.sources`) e teto `MAX_FACTOR_FILTERS`. O `savePlan` valida campo
  contra `buildAvailableFields` (sintético/agregado recusados) e exige valor
  nos ops com valor; `operation_id` é PROIBIDO (coluna derivada possivelmente
  NULL — a tradução viva de operação do §4.10 não passa pelo recompute;
  filtre por responsável ou campo do registro). O save do editor RE-EMITE os
  filtros (regra do presetKey — sem isso o round-trip os destruiria) e a
  prévia da fórmula os aplica; valor de relação grava NOME
  (`FilterValuePicker` storeAs "label", resolvido em runtime — §4.10),
  etapa/seleção gravam o rótulo.
- **Apuração sobre o mês anterior (31/07/2026).** `config.apuracao:
  "mes_anterior"` faz o lançamento do mês M (pagamento) apurar
  realizado/metas/taxas sobre M-1 — caso Zapper: a variável paga em Julho
  refere-se a Junho; os 5 planos do preset nascem com a chave e plano NOVO no
  editor default a ela (o parse NORMALIZA `"mes_corrente"` para ausência —
  ausente = mês do lançamento, compat). Contrato ANTI-DUPLA-CONVERSÃO:
  `year`/`month` em toda assinatura pública é SEMPRE o mês do LANÇAMENTO; o
  deslocamento acontece via `apuracaoRef` (helper puro do model, rollover de
  janeiro) DENTRO de `loadTargetsByMember`/`loadTargetRatesForConfig` e nos
  pontos únicos `monthPeriod` do `recomputePlanMonth` e key de goals do
  `saveTarget` (a célula de alvo do lançamento M edita a meta de M-1 — mesma
  linha que a área Metas mostra em M-1) — call site NUNCA passa mês já
  deslocado (`rederiveEntryTotal`/`deriveTotal`/`publishMonth` seguem falando
  M; o loader desloca de novo lá dentro — deslocar no caller leria M-2).
  Identidade da entry (`period_year/month`), leitura/insert de entries e o
  espelho (`closed_at`/título = mês de PAGAMENTO) ficam em M. O recompute
  carimba a janela apurada em `computed.ref` ({year, month} — snapshot legado
  sem a chave: a UI deriva do config); grade/vendedor exibem o badge
  "Apurado sobre <mês>" e o save do editor RE-EMITE a chave (regra do
  presetKey). Planos já criados NÃO são alcançados pelo ensure do preset —
  backfill via SQL (PR da entrega).
- **Fórmula livre de total.** `config.totalFormula` avalia por
  `evaluateFormula` sobre o mapa `comp:*` montado em `computeEntry`
  (`comp:f:<fid>:realizado|alvo|ating|valor`, `comp:base`, `comp:bonus`,
  `comp:fatores`, `comp:comissao` quando há comissão) — variáveis JÁ efetivas
  (overrides aplicados = sincronia total). Catálogo/validação em
  `compOperandCatalog` + kind "record" (módulo único; SOMASE proibido com
  mensagem própria). Resultado não-numérico ⇒ total null ("—" + aviso;
  Publicar pula a linha). `overrides.total` vence os dois modos.
- **Publicar (espelho em Base).** `publishMonth` materializa 1 registro por
  responsável×mês numa base manual "Remuneração" (`lib/comp/mirror.ts`:
  `data_sources` key `remuneracao` com sufixo em colisão global, ponteiro em
  `sync_config` 'remuneracao_mirror', field defs fixas `rem_base`/`rem_bonus`/
  `rem_comissao`/`rem_atingimento`/`rem_plano` com
  `editable_by_roles: ["admin"]`; `rem_comissao` fica vazio em plano sem
  comissão — nunca 0 fabricado; `rem_atingimento` é média ponderada pelos
  pesos e cai em média SIMPLES quando TODOS os pesos são 0 — planos
  só-comissão do preset Remuneração Variável). A escrita
  é SÓ por `createRecord`/`updateRecord` com o client RLS do admin (invariante
  25) — `core__value` = total, `core__closed_at` = último dia do mês
  (`YYYY-MM-DD`; o `coerceCore` ancora em Brasília — invariante 11),
  `responsible_id` canônico. Dedup por `comp_entries.mirror_record_id` (FK
  `on delete set null` ⇒ registro apagado à mão é recriado no próximo
  Publicar); NUNCA por `source_id` (o ramo manual da RLS exige null). Todos os
  widgets/dashboards funcionam sobre a base sem código novo; a visibilidade do
  vendedor segue a RLS normal de `records` (sem `view_all_records` vê só as
  próprias linhas — consequência deliberada de publicar).
- **Acesso.** `AREA_GATES.remuneracao = {}` — a page ramifica: admin gere;
  demais papéis veem "Minha remuneração" (read-only). RLS: `comp_plans` select
  org-wide (o vendedor precisa do DESENHO do plano; org que considere a base
  default sensível deixa-a nula e digita por pessoa); `comp_entries` select =
  admin OU `responsible_id in (select auth_responsible_ids())` (grupo
  canônico, 0101); escrita admin-only nas duas. Tabelas raiz org-scoped com
  carimbo na action (padrão 0111); fora de `PASSTHROUGH_TABLES`.
- **Recurso SOB DEMANDA por org (0114, 31/07/2026).** A Remuneração é config
  CUSTOM feita sob demanda (Zapper): `org_features` (uma linha por org, jsonb
  `{"remuneracao": true}`; select p/ membros, ESCRITA service-role-only) +
  catálogo/parse fail-closed em `lib/config/org-features.ts` (sem linha/chave
  = OFF; só `true` literal liga). O gate vive em `lib/auth/access.ts`
  (`AREA_FEATURES`): feature-off vence TUDO — inclusive override allow —
  na page (`requireSettingsArea`/`checkSettingsArea`), na ESCRITA
  (`isSettingsAreaDenied`), na aba do settings layout (`disabledAreas`) e na
  matriz de Acessos (linha some). O preset "Remuneração Variável" carrega
  `requiresFeature: "remuneracao"` (`PresetDashboard`): some da lista de
  Presets, `applyPreset` barra com erro amigável e `generatePresets` PULA —
  os dois caminhos são alcançáveis por action direta, o filtro da lista não
  basta. Habilitação SÓ pelo console `/owner` (toggle por org →
  `setOrgFeatureAction`, requireOwner + service role; org_admin NUNCA se
  auto-habilita). Desligar o feature esconde área/preset e barra escrita —
  NUNCA apaga nem esconde dados (planos/entradas/espelho seguem com a RLS da
  0112; a Zapper é semeada ON na própria migração). Precedência completa
  documentada: feature-off > deny > allow > gate de papel.

Testes: `lib/comp/model.test.ts` (parse fail-closed, precedência de overrides,
cap/floor, fórmula livre, catálogo comp:*, faixas de comissão — seleção `>=`,
membro > plano, comp:comissao sem soma automática), `lib/comp/engine.test.ts`
(1 RPC por célula com canon expandido, alvos de goals dobrados, update nunca
toca inputs, erro isolado, total por membro com tabela própria),
`lib/comp/mirror.test.ts` (builders do form, rem_comissao) e
`lib/metas/upsert.test.ts` (find-then-update, registry). Ver invariante 26.

## 5. Invariantes críticas (NÃO QUEBRAR)

Estas regras já causaram ou causariam bugs graves e silenciosos. Elas também estão
em [`AGENTS.md`](../AGENTS.md) (instruções para agentes de IA), mas valem — e
principalmente — para mantenedores humanos.

1. **RPC de widgets duplicado.** `run_widget_query_snapshot` é uma cópia de
   `run_widget_query` apontada para `snapshot_records`, com as restrições do snapshot
   aplicadas internamente (mock-aware). **Toda mudança em `run_widget_query` (nova
   migração que o recrie) DEVE ser espelhada em `run_widget_query_snapshot` na mesma
   migração** — inclusive o helper `_widget_match_expr` ↔ `_widget_match_expr_snap`.
   Divergência = snapshot público mostrando números diferentes do dashboard, sem
   nenhum erro visível.
2. **Regra dos mocks triplicada.** A detecção "consulta referencia Data Reunião"
   existe em `run_widget_query`, `run_widget_query_snapshot` e
   `lib/widgets/mock-reuniao.ts`, toda por substring das duas chaves
   `bitrix_uf_crm_*`. Alterar um lado sem os outros quebra a paridade.
3. **Mocks em snapshots.** Mocks (`records.is_mock`) entram SEMPRE no dataset
   congelado, ignorando as restrições do snapshot (0057). As restrições são aplicadas
   dentro da RPC como `(is_mock OR restrições)`. **Não reintroduza filtros de
   restrição injetados pelo viewer** — um AND puro derrubaria os mocks.
4. **Período congelado ≠ restrição.** `snapshots.default_period` (0059) é filtro de
   **consulta** (mesma semântica da barra do dashboard), aplicado pelo resolver
   padrão no viewer. Sem ele, consultas em "todo período" deixam de referenciar Data
   Reunião e a regra dos mocks os derruba.
5. **Snapshots são acesso público controlado.** Nunca crie política RLS `to anon` nem
   conceda EXECUTE a `anon`/`authenticated` nas funções de snapshot. O caminho
   público é exclusivamente `app/s/[token]` + service role após validar o token.
6. **SQL antes do deploy.** Migrações que criam colunas selecionadas pelo app (ex.:
   0051, 0059, fase-14) devem ser aplicadas **antes** do deploy do código — sem a
   coluna, as telas quebram. Confira o aviso no cabeçalho de cada migração.
7. **Bucket canônico.** A chave de bucket de data gerada no SQL deve bater com
   `canonicalBucketKey` no cliente (`lib/widgets/`) — divergência quebra rótulos e
   filtros rápidos. Desde a 0085 a ATRIBUIÇÃO de dia é a de Brasília nos dois
   lados (`_widget_local_ts` no SQL ↔ prefixo `parseYmd` no cliente); os
   FORMATOS de chave seguem os mesmos — mudar um formato ou a âncora de fuso de
   um lado só quebra a paridade em silêncio.
8. **Autorização pelo vínculo vivo.** Use `records.responsible_id →
   responsibles.user_id` para visibilidade; `owner_user_id` é legado (0037).
9. **Fonte por métrica se resolve no ENGINE, nunca no RPC.** `Metric.sources`
   vira filtro `record_type in (...)` de uma chamada RPC separada
   (lib/widgets/metric-sources.ts + engine.ts); o par
   `run_widget_query`/`run_widget_query_snapshot` não conhece o conceito. Não
   introduza parâmetro de fonte-por-métrica no RPC — obrigaria nova migração
   espelhada (invariante 1) sem necessidade. O universo de linhas é sempre
   `widgets.sources`; o `@period` pré-sintetizado dos filtros rápidos deve
   cobrir fontes do widget ∪ fontes das métricas ∪ fontes dos operandos com
   ESCOPO (`agg:…@<fonte>`, 19/07/2026) — `widgetQuerySources` com o
   `fieldByKey` (3 pontos: page, viewer de snapshot e widget-scope), senão as
   pernas perdem registros em silêncio. O mesmo vale para as pernas:
   `metricLegSources`/`partitionMetricLegs` unem `formulaScopedSources` ao
   conjunto da métrica. A regra dos mocks das pernas COBERTAS (fontes dentro
   das do widget) também se resolve no engine: top-up `is_mock = true`
   (`recordListIncludesMocks`/`runCoveredLegMockTopUp`, 20/07/2026) mesclado
   ao stream de extras — não a resolva via RPC nem re-inspecione a regra fora
   de `resolveListFilters` (record-list.ts).

10. **Sub-fontes se resolvem no ENGINE, nunca no RPC.** Uma sub-fonte
    (`sub_sources`, 0078) compartilha o `record_type` da pai; a resolução (fonte
    efetiva por `record_type`, predicado da sub, data e membro de unificado
    próprios) mora no engine (`lib/sources.ts` `planSourceLegs` +
    `lib/widgets/engine.ts`/`record-list.ts`). O par
    `run_widget_query`/`run_widget_query_snapshot` **não conhece o conceito** —
    não recrie as RPCs para isso (não acione a invariante 1). O membro de
    unificado é por `source_key`; o `p_correspondences` de TODA consulta sai de
    `correspondenceMapForSources` (um ref por perna, fallback perna → raízes →
    todos; v1.6) — misturar o membro da pai e o da sub no mesmo `coalesce` pega
    o 1º não-nulo (uma linha com as duas colunas preenchidas erra), e isso vale
    TAMBÉM para widget que nem selecionou a sub (mesmas linhas, mesmo
    `record_type`). Nunca passe `buildCorrespondenceMap` (união global) a uma
    consulta — ele é só das opções de bucket. `AvailableField.unifiedMembers`
    (por `record_type`) é RAIZ-primeiro pelo mesmo motivo. Os MODOS de exibição
    das pernas (`settings.subSeriesMode` — empilhado/total/lado a lado) e o
    zeroing de operandos escopados em fonte-irmã também se resolvem no
    ENGINE/chart (`zeroSiblingScopedOperands`, `foldRowGroup`,
    `lib/widgets/sub-series.ts`) — nunca nos RPCs. Ver §4.8.

11. **Datas são strings no fuso de Brasília.** Valores **datetime** ingeridos de
    fonte com `data_sources.timezone` configurado (0079) são convertidos para
    America/Sao_Paulo na ENTRADA (`lib/date/normalize.ts`, aplicado no mapper do
    sync); o read side inteiro é prefix-based (display, buckets, comparação
    textual do período) e depende do dia certo estar no prefixo. Campo Bitrix
    tipo `date` é calendário puro — **nunca converter** (recuaria um dia);
    date-only é sempre passthrough. O formato emitido
    (`YYYY-MM-DDTHH:mm:ss-03:00`) deve seguir byte-idêntico ao do backfill 0080,
    senão o reconcile reescreve tudo (churn de audit). Desde a 0085 o read side
    dos RPCs também é dia de Brasília para as colunas `timestamptz` do NÚCLEO:
    bounds de período/filtro em coluna do núcleo levam offset explícito
    `-03:00` (`anchorCoreDateBound` no client + ancoragem por coluna no ramo
    `@period` do RPC) e o bucketing passa por `_widget_local_ts` (núcleo =
    `at time zone 'America/Sao_Paulo'`; texto = prefixo de 10 chars). NUNCA
    ancore bounds de campo custom (texto): a comparação é lexicográfica e o
    offset no lower bound excluiria valores date-only. NUNCA aplique
    `at time zone` a valor texto: um naive (CSV) recuaria um dia.
    **Write side das colunas core `timestamptz` (26/07/2026):** valor NAIVE de
    fonte sem fuso (planilha do Estudo, CSV do wizard/API) é hora de parede de
    BRASÍLIA e deve ser ANCORADO na gravação com `anchorNaiveToBrasilia`
    (`lib/date/normalize.ts` — date-only → `T00:00:00-03:00`; naive → sufixo
    `-03:00`; com offset/lixo → passthrough). Sem a âncora o Postgres assume
    UTC e o registro recua 3h — os de 00:00–02:59 mudam de dia e os do dia 1
    caem no mês anterior (bug das "15 vs 17 vendas do site", corrigido pelo
    backfill `supabase/apply/backfill-naive-tz.sql`). Isso vale SÓ para coluna
    core `timestamptz` — campo custom (texto) segue naive/passthrough, como
    acima. Ancoram hoje: adapter de Sheets, `ingestRows` e — desde 30/07/2026 —
    a coerção do form manual/inserção por IA (`coerceCore` em
    `lib/records/coerce.ts`, usada por `createRecord`/`updateRecord`; antes o
    form gravava naive e o dia recuava no read side). E o reconcile compara as colunas core de data por INSTANTE
    (`timestampValuesDiffer`, `lib/sync/shared.ts`): o PostgREST devolve
    `+00:00` e os mappers emitem `-03:00` — byte-compare (`valuesDiffer`)
    churnaria update+audit de toda linha a cada sync (aconteceu até
    26/07/2026: ~126k entradas de audit por coluna). Campos custom (texto)
    seguem no byte-compare: lá o formato É o dado.

12. **Escopo de widget em server action sai SEMPRE do widget-scope.** Toda
    server action que consulta dados de um widget do dashboard (paginação,
    export, Tabela Livre, kanban — e qualquer action deferida futura) monta o
    recorte por `loadWidgetScope`/`resolveWidgetViewScope`
    (`lib/widgets/widget-scope.ts`) — nunca remonte `__qf__`/`ff_`/`__ff__`/
    `tf_`/tradução de operação/`__pw__` à mão: cópias parciais foram exatamente o
    bug de widgets deferidos ignorando o filtro de operação até F5. No
    cliente, o fetch deferido re-dispara pelo fingerprint `scopeKey`
    (`deferredScopeById` da page), nunca por `useSearchParams` (filtro
    persistido no banco não muda a URL) — e o fingerprint INCLUI a config do
    widget (`widgetConfigFingerprint`, posição fora): sem isso, EDITAR um
    widget deferido deixava o payload velho na tela até F5 (regressão
    31/07/2026). A página cheia do kanban de widget
    (`/kanbans/w/[widgetId]`) NÃO é uma action de widget-no-dashboard: é um
    contexto de visualização próprio (como a Agenda) que ignora os filtros do
    pai POR INTEIRO e POR DESIGN — RSC → `runKanban` direto, barra de período
    própria. Ver §4.10.

13. **Linhas core de `field_definitions` são OVERRIDES, nunca campos custom.**
    A migração 0086 seeda as colunas do núcleo de `records` como linhas
    `source_system='core'` (`field_key` = nome da coluna) para a aba Campos
    exibi-las/geri-las (rótulo, olho, ordem; texto↔selecao na whitelist
    `CORE_SELECT_CAPABLE` — pipeline/etapa/tipo de venda/canal/Base
    `source_system`). O ref de
    widget segue sendo o nome CRU da coluna (`pipeline`) — uma linha core
    JAMAIS pode virar `custom:<key>` em catálogo, operando, coluna ou mapa
    `fieldByKey`. O split é feito por `lib/records/core-defs.ts`
    (`isCoreDef`/`splitCoreDefs`): `buildAvailableFields` particiona e aplica
    rótulo/olho; todos os consumidores de defs-como-custom filtram com
    `isCoreDef` (nunca com `.neq("source_system",'core')` — campos locais/app
    têm `source_system` NULL e o `<>` os derrubaria). Os loaders de builder
    usam `show_in_builder OR source_system='core'` — a linha core precisa
    chegar ao merge mesmo oculta, senão o hardcoded de `CORE_FIELDS`
    reapareceria. As options do `pipeline` (selecao) são reescritas a cada
    sync com os funis vivos (`lookups.categoryNames()` em `syncFieldCatalog`);
    edição manual das options não sobrevive ao sync (mesmo trato do campo
    curado `fonte`). A Base (`source_system`) nasce selecao desde a 0099 com
    as origens de ingestão como options (distintos da org ∪
    bitrix/sheet_site/manual/csv) — ao contrário do pipeline, NADA as
    reescreve depois: origem nova entra pelo /campos.

14. **Board na Lixeira não abre; duplicação sempre remapeia.** `dashboards.status
    = 'trashed'` (0087) significa 404 em `/dashboards/[id]`, `/kanbans/[id]` E
    `/s/[token]` (a RLS `dashboards_select` NÃO filtra por status — o "não
    abre" vive nas pages/actions; não afrouxe esses guards), fora dos pickers
    (`listWidgetLinkTargets`/`listTaskBoards`), do lookup de preset e do
    refresh de snapshots. Exclusão definitiva SÓ de dentro da Lixeira
    (`deleteBoardPermanently` exige `status='trashed'` no predicado); a purga
    física é o cron `apply/pg-cron-purge-trash.sql` (14 dias) e o hub esconde
    vencidos por conta própria. `duplicateBoard` SEMPRE remapeia os uuids de
    widget/dashboard dentro dos settings copiados e REMOVE
    `settings.preset`/`settings.presetKey` — sem isso, conectores/links da
    cópia apontariam para os widgets do original e o `applyPreset` adotaria/
    sobrescreveria a cópia.

15. **Isolamento de organização vive em RLS + loaders, NUNCA no RPC.** As
    tabelas-raiz carregam `organization_id` (0090) e TODA policy é prefixada
    pelo gate `auth_org_ids()` (0091) — inclusive os ramos admin/permission.
    O par `run_widget_query`/`_snapshot` é SECURITY INVOKER e herda o
    isolamento do chamador: NÃO introduza parâmetro de org nos RPCs (não
    acione a invariante 1). Caminhos service-role (sync/ingest/viewer/refresh
    de snapshots) BYPASSAM a RLS — eles escopam explicitamente (org do
    dashboard no viewer/refresh; triggers de stamp da 0090 nos inserts).
    NUNCA carregue catálogo/campos/correspondências com service role sem
    filtrar por org — vazaria nomes de outras empresas.

16. **org_admin e Owner são protegidos por TRIGGER + GUC, não por UI.** Um
    org_admin por org (índice parcial), indeletável/indemovível; `app_owner`
    imutável e com FK sem cascade; `organizations` só deleta via
    `delete_organization`. Os triggers valem até para service role — o único
    desbloqueio é `set_config('app.allow_protected_change','on',true)` em SQL
    direto. Nenhuma action/tela pode ganhar esse poder; o modo Owner exige
    ainda env `OWNER_USER_ID` == uid (fail-closed: env ausente nega sempre) e
    `requireOwner()` em TODA page/action de `/owner`.

17. **Acesso efetivo = papel × overrides, resolvido em UM lugar por família.**
    Boards: helpers `auth_board_visible/editable/manageable` (blocked vence
    papel; view/edit concede; dono/admin imunes) — não reimplemente a regra
    em policy/page nova. Áreas de Configurações: `AREA_GATES` +
    `canAccessSettingsArea` (`lib/auth/access.ts`) — deny vence tudo, allow
    vence o papel; sub-page nova usa `requireSettingsArea` (link condicionado
    usa `checkSettingsArea`, a variante sem redirect). A CHAVE de área é
    HISTÓRICA e desacoplada da rota (27/07/2026: `fontes` →
    `/registros/bases`, `log` → `/registros/log`, `moedas` → aba de
    `/campos`) — NUNCA renomear (overrides gravados). Bases negadas:
    RLS de `data_sources`/`sub_sources` (pickers somem via loadSources) +
    `records_select` (dados) — não filtre "na mão" em componente. Escopo de
    bases do board (`sourceScope`) é OFERTA, nunca autorização — não os
    confunda.

18. **Espaço de grid v2: leitura normaliza, escrita converte antes (§4.12).**
    Unidades de `grid_position`/`ShapeLine`/`canvas` dependem de
    `settings.canvas.gridVersion` (2 = fino base-120; ausente = legado
    base-12). TODA leitura de linha crua passa por `normalizeGridSpace`
    (`lib/widgets/grid-space.ts`) e TODO escritor de geometria chama
    `ensureFineGrid` ANTES de gravar (a ordem leitura→carimbo CAS→conversão é
    o que impede a dupla conversão — não a mude). Um caminho novo que grave
    posição sem o ensureFineGrid pode MISTURAR escalas no banco; um que leia
    sem normalizar renderiza um board legado 10× menor. Snapshots congelados
    (`snapshots.config`) NUNCA são migrados por backfill — a conversão
    runtime do viewer é permanente. RPCs de widget intocados.

19. **`settings.pages` (mescla) nunca viaja por JSON e é preservada no apply
    (§4.12).** `pages` referencia widget IDS do banco: o export/clipboard a
    REMOVEM, o `validate.ts` a rejeita com warning e `applyPresetDefinition`
    a RE-INJETA do settings existente no update in-place — sem isso, qualquer
    edição por IA desfaria mesclas em silêncio (ou pior: adotaria ids de outro
    board). `deleteWidget` mantém a integridade (host excluído devolve membros
    ao canvas; membro excluído sai do `pages` do host). A ocultação dos
    membros é SÓ de renderização (`collectPageMembers` no grid) — nunca
    filtre membros da computação de dados da page (a página oculta precisa do
    dado ao virar visível).

20. **Agrupamento de responsáveis se resolve no ENGINE/loaders, nunca no RPC
    nem repontando `records.responsible_id` (§4.13).** `canonical_id` (0101)
    é exibição reversível: filtros por responsável DEVEM expandir para o
    grupo (`expandResponsibleFilters` nos choke points de
    `runWidget`/`runCalculatedWidget`/`runRecordList*`), a dimensão funde no
    merge client-side e o rótulo sai do principal. Caminho novo que filtre ou
    agrupe por `responsible_id` sem passar por esses choke points mostra o
    grupo rachado em silêncio. Restrição de snapshot grava o conjunto JÁ
    EXPANDIDO (o RPC lê a coluna como está — não o recrie);
    `auth_responsible_ids()` devolve o grupo (visibilidade do vendedor cobre
    registros no id do apelido). Grupo sempre PLANO — só a action
    `setResponsibleCanonical` escreve a coluna.
21. **Match de bases dinâmicas resolve no helper, fusão de operações resolve
    no ENGINE (§4.14).** `_widget_match_expr(_snap)` resolvem a fonte por
    `data_sources` (são `stable`; recriação segue a invariante 1 — os dois na
    mesma migração, linha do lookup idêntica). Refs `match:` de SUB-fontes não
    existem em nenhum catálogo (buildMatchFields/matches-manager/validador de
    import) — não os reintroduza. A fusão de perfis de operação
    (`fuseOperationProfiles` + op interno `in_ci`) vive em
    `lib/config/operation-scope.ts`: NÃO recrie os RPCs para variações novas
    de fusão, e mantenha o degrade byte-idêntico dos casos não-fundíveis
    (fiscalizado por `lib/config/operation-scope.test.ts`).
22. **Sub-operações automáticas: identidade por `auto_source_record_id`,
    perfil do gerador, nunca delete (§4.14).** A rotina
    (`lib/operations/auto-operations.ts`) roda com service role e carimbo
    EXPLÍCITO de org; rename atualiza a MESMA operação, registro sumido
    INATIVA (goals/vínculos/snapshots podem referenciar a operação) e o
    perfil gerado é reescrito a cada rodada (customize a CONFIG em
    `source_auto_operations`, não o perfil). `records.operation_id` derivado
    fica NULL nessas operações — dimensão "por Operação" e
    `allowed_operation_ids` de snapshot não as enxergam (limitação
    documentada; não "conserte" repontando a coluna).
23. **Automações do kanban e ações em massa se resolvem no ENGINE/actions,
    nunca no RPC (§4.15).** O caminho service-role das automações carrega
    escopo EXPLÍCITO de org em TODA consulta (`opts.orgId` do
    `runRecordList`, `.eq("organization_id")` nos fetches auxiliares) — um
    fetch novo sem o escopo vaza registro entre orgs em silêncio. Colunas por
    bucket de DATA nunca são alvo de automação (não idempotente); mocks nunca
    movem/selecionam/recebem escrita; `KANBAN_OVERFLOW_KEY` nunca recebe
    card. A ação `set_field` é IDEMPOTENTE por comparação no snapshot da
    rodada (valor igual consome o card SEM escrever — decidido no
    `decideActions`, nunca no executor) e seus alvos proibidos
    (data/calculado/relação/`match:`/`unified:`/coluna core não-editável/
    campo-espelho da alocação) são barrados por `setFieldTargetError` na
    AVALIAÇÃO + no save + no picker (`settableFields`) — a MESMA régua nos
    três, nunca listas paralelas. Toda escrita de campo das automações (move
    por valor E set) passa pelo executor ÚNICO `executeFieldWrites`
    (carimbos, UM recalc, audit 'automation', write-back gateado, webhook em
    lote); o teto é ÚNICO — `MAX_ACTIONS_PER_RUN` (200) sobre moves + sets.
    Exclusão de
    registro é admin-only (action espelha a RLS `records_delete`) e SEMPRE
    emite `record.deleted`. As ações em massa devolvem resultado POR ITEM e o
    board só reconcilia `data` → estado local com a fila DRENADA (guarda de
    resync) — remover a guarda faz o refresh clobrar o movimento otimista.
    Regras vivem em `kanban_automations` (tabela própria): NÃO as mova para
    `settings.kanban` (o widget-builder reconstrói o objeto no save e as
    derrubaria; o tick perderia a enumeração indexada).

24. **Alocação do kanban como campo é ESPELHO derivado, mantido só pelos
    choke points (§4.16).** `kanban_placements` é a verdade; o campo
    `settings.kanban.allocationFieldKey` grava o RÓTULO da coluna atual (sem
    posição = 1ª coluna) via dual-write pós-move + reconcile — SEMPRE
    service-role com org explícita, com carimbo `field_modified_at`/
    `locally_modified_at`, SEM audit/webhook, e mock nunca recebe escrita.
    NUNCA leia `kanban_placements` nos RPCs/engine de widgets para "resolver"
    a fase — é o campo materializado que dá o filtro. A chave em
    `settings.kanban` DEVE ser re-emitida pelo widget-builder no save (branch
    `isCustomCols` — o builder reconstrói o objeto) e SEMPRE sofre STRIP em
    `createWidget`/`duplicateBoard` e na troca de base/modo
    (`normalizeKanbanAllocationOnSave`): uma cópia com a chave escreveria no
    campo do quadro ORIGINAL. Desligar/excluir mantém campo e valores; campo
    excluído em /campos auto-desliga o vínculo no próximo reconcile.

25. **Assistentes de IA de registros/campos/operações nunca escrevem direto
    (§4.17).** Os cores (`lib/ai/insert-records.ts`,
    `lib/ai/update-records.ts`, `lib/ai/csv-mapping.ts`,
    `lib/ai/create-fields.ts`, `lib/ai/manage-operations.ts`) só validam e
    devolvem prévia; a aplicação RE-VALIDA o JSON (possivelmente editado na
    prévia) e escreve SÓ pelos choke points existentes — `createRecord` por
    registro, `updateRecordValuesBulk` (`lib/records/bulk-update.ts`) na
    atualização em massa, `createField` por campo, estado `plans` do wizard,
    `createOperation`/`updateOperation`/`updateOperationFilter`/
    `addResponsibleOperation`/`removeResponsibleOperation` por ação de
    operação (a RLS segue sendo a muralha; nada de service role para
    inserir/atualizar). A base/alvo vem SEMPRE do seletor da UI, nunca do
    JSON da IA;
    no contrato de operações a identidade é resolvida por NOME no SERVIDOR
    (ids nunca viajam no JSON) e operações AUTOMÁTICAS de parceria são
    intocáveis (invariante 22). Teto de 10 por leva (registros e campos), 15
    ações (operações) e 200 registros na atualização em massa
    (`MAX_AI_UPDATE_RECORDS` = precedente de `BULK_MAX_ITEMS` — recorte maior
    aborta ALTO, nunca fatia em silêncio); prévia obrigatória (registros: só
    colunas preenchidas + edição inline/remap; update: contagem resolvida no
    SERVIDOR via `runRecordListWindow` + amostra antes→depois + confirmação
    explícita — a IA NUNCA emite ids de registro; operadores de filtro =
    `FILTER_OPS` estrito, senão o modo lista dropava o op em silêncio e o
    recorte over-matchava). Os SPECs são DERIVADOS de constantes reais
    (`EDITABLE_CORE_COLUMNS`, `CORE_IMPORT_TARGETS`, `IMPORT_NEW_FIELD_TYPES`,
    `DATA_TYPE_LABELS`, `FORMULA_FUNC_GROUPS`, `CURRENCY_OPTIONS`,
    `FILTER_OPS`,
    `PROFILE_OPS`/`NO_VALUE_OPS` de `lib/config/operation-profile.ts` — o
    MESMO módulo do choke point) e fiscalizados pelos testes de paridade —
    nunca documente em prosa paralela. Fórmula proposta pela IA valida pelos
    módulos ÚNICOS de `lib/records/formula-server.ts` (extraídos de
    campos/actions — não recrie catálogos). Datas core do contrato são
    `YYYY-MM-DD` e ancoram em Brasília na ESCRITA via `coerceCore`
    (invariante 11); campo custom de data segue texto naive. O `id` devolvido
    por `createOperation` existe para o apply encadear perfil/vínculos de
    operação criada no lote — segue sendo o choke point, não um caminho novo.

26. **Remuneração variável se resolve no ENGINE e nos choke points (§4.18).**
    O realizado por fator sai SÓ de `runCalculatedWidget` (RPCs intocados);
    o efetivo é `manual ?? calculado` derivado por `computeEntry` na LEITURA —
    `comp_entries.computed` guarda só o snapshot CRU e o recompute NUNCA toca
    `inputs`/`base_amount` (overrides sobrevivem sempre). Alvos são LINHAS de
    `goals` (scope 'responsible', id CANÔNICO) escritas SÓ por
    `lib/metas/upsert.ts` (célula limpa EXCLUI a meta, nunca `target=0`); a
    fórmula livre de total avalia SÓ por `evaluateFormula` sobre o mapa
    `comp:*` montado em `computeEntry` — nunca parser/avaliador/catálogo
    paralelo (`compOperandCatalog` é o módulo único de editor e servidor). O
    espelho publicado escreve SÓ por `createRecord`/`updateRecord` com o
    client RLS do admin, dedup por `mirror_record_id` (nunca `source_id`).
    Membros por operação (`config.memberOperationIds`) resolvem SÓ nos
    callers via `loadOperationScopes` + canonicalização
    (`operationMembersFromScopes`) — NUNCA por `records.operation_id` literal
    nem em client component; presença da chave ⇒ lista explícita SEMPRE
    (resolução vazia = plano sem membros, nunca fallback "todos");
    `memberResponsibles` segue PURA (os ids resolvidos entram pelo 4º
    argumento). Leitura do vendedor via `auth_responsible_ids()` na policy de
    `comp_entries` — remuneração é dado sensível: NUNCA afrouxar o select
    para org-wide; escrita segue admin-only. Comissão por faixas MULTI-BLOCO
    (`config.commissions[]`; legado `commission` NORMALIZADO no parse — o
    tipo parseado expõe só `commissions`) calcula SÓ em `computeEntry` via
    `resolveCommissionTiers(bloco)`/`selectCommissionTier` (tabela do MEMBRO
    substitui a do bloco inteira; a seleção lê o gatilho EFETIVO —
    atingimento %, ou realizado absoluto com `tierBy:"realized"`; payout por
    kind pct/flat/per_unit; faixas são LOOKUP, nunca brackets; os blocos
    SOMAM e `overrides.commission` é da SOMA) — NUNCA gerar fórmula a partir
    das faixas nem somar `comp:comissao` automaticamente no modo
    `totalFormula`; todo call site de `computeEntry` passa o `responsible_id`
    como `memberId` (omitir cai na tabela do plano — degradação segura, mas
    silenciosa: consulta nova sem o argumento erra o valor de membro
    personalizado). `factor.memberField` troca o filtro de membro por
    `<campo> in (nomes do grupo canônico)` SÓ via `memberFilterFor` (engine;
    membro sem nome ⇒ erro de célula, nunca consulta sem filtro;
    `expandResponsibleFilters` segue exclusivo do responsible_id).
    `factor.filters` (condições do recorte, com UI no plan-editor) entra
    ANTES do filtro de membro na MESMA consulta; parse restrito aos 10 ops de
    `FILTER_OPS` (nunca lista paralela), `sources` por-filtro descartado,
    `operation_id` proibido no savePlan e o save do editor RE-EMITE os
    filtros (regra do presetKey).
    `factor.defaultTarget` é fallback de LEITURA (goals vence; limpar a
    célula segue deletando a linha) — nunca vira linha de goals.
    `factor.targetCurrency` converte o alvo a BRL NA LEITURA pelos
    `targetRates` resolvidos nos CALLERS (computeEntry segue puro; taxa
    ausente ⇒ atingimento null + `targetRateMissing`, NUNCA 1:1 — caller novo
    sem o 7º argumento falha FECHADO). `config.presetKey` (plano criado por
    preset) sobrevive ao round-trip do save do editor — removê-lo quebraria o
    ensure-only do re-apply (§4.7). Apuração sobre o mês anterior
    (`config.apuracao: "mes_anterior"`): `year/month` público é SEMPRE o mês
    do LANÇAMENTO e o deslocamento vive via `apuracaoRef` DENTRO de
    `loadTargetsByMember`/`loadTargetRatesForConfig` + `monthPeriod` do
    recompute + key de goals do `saveTarget` — NUNCA desloque no call site
    (dupla conversão lê M-2) e NUNCA desloque entry/espelho (ficam no mês de
    pagamento); o save do editor RE-EMITE a chave como o presetKey.

27. **Filtros de relação por NOME se resolvem no ENGINE, antes do canon
    (§4.10).** Valor não-UUID em filtro de `responsible_id`/`operation_id`
    (string ou elemento de array) é NOME e resolve por
    `resolveFkFilterNames` (engine; homônimo: responsável canônico vence e o
    id emitido é o principal, operação ativa vence; desconhecido ⇒
    `FK_NO_MATCH` = vazio silencioso — o validador de import barra antes). A
    ordem nome→id→`expandResponsibleFilters` é FIXA em todos os choke points
    (runWidget, pernas por métrica, record-list, espelhos de operação da
    page/widget-scope — resolvidos ANTES de `collectOperationFilterIds`);
    consulta nova que aceite filtro de visualização DEVE passar pelo
    resolver. NUNCA valide nome via RPC nem reintroduza UUID em filtro de
    preset/JSON da IA (o export emite nome — `loadExportFkNames`). Editores
    cujos predicados comparam a coluna crua (sub-base, perfil de operação,
    automações do kanban) seguem gravando ID (picker exibe rótulo; storeAs
    "value") — nome lá NÃO resolve e no validador de import é erro dedicado.

## 6. Convenções do projeto

- **Cabeçalho de versão em todo arquivo**: `Versão: X.Y | Data: DD/MM/AAAA`,
  mudanças comentadas inline (`// vX.Y (data): ...`). É o único changelog que existe —
  mantenha-o ao editar.
- Comentários em português, explicando o **porquê** e as invariantes cross-file.
- Migrações SQL numeradas, **idempotentes** (`if not exists` / `create or replace` /
  `drop ... if exists`), com cabeçalho explicando o que fazem. Blocos consolidados
  por fase em `supabase/apply/`.
- Sem JSDoc formal — a documentação de código é prosa nos cabeçalhos + tipos de
  `lib/widgets/types.ts` e afins.

<!-- Versão: 1.0 | Data: 05/07/2026 -->

# Banco de dados (Supabase) — aplicação manual

Este projeto **não conecta ao banco** a partir do código de build/deploy do agente.
Todas as migrations e seeds são geradas como SQL para você aplicar manualmente no
**SQL Editor do Supabase**. As credenciais vivem só no painel do Supabase e nas
Environment Variables da Vercel.

## Como aplicar a Fase 1

1. Abra o **SQL Editor** do seu projeto Supabase.
2. Cole o conteúdo de [`apply/fase-1.sql`](./apply/fase-1.sql) (bloco único, já na
   ordem correta) e execute.
3. O script é **idempotente**: se algo falhar no meio, corrija e rode de novo.
4. Confirme que as tabelas, funções e políticas foram criadas sem erro.

As migrations individuais ficam em [`migrations/`](./migrations) (0001…0011), caso
prefira aplicar/versionar uma a uma.

## Como aplicar a Fase 2 (Sync Bitrix)

Depois da Fase 1, cole o [`apply/fase-2.sql`](./apply/fase-2.sql) (migração `0012`:
Responsáveis, Operações e Lead relacionado) e execute. Também idempotente.

Para o sync do Bitrix funcionar, configure na Vercel as env `BITRIX_WEBHOOK_URL`
(webhook de ENTRADA / API REST) e `SYNC_SECRET`. Depois, na página **Registros** (logado
como admin), use **Backfill inicial** (importa leads + deals do ano) e **Reconciliar**
(últimos N dias). Os responsáveis são criados automaticamente a partir do Bitrix; o admin
depois cura a lista (ativa/desativa) e monta as Operações. Não há webhook de saída por ora.

## Como aplicar a Fase 3 (Sync Estudo de Fechamentos)

Depois da Fase 2, cole o [`apply/fase-3.sql`](./apply/fase-3.sql) (migração `0013`:
índice funcional para localizar o lead relacionado por e-mail) e execute.

Esta fase é **receptora** (push): o Apps Script da planilha "Estudo de Fechamentos"
(`integrations/apps-script/push_estudo_fechamentos.gs`) envia as linhas da aba "Site" a
cada hora para `POST /api/sync/sheets`, protegido pela mesma `SYNC_SECRET`. Não há botão
manual — a listagem em **Registros** vai mostrar essas vendas assim que o Apps Script
rodar pela primeira vez (`installHourlyTrigger()`).

**Recomendado:** depois de aplicar esta fase, rode **Reconciliar** de novo no Bitrix — o
mapper de leads passou a capturar e-mail (necessário para casar vendas do site com o lead
de origem), então um novo sync garante que os leads já importados fiquem com e-mail
preenchido.

## Como aplicar a Fase 6A (Construtor de dashboards)

Cole o [`apply/fase-6.sql`](./apply/fase-6.sql) (migração `0015`: estende o RPC
`run_widget_query` para aceitar `responsible_id`/`operation_id`/`related_lead_id` como
dimensões/filtros e `lead_time_days` como métrica). É `create or replace`, idempotente.

Depois, no app: a **home** vira a lista de dashboards. Crie um dashboard, clique nele e use
**Adicionar widget** (fonte → dimensões → métricas → filtros → visual). "Editar layout"
liga o arraste/redimensionar (grid).

## Como aplicar a Fase 6B (Metas + operações aninhadas + presets)

Cole o [`apply/fase-6b.sql`](./apply/fase-6b.sql) (migração `0016`): tabela `goals` (metas),
`operations.parent_operation_id` (aninhamento), `widgets.settings` e a função
`operation_subtree`. Idempotente; semeia "Operação 1"/"Operação 2" só se não houver operações.

No app (como admin):
- **Operações** / **Responsáveis** / **Metas** aparecem na navegação. Configure as operações
  (com aninhamento), mapeie responsáveis→operações (prioridade 1 = padrão) e defina metas
  (global/operação/responsável — elas se comunicam por roll-up na leitura).
- Na **home**, botão **"Gerar presets"** cria os 4 dashboards de exemplo (incluindo
  "Performance comercial do mês") e os campos de apoio (forecast, implementação, etc.).
  É idempotente (pula o que já existe).

## Como aplicar a Fase 7 (Filtro de período interativo)

Cole o [`apply/fase-7.sql`](./apply/fase-7.sql) (migração `0017`) e execute. Idempotente.
Ele libera o `visual_type` `'filtro'` nos widgets (widget de filtro de período que
controla outros widgets) e adiciona `dashboards.settings` (jsonb) para guardar a config
da barra de período global de cada dashboard (ligada/desligada, período e campo padrão).

No app, dentro de um dashboard:
- A **barra de período** no topo filtra o dashboard inteiro. Quem edita pode, pela
  engrenagem da barra, definir o período/campo padrão ou ocultá-la.
- **Adicionar widget → "Filtro de período"** cria um filtro que pode ser **vinculado a
  gráficos/tabelas específicos** (aba "Vincular a"). Sem vínculo, ele age sobre o
  dashboard todo; com vínculo, só os widgets escolhidos respondem a ele (têm prioridade
  sobre a barra global).

## Como aplicar a Fase 8 (Separação de fontes + correspondências)

Cole o [`apply/fase-8.sql`](./apply/fase-8.sql) (migrações `0018`–`0021`) e execute.
Idempotente. Ele adiciona:
- `field_definitions.applies_to` (a quais fontes/`record_type` a coluna pertence) e
  cataloga os campos da planilha "Estudo de Fechamentos" (Produtos, Assentos, Campanha, E-mail).
- `field_correspondences` + `field_correspondence_members`: correspondências GLOBAIS de
  colunas (um "campo unificado" liga colunas equivalentes entre Estudo, Leads e Deals).
- `run_widget_query` passa a aceitar campos `unified:<key>` (coalesce das colunas
  correspondidas) via o novo parâmetro `p_correspondences`.
- `widgets.sources` / `widgets.split_by_source`: seleção de fontes por widget e o modo
  "quebrar por fonte".

No app (como admin):
- **Registros** ganha abas por fonte (Leads / Deals / Estudo de Fechamentos), cada uma com
  as colunas relevantes daquela fonte.
- **Campos** ganha a seção **Correspondências de colunas** (CRUD global).
- No **construtor de widget**: escolha as fontes, ligue "Combinar / Quebrar por fonte" e use
  os campos unificados nas dimensões/métricas/filtros.
- Depois de aplicar, rode um **Backfill** no Bitrix para (re)catalogar as colunas com nome
  visual e preencher `applies_to`.

## Como aplicar a Fase 8b (Rótulos visuais + visibilidade)

Cole o [`apply/fase-8b.sql`](./apply/fase-8b.sql) (migração `0022`) e execute. Idempotente.
Ele corrige **imediatamente** o nome das colunas do Bitrix (usa os nomes visuais do
arquivo de integração no lugar do nome da API que o schema às vezes devolve) e liga a
visibilidade (`show_in_builder`) desses campos — sem precisar rodar um sync. Os próximos
syncs preservam esses nomes/visibilidade (via `FIELD_LABELS` em
`lib/sync/bitrix/catalog.ts`). Depois disso, em **Campos**, você pode ocultar qualquer
coluna que não queira ver nos seletores/tabelas.

## Como aplicar a Fase 9 (Sync incremental e retomável)

Cole o [`apply/fase-9.sql`](./apply/fase-9.sql) (migração `0023`: tabela `sync_jobs`) e
execute. Idempotente. Ela guarda o estado dos jobs de **Backfill/Reconciliar** para que
rodem em pedaços pequenos (1 página do Bitrix por requisição), com **barra de progresso** e
**retomável** — resolve o travamento em períodos longos no plano gratuito da Vercel.

Depois de aplicar, em **Registros** (como admin) o painel de Sincronização passa a mostrar
o progresso por fase; o **Backfill** ganha o campo de dias (padrão 365, janela corrida) e o
**Reconciliar** continua puxando só o que mudou (por `DATE_MODIFY`). Se a aba for fechada no
meio, ao reabrir a página o job em andamento é detectado e pode ser retomado.

## Como aplicar a migration 0038 (Configurações para gestor/vendedor)

Cole o [`migrations/0038_config_read_access.sql`](./migrations/0038_config_read_access.sql)
no SQL Editor e execute. Idempotente. Ela libera a leitura de `sync_jobs` para
qualquer autenticado (aba **Configurações → Log**, seção "Sincronizações": mostra
reconciliações e backfills a gestor/vendedor também) e troca a leitura de
`bitrix_writeback_queue` de admin para quem tem `view_all_records` (admin + gestor).
A escrita das duas tabelas continua só via service role. Depois disso, gestor e
vendedor passam a ver uma **Configurações simplificada** (Moedas em leitura, Log e
troca da própria senha) — sem mudança de RLS nas moedas, cuja leitura já era pública.

## Como aplicar a Fase 12 (Mock de "Data Reunião" jan–mai + congelamento)

Cole o [`apply/fase-12.sql`](./apply/fase-12.sql) (migrações `0051`–`0052`) e execute.
Idempotente. **Aplique o SQL ANTES de fazer o deploy do código desta fase** (o app
passa a filtrar pela nova coluna `records.is_mock`). O que ela faz:

- **Zera "Data Reunião"** (Lead `UF_CRM_1743441331` e Negócio `UF_CRM_67EACEFCCCD98`)
  de todos os registros reais com data **anterior a 01/06/2026** (o período jan–mai e
  tudo antes de 01/01). Os valores originais ficam guardados em
  `reuniao_freeze_backup` (para o undo).
- **Insere 270 leads mock** (CSV "Inbound Zapper") com Data Reunião entre 01/01/2026 e
  31/05/2026 — os únicos com o campo preenchido no período. Eles têm todas as datas do
  núcleo NULL e `is_mock = true`.
- **Congela o campo** com um trigger no banco: nenhum sync do Bitrix, recálculo ou
  edição no app consegue gravar Data Reunião anterior a 01/06/2026 nem alterar os
  mocks. O sync continua rodando normalmente — as tentativas são descartadas em
  silêncio (pode gerar algum ruído no audit_log; inofensivo). Datas a partir de
  01/06/2026 seguem sincronizando normal.
- **Regra de contagem**: os mocks **nunca somam** em nenhuma consulta (widgets,
  contagens, listas, página Registros) — só aparecem quando a consulta referencia
  Data Reunião (período, dimensão, métrica ou filtro, direto ou via campo unificado).
  Consultas por data de criação/movimentação/fechamento os ignoram por construção.

**Para desfazer** (única forma prevista): cole e execute
[`apply/undo-mock-reuniao.sql`](./apply/undo-mock-reuniao.sql) — remove o trigger,
restaura os valores originais do backup e apaga os mocks.

Conferência pós-aplicação:

```sql
select count(*) from public.records where is_mock;                    -- esperado: 270
select count(*) from public.records
 where not is_mock
   and left(custom_fields->>'bitrix_uf_crm_1743441331', 10) < '2026-06-01';  -- 0
select count(*) from public.records
 where not is_mock
   and left(custom_fields->>'bitrix_uf_crm_67eacefcccd98', 10) < '2026-06-01'; -- 0
-- teste do congelamento (deve continuar NULL depois do update):
update public.records
   set custom_fields = jsonb_set(custom_fields, '{bitrix_uf_crm_1743441331}', '"2026-03-10"')
 where not is_mock and record_type = 'lead' and id = (
   select id from public.records where not is_mock and record_type = 'lead' limit 1
 );
```

## Criar o primeiro usuário admin (bootstrap)

Os seeds criam papéis e permissões, mas **não criam usuários**. Para ter o primeiro
admin (e poder usar a tela de Usuários depois):

1. No painel Supabase: **Authentication → Users → Add user** (defina email e senha;
   não há signup público no app).
2. Copie o `User UID` do usuário criado.
3. No SQL Editor, atribua o papel `admin`:

   ```sql
   insert into public.user_roles (user_id, role_key)
   values ('COLE-O-USER-UID-AQUI', 'admin')
   on conflict do nothing;
   ```

4. Faça login no app com esse email/senha. O menu de admin (Campos, Usuários) aparece
   conforme as permissões do papel.

## Papéis e permissões (resumo)

| Papel     | Permissões                                                                 |
| --------- | -------------------------------------------------------------------------- |
| admin     | todas                                                                      |
| gestor    | editar valores, criar dashboards, ver todos os registros, ver forecast     |
| vendedor  | editar os próprios valores, criar dashboards pessoais                       |

As duas camadas independentes da especificação são as permissões
`edit_record_values` (editar valor) e `manage_field_definitions` (criar/alterar
coluna), reforçadas por políticas RLS distintas.

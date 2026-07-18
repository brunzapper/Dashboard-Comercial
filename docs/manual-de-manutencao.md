<!-- Versão: 1.0 | Data: 17/07/2026 -->

# Manual de manutenção

Runbook para manter o sistema **manualmente, sem IA**: setup do zero, rotina de
mudanças seguras e troubleshooting. Pressupõe a leitura de
[`arquitetura.md`](./arquitetura.md) (especialmente a seção **Invariantes críticas**)
e usa [`banco-de-dados.md`](./banco-de-dados.md) como referência de schema.

## 1. Setup do zero (novo ambiente)

Ordem completa para levantar o sistema num projeto Supabase + Vercel novos:

1. **Supabase** — crie o projeto e anote URL, anon key e service role key.
2. **Banco** — no SQL Editor, aplique os blocos de `supabase/apply/` na ordem do
   runbook [`../supabase/README.md`](../supabase/README.md) (fase-1 → fase-2 → ... →
   fase-14, mais as migrações avulsas citadas lá, ex.: 0038 e 0056–0059). Tudo é
   idempotente: se falhar no meio, corrija e rode de novo. Termine com as migrações
   posteriores ao último bloco de fase (0065–0074, em ordem).
3. **Vercel** — importe o repositório (deploy automático a cada push; não há CI).
   Configure as Environment Variables usando `.env.example` como checklist:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `BITRIX_WEBHOOK_URL`, `SYNC_SECRET`,
   `KEY_ENCRYPTION_KEY` (gere: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).
   Não existe `.env.local` — valores só na Vercel/Supabase.
4. **Primeiro admin** — Authentication → Users → Add user no painel Supabase; depois
   `insert into public.user_roles (user_id, role_key) values ('<UID>', 'admin')`.
   Passo a passo completo no `supabase/README.md` ("bootstrap").
5. **Agendamentos (pg_cron)** — no SQL Editor, nesta ordem:
   1. `apply/pg-cron-tick.sql` — **cria os segredos no Vault**
      (`app_base_url` = domínio de produção, `sync_secret` = SYNC_SECRET) e agenda o
      tick do sync a cada minuto;
   2. `apply/pg-cron-recalc.sql` — recalc diário dos campos calculados (05:00 UTC);
   3. `apply/pg-cron-snapshots.sql` — tick dos snapshots a cada 5 min;
   4. `apply/pg-cron-webhooks.sql` — tick dos webhooks de saída a cada minuto.
   Os três últimos **pressupõem os segredos criados pelo primeiro**.
6. **Sync Bitrix** — logado como admin, em Registros: **Backfill inicial** (importa o
   ano) e depois **Reconciliar**. Os responsáveis são criados automaticamente; cure a
   lista em Configurações → Responsáveis e monte as Operações.
7. **Planilha "Estudo de Fechamentos"** — instale o Apps Script
   `integrations/apps-script/push_estudo_fechamentos.gs` na planilha (instruções no
   cabeçalho do arquivo) e rode `installHourlyTrigger()`.
8. **Conferência** — rode as queries de verificação do `supabase/README.md`
   (políticas `anon` em snapshots = 0 linhas; EXECUTE das funções de snapshot só
   `service_role`; contagem de mocks = 302).

## 2. Rotina de desenvolvimento

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck  # tsc --noEmit  — rode SEMPRE antes de commitar
npm run lint
npm run build      # o que a Vercel roda no deploy
```

- **Convenção de versionamento**: todo arquivo tem cabeçalho
  `Versão: X.Y | Data: DD/MM/AAAA`. Ao editar, incremente a versão menor e comente a
  mudança no local (`// vX.Y (data): ...`). Este é o único changelog do projeto.
- Não há testes automatizados: `typecheck` + `lint` + verificação manual no app são a
  rede de segurança (ver §6).

## 3. Como fazer uma mudança de banco

1. Crie `supabase/migrations/NNNN_nome.sql` com o próximo número livre (hoje: 0075).
   Cabeçalho `-- Versão / -- Data` + comentário explicando o quê/porquê.
2. Escreva SQL **idempotente** (`if not exists`, `create or replace`,
   `drop ... if exists` antes de `create trigger/policy`).
3. Se o app passa a **selecionar colunas novas**, o SQL deve ser aplicado **antes**
   do deploy do código — deixe isso avisado no cabeçalho da migração e no
   `supabase/README.md`.
4. Aplique manualmente no SQL Editor do Supabase (não há pipeline).
5. Atualize: a seção correspondente do `supabase/README.md` (como aplicar), o
   [`banco-de-dados.md`](./banco-de-dados.md) (schema + histórico) e, se a mudança
   for de fase, o bloco `supabase/apply/fase-N.sql`.
6. **Não renumere nem "conserte"** as anomalias históricas (0014 ausente; 0017 e
   0049 duplicados) — a ordem real de aplicação é a do runbook.

## 4. Checklists de mudança segura (áreas de risco)

### 4.1 Mudou `run_widget_query` (motor de widgets)

- [ ] A migração recria **também** `run_widget_query_snapshot` (e
  `_widget_match_expr` ↔ `_widget_match_expr_snap`) **no mesmo arquivo** — parta da
  0072, que contém o par completo.
- [ ] A regra dos mocks (substring das chaves `bitrix_uf_crm_1743441331` /
  `bitrix_uf_crm_67eacefcccd98`) permanece idêntica nos dois lados **e** em
  `lib/widgets/mock-reuniao.ts`.
- [ ] Buckets de data continuam batendo com `canonicalBucketKey` no cliente.
- [ ] EXECUTE da versão snapshot continua restrito à service role.
- [ ] Teste manual: um mesmo widget no dashboard e num snapshot recém-refrescado
  mostra os mesmos números (crie um snapshot de teste; "Atualizar agora" no menu ⋮).

### 4.2 Mexeu em snapshots

- [ ] Nenhuma política RLS `to anon`, nenhum GRANT a `anon`/`authenticated` nas
  funções de snapshot (rode as queries de conferência do `supabase/README.md`).
- [ ] O viewer não injeta filtros de restrição (as restrições vivem DENTRO da RPC
  como `(is_mock OR restrições)`).
- [ ] `default_period` continua tratado como filtro de consulta, não restrição.
- [ ] Mudanças no dataset exigem refresh dos snapshots existentes ("Atualizar agora"
  ou `select public.snapshot_refresh_copy(id) from public.snapshots;`).

### 4.3 Mexeu em RLS / permissões

- [ ] Helpers (`auth_has_role` etc.) chamados como `(select ...)` nas policies
  (InitPlan — 0068); chamada "nua" reavalia por linha.
- [ ] Visibilidade de registros continua pelo vínculo vivo
  `records.responsible_id → responsibles.user_id`; **nunca** por `owner_user_id`.
- [ ] Tabelas de segredo (`api_keys`, `webhook_*`, `sync_jobs`) continuam sem policy
  de escrita (só service role).

### 4.4 Criou/alterou fontes de dados

- [ ] Fonte nova via UI (Configurações → Fontes) segue a convenção
  `key === record_type`.
- [ ] O resolver de período cobre a fonte (mapa `fieldBySource` —
  `lib/widgets/period-resolve.ts`); fontes fora do mapa são **excluídas** pelo
  `@period` do RPC.
- [ ] `default_period_field` da fonte faz sentido (é o campo da barra de período).

### 4.5 Mexeu em campos calculados / fórmulas

- [ ] Valores são materializados em `records.custom_fields` — mudou fórmula, dispare
  o recálculo (a UI de Campos faz isso; em lote usa `recalc_apply_updates`).
- [ ] Fórmulas com "Data atual" dependem do cron diário (`pg-cron-recalc.sql`).
- [ ] Campos calculados são sempre recomputados pelo sync (não são protegidos por
  `field_modified_at`).

### 4.6 Mexeu no sync do Bitrix

- [ ] Edições manuais continuam protegidas (conflito por campo via
  `field_modified_at`).
- [ ] Jobs continuam resumíveis (uma página por requisição; estado em `sync_jobs`).
- [ ] Mapper/catalog: rótulos visuais vêm de `FIELD_LABELS`
  (`lib/sync/bitrix/catalog.ts`); após mudar catálogo, rode um Backfill.
- [ ] Ao promover um campo descoberto (`bitrix_<id>`) a chave curada, reconcilie a
  linha antiga de `field_definitions` numa migração ANTES do próximo catálogo — o
  índice único `(source_system, source_field_id)` (0017) rejeita a chave nova
  enquanto a descoberta existir (precedente: 0075, `fonte`/`implementacao`).
- [ ] O sync **nunca** toca linhas mock (`source_system='manual'`,
  `source_id='mock_reuniao_*'`).

## 5. Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| Snapshot mostra números ≠ dashboard | RPCs divergiram (espelhamento esquecido) ou snapshot sem refresh após migração | Compare `pg_get_functiondef` das duas funções; refaça o espelhamento; "Atualizar agora" |
| Mocks sumiram de um widget/snapshot | A consulta deixou de referenciar Data Reunião (ex.: snapshot sem `default_period`, período "todo o período") | Confira o campo de período; para snapshots antigos, defina `default_period` (SQL de exemplo no `supabase/README.md`, seção 0059) |
| Vendedor não vê os próprios registros/mocks | `responsibles` sem `user_id` vinculado (ou duplicata sem vínculo) | Vincule na tela de Usuários; para mocks, ver migração 0058 |
| Sync "travado" | Job em `sync_jobs` com status `running` órfão | Reabra a página Registros (o job é detectado e retomável); em último caso, marque `status='canceled'` via SQL |
| Tick não roda (sync/snapshot/webhook) | pg_cron não agendado, ou segredos ausentes no Vault | `select * from cron.job;` — confira os 4 jobs; recrie segredos conforme `pg-cron-tick.sql`; teste `POST` manual na rota com `SYNC_SECRET` |
| Ruído no `audit_log` com Data Reunião | Trigger de congelamento descartando tentativas do sync (esperado) | Inofensivo — ver migração 0051 |
| Webhook de saída parou | Auto-desativado após falhas consecutivas | Configurações → Integrações: ver `disabled_reason`, corrigir o endpoint e reativar |
| Tela de snapshots/listagens quebrou após deploy | Código selecionando coluna que a migração ainda não criou | Aplique o SQL pendente (regra "SQL antes do deploy") |
| Erro de env em runtime | Variável ausente na Vercel | `lib/env.ts` diz qual; confira `.env.example` |
| Remover os mocks de vez | — | `supabase/apply/undo-mock-reuniao.sql` (única forma prevista) |

## 6. Lacunas conhecidas e recomendações

Registradas para o futuro — **nada disto está implementado**:

1. **Testes de paridade das RPCs** (maior risco hoje): um script SQL que rode a mesma
   config de widget em `run_widget_query` e, sobre um snapshot de teste, em
   `run_widget_query_snapshot`, comparando resultados. Alternativa mínima: comparar
   `pg_get_functiondef` das duas funções módulo o nome da tabela.
2. **CI mínimo**: GitHub Actions rodando `npm run lint` + `npm run typecheck` a cada
   push — hoje nada impede um push que não compila.
3. **Testes de unidade** dos módulos puros (`lib/widgets/period-resolve.ts`,
   `lib/records/formulas.ts`, `lib/widgets/mock-reuniao.ts`) — são funções puras,
   fáceis de testar sem banco.
4. Manter **este manual e o `banco-de-dados.md` atualizados a cada migração** — eles
   substituem a leitura das 75 migrações; desatualizados, viram armadilha.

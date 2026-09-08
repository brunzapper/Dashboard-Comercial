# Segurança — diagnóstico e blindagem

> Última auditoria: 22/08/2026. Escopo: Next.js 16 (App Router) + Supabase,
> multi-organização com RLS, viewer público de snapshots, sync Bitrix, API de
> ingest/webhooks. Este documento registra o diagnóstico, o que foi corrigido e
> as recomendações que dependem de painel/infra.

## Veredito

Postura de segurança **forte** na base: RLS fail-closed em todas as tabelas
org-scoped, tokens guardados só como `sha256`, segredos reversíveis em
AES-256-GCM, SQL dinâmico via `format('%I'/'%L')` + whitelist (sem injeção),
SSRF guard nos webhooks de saída, Owner guard triplo, nada sensível em
`NEXT_PUBLIC`, `.env` nunca versionado. A auditoria de 23/07/2026 encontrou
**3 falhas de isolamento entre organizações** (corrigidas) e itens de hardening;
a de 22/08/2026 encontrou mais **6** (corrigidas — seção abaixo), sendo duas das
cinco classes revisadas totalmente limpas.

## Auditoria 22/08/2026 — RLS, permissão no navegador, IDOR, chaves, XSS

Revisão das cinco classes pedidas sobre o repo inteiro, com foco no que nasceu
DEPOIS da auditoria de 23/07 (remuneração 0112–0115, automações de kanban 0109,
mapeamentos 0117–0119, lixeira 0121, export p/ Planilhas, assistentes de IA).
Essas superfícies novas passaram limpas: RLS org-scoped, escrita
service-role-only onde cabe, `revoke ... from anon` em todas.

**Duas categorias sem nenhum achado:**

- **Chaves hard-coded:** zero literais de segredo (`lib/env.ts` lê tudo
  preguiçosamente; `lib/supabase/service.ts` importa `server-only`; o Apps
  Script lê de `PropertiesService`; o CI injeta de `secrets`). Ressalva
  documentada, não achado: `tests/helpers/e2e-fixtures.ts` versiona senha e
  token de teste fixos e `scripts/e2e-seed.ts` cria com eles um usuário
  `admin` — contido pela guarda de host (`:50-59`, só localhost salvo
  `E2E_SEED_ALLOW_REMOTE=1`).
- **XSS:** os dois únicos `dangerouslySetInnerHTML` (`app/layout.tsx:72`,
  `components/layout/theme-sync.tsx:43`) interpolam valores já passados pelas
  whitelists de `lib/theme.ts`; nenhum `innerHTML`/`eval`/`document.write`;
  `href` dinâmico só no widget Imagem, saneado a `https:` em três camadas.

### Corrigido nesta entrega

- **Valores de campo restrito no payload RSC (alto).** `visible_to_roles`
  filtrava a LISTA de colunas, não os dados: `custom_fields` é UMA coluna jsonb
  (a RLS não esconde chave de jsonb), e as linhas cruas seguiam para o Client
  Component — o valor de um campo `visible_to_roles: ["admin"]` viajava no
  flight payload de `/registros` para gestor/vendedor, só não era desenhado.
  Peneira no SERVIDOR por `lib/records/field-acl.ts`
  (`restrictedFieldKeys` + `redactRestrictedFields`, deny-list: chave ÓRFÃ sem
  definição sobrevive), aplicada em `app/(app)/registros/page.tsx` e na agenda
  (`lib/agenda/actions.ts` — `AgendaItem.record` é um RecordRow inteiro).
  Precedente da mesma régua: `registros/export-actions.ts`, que já filtrava os
  valores antes do CSV.
- **Escalada de privilégio entre orgs (alto).** Escrita de `roles`/
  `permissions`/`role_permissions` (globais) exigia só `manage_users_roles` —
  permissão de usuário. Migração **0122**: service-role-only.
- **`reuniao_freeze_backup` sem RLS (médio).** Única tabela do schema sem
  tranca. Migração **0122**: RLS ligada, zero policies.
- **Câmbio compartilhado entre orgs (médio).** `currencies`/`currency_rates`
  eram globais com escrita por `manage_field_definitions`. Migração **0123**:
  org-scoped (PK/FK compostas), writers carimbam a org
  (`campos/moedas-actions.ts`) e os loaders aceitam `orgId` — OBRIGATÓRIO no
  caminho service role de `lib/snapshots/refresh.ts`.
- **Injeção de filtro PostgREST (baixo).** `campos/matches-actions.ts` montava
  `.or(\`record_a_id.eq.${recordId},...\`)` com id cru do cliente (vírgula e
  ponto são sintaxe ali). Agora valida UUID antes. Os `.or()` de
  `registros/bases/actions.ts` já eram seguros (`slugify` + `KEY_RE`).
- **Enumeração de contas (baixo).** `dashboards/access-actions.ts` chamava
  `listUsers({perPage:1000})` (todas as orgs) e só recortava depois, se houvesse
  org — board sem `organization_id` devolvia o email de toda conta ao dono.
  Agora resolve a membership ANTES e é fail-closed; `setBoardAccessEntry` passa
  a validar no servidor que o alvo é da org do board (remover override segue
  livre — é estreitamento).

### Prova

Cluster Postgres descartável com shim do ambiente Supabase (roles `anon`/
`authenticated`/`service_role`, schema `auth`, e os grants default do Supabase
no schema `public` — é o que torna uma tabela sem RLS legível por qualquer
autenticado). As 123 migrações aplicam em ordem; 0122/0123 são idempotentes.
Como `authenticated` de uma org, com `manage_field_definitions` ativo:

| Tentativa | Antes (até 0121) | Depois |
|---|---|---|
| `update currency_rates` de outra org | `UPDATE 1` | `UPDATE 0` |
| `insert currency_rates` carimbando outra org | — | erro de WITH CHECK |
| `insert role_permissions ('vendedor','view_all_records')` | `INSERT 0 1` | permission denied |
| `truncate role_permissions` | `TRUNCATE TABLE` | permission denied |
| `select from reuniao_freeze_backup` | 1 linha | permission denied |

O TRUNCATE é o motivo de a 0122 usar `revoke all` + `grant select` em vez de
`revoke insert, update, delete`: o revoke enumerado deixava TRUNCATE de pé e um
autenticado zerava o catálogo de permissões do sistema.

### Decisões conscientes (não corrigido)

- **Widget de lista/tabela em dashboard com coluna de campo restrito.** O
  construtor já impede não-admin de ADICIONAR coluna restrita
  (`dashboards/[id]/page.tsx:376-385`); se um admin montou o widget e
  compartilhou o board, o dado aparece de propósito. Decidido em 22/08/2026
  manter o comportamento — peneirar ali esvaziaria colunas de boards já
  compartilhados. Se a decisão mudar, o helper é o mesmo
  (`redactRestrictedFields` sobre `recordListById`).
- **CSP `img-src` sem `https:`** (`next.config.ts:19`) enquanto o widget Imagem
  existe para renderizar URL https externa: em produção o browser bloqueia
  essas imagens. É bug FUNCIONAL, não falha de segurança — registrado aqui para
  não se perder.

## Follow-up 27/07/2026 — realocação de páginas de Configurações + Tema

- **Páginas movidas mantêm chave e guards.** Bases (`/registros/bases`), Log
  (`/registros/log`) e Moedas (aba de `/campos`) saíram do hub de
  Configurações mas seguem nas MESMAS chaves de área (`fontes`/`log`/
  `moedas`) em `requireSettingsArea`/`isSettingsAreaDenied` — overrides
  gravados em `user_access_overrides` continuam valendo. Nunca renomear uma
  chave de área.
- **Log endurecido**: a page trocou `requireSession()` por
  `requireSettingsArea("log")` (gate `{}` = mesmo público), fechando o acesso
  por URL direta de um usuário com deny — antes o deny só escondia a aba.
- **Tema**: cookies `theme_mode`/`theme_accent` NUNCA vão crus a style/script
  — sanitização por whitelist em `lib/theme.ts` (`normalizeThemeMode`/
  `normalizeHexColor`) no root layout e nas actions. Padrão da org
  (`organizations.theme`, 0108) escrito só pelo org_admin (policy existente
  `organizations_update` é a muralha).

## Follow-up 24/07/2026 — auditoria de comentários/docs

Revisão focada em comentários e documentos que expunham fragilidades. Correções
de código (todas estreitamentos ou aditivas — nenhuma concede acesso novo):

- **Bypass de escrita em área NEGADA (corrigido).** O override `deny` de uma
  área de Configurações agora barra também a ESCRITA das server actions, não só
  a page — antes um admin explicitamente negado ainda escrevia chamando a action
  direto. Helper `isSettingsAreaDenied` (`lib/auth/access.ts`) aplicado nos
  guards de metas/operacoes/responsaveis/moedas/integracoes/fontes/usuarios.
  `allow` continua NÃO concedendo escrita (segue o papel/RLS).
- **Senha mínima 6 → 12** (`configuracoes/usuarios/actions.ts`): contas são
  todas provisionadas por admin (sem signup público); mínimo forte reduz o risco
  de credencial fraca. Combina com o Leaked Password Protection (pendente,
  painel).
- **TTL opcional de snapshots (0097).** `snapshots.expires_at` (nullable — NULL
  preserva o "sem expiração" atual); o viewer público (`app/s/[token]`) responde
  o mesmo 404 uniforme quando expirado (`isSnapshotExpired`, fail-closed). Sem
  tocar o par `run_widget_query`/`_snapshot` (é metadado de acesso). Ajustável no
  form de criação/edição do snapshot.

**Não corrigido de propósito — PII de mock (`0051`/`0053`/`0058`).** Os nomes
reais de vendedores nas migrações de mock são CHAVE DE JUNÇÃO com
`responsibles.display_name` (populado pelo sync do Bitrix); anonimizá-los
quebraria o vínculo em banco novo e a visibilidade por RLS — regressão. É dado
da própria organização em repo privado, e o histórico do git reteria os nomes de
qualquer forma. Se o repo for tornar-se público: refatorar o vínculo do mock
para ID (em vez de nome) + purgar o histórico (git-filter-repo/BFG) — esforço
deliberado e testado, não um sed apressado.

## Corrigido nesta entrega

### Isolamento entre organizações (crítico)
- **Webhooks de saída** (`lib/webhooks/emit.ts`): `emitWebhookEvent` agora recebe
  `organizationId`; os endpoints são filtrados por org (cache por org) e o
  `webhook_events` é carimbado. Antes, um `record.*`/`task.*`/`comment.*` de uma
  org era entregue a endpoints de outra, com payload. Call-sites em
  `lib/records/actions.ts`, `lib/tasks/actions.ts`, `lib/comments/actions.ts`
  passam `getActiveOrgId()`.
- **Ações de usuários** (`configuracoes/usuarios/actions.ts`): `resetUserPassword`,
  `setUserDisabled`, `deleteUser` agora exigem que o `userId`-alvo seja membro da
  org ativa (`targetInActiveOrg`) antes de agir via service role.
- **Ações de integrações** (`configuracoes/integracoes/actions.ts`): revoke de
  chave, update/toggle/roll/delete de endpoint e `sendTestEvent` agora recortam
  a linha por `organization_id` da org ativa (sem sucesso silencioso cross-org).
- **Recalc de fórmulas** (`lib/records/recalc.ts` + `loadFormulaDefsByOrg`): o
  recálculo global agora aplica a cada registro **apenas as fórmulas da sua org**
  (`field_key` é único por-org). `runAutoMatch` já era seguro (matching por
  `record_type`, que é global/único → uma só org por tipo).

### Hardening de aplicação
- **Headers de segurança** (`next.config.ts`): CSP, `X-Frame-Options: DENY` +
  `frame-ancestors 'none'` (anti-clickjacking), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `Strict-Transport-Security` (HSTS) e `Permissions-Policy`
  em todas as rotas.
- **CSV/formula injection** (`lib/export/csv.ts`): `sanitizeCsvCell` prefixa `'`
  em células iniciadas por `= + - @ TAB CR` (exceto números do formato do app),
  preservando o round-trip com o import.
- **`SYNC_SECRET` constant-time** (`lib/auth/sync-secret.ts`): comparação via
  `timingSafeEqual` sobre `sha256`, compartilhada pelas 7 rotas de tick/sync.
- **`server-only`** em `lib/supabase/service.ts`: build falha se a service role
  key for importada por um Client Component.

### Dependências (CVEs)
- **`next` 16.2.10 → 16.2.11**: fecha 9 advisories (SSRF em Server Actions,
  disclosure de endpoints internos de Server Function, DoS, cache confusion).
- **`brace-expansion`**: DoS (ReDoS) corrigido via `npm audit fix`.
- Pendentes (transitivos do `next`, sem fix sem quebrar): `postcss` (<8.5.10,
  XSS moderado) e `sharp` (<0.35.0, libvips). `npm audit --force` só "resolve"
  downgradando o Next para 9.3.3 (inaceitável). Aguardar patch upstream do Next.

### Banco (migração `0095_security_hardening.sql`)
- `search_path = ''` fixado em 9 funções (`set_updated_at`, `operation_subtree`,
  os 3 `enforce_*_guard`, os 4 `*_set_org`) — anti schema-hijack.
- Helpers `auth_*` (SECURITY DEFINER): `revoke execute from public, anon` +
  `grant to authenticated, service_role` (grant-first, sem risco de lockout).
- **Verificado com o linter do Supabase**: os 9 avisos de `search_path` mutável e
  os 15 de `anon` executável **zeraram**.

## Pendências (ação de painel/infra — não código)

| Item | Ação | Severidade |
|------|------|-----------|
| **Leaked Password Protection** desabilitado | Ativar no painel Supabase → Auth → Password (checa HaveIBeenPwned) | Média — 1 clique |
| **Rate limiting** ausente (login, `/s/[token]`, `api/ingest`, ticks) | Requer Upstash/edge; avaliar `@upstash/ratelimit` no login e no ingest | Média |
| **Extensões `unaccent`/`pg_net` em `public`** | Mover para schema `extensions` (`pg_net` é gerenciado pelo Supabase — baixa prioridade) | Baixa |
| **Sem CI** | Workflow com `typecheck` + `lint` + `npm audit` no push | Processo |

> Resolvidos no follow-up 24/07/2026 (ver seção acima): **Snapshots sem TTL**
> (agora `expires_at` opcional) e **senha fraca** (`MIN_PASSWORD` 6 → 12). O
> **Leaked Password Protection** segue pendente (1 clique no painel) e o **rate
> limiting** segue como item de edge/infra.

## Avisos residuais do linter (por design — não corrigir)

- **`authenticated_security_definer_function_executable`** (helpers `auth_*`): os
  helpers de RLS PRECISAM ser executáveis por `authenticated` — sem isso as
  políticas de RLS falham. São SECURITY DEFINER que retornam só o escopo do
  próprio usuário (via `auth.uid()`); execução por anon já foi removida.
- **`rls_enabled_no_policy`** em `reuniao_freeze_backup`: RLS ligada sem policy =
  fail-closed (ninguém lê, exceto service role). Intencional.

## Pontos fortes confirmados (sem ação)

- Middleware (`proxy.ts`) valida sessão em toda rota não-pública; todas as
  pages/actions com guard (`getSessionInfo`/`require*`/`ensureAdmin`).
- RLS org-scoped (0089–0094); `auth_org_ids()` derivado da sessão, nunca do
  cliente; `organization_id` carimbado por trigger + WITH CHECK.
- `run_widget_query`/`_snapshot`: `security invoker`, `search_path=''`,
  `format %I/%L` + whitelist; `_snapshot` revogado de anon/authenticated.
- Viewer público: token de 256 bits, só `sha256` no banco, 404 uniforme, adapter
  fail-closed (`lib/snapshots/db-adapter.ts`).
- `api/ingest`: hash + `timingSafeEqual`, 401 uniforme, teto 1 MB/500 linhas.
- Webhooks de saída: HMAC (estilo Stripe, com timestamp) + SSRF guard (bloqueia
  IPs privados v4/v6, resolve DNS, `redirect: error`).
- Owner guard triplo fail-closed; segredos AES-256-GCM; logs sem dados sensíveis.

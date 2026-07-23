# Segurança — diagnóstico e blindagem

> Última auditoria: 23/07/2026. Escopo: Next.js 16 (App Router) + Supabase,
> multi-organização com RLS, viewer público de snapshots, sync Bitrix, API de
> ingest/webhooks. Este documento registra o diagnóstico, o que foi corrigido e
> as recomendações que dependem de painel/infra.

## Veredito

Postura de segurança **forte** na base: RLS fail-closed em todas as tabelas
org-scoped, tokens guardados só como `sha256`, segredos reversíveis em
AES-256-GCM, SQL dinâmico via `format('%I'/'%L')` + whitelist (sem injeção),
SSRF guard nos webhooks de saída, Owner guard triplo, nada sensível em
`NEXT_PUBLIC`, `.env` nunca versionado. A auditoria encontrou **3 falhas de
isolamento entre organizações** (corrigidas) e itens de hardening (corrigidos ou
documentados).

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
| **Snapshots sem TTL** | Só revogação manual por status; avaliar `expires_at` opcional | Baixa |
| **Sem CI** | Workflow com `typecheck` + `lint` + `npm audit` no push | Processo |

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

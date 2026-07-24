-- Versão: 1.0 | Data: 24/07/2026
-- TTL OPCIONAL de snapshots públicos. Antes um link /s/<token> valia para
-- sempre (só revogável manualmente mudando o status). `expires_at` (nullable)
-- guarda o instante de expiração escolhido na criação/edição; NULL = sem
-- expiração (comportamento atual preservado — nenhum snapshot existente muda).
--
-- O enforcement é de APLICAÇÃO, fail-closed, no viewer público (app/s/[token]):
-- token válido + status 'active' + (expires_at NULL OU futuro). Não mexe no par
-- run_widget_query/_snapshot nem em nenhuma policy (invariante 1) — é só um
-- metadado de acesso. Idempotente.
alter table public.snapshots
  add column if not exists expires_at timestamptz;

comment on column public.snapshots.expires_at is
  'TTL opcional do link público: quando no passado, o viewer responde 404 '
  '(mesmo 404 uniforme de pausado/revogado). NULL = sem expiração.';

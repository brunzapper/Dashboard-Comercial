-- Versão: 1.0 | Data: 04/07/2026
-- Auditoria: toda edição de valor gera uma linha aqui. user_id nulo quando a
-- origem é sincronização. Idempotente.

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  record_id uuid references public.records (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  field text not null,
  old_value jsonb,
  new_value jsonb,
  changed_at timestamptz not null default now(),
  origin text not null check (origin in ('app', 'sync_bitrix', 'sync_sheet'))
);

create index if not exists idx_audit_record on public.audit_log (record_id, changed_at desc);

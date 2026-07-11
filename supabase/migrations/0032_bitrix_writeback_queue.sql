-- Versão: 1.0 | Data: 11/07/2026
-- Fila de write-back para o Bitrix. Ao editar um campo marcado (field_definitions
-- .write_back), a edição salva SEMPRE no Supabase e uma linha 'pending' é criada
-- aqui. O tick agendado (/api/sync/tick) drena a fila: converte o valor para o
-- formato do Bitrix e chama crm.deal/lead.update. Falhas ficam registradas
-- (last_error/attempts) e viram 'error' após MAX_ATTEMPTS — visíveis na aba
-- Configurações → Log. Escrita SÓ via service role; admins leem. Idempotente.

create table if not exists public.bitrix_writeback_queue (
  id              uuid primary key default gen_random_uuid(),
  record_id       uuid not null references public.records (id) on delete cascade,
  entity          text not null check (entity in ('deal', 'lead')),
  source_id       text not null,                 -- ID do deal/lead no Bitrix
  field_key       text not null,                 -- chave em records.custom_fields (ou coluna)
  source_field_id text not null,                 -- campo alvo no Bitrix (UF_CRM_* / padrão)
  label           text,                          -- rótulo do campo (para o Log)
  new_value       jsonb,                         -- valor como armazenado no record
  status          text not null default 'pending'
                    check (status in ('pending', 'done', 'error')),
  attempts        int not null default 0,
  last_error      text,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  processed_at    timestamptz
);

-- Drenar por ordem de chegada dentro de cada status (pega os 'pending' antigos).
create index if not exists idx_writeback_status_created
  on public.bitrix_writeback_queue (status, created_at);
create index if not exists idx_writeback_record
  on public.bitrix_writeback_queue (record_id);

drop trigger if exists trg_writeback_updated_at on public.bitrix_writeback_queue;
create trigger trg_writeback_updated_at
  before update on public.bitrix_writeback_queue
  for each row execute function public.set_updated_at();

-- ===================== RLS =====================
alter table public.bitrix_writeback_queue enable row level security;

-- Admins leem (aba Log). Escrita só pelo service role (createServiceClient
-- bypassa RLS) — sem policy de insert/update.
drop policy if exists writeback_select on public.bitrix_writeback_queue;
create policy writeback_select on public.bitrix_writeback_queue for select to authenticated
  using (public.auth_has_role('admin'));

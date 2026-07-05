-- ============================================================================
-- Versão: 1.0 | Data: 05/07/2026
-- BLOCO ÚNICO — FASE 2 — colar no SQL Editor do Supabase APÓS a Fase 1.
-- Adiciona Responsáveis, Operações e Lead relacionado (migração 0012).
-- Idempotente.
-- ============================================================================

-- >>>>>>>>>>>>>>>>>>>> migrations/0012_responsaveis_operacoes.sql <<<<<<<<<<<<<<<<<<<<
-- Versão: 1.0 | Data: 05/07/2026
-- Responsáveis, Operações e Lead relacionado (substitui o antigo conceito de
-- "Origem"). Migração aditiva — aplique DEPOIS do bloco da Fase 1.
-- Idempotente.

-- ===================== Operações =====================
-- Criadas no próprio sistema (tela admin). Começam vazias (sem seed).
create table if not exists public.operations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===================== Responsáveis elegíveis =====================
-- Lista configurável (evita dropdown gigante). Populada a partir dos
-- Responsáveis do Bitrix durante o sync; admin cura (ativa/desativa).
create table if not exists public.responsibles (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  bitrix_user_id text unique,            -- ASSIGNED_BY_ID do Bitrix (matching)
  user_id uuid references auth.users (id) on delete set null, -- se também loga no app
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_responsibles_user on public.responsibles (user_id);

-- ===================== Operações por responsável (com prioridade) =====================
create table if not exists public.responsible_operations (
  responsible_id uuid not null references public.responsibles (id) on delete cascade,
  operation_id uuid not null references public.operations (id) on delete cascade,
  priority int not null default 1,       -- 1 = primária, 2 = secundária, ...
  created_at timestamptz not null default now(),
  primary key (responsible_id, operation_id),
  unique (responsible_id, priority)
);

-- ===================== Colunas novas em records =====================
alter table public.records
  add column if not exists responsible_id uuid references public.responsibles (id) on delete set null,
  add column if not exists operation_id uuid references public.operations (id) on delete set null,
  add column if not exists related_lead_id uuid references public.records (id) on delete set null,
  add column if not exists lead_time_days numeric;

create index if not exists idx_records_responsible on public.records (responsible_id);
create index if not exists idx_records_operation on public.records (operation_id);
create index if not exists idx_records_related_lead on public.records (related_lead_id);

-- ===================== Triggers updated_at =====================
drop trigger if exists trg_operations_updated_at on public.operations;
create trigger trg_operations_updated_at
  before update on public.operations
  for each row execute function public.set_updated_at();

drop trigger if exists trg_responsibles_updated_at on public.responsibles;
create trigger trg_responsibles_updated_at
  before update on public.responsibles
  for each row execute function public.set_updated_at();

-- ===================== RLS =====================
alter table public.operations             enable row level security;
alter table public.responsibles           enable row level security;
alter table public.responsible_operations enable row level security;

-- Leitura por qualquer autenticado (dropdowns); escrita só admin.
drop policy if exists operations_select on public.operations;
create policy operations_select on public.operations for select to authenticated using (true);
drop policy if exists operations_write on public.operations;
create policy operations_write on public.operations for all to authenticated
  using (public.auth_has_role('admin'))
  with check (public.auth_has_role('admin'));

drop policy if exists responsibles_select on public.responsibles;
create policy responsibles_select on public.responsibles for select to authenticated using (true);
drop policy if exists responsibles_write on public.responsibles;
create policy responsibles_write on public.responsibles for all to authenticated
  using (public.auth_has_role('admin'))
  with check (public.auth_has_role('admin'));

drop policy if exists responsible_operations_select on public.responsible_operations;
create policy responsible_operations_select on public.responsible_operations for select to authenticated using (true);
drop policy if exists responsible_operations_write on public.responsible_operations;
create policy responsible_operations_write on public.responsible_operations for all to authenticated
  using (public.auth_has_role('admin'))
  with check (public.auth_has_role('admin'));

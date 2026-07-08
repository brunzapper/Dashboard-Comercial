-- Versão: 1.0 | Data: 05/07/2026
-- Fase 6B: metas (goals), operações aninhadas (parent_operation_id),
-- widgets.settings (extras de KPI) e função de subárvore de operação.
-- Idempotente.

-- ===================== Operações aninhadas =====================
alter table public.operations
  add column if not exists parent_operation_id uuid
    references public.operations (id) on delete set null;

create index if not exists idx_operations_parent
  on public.operations (parent_operation_id);

-- Seed condicional: 2 operações top-level só se ainda não houver nenhuma.
insert into public.operations (name)
select v.name
from (values ('Operação 1'), ('Operação 2')) as v(name)
where not exists (select 1 from public.operations);

-- ===================== Subárvore de operação (roll-up) =====================
-- Retorna a operação e todas as descendentes.
create or replace function public.operation_subtree(p_root uuid)
returns table (operation_id uuid)
language sql
stable
as $$
  with recursive tree as (
    select id from public.operations where id = p_root
    union                          -- UNION (não ALL): termina mesmo se houver ciclo
    select o.id
    from public.operations o
    join tree t on o.parent_operation_id = t.id
  )
  select id from tree;
$$;

grant execute on function public.operation_subtree(uuid) to authenticated;

-- ===================== widgets.settings (extras de KPI) =====================
alter table public.widgets
  add column if not exists settings jsonb not null default '{}'::jsonb;

-- ===================== Metas (goals) =====================
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  period_year int not null,
  period_month int,                         -- null = meta anual
  scope text not null check (scope in ('global', 'operation', 'responsible')),
  operation_id uuid references public.operations (id) on delete cascade,
  responsible_id uuid references public.responsibles (id) on delete cascade,
  metric text not null,                     -- 'mrr' | 'clientes' | ...
  target numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Uma meta por período/escopo/alvo/métrica (nulls normalizados p/ o índice).
create unique index if not exists uq_goals_scope on public.goals (
  period_year,
  coalesce(period_month, 0),
  scope,
  coalesce(operation_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(responsible_id, '00000000-0000-0000-0000-000000000000'::uuid),
  metric
);

drop trigger if exists trg_goals_updated_at on public.goals;
create trigger trg_goals_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

-- ===================== RLS de goals =====================
alter table public.goals enable row level security;

drop policy if exists goals_select on public.goals;
create policy goals_select on public.goals for select to authenticated using (true);

drop policy if exists goals_write on public.goals;
create policy goals_write on public.goals for all to authenticated
  using (public.auth_has_role('admin'))
  with check (public.auth_has_role('admin'));

-- Versão: 1.0 | Data: 17/07/2026
-- FEED dos cards (comentários + subtarefas) e TAREFAS GLOBAIS.
--
-- 1) `comments`: comentário vinculado a UM registro OU UMA tarefa (check).
--    Visibilidade TRANSITIVA: quem vê o pai (via RLS de records/tasks) vê o
--    comentário — o EXISTS roda sob as policies do pai para o mesmo usuário.
--    Editar/fixar/excluir: autor ou admin/gestor. `pinned` + `position`
--    (fracionária, novo = -Date.now()) ordenam o feed. SEM acesso anon
--    (snapshots públicos ficam de fora por regra do projeto).
-- 2) `tasks`: parent_task_id (SUBTAREFAS — não viram card de quadro; vivem no
--    feed da tarefa pai), pinned/feed_position (fixar/ordenar no feed —
--    `position` continua sendo a ordenação no QUADRO), is_global (notifica
--    todos; só admin/gestor define — trigger) e assigned_at (carimbo de
--    reatribuição de responsável; alimenta a seção "Novas" do sino).
-- 3) Policy de SELECT de tasks ganha `or is_global`: tarefa global é visível
--    a todos os autenticados (sino, /tarefas, quadros "minhas tarefas").
-- Idempotente.

-- ===================== Comentários =====================

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  record_id uuid references public.records (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  body text not null,
  pinned boolean not null default false,
  -- Ordenação fracionária no feed (mesmo esquema de tasks.position).
  position double precision not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Exatamente um pai: registro OU tarefa.
  constraint comments_one_parent check (
    ((record_id is not null)::int + (task_id is not null)::int) = 1
  )
);

create index if not exists idx_comments_record on public.comments (record_id);
create index if not exists idx_comments_task on public.comments (task_id);

drop trigger if exists trg_comments_updated_at on public.comments;
create trigger trg_comments_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

alter table public.comments enable row level security;

-- Vê o comentário quem vê o pai (as RLS de records/tasks se aplicam no EXISTS).
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select to authenticated
  using (
    (record_id is not null and exists (
      select 1 from public.records r where r.id = comments.record_id
    ))
    or (task_id is not null and exists (
      select 1 from public.tasks t where t.id = comments.task_id
    ))
  );

-- Comenta em nome próprio, e só em pai visível.
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (record_id is not null and exists (
        select 1 from public.records r where r.id = comments.record_id
      ))
      or (task_id is not null and exists (
        select 1 from public.tasks t where t.id = comments.task_id
      ))
    )
  );

-- Edita/fixa/reordena: autor ou admin/gestor (fixar comentário alheio = gestão).
drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments for update to authenticated
  using (
    created_by = (select auth.uid())
    or public.auth_has_role('admin')
    or public.auth_has_role('gestor')
  )
  with check (
    created_by = (select auth.uid())
    or public.auth_has_role('admin')
    or public.auth_has_role('gestor')
  );

drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete to authenticated
  using (
    created_by = (select auth.uid())
    or public.auth_has_role('admin')
    or public.auth_has_role('gestor')
  );

-- ===================== Tarefas: subtarefas, feed, global =====================

alter table public.tasks
  add column if not exists parent_task_id uuid references public.tasks (id) on delete cascade,
  add column if not exists pinned boolean not null default false,
  add column if not exists feed_position double precision not null default 0,
  add column if not exists is_global boolean not null default false,
  add column if not exists assigned_at timestamptz;

create index if not exists idx_tasks_parent on public.tasks (parent_task_id);

-- Só admin/gestor definem/alteram `is_global` (INSERT e UPDATE — diferente da
-- trava `locked`, que qualquer um define na criação). Contexto sem usuário
-- (service role, SQL Editor) passa, como no enforce_task_lock.
create or replace function public.enforce_task_global()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old boolean := case when tg_op = 'INSERT' then false else old.is_global end;
begin
  if new.is_global is distinct from v_old then
    if (select auth.uid()) is not null
       and not (public.auth_has_role('admin') or public.auth_has_role('gestor')) then
      new.is_global := v_old;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_global on public.tasks;
create trigger trg_tasks_global
  before insert or update on public.tasks
  for each row execute function public.enforce_task_global();

-- Tarefa GLOBAL é visível a todos os autenticados (notifica a todos).
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    is_global
    or public.auth_has_permission('view_all_records')
    or created_by = (select auth.uid())
    or responsible_id in (select public.auth_responsible_ids())
  );

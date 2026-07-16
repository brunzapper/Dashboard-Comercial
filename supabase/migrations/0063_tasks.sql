-- Versão: 1.0 | Data: 16/07/2026
-- TAREFAS: entidade própria (não é um record) para gestão de projetos/funis.
-- Uma tarefa pode ser standalone, vinculada a um registro (record_id) e/ou a um
-- kanban de tarefas (board_id = dashboards.kind 'kanban'; `phase` é a key da
-- coluna do board). Vencimento em `due_date date` (+ `due_time` opcional,
-- exibicional): o app inteiro bucketiza datas por prefixo ISO YYYY-MM-DD e
-- "atrasada hoje?" usa o dia civil de America/Sao_Paulo — date evita drift de
-- fuso; alertas são DERIVADOS (sem tabela de notificações).
-- Visibilidade espelha `records` (0037): view_all_records OU responsável
-- vinculado ao usuário (auth_responsible_ids) OU criador — vendedor só vê as
-- próprias tarefas. `locked` controla exclusão: true = só admin/gestor exclui;
-- só admin/gestor alteram a flag (trigger enforce_task_lock; a policy de
-- UPDATE precisa liberar o resto da linha p/ os envolvidos).
-- `position` é ordenação fracionária dentro da coluna (inserção por ponto
-- médio, sem reindexar). Idempotente.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  -- Vínculos (ambos opcionais; tarefa standalone tem os dois nulos).
  record_id uuid references public.records (id) on delete cascade,
  board_id uuid references public.dashboards (id) on delete set null,
  -- Key da coluna no kanban de tarefas (fases de execução).
  phase text not null default 'a_fazer',
  -- Vencimento (dia civil; hora opcional só para exibição/ordenação).
  due_date date,
  due_time time,
  -- Conclusão (null = aberta).
  completed_at timestamptz,
  completed_by uuid references auth.users (id) on delete set null,
  -- Atribuição: mesma entidade dos registros (responsibles.user_id vincula ao
  -- usuário que enxerga a tarefa via RLS).
  responsible_id uuid references public.responsibles (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  position double precision not null default 0,
  -- true: só admin/gestor excluem a tarefa (flag alterável só por admin/gestor).
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tasks_record on public.tasks (record_id);
create index if not exists idx_tasks_board on public.tasks (board_id, phase);
create index if not exists idx_tasks_responsible on public.tasks (responsible_id);
-- Sino de alertas: tarefas abertas por vencimento.
create index if not exists idx_tasks_due_open on public.tasks (due_date)
  where completed_at is null;

drop trigger if exists trg_tasks_updated_at on public.tasks;
create trigger trg_tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- ===================== Trigger: só admin/gestor mudam `locked` =====================
-- A policy de UPDATE libera a linha inteira para os envolvidos (concluir,
-- editar título/prazo/fase); o trigger impede que um não-admin/gestor
-- destrave a tarefa via PostgREST direto. Contexto sem usuário (service role,
-- SQL Editor) passa — não há JWT para autorizar de outro jeito.
create or replace function public.enforce_task_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.locked is distinct from old.locked then
    if (select auth.uid()) is not null
       and not (public.auth_has_role('admin') or public.auth_has_role('gestor')) then
      new.locked := old.locked;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_lock on public.tasks;
create trigger trg_tasks_lock
  before update on public.tasks
  for each row execute function public.enforce_task_lock();

-- ===================== RLS =====================
alter table public.tasks enable row level security;

-- Vê a tarefa: gestor/admin (view_all_records), criador ou responsável vinculado.
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    public.auth_has_permission('view_all_records')
    or created_by = (select auth.uid())
    or responsible_id in (select public.auth_responsible_ids())
  );

-- Cria: sempre em nome próprio; sem view_all_records (vendedor), só sem
-- responsável ou atribuída a um responsável do próprio usuário.
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      public.auth_has_permission('view_all_records')
      or responsible_id is null
      or responsible_id in (select public.auth_responsible_ids())
    )
  );

-- Edita/conclui/move: os mesmos que veem (o trigger acima protege `locked`).
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (
    public.auth_has_permission('view_all_records')
    or created_by = (select auth.uid())
    or responsible_id in (select public.auth_responsible_ids())
  )
  with check (
    public.auth_has_permission('view_all_records')
    or created_by = (select auth.uid())
    or responsible_id in (select public.auth_responsible_ids())
  );

-- Exclui: admin/gestor sempre; envolvidos só se a tarefa não está travada.
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (
    public.auth_has_role('admin')
    or public.auth_has_role('gestor')
    or (
      not locked
      and (
        created_by = (select auth.uid())
        or responsible_id in (select public.auth_responsible_ids())
      )
    )
  );

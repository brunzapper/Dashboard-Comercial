-- 0136_task_bitrix_activity.sql
-- Versão: 1.0 | Data: 09/09/2026
-- ESPELHO DE TAREFA NO BITRIX: a tarefa aberta aqui vira uma ATIVIDADE na
-- timeline do negócio lá (crm.activity.add, TYPE_ID 6 / PROVIDER_ID CRM_TODO)
-- — o mesmo objeto que o time já usa no feed do deal.
--
-- POR QUE UMA FILA, E POR QUE UMA NOVA. Chamar o Bitrix na hora de salvar a
-- tarefa amarraria o salvamento à latência (e à disponibilidade) do portal:
-- uma falha lá viraria uma tarefa que não foi criada aqui. A fila já é o padrão
-- do projeto para isso (bitrix_writeback_queue, 0032), com tentativas, erro
-- visível e um dreno com orçamento de tempo no tick que já roda.
--
-- Mas a fila existente NÃO serve, por três razões estruturais:
--   1. `entity` tem CHECK ('deal','lead') e `record_id` é NOT NULL com FK para
--      `records` — uma tarefa não é um registro;
--   2. o dreno é fixo em crm.deal/lead.update;
--   3. ela modela ATUALIZAÇÃO DE CAMPO (uma linha por campo) e nunca devolve o
--      id de algo criado — que é justamente o que precisamos guardar.
--
-- `tasks.bitrix_activity_id` é o que torna tudo idempotente e reversível: sem
-- id externo não dá para saber "já mandei" (o dreno duplicaria a atividade a
-- cada tentativa), nem fechar lá a tarefa concluída aqui, nem mover o prazo.
--
-- `data_sources.bitrix_activity_owner` é o nível mais geral dos TRÊS de
-- configuração (Base → automação/série → tarefa manual): diz se a Base espelha
-- e em que entidade do CRM a atividade fica pendurada. NULL = desligado, que é
-- o estado de toda Base existente — nada passa a ir para o Bitrix por causa
-- desta migração.
--
-- Escrita da fila SÓ por service role (sem policy de insert/update, como a
-- 0032); admins leem. Idempotente.

-- ============ 1. O vínculo da tarefa com a atividade ============
alter table public.tasks
  add column if not exists bitrix_activity_id text;

comment on column public.tasks.bitrix_activity_id is
  'ID da atividade correspondente no Bitrix (crm.activity). NULL = nunca espelhada. É o que impede o dreno de criar a mesma atividade duas vezes.';

-- Uma tarefa por atividade e vice-versa. Parcial porque a esmagadora maioria
-- das tarefas nunca é espelhada, e NULL num índice único é distinto de si
-- mesmo (não serviria de trava).
create unique index if not exists uq_tasks_bitrix_activity
  on public.tasks (bitrix_activity_id)
  where bitrix_activity_id is not null;

-- ============ 2. A configuração por Base ============
alter table public.data_sources
  add column if not exists bitrix_activity_owner text
    constraint data_sources_activity_owner_check
      check (bitrix_activity_owner in ('deal', 'lead'));

comment on column public.data_sources.bitrix_activity_owner is
  'Espelha as tarefas desta Base como atividade do CRM, pendurada nesta entidade. NULL = não espelha (padrão). Editável em Configurações → Bases.';

-- ============ 3. A fila ============
create table if not exists public.bitrix_task_queue (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  task_id         uuid not null references public.tasks (id) on delete cascade,
  -- 'create' precisa do id de volta; 'update' e 'complete' já o têm.
  op              text not null check (op in ('create', 'update', 'complete')),
  -- Entidade e id do CRM onde a atividade fica pendurada, RESOLVIDOS no
  -- enfileiramento: o dreno não deve depender de o registro ainda existir, nem
  -- refazer a resolução de Base com outra configuração vigente.
  owner_entity    text not null check (owner_entity in ('deal', 'lead')),
  owner_source_id text not null,
  -- Atividade a alterar. NULL em 'create' — é o dreno que a preenche.
  activity_id     text,
  status          text not null default 'pending'
                    check (status in ('pending', 'done', 'error')),
  attempts        int not null default 0,
  last_error      text,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  processed_at    timestamptz
);

-- Drenar por ordem de chegada dentro do status (o molde da 0032).
create index if not exists idx_task_queue_status_created
  on public.bitrix_task_queue (status, created_at);
create index if not exists idx_task_queue_task
  on public.bitrix_task_queue (task_id);

-- Uma operação pendente por (tarefa, op): o tick e o salvamento podem
-- enfileirar a mesma coisa, e 23505 é NO-OP no enfileirador (precedente das
-- 0129/0130/0132). Sem isso, salvar a tarefa três vezes mandaria três
-- atualizações idênticas ao Bitrix.
create unique index if not exists uq_task_queue_pending
  on public.bitrix_task_queue (task_id, op)
  where status = 'pending';

drop trigger if exists trg_task_queue_updated_at on public.bitrix_task_queue;
create trigger trg_task_queue_updated_at
  before update on public.bitrix_task_queue
  for each row execute function public.set_updated_at();

-- ============ RLS ============
alter table public.bitrix_task_queue enable row level security;

-- Admins da própria org leem (aba Log). Escrita só pelo service role — sem
-- policy de insert/update, como na 0032.
drop policy if exists task_queue_select on public.bitrix_task_queue;
create policy task_queue_select on public.bitrix_task_queue for select to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and public.auth_has_role('admin')
  );

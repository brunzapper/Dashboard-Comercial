-- 0137_bitrix_two_way.sql
-- Versão: 1.0 | Data: 10/09/2026
-- O ESPELHO DO BITRIX NOS DOIS SENTIDOS, e o substantivo da ocorrência.
--
-- A 0136 entregou metade: a tarefa daqui vira atividade lá. Faltava tudo o que
-- acontece DO OUTRO LADO — concluir, apagar, criar, comentar. Esta migração
-- abre espaço para as quatro, e fecha três buracos do sentido que já existia.
--
-- POR QUE O SENTIDO DE VOLTA MUDA A FILA. `bitrix_task_queue` nasceu para três
-- operações que sempre tinham uma tarefa viva do lado de cá (create/update/
-- complete). Duas coisas quebram isso:
--
--   1. EXCLUIR. A ordem "apague a atividade lá" precisa sobreviver à tarefa
--      daqui — que já não existe quando o dreno roda. Com `task_id` NOT NULL e
--      FK `on delete cascade`, enfileirar e apagar em seguida sumia com a
--      própria ordem, e a atividade ficava órfã no feed do negócio para
--      sempre. Daí `task_id` anulável + `on delete set null`: quem identifica
--      um delete é o `activity_id`, não a tarefa.
--   2. COMENTAR. A anotação daqui vira comentário na timeline. É a mesma fila
--      (mesmo portal, mesmo orçamento, mesmo tratamento de falha), então ela
--      ganha um ALVO em vez de uma tabela irmã. `target` tem default 'task'
--      justamente para que as linhas já gravadas não mudem de significado.
--
-- E o `uq_task_queue_pending` da 0136 é `(task_id, op)`: em Postgres, NULL num
-- índice único é distinto de si mesmo, então ele NÃO dedupe as ordens de
-- exclusão. Daí o índice parcial próprio por `activity_id`.
--
-- `comments.bitrix_comment_id` é o que impede o pingue-pongue: comentário que
-- nós mesmos criamos volta na leitura da timeline e não pode virar uma segunda
-- anotação. `comments` NÃO ganha `organization_id` — a tabela é transitiva ao
-- registro desde a 0066 e a RLS depende disso; a leitura escopa pela org dos
-- registros.
--
-- `tasks.occurrence_noun` é vocabulário: como ESTA tarefa da série se chama na
-- árvore. Ver lib/series/types.ts — o padrão é "Tarefa", a série escolhe outro
-- e a tarefa individual sobrepõe.
--
-- Idempotente. Nenhuma linha existente muda de comportamento: toda Base segue
-- com o espelho desligado e nenhuma coluna nova é obrigatória.

-- ============ 1. O substantivo por tarefa ============
alter table public.tasks
  add column if not exists occurrence_noun text;

comment on column public.tasks.occurrence_noun is
  'Como esta ocorrência da série se chama na Tree ("Tarefa", "Follow-up", "Visita"). NULL = usa o da série, e na falta dele o padrão do sistema. É rótulo de exibição: não entra em chave, identidade nem consulta.';

-- A 0132 descrevia a coluna com um vocabulário que esta organização não usa.
comment on column public.tasks.series_occurrence is
  'N-ésima ocorrência de uma série periódica, DERIVADA de floor((hoje - âncora)/cadência) — nunca um contador. Junto de (automation_rule_id, record_id) forma a trava uq_tasks_series_occurrence; o tick roda a cada minuto e recriar a mesma ocorrência é no-op.';

-- ============ 2. O id externo do comentário ============
alter table public.comments
  add column if not exists bitrix_comment_id text;

comment on column public.comments.bitrix_comment_id is
  'ID do comentário correspondente na timeline do Bitrix (crm.timeline.comment). NULL = nunca espelhado. É o que impede a leitura de volta de transformar o nosso próprio comentário numa segunda anotação.';

create unique index if not exists uq_comments_bitrix_comment
  on public.comments (bitrix_comment_id)
  where bitrix_comment_id is not null;

-- ============ 3. A fila ganha alvo, exclusão e tarefa opcional ============
alter table public.bitrix_task_queue
  add column if not exists target text not null default 'task'
    constraint bitrix_task_queue_target_check
      check (target in ('task', 'comment'));

comment on column public.bitrix_task_queue.target is
  'O que esta linha espelha: a tarefa (atividade do CRM) ou a anotação (comentário da timeline). Default ''task'' — as linhas gravadas pela 0136 seguem significando exatamente o que significavam.';

-- Comentário espelhado: a fila aponta para `comments`, não para `tasks`.
alter table public.bitrix_task_queue
  add column if not exists comment_id uuid
    references public.comments (id) on delete set null;

-- `op` passa a aceitar as duas operações novas. O CHECK é recriado inteiro
-- (precedente da 0134 com visual_type): nenhum valor antigo sai da lista.
alter table public.bitrix_task_queue
  drop constraint if exists bitrix_task_queue_op_check;
alter table public.bitrix_task_queue
  add constraint bitrix_task_queue_op_check
    check (op in ('create', 'update', 'complete', 'delete', 'comment_add'));

-- A ordem de exclusão precisa sobreviver ao sumiço da tarefa. Sem isto, o
-- cascade apagava a própria ordem e a atividade ficava órfã lá.
alter table public.bitrix_task_queue
  alter column task_id drop not null;
alter table public.bitrix_task_queue
  drop constraint if exists bitrix_task_queue_task_id_fkey;
alter table public.bitrix_task_queue
  add constraint bitrix_task_queue_task_id_fkey
    foreign key (task_id) references public.tasks (id) on delete set null;

-- Dedupe das ordens SEM tarefa: NULL não casa com NULL num índice único, então
-- o uq_task_queue_pending da 0136 não as cobre.
create unique index if not exists uq_task_queue_pending_activity
  on public.bitrix_task_queue (activity_id, op)
  where status = 'pending' and activity_id is not null and task_id is null;

create unique index if not exists uq_task_queue_pending_comment
  on public.bitrix_task_queue (comment_id, op)
  where status = 'pending' and comment_id is not null;

create index if not exists idx_task_queue_comment
  on public.bitrix_task_queue (comment_id);

-- ============ 4. A leitura de volta: quem buscar fora do período ============
-- A conclusão de uma atividade NÃO mexe no DATE_MODIFY do negócio, então o
-- reconcile por período nunca traria aquele registro de volta. Quem precisa
-- ser conferido é o DONO das atividades pendentes — e este índice é o que
-- torna "quais registros têm tarefa aberta espelhada" uma consulta barata.
create index if not exists idx_tasks_open_mirrored
  on public.tasks (record_id)
  where bitrix_activity_id is not null and completed_at is null;

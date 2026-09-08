-- 0129_task_automation_link.sql
-- Versão: 1.0 | Data: 08/09/2026
-- Vínculo tarefa ← regra de automação, para a ação `create_task`.
--
-- Por que a coluna existe: o tick roda A CADA MINUTO. Uma ação que abre tarefa
-- precisa saber se JÁ abriu uma para aquele registro por aquela regra — senão
-- "lead parado há 7 dias → abrir tarefa" cria 1.440 tarefas por dia, por lead.
--
-- `set_field` não precisou disso porque é idempotente por comparação (valor
-- igual ao alvo consome o card sem escrever). Criar tarefa não tem estado
-- anterior para comparar: o que existe é a tarefa em si.
--
-- O índice único parcial é a trava, no BANCO — não no código. Uma corrida
-- entre dois ticks (o agendado e um "Executar agora") esbarra nele em vez de
-- duplicar. `where completed_at is null` é deliberado: concluída a tarefa, a
-- regra pode abrir outra se a condição voltar a valer — é uma cobrança
-- recorrente, não um marcador de "já cobrei uma vez na vida".
--
-- Idempotente. Não recria RPC nenhuma.

alter table public.tasks
  add column if not exists automation_rule_id uuid
    references public.automation_rules (id) on delete set null;

-- A trava: no máximo UMA tarefa ABERTA por (regra, registro).
create unique index if not exists uq_tasks_open_per_automation
  on public.tasks (automation_rule_id, record_id)
  where automation_rule_id is not null
    and record_id is not null
    and completed_at is null;

comment on column public.tasks.automation_rule_id is
  'Regra de automação que abriu esta tarefa (ação create_task). NULL = tarefa criada por pessoa. O índice único parcial uq_tasks_open_per_automation impede uma segunda tarefa ABERTA da mesma regra para o mesmo registro — o tick roda a cada minuto.';

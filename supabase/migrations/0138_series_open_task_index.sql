-- 0138_series_open_task_index.sql
-- Versão: 1.0 | Data: 10/09/2026
-- A trava da 0129 estava impondo às tarefas de SÉRIE uma regra que não é
-- delas — e o resultado eram dezenas de 23505 por minuto, em silêncio.
--
-- AS DUAS TRAVAS, e por que NÃO devem ser uniformizadas:
--
--   uq_tasks_open_per_automation (0129) = "uma tarefa ABERTA por vez".
--     É de `create_task`: a regra "lead parado há 7 dias → abrir tarefa" não
--     tem estado anterior para comparar, e o tick roda a cada minuto. Concluída
--     a tarefa, a regra pode abrir outra — por isso `completed_at is null`.
--
--   uq_tasks_series_occurrence (0132) = "a 3ª quinzena aconteceu uma vez na
--     vida". É de `create_task_series`, e é por OCORRÊNCIA justamente para que
--     várias fiquem abertas lado a lado: é ver as próximas na tela que permite
--     ao vendedor enxergar e remarcar o que ainda vai vencer.
--
-- O predicado da 0129 não excluía as linhas de série, então ela vencia sobre a
-- 0132 e reduzia toda série a UMA tarefa aberta por registro. Com o lookahead
-- (a devida + as futuras), cada rodada tentava inserir as demais e todas
-- batiam no índice: 23505 tratado como no-op pelo executor, invisível na
-- aplicação e visível só no log do PostgREST, a cada minuto, para sempre.
--
-- A correção é acrescentar `series_occurrence is null` ao predicado: cada
-- índice volta a guardar exatamente o que foi feito para guardar. Nenhuma
-- linha muda; nenhuma RPC é recriada.

drop index if exists public.uq_tasks_open_per_automation;

create unique index if not exists uq_tasks_open_per_automation
  on public.tasks (automation_rule_id, record_id)
  where automation_rule_id is not null
    and record_id is not null
    and completed_at is null
    and series_occurrence is null;

comment on column public.tasks.automation_rule_id is
  'Regra de automação que abriu esta tarefa. NULL = tarefa criada por pessoa. Tarefa de create_task: uq_tasks_open_per_automation impede uma segunda ABERTA da mesma regra para o mesmo registro (o tick roda a cada minuto). Tarefa de série (series_occurrence preenchido): fica FORA daquele índice e é travada por uq_tasks_series_occurrence, que é por ocorrência — várias abertas lado a lado é o comportamento desejado.';

-- 0130_workflow_run_triggers.sql
-- Versão: 1.0 | Data: 09/09/2026
-- A ação `run_schema` das automações (executar os passos de um esquema tendo um
-- REGISTRO como entrada) precisa de uma trava, e a trava mora aqui.
--
-- Por que: o tick roda A CADA MINUTO. Um esquema é uma sequência de alterações
-- dentro e fora do sistema — pode criar uma entidade num CRM, pode só atualizar
-- campos. Sem trava, "registro parado há 7 dias → executa o esquema" dispara
-- 1.440 vezes por dia, por registro.
--
-- A trava NÃO é uma só, porque as duas naturezas de passo não pedem a mesma:
--   * esquema IRREVERSÍVEL (tem passo de criação): o registro é consumido UMA
--     vez por regra, para sempre. `payload_hash` fica '' e as linhas colapsam
--     numa só.
--   * esquema REPETÍVEL (só passos de alteração): re-executa quando o payload
--     resolvido MUDA — a mesma idempotência por comparação do `set_field`, que
--     escreve quando o valor atual difere do alvo. `payload_hash` guarda o
--     hash do que foi enviado.
-- Quem decide é o CÓDIGO, derivando dos passos do esquema (schemaIsIrreversible
-- em lib/workflow/run.ts) — não há interruptor para desalinhar do que o esquema
-- de fato faz.
--
-- O sentinela '' em vez de NULL é deliberado: NULL num índice único é distinto
-- de si mesmo (nulls distinct), então a trava do esquema irreversível não
-- travaria nada.
--
-- `released_at` é a retentativa MANUAL: falha não repete sozinha (uma entidade
-- duplicada no destino é sujeira que alguém limpa à mão; uma que faltou aparece
-- no erro da regra e na tarefa de notificação). Um admin carimba released_at e
-- o registro volta à fila — sem apagar a linha histórica.
--
-- Idempotente. Não recria RPC nenhuma.

alter table public.workflow_runs
  add column if not exists trigger_record_id uuid
    references public.records (id) on delete set null,
  add column if not exists automation_rule_id uuid
    references public.automation_rules (id) on delete set null,
  add column if not exists mode text not null default 'real',
  add column if not exists payload_hash text not null default '',
  add column if not exists released_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workflow_runs_mode_check'
  ) then
    alter table public.workflow_runs
      add constraint workflow_runs_mode_check
      check (mode in ('real', 'simulado'));
  end if;
end $$;

-- 'iniciado' = execução REIVINDICADA cujo desfecho não foi gravado (o processo
-- morreu no meio). Ela SEGURA a trava de propósito: não se sabe o que chegou ao
-- destino, e repetir às cegas é justamente o que a trava existe para impedir.
alter table public.workflow_runs
  drop constraint if exists workflow_runs_status_check;
alter table public.workflow_runs
  add constraint workflow_runs_status_check
  check (status in ('iniciado', 'ok', 'partial', 'error'));

-- A TRAVA. `mode` entra na chave para que simular não gaste a execução real
-- (e para que o tick não escreva uma linha de simulação por minuto).
create unique index if not exists uq_workflow_runs_per_automation
  on public.workflow_runs (automation_rule_id, trigger_record_id, mode, payload_hash)
  where automation_rule_id is not null
    and trigger_record_id is not null
    and released_at is null;

create index if not exists idx_workflow_runs_rule
  on public.workflow_runs (automation_rule_id);

comment on column public.workflow_runs.automation_rule_id is
  'Regra que disparou esta execução (ação run_schema). NULL = execução por formulário. Junto de trigger_record_id/mode/payload_hash forma a trava uq_workflow_runs_per_automation — o tick roda a cada minuto.';
comment on column public.workflow_runs.payload_hash is
  'Hash do payload resolvido em esquema REPETÍVEL (só passos de alteração): reexecuta apenas quando o que seria enviado muda. Vazio ('''') em esquema IRREVERSÍVEL — uma execução por registro, para sempre.';
comment on column public.workflow_runs.released_at is
  'Carimbado pela retentativa MANUAL de um admin: solta a trava daquele registro sem apagar o histórico. Falha nunca repete sozinha.';

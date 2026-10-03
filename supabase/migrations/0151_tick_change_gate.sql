-- Versão: 1.0 | Data: 03/10/2026
-- 0151 — Redução do LOG INGESTION do Supabase sem mudar comportamento.
--
-- MEDIÇÃO que motivou (24h, out/2026): ~164 mil linhas de edge_logs/dia, 64%
-- de service_role CONSTANTE (~4.500/h, inclusive de madrugada) vindas dos dois
-- crons de minuto (`bitrix-tick` e `kanban-automations-tick`). Só 20 dos 1.440
-- minutos do dia tiveram qualquer mudança de dado — e o tick de automações
-- recarregava catálogo + universo inteiro + fatos (~60 requisições) a cada
-- minuto para chegar à MESMA conclusão. Todas as condições de automação,
-- série e ritual têm granularidade de DIA (Brasília), então o resultado de uma
-- rodada só muda se (a) algum dado mudar ou (b) o dia virar.
--
-- (a) PORTÃO DE MUDANÇA: `data_change_seq` (sequence — não-transacional, SEM
--     lock: zero contenção entre writers) avançada por trigger STATEMENT-level
--     em toda tabela que o tick lê (insert/update/delete — exclusão conta, e
--     ela não deixa carimbo de updated_at). `automation_rules` tem trigger
--     ROW-level restrito às colunas de configuração: o bookkeeping
--     (last_run_at/last_error/last_moved_count) NÃO avança a seq, senão a
--     própria rodada se acordaria todo minuto. Tabela NOVA lida pelo tick DEVE
--     ganhar o trigger (fiscalizado por lib/ticks/gate.test.ts contra
--     TICK_GATE_TABLES).
-- (b) `tick_gates` + `tick_gate_begin`/`tick_gate_commit`: UMA requisição por
--     tick ocioso. Roda quando a seq mudou, o dia virou, há confirmação
--     pendente (a rodada anterior viu mudança — cobre transação que avançou a
--     seq antes de commitar), ou a última rodada completa tem mais de
--     p_max_age_minutes (rede de segurança). Service-role-only (sem policies,
--     sem grant a anon/authenticated).
-- (c) `sync_tick_state`: o que o tick de sync fazia em ~5 requisições
--     ociosas (takeover de job preso, job em andamento, último reconcile
--     automático, filas pendentes) numa só.
-- (d) `activity_inbound_owners`: a montagem dos donos da leitura de volta do
--     Bitrix (data_sources + tasks + record_attributes + records) numa só.
-- (e) `session_context`: papéis + permissões + memberships + org de cada
--     membership numa só, SECURITY INVOKER (as RLS valem como nas 4 consultas
--     que ela substitui).
-- RPCs de widget INTOCADAS. Idempotente.

-- ===================== (a) sequence + triggers =====================
create sequence if not exists public.data_change_seq;
revoke all on sequence public.data_change_seq from public, anon, authenticated;

create or replace function public.bump_data_change_seq()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform nextval('public.data_change_seq');
  return null;
end;
$$;
revoke all on function public.bump_data_change_seq() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    -- dados
    'records', 'tasks', 'kanban_placements', 'record_attributes',
    'record_matches', 'audit_log', 'series_settings', 'tree_nodes',
    'non_working_days', 'workflow_runs',
    -- configuração
    'widgets', 'dashboards', 'field_definitions', 'field_correspondences',
    'field_correspondence_members', 'data_sources', 'sub_sources',
    'responsibles', 'responsible_operations', 'operations', 'sync_config',
    'workflow_schemas'
  ]
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('drop trigger if exists trg_bump_data_change_seq on public.%I', t);
    execute format(
      'create trigger trg_bump_data_change_seq after insert or update or delete on public.%I '
      'for each statement execute function public.bump_data_change_seq()',
      t
    );
  end loop;
end;
$$;

-- automation_rules: só mudança de CONFIGURAÇÃO acorda o tick.
drop trigger if exists trg_bump_data_change_seq on public.automation_rules;
create trigger trg_bump_data_change_seq
  after insert or delete
     or update of rule, enabled, name, position, widget_id, board_id, source_key
  on public.automation_rules
  for each row execute function public.bump_data_change_seq();

-- ===================== (b) tick_gates =====================
create table if not exists public.tick_gates (
  key             text primary key,
  seen_seq        bigint,
  seen_day        text,
  pending_confirm boolean not null default false,
  last_full_at    timestamptz,
  checked_at      timestamptz
);
alter table public.tick_gates enable row level security;
revoke all on public.tick_gates from anon, authenticated;

create or replace function public.tick_gate_begin(
  p_key text,
  p_today text,
  p_max_age_minutes int default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq bigint;
  v_row public.tick_gates%rowtype;
  v_run boolean;
begin
  -- `is_called` entra na conta: o 1º nextval devolve o próprio last_value
  -- (1) e só liga is_called — sem isso a primeira mudança passaria batida.
  select case when is_called then last_value else 0 end
    into v_seq
    from public.data_change_seq;

  insert into public.tick_gates as g (key, checked_at)
  values (p_key, now())
  on conflict (key) do update set checked_at = excluded.checked_at
  returning g.* into v_row;

  v_run :=
       v_row.seen_seq is distinct from v_seq
    or v_row.seen_day is distinct from p_today
    or v_row.pending_confirm
    or v_row.last_full_at is null
    or v_row.last_full_at < now() - make_interval(mins => greatest(p_max_age_minutes, 1));

  return jsonb_build_object('run', v_run, 'seq', v_seq, 'checked_at', v_row.checked_at);
end;
$$;

create or replace function public.tick_gate_commit(
  p_key text,
  p_seq bigint,
  p_today text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Rodada disparada por MUDANÇA pede UMA confirmação no minuto seguinte:
  -- a seq avança no fim do statement, ANTES do commit do writer — uma
  -- transação mais longa pode ter ficado invisível para esta rodada.
  update public.tick_gates
     set pending_confirm = seen_seq is distinct from p_seq,
         seen_seq = p_seq,
         seen_day = p_today,
         last_full_at = now()
   where key = p_key;
end;
$$;

revoke all on function public.tick_gate_begin(text, text, int) from public, anon, authenticated;
revoke all on function public.tick_gate_commit(text, bigint, text) from public, anon, authenticated;
grant execute on function public.tick_gate_begin(text, text, int) to service_role;
grant execute on function public.tick_gate_commit(text, bigint, text) to service_role;

-- ===================== (c) sync_tick_state =====================
create or replace function public.sync_tick_state(
  p_stale_before timestamptz,
  p_stale_error text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staled int;
  v_running jsonb;
  v_last_auto timestamptz;
begin
  -- Mesmo UPDATE do takeoverStale (runner.ts) — statements SEPARADOS de
  -- propósito: num CTE o select abaixo ainda veria o job preso como running.
  with st as (
    update public.sync_jobs
       set status = 'error',
           error = p_stale_error,
           finished_at = now()
     where status = 'running'
       and updated_at < p_stale_before
    returning id
  )
  select count(*) into v_staled from st;

  select to_jsonb(j) into v_running
    from public.sync_jobs j
   where j.status = 'running'
   order by j.created_at desc
   limit 1;

  select j.created_at into v_last_auto
    from public.sync_jobs j
   where j.trigger = 'auto' and j.kind = 'reconcile'
   order by j.created_at desc
   limit 1;

  return jsonb_build_object(
    'staled', v_staled,
    'running', v_running,
    'last_auto_reconcile_at', v_last_auto,
    'writeback_pending',
      exists (select 1 from public.bitrix_writeback_queue where status = 'pending'),
    'task_mirror_pending',
      exists (select 1 from public.bitrix_task_queue where status = 'pending')
  );
end;
$$;
revoke all on function public.sync_tick_state(timestamptz, text) from public, anon, authenticated;
grant execute on function public.sync_tick_state(timestamptz, text) to service_role;

-- ===================== (d) activity_inbound_owners =====================
create or replace function public.activity_inbound_owners(p_max int default 400)
returns table (
  record_id uuid,
  organization_id uuid,
  record_type text,
  source_id text,
  entity text,
  tree boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with cand as (
    select t.record_id, false as tree
      from public.tasks t
     where t.bitrix_activity_id is not null
       and t.completed_at is null
       and t.record_id is not null
    union all
    select a.record_id, true as tree
      from public.record_attributes a
     where a.attribute_key = 'tree'
       and a.status = 'ativo'
  ),
  ids as (
    select c.record_id, bool_or(c.tree) as tree
      from cand c
     group by c.record_id
  )
  select r.id, r.organization_id, r.record_type, r.source_id,
         s.bitrix_activity_owner, i.tree
    from ids i
    join public.records r on r.id = i.record_id
    join public.data_sources s on s.record_type = r.record_type
   where r.source_id is not null
     and s.bitrix_activity_owner is not null
   order by r.id
   limit greatest(p_max, 0);
$$;
revoke all on function public.activity_inbound_owners(int) from public, anon, authenticated;
grant execute on function public.activity_inbound_owners(int) to service_role;

-- ===================== (e) session_context =====================
create or replace function public.session_context()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with my_roles as (
    select ur.role_key from public.user_roles ur where ur.user_id = auth.uid()
  )
  select jsonb_build_object(
    'roles',
      coalesce((select jsonb_agg(r.role_key) from my_roles r), '[]'::jsonb),
    'permissions',
      coalesce((
        select jsonb_agg(distinct rp.permission_key)
          from public.role_permissions rp
         where rp.role_key in (select r.role_key from my_roles r)
      ), '[]'::jsonb),
    'memberships',
      coalesce((
        select jsonb_agg(jsonb_build_object(
                 'organization_id', m.organization_id,
                 'is_org_admin', m.is_org_admin,
                 'org', (
                   select jsonb_build_object(
                            'id', o.id, 'name', o.name, 'app_name', o.app_name,
                            'theme', o.theme, 'ui_prefs', o.ui_prefs)
                     from public.organizations o
                    where o.id = m.organization_id
                 )
               ))
          from public.organization_members m
         where m.user_id = auth.uid()
      ), '[]'::jsonb)
  );
$$;
revoke all on function public.session_context() from public, anon;
grant execute on function public.session_context() to authenticated;

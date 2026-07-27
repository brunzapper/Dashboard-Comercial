-- Versão: 1.0 | Data: 27/07/2026
-- Automações do Kanban (modo REGISTROS): regras condicionais que movem cards
-- de coluna automaticamente ("se o parceiro tiver >= N leads conectados e
-- estiver parado há X dias, mover para Y"). Uma linha por regra, dona = um
-- WIDGET kanban (widget_id) OU um kanban DEDICADO (board_id) — check de
-- exatamente um (padrão 0067). A regra em si é jsonb versionado
-- ({ v:1, conditions:[...], action:{...} } — lib/kanban/automations/types.ts);
-- a avaliação/execução é 100% no ENGINE (tick por pg_cron + hook pós-sync +
-- "Executar agora"), com service role e escopo EXPLÍCITO de org — os RPCs de
-- widget seguem INTOCADOS. Bookkeeping por regra (last_run_at/last_error/
-- last_moved_count) em vez de tabela de runs: o tick roda a cada minuto e uma
-- tabela de histórico cresceria sem retenção. RLS: LER e ESCREVER regra exige
-- editor do board (auth_board_editable, 0088/0091) + gate de org. Sem acesso
-- anon (regra do projeto). Idempotente.

create table if not exists public.kanban_automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
                    references public.organizations (id) on delete cascade,
  widget_id uuid references public.widgets (id) on delete cascade,
  board_id uuid references public.dashboards (id) on delete cascade,
  name text not null default '',
  enabled boolean not null default true,
  -- Ordem de avaliação (primeira regra que casar vence por card).
  position int not null default 0,
  rule jsonb not null,
  last_run_at timestamptz,
  last_error text,
  last_moved_count int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kanban_automations_one_owner check (
    ((widget_id is not null)::int + (board_id is not null)::int) = 1
  )
);

create index if not exists idx_kanban_automations_widget
  on public.kanban_automations (widget_id);
create index if not exists idx_kanban_automations_board
  on public.kanban_automations (board_id);
-- Enumeração do tick: habilitadas, mais "antigas" primeiro (round-robin justo).
create index if not exists idx_kanban_automations_tick
  on public.kanban_automations (enabled, last_run_at);

drop trigger if exists trg_kanban_automations_updated_at on public.kanban_automations;
create trigger trg_kanban_automations_updated_at
  before update on public.kanban_automations
  for each row execute function public.set_updated_at();

-- Stamp de org (padrão 0098): a org é SEMPRE a do dashboard dono (direto ou
-- via widget) — o valor derivado vence o que a action mandar.
create or replace function public.kanban_automations_set_org()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.organization_id := coalesce(
    (select d.organization_id
       from public.dashboards d
      where d.id = coalesce(
        new.board_id,
        (select w.dashboard_id from public.widgets w where w.id = new.widget_id)
      )),
    new.organization_id
  );
  return new;
end;
$$;

drop trigger if exists trg_kanban_automations_set_org on public.kanban_automations;
create trigger trg_kanban_automations_set_org
  before insert on public.kanban_automations
  for each row execute function public.kanban_automations_set_org();

alter table public.kanban_automations enable row level security;

drop policy if exists kanban_automations_all on public.kanban_automations;
create policy kanban_automations_all on public.kanban_automations
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (
      (
        widget_id is not null
        and (select public.auth_board_editable(
          (select w.dashboard_id from public.widgets w
            where w.id = kanban_automations.widget_id)))
      )
      or (
        board_id is not null
        and (select public.auth_board_editable(kanban_automations.board_id))
      )
    )
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (
      (
        widget_id is not null
        and (select public.auth_board_editable(
          (select w.dashboard_id from public.widgets w
            where w.id = kanban_automations.widget_id)))
      )
      or (
        board_id is not null
        and (select public.auth_board_editable(kanban_automations.board_id))
      )
    )
  );

revoke all on public.kanban_automations from anon;

-- ============ audit_log.origin: aceita 'automation' ============
-- Movimentos executados por automação auditam com origin='automation' (via
-- service role); a policy de INSERT p/ autenticados (0009) segue exigindo
-- origin='app'. Mesmo mecanismo da 0060/0074: dropa o CHECK vigente por busca
-- no catálogo e recria com o novo valor.
do $$
declare
  v_con text;
begin
  for v_con in
    select conname
    from pg_constraint
    where conrelid = 'public.audit_log'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%origin%'
  loop
    execute format('alter table public.audit_log drop constraint %I', v_con);
  end loop;
end $$;

alter table public.audit_log
  add constraint audit_log_origin_check
  check (origin in ('app', 'sync_bitrix', 'sync_sheet', 'import_csv', 'api', 'automation'));

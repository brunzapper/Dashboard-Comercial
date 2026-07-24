-- Versão: 1.0 | Data: 24/07/2026
-- Sessões PERSISTIDAS da edição com IA dentro do dashboard: uma linha por
-- (usuário, dashboard) com os turnos do usuário (o servidor é a fonte de
-- verdade — o cliente envia só a mensagem nova), o log de exibição do chat, a
-- prévia pendente (auto-aplicar OFF) e o snapshot pré-turno da última edição
-- aplicada ("Desfazer edição da IA", agora DB-backed — sobrevive a F5). Caps de
-- tamanho (turns/chat) são aplicados no app. RLS: linha própria + gate de org
-- (0089); a manageability do board fica nas ACTIONS (mesmo gate dono/admin da
-- geração por IA) — as escritas reais no board já são muradas pela RLS de
-- dashboards/widgets. Idempotente.

create table if not exists public.dashboard_ai_sessions (
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
                    references public.organizations (id) on delete cascade,
  dashboard_id    uuid not null references public.dashboards (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  turns           jsonb not null default '[]'::jsonb, -- string[]: textos do usuário
  chat            jsonb not null default '[]'::jsonb, -- AiChatEntry[]: log de exibição
  pending         jsonb,           -- { json, summary[] } | null: prévia aguardando Aplicar
  undo_snapshot   jsonb,           -- DashboardSnapshot | null: pré-turno do último apply
  undo_saved_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (user_id, dashboard_id)
);

create index if not exists idx_dash_ai_sessions_dashboard
  on public.dashboard_ai_sessions (dashboard_id);
create index if not exists idx_dash_ai_sessions_org
  on public.dashboard_ai_sessions (organization_id);

drop trigger if exists trg_dashboard_ai_sessions_updated_at on public.dashboard_ai_sessions;
create trigger trg_dashboard_ai_sessions_updated_at
  before update on public.dashboard_ai_sessions
  for each row execute function public.set_updated_at();

-- Stamp de org (padrão records_set_org, 0090): a org é SEMPRE a do dashboard —
-- o valor derivado vence o que a action mandar (cinto + suspensório).
create or replace function public.dashboard_ai_sessions_set_org()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.organization_id := coalesce(
    (select d.organization_id
       from public.dashboards d
      where d.id = new.dashboard_id),
    new.organization_id
  );
  return new;
end;
$$;

drop trigger if exists trg_dashboard_ai_sessions_set_org on public.dashboard_ai_sessions;
create trigger trg_dashboard_ai_sessions_set_org
  before insert on public.dashboard_ai_sessions
  for each row execute function public.dashboard_ai_sessions_set_org();

alter table public.dashboard_ai_sessions enable row level security;

drop policy if exists dashboard_ai_sessions_all on public.dashboard_ai_sessions;
create policy dashboard_ai_sessions_all on public.dashboard_ai_sessions
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and user_id = (select auth.uid())
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and user_id = (select auth.uid())
  );

revoke all on public.dashboard_ai_sessions from anon;

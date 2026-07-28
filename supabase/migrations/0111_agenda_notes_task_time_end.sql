-- Versão: 1.0 | Data: 28/07/2026
-- Redesign da Agenda (parte de banco):
-- (a) tasks.due_time_end — agendamento com hora FINAL opcional ("14:00–15:30").
--     Segue a regra da 0063: dia civil em `date` + hora naive em `time` (relógio
--     de parede de Brasília) — NUNCA timestamptz, que arrastaria tasks para o
--     regime de ancoragem -03:00 dos records (invariante 11). Hora final exige
--     hora inicial (CHECK); "fim depois do início" é regra da action (mensagem
--     amigável no form).
-- (b) agenda_notes — "anotação do dia": texto livre ancorado a um dia civil,
--     sem vínculo com registro/tarefa (post-it do calendário). Tabela RAIZ
--     org-scoped (0089-0091): sem pai derivável ⇒ carimbo de org na ACTION via
--     getActiveOrgId() (padrão createTask), sem trigger set_org. Visibilidade:
--     org inteira lê (anotação é contexto compartilhado do calendário —
--     "feriado", "equipe em treinamento"); autor OU admin/gestor editam/
--     excluem. Sem acesso anon (regra do projeto); fora de PASSTHROUGH_TABLES
--     ⇒ snapshots públicos nunca a leem (adapter falha fechado).
-- (c) realtime: agenda_notes entra na publication (padrão idempotente 0071)
--     para o RealtimeRefresher recarregar as agendas abertas.
-- Idempotente.

-- ============ tasks.due_time_end (agendamento com hora final) ============
alter table public.tasks add column if not exists due_time_end time;

-- Hora final sem hora inicial não faz sentido (par); a action limpa o fim
-- quando o form limpa o início.
alter table public.tasks drop constraint if exists tasks_due_time_end_pair;
alter table public.tasks add constraint tasks_due_time_end_pair
  check (due_time_end is null or due_time is not null);

-- Range da agenda + ordenação cronológica intra-dia (agenda, /tarefas, sino).
create index if not exists idx_tasks_due
  on public.tasks (due_date, due_time) where due_date is not null;

-- ============ agenda_notes (anotação do dia) ============
create table if not exists public.agenda_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
                    references public.organizations (id) on delete cascade,
  -- Dia civil da célula (mesma semântica de tasks.due_date).
  note_date date not null,
  body text not null,
  -- Token da paleta de post-it ('amarelo'|'rosa'|'verde'|'azul'|'laranja'|
  -- 'roxo'); validado na action (paleta é decisão de UI, não de schema).
  color text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Consulta canônica: range de dias da org (agenda mensal/semanal).
create index if not exists idx_agenda_notes_org_date
  on public.agenda_notes (organization_id, note_date);

drop trigger if exists trg_agenda_notes_updated_at on public.agenda_notes;
create trigger trg_agenda_notes_updated_at
  before update on public.agenda_notes
  for each row execute function public.set_updated_at();

alter table public.agenda_notes enable row level security;

-- Org inteira lê: anotação é contexto compartilhado do calendário.
drop policy if exists agenda_notes_select on public.agenda_notes;
create policy agenda_notes_select on public.agenda_notes
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

-- Cria em nome próprio (carimbo de org vem da action; WITH CHECK barra org
-- alheia — falha ALTO, nunca vaza para a Zapper).
drop policy if exists agenda_notes_insert on public.agenda_notes;
create policy agenda_notes_insert on public.agenda_notes
  for insert to authenticated
  with check (
    organization_id in (select public.auth_org_ids())
    and created_by = (select auth.uid())
  );

-- Autor OU admin/gestor editam/excluem (a RLS dá o veredito; o client tenta e
-- exibe "Sem permissão" na negação — padrão attempt-and-fail do feed).
drop policy if exists agenda_notes_update on public.agenda_notes;
create policy agenda_notes_update on public.agenda_notes
  for update to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (
      created_by = (select auth.uid())
      or (select public.auth_has_role('admin'))
      or (select public.auth_has_role('gestor'))
    )
  )
  with check (organization_id in (select public.auth_org_ids()));

drop policy if exists agenda_notes_delete on public.agenda_notes;
create policy agenda_notes_delete on public.agenda_notes
  for delete to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (
      created_by = (select auth.uid())
      or (select public.auth_has_role('admin'))
      or (select public.auth_has_role('gestor'))
    )
  );

revoke all on public.agenda_notes from anon;

-- ============ realtime: agenda_notes na publication (padrão 0071) ============
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'agenda_notes'
     )
  then
    alter publication supabase_realtime add table public.agenda_notes;
  end if;
end $$;

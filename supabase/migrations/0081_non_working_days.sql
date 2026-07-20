-- Versão: 1.0 | Data: 20/07/2026
-- Dias não úteis (feriados e paradas declaradas à mão): calendário único
-- global consumido pelos utilitários de dia útil (lib/date/business-days.ts)
-- — meta ideal/ritmo (goalLine modo 'pace'), alinhamento "mesmo dia útil"
-- (businessDayAlign) e base de comparação previous_period_bd.
-- Dia útil = seg–sex que NÃO está nesta tabela. Idempotente. Não toca RPCs.

create table if not exists public.non_working_days (
  day date primary key,
  label text not null default '',
  created_at timestamptz not null default now()
);

alter table public.non_working_days enable row level security;

-- Leitura: qualquer autenticado (o cálculo de dia útil roda para todos os
-- papéis). Escrita: admin. SEM policy `to anon` — o viewer público de
-- snapshots lê via service role (PASSTHROUGH_TABLES em
-- lib/snapshots/db-adapter.ts), nunca como anon.
drop policy if exists non_working_days_select on public.non_working_days;
create policy non_working_days_select on public.non_working_days
  for select to authenticated using (true);

drop policy if exists non_working_days_write on public.non_working_days;
create policy non_working_days_write on public.non_working_days
  for all to authenticated
  using ((select public.auth_has_role('admin')))
  with check ((select public.auth_has_role('admin')));

-- Versão: 1.0 | Data: 17/07/2026
-- REALTIME: adiciona records/tasks/comments à publication supabase_realtime
-- para o app assinar postgres_changes (components/realtime-refresher.tsx). Os
-- eventos são usados apenas como SINAL de "algo mudou" (payload ignorado): o
-- cliente coalesce e dispara o event bus + router.refresh() — outros usuários
-- passam a ver inserções/edições sem navegar.
--
-- Autorização: postgres_changes respeita RLS com o JWT do assinante — cada
-- usuário só recebe eventos de linhas que pode ver (policies de records/tasks/
-- comments; o wrap InitPlan da 0068 também barateia essa avaliação). Replica
-- identity default (PK) basta: o payload não é consumido.
-- NADA aqui toca tabelas de snapshot nem cria acesso anon (o viewer público
-- /s/[token] fica FORA do realtime — regra do projeto).
-- Idempotente (checa pg_publication_tables antes de cada ADD).

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publication supabase_realtime inexistente — nada a fazer';
    return;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'records'
  ) then
    alter publication supabase_realtime add table public.records;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'comments'
  ) then
    alter publication supabase_realtime add table public.comments;
  end if;
end
$$;

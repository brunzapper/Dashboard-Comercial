-- Versão: 1.0 | Data: 11/10/2026
-- 0154 — Tarefa SOMENTE LEITURA (atividade CONCLUÍDA que nasceu no Bitrix).
--
-- As atividades de TODOS os negócios passaram a entrar (pedido do usuário):
-- pendente vira tarefa normal; concluída entra como registro do que aconteceu
-- lá, e não se edita aqui. Concluir LÁ conclui aqui, e reabrir lá devolve a
-- tarefa ao normal — quem mexe na coluna é a leitura de volta
-- (lib/sync/bitrix/activity-inbound.ts + activity-discovery.ts), sempre com
-- service role.
--
-- A trava é no BANCO, não só na tela: usuário autenticado (auth.uid() não
-- nulo) não altera nem exclui tarefa com `read_only`. Service role passa
-- (auth.uid() nulo). A exclusão em CASCATA (purga de registro da Lixeira pelo
-- admin) também passa: ela chega por trigger de FK, com pg_trigger_depth() > 1
-- — barrá-la impediria apagar o registro.
-- Sem mudança em RPC de widget (invariante 1 intocada).

alter table public.tasks
  add column if not exists read_only boolean not null default false;

create or replace function public.enforce_tasks_read_only()
returns trigger
language plpgsql
as $$
begin
  if old.read_only
     and auth.uid() is not null
     and pg_trigger_depth() = 1 then
    raise exception 'Tarefa somente leitura: ela veio concluída do Bitrix.'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_tasks_read_only on public.tasks;
create trigger trg_tasks_read_only
  before update or delete on public.tasks
  for each row execute function public.enforce_tasks_read_only();

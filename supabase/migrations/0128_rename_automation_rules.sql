-- 0128_rename_automation_rules.sql
-- Versão: 1.0 | Data: 08/09/2026
-- RENAME: `kanban_automations` → `automation_rules`.
--
-- A 0127 deu à regra um terceiro tipo de dono (uma BASE, sem quadro nenhum), e
-- a partir dali o nome mentia: uma tabela chamada "kanban_automations"
-- guardando regras que não têm kanban. Renomeada agora, enquanto o volume é
-- pequeno e antes de o nome virar folclore — o mesmo erro que as chaves de
-- área históricas (`fontes` apontando para /registros/bases) já cometeram e
-- que não dá mais para desfazer sem quebrar overrides gravados.
--
-- O que NÃO é renomeado, de propósito:
--  - a ROTA do tick (`/api/kanban-automations/tick`). O pg_cron já instalado
--    aponta para ela; trocar o caminho derrubaria o agendamento até alguém
--    reaplicar `supabase/apply/pg-cron-kanban-automations.sql`. Uma tabela se
--    renomeia numa transação; um cron agendado noutro sistema, não.
--  - a coluna `last_moved_count`, que hoje conta AÇÕES (mover + definir
--    campo). Renomeá-la é churn de dado sem ganho.
--
-- Idempotente: cada passo checa antes. Não recria RPC nenhuma.

do $$
begin
  -- Tabela. Índices, constraints, policies e triggers seguem junto por OID —
  -- só os NOMES deles continuam com o prefixo antigo, corrigidos abaixo.
  if exists (select 1 from pg_class where relname = 'kanban_automations' and relkind = 'r')
     and not exists (select 1 from pg_class where relname = 'automation_rules' and relkind = 'r')
  then
    alter table public.kanban_automations rename to automation_rules;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_class where relname = 'kanban_automations_pkey') then
    alter index public.kanban_automations_pkey rename to automation_rules_pkey;
  end if;
  if exists (select 1 from pg_class where relname = 'idx_kanban_automations_widget') then
    alter index public.idx_kanban_automations_widget rename to idx_automation_rules_widget;
  end if;
  if exists (select 1 from pg_class where relname = 'idx_kanban_automations_board') then
    alter index public.idx_kanban_automations_board rename to idx_automation_rules_board;
  end if;
  if exists (select 1 from pg_class where relname = 'idx_kanban_automations_tick') then
    alter index public.idx_kanban_automations_tick rename to idx_automation_rules_tick;
  end if;
  if exists (select 1 from pg_class where relname = 'idx_kanban_automations_source') then
    alter index public.idx_kanban_automations_source rename to idx_automation_rules_source;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'kanban_automations_one_owner'
  ) then
    alter table public.automation_rules
      rename constraint kanban_automations_one_owner to automation_rules_one_owner;
  end if;
end $$;

-- Função do stamp de org: o trigger a referencia por OID, então o rename não
-- quebra o vínculo.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'kanban_automations_set_org'
  ) then
    alter function public.kanban_automations_set_org()
      rename to automation_rules_set_org;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_trigger
    where tgname = 'trg_kanban_automations_updated_at'
      and tgrelid = 'public.automation_rules'::regclass
  ) then
    alter trigger trg_kanban_automations_updated_at on public.automation_rules
      rename to trg_automation_rules_updated_at;
  end if;
  if exists (
    select 1 from pg_trigger
    where tgname = 'trg_kanban_automations_set_org'
      and tgrelid = 'public.automation_rules'::regclass
  ) then
    alter trigger trg_kanban_automations_set_org on public.automation_rules
      rename to trg_automation_rules_set_org;
  end if;
end $$;

-- Policy: recriada (o corpo é o mesmo da 0127) em vez de renomeada, para o
-- arquivo carregar o texto vigente — quem for auditar a autoridade desta
-- tabela lê aqui, não precisa reconstruir a partir de três migrações.
drop policy if exists kanban_automations_all on public.automation_rules;
drop policy if exists automation_rules_all on public.automation_rules;
create policy automation_rules_all on public.automation_rules
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (
      (
        widget_id is not null
        and (select public.auth_board_editable(
          (select w.dashboard_id from public.widgets w
            where w.id = automation_rules.widget_id)))
      )
      or (
        board_id is not null
        and (select public.auth_board_editable(automation_rules.board_id))
      )
      or (
        source_key is not null
        and (select public.auth_has_role('admin'))
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
            where w.id = automation_rules.widget_id)))
      )
      or (
        board_id is not null
        and (select public.auth_board_editable(automation_rules.board_id))
      )
      or (
        source_key is not null
        and (select public.auth_has_role('admin'))
      )
    )
  );

revoke all on public.automation_rules from anon;

comment on table public.automation_rules is
  'Regras de automação sobre registros: condições em E + uma ação (mover de coluna, definir campo). O dono é um quadro (widget_id/board_id) OU uma Base (source_key) — exatamente um. Ex-kanban_automations (0109), renomeada na 0128 quando o escopo de Base tornou o nome antigo mentiroso.';

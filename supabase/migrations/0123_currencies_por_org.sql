-- Versão: 1.0 | Data: 22/08/2026
-- MOEDAS POR ORGANIZAÇÃO (auditoria de segurança 22/08/2026).
-- A 0090 deixou `currencies`/`currency_rates` de fora de propósito ("globais"),
-- e a policy de escrita da 0036 era só `manage_field_definitions` — permissão
-- de USUÁRIO. Resultado: alguém da org A alterava a taxa trimestral que a org B
-- usa para converter valores em moeda (widgets de dinheiro) e, desde a 0112, os
-- ALVOS de remuneração (`factor.targetCurrency` → BRL em resolveTargetRates).
-- Isolamento entre tenants não pode depender de ninguém se comportar bem.
--
-- Esta migração reverte aquela decisão: as duas tabelas passam a ser
-- org-scoped no padrão 0090/0091 (coluna com default Zapper — o ADD COLUMN
-- carimba o legado sem rewrite; policies prefixadas por
-- `organization_id in (select public.auth_org_ids())`).
--
-- Chaves: a unicidade vira POR-ORG (precedente de field_definitions.field_key e
-- da PK de sync_config na 0090) — currencies (organization_id, code) e
-- currency_rates (organization_id, code, year, quarter). A FK de rates → moedas
-- passa a ser COMPOSTA, senão a taxa de uma org poderia apontar para a moeda de
-- outra.
--
-- ATENÇÃO no read side: os loaders de lib/widgets/currency.ts passam a aceitar
-- orgId e os caminhos SERVICE ROLE (que bypassam RLS) DEVEM passá-lo —
-- lib/snapshots/refresh.ts congela moedas/taxas com o service client e sem o
-- filtro misturaria as taxas de todas as orgs na mesma chave
-- `rateKey(code, year, quarter)` (último a chegar venceria).
-- Idempotente.

-- ===================== Colunas =====================
alter table public.currencies
  add column if not exists organization_id uuid not null
    default '00000000-0000-4000-a000-000000000001'
    references public.organizations (id) on delete cascade;
alter table public.currency_rates
  add column if not exists organization_id uuid not null
    default '00000000-0000-4000-a000-000000000001'
    references public.organizations (id) on delete cascade;

-- ===================== Chaves (PK por-org + FK composta) =====================
do $$
declare
  v_pk_has_org boolean;
begin
  -- A FK simples (code) precisa sair ANTES de trocar o PK da pai.
  if exists (
    select 1 from pg_constraint
    where conname = 'currency_rates_code_fkey'
      and conrelid = 'public.currency_rates'::regclass
  ) then
    alter table public.currency_rates drop constraint currency_rates_code_fkey;
  end if;

  -- currencies: PK (code) → (organization_id, code)
  select exists (
    select 1
    from pg_index i
    join pg_attribute a
      on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
    where i.indrelid = 'public.currencies'::regclass
      and i.indisprimary
      and a.attname = 'organization_id'
  ) into v_pk_has_org;
  if not v_pk_has_org then
    alter table public.currencies drop constraint currencies_pkey;
    alter table public.currencies
      add constraint currencies_pkey primary key (organization_id, code);
  end if;

  -- currency_rates: PK (code, year, quarter) → (organization_id, code, year, quarter)
  select exists (
    select 1
    from pg_index i
    join pg_attribute a
      on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
    where i.indrelid = 'public.currency_rates'::regclass
      and i.indisprimary
      and a.attname = 'organization_id'
  ) into v_pk_has_org;
  if not v_pk_has_org then
    alter table public.currency_rates drop constraint currency_rates_pkey;
    alter table public.currency_rates
      add constraint currency_rates_pkey
      primary key (organization_id, code, year, quarter);
  end if;

  -- FK composta: taxa nunca aponta para a moeda de outra org.
  if not exists (
    select 1 from pg_constraint
    where conname = 'currency_rates_org_code_fkey'
      and conrelid = 'public.currency_rates'::regclass
  ) then
    alter table public.currency_rates
      add constraint currency_rates_org_code_fkey
      foreign key (organization_id, code)
      references public.currencies (organization_id, code) on delete cascade;
  end if;
end
$$;

-- ===================== RLS (padrão 0091) =====================
drop policy if exists currencies_select on public.currencies;
create policy currencies_select on public.currencies
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists currencies_write on public.currencies;
create policy currencies_write on public.currencies
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_field_definitions'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_field_definitions'))
  );

drop policy if exists currency_rates_select on public.currency_rates;
create policy currency_rates_select on public.currency_rates
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists currency_rates_write on public.currency_rates;
create policy currency_rates_write on public.currency_rates
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_field_definitions'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_field_definitions'))
  );

revoke all on public.currencies      from anon;
revoke all on public.currency_rates  from anon;

-- ===================== Provisionamento de org nova =====================
-- Org nova precisa do próprio catálogo de moedas (a 0036 semeava global). Sem
-- isto, org nova cai no fallbackCurrencies() do app e fica sem taxas.
create or replace function public.seed_org_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.field_definitions
    (organization_id, field_key, label, data_type, options, source_system,
     source_field_id, show_in_builder, applies_to, is_local, sort_order)
  values
    (p_org, 'title',             'Nome (título)',                   'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'record_type',       'Tipo de registro',                'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'source_system',     'Base',                            'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'pipeline',          'Pipeline',                        'selecao',  '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'stage',             'Etapa',                           'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'stage_semantic',    'Situação (aberto/ganho/perdido)', 'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'sale_type',         'Tipo de venda',                   'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'channel',           'Canal',                           'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'currency',          'Moeda',                           'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'closed',            'Fechado?',                        'booleano', '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'responsible_id',    'Responsável',                     'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'operation_id',      'Operação',                        'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'related_lead_id',   'Lead relacionado',                'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'value',             'Valor',                           'moeda',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'mrr',               'MRR',                             'moeda',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'lead_time_days',    'Lead time (dias)',                'numero',   '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'closed_at',         'Data de fechamento',              'data',     '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'opened_at',         'Data de abertura',                'data',     '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'source_created_at', 'Data de criação (origem)',        'data',     '[]'::jsonb, 'core', null, true, '{}', false, 0)
  on conflict (organization_id, field_key) do nothing;

  -- Catálogo de moedas da org (espelha o seed da 0036 / CURRENCY_OPTIONS).
  -- Taxas nascem vazias: cada org preenche as suas em Campos → Moedas.
  insert into public.currencies (organization_id, code, label, enabled, sort_order)
  values
    (p_org, 'BRL', 'Real (R$)',          true,  0),
    (p_org, 'USD', 'Dólar (US$)',        true,  1),
    (p_org, 'EUR', 'Euro (€)',           false, 2),
    (p_org, 'GBP', 'Libra (£)',          false, 3),
    (p_org, 'ARS', 'Peso argentino ($)', false, 4)
  on conflict (organization_id, code) do nothing;
end;
$$;

revoke execute on function public.seed_org_defaults(uuid) from public, anon, authenticated;
grant execute on function public.seed_org_defaults(uuid) to service_role;

-- Orgs que já existem (criadas antes desta migração) ganham o catálogo agora.
insert into public.currencies (organization_id, code, label, enabled, sort_order)
select o.id, c.code, c.label, c.enabled, c.sort_order
from public.organizations o
cross join (values
  ('BRL', 'Real (R$)',          true,  0),
  ('USD', 'Dólar (US$)',        true,  1),
  ('EUR', 'Euro (€)',           false, 2),
  ('GBP', 'Libra (£)',          false, 3),
  ('ARS', 'Peso argentino ($)', false, 4)
) as c(code, label, enabled, sort_order)
on conflict (organization_id, code) do nothing;

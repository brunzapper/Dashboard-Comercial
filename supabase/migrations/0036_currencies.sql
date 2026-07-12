-- Versão: 1.0 | Data: 12/07/2026
-- Sistema de moedas e conversão cambial.
--   1) field_definitions ganha currency_code (moeda fixa de um campo 'moeda' ou de
--      um 'calculado' com moeda fixa) e currency_mode (só 'calculado':
--      'inherit' = herda a moeda do registro | 'fixed' = usa currency_code;
--      null = número puro, sem moeda).
--   2) currencies: catálogo das moedas do sistema (habilitáveis pelo admin). BRL é
--      a base (taxa implícita 1). Seed com as 5 de lib/widgets/currency.ts; BRL/USD
--      já habilitadas.
--   3) currency_rates: taxa média (R$ por 1 unidade da moeda) por ano e por
--      trimestre (quarter 0 = anual; 1..4 = trimestral). Preenchida à mão OU pela
--      média PTAX do Banco Central. Regra = último a escrever vence (source é só
--      informativo, não protege).
-- RLS: leitura para autenticados; escrita para quem tem manage_field_definitions.
-- Idempotente.

-- ===================== field_definitions: moeda por campo =====================
alter table public.field_definitions
  add column if not exists currency_code text,
  add column if not exists currency_mode text;

-- ===================== currencies (catálogo do sistema) =======================
create table if not exists public.currencies (
  code text primary key,                 -- ISO: 'BRL','USD','EUR','GBP','ARS'
  label text not null,                   -- 'Real (R$)'
  enabled boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_currencies_updated_at on public.currencies;
create trigger trg_currencies_updated_at
  before update on public.currencies
  for each row execute function public.set_updated_at();

-- Seed idempotente (espelha CURRENCY_OPTIONS). BRL/USD nascem habilitadas.
insert into public.currencies (code, label, enabled, sort_order) values
  ('BRL', 'Real (R$)', true, 0),
  ('USD', 'Dólar (US$)', true, 1),
  ('EUR', 'Euro (€)', false, 2),
  ('GBP', 'Libra (£)', false, 3),
  ('ARS', 'Peso argentino ($)', false, 4)
on conflict (code) do nothing;

-- ===================== currency_rates (taxas por ano/trimestre) ================
create table if not exists public.currency_rates (
  code text not null references public.currencies (code) on delete cascade,
  year int not null,
  quarter int not null default 0,        -- 0 = anual; 1..4 = trimestral
  rate numeric not null,                 -- R$ por 1 unidade da moeda
  source text,                           -- 'manual' | 'ptax' (informativo)
  updated_at timestamptz not null default now(),
  primary key (code, year, quarter),
  check (quarter between 0 and 4)
);

drop trigger if exists trg_currency_rates_updated_at on public.currency_rates;
create trigger trg_currency_rates_updated_at
  before update on public.currency_rates
  for each row execute function public.set_updated_at();

-- ===================== RLS =====================================================
alter table public.currencies enable row level security;
alter table public.currency_rates enable row level security;

drop policy if exists currencies_select on public.currencies;
create policy currencies_select on public.currencies
  for select to authenticated
  using (true);

drop policy if exists currencies_write on public.currencies;
create policy currencies_write on public.currencies
  for all to authenticated
  using (public.auth_has_permission('manage_field_definitions'))
  with check (public.auth_has_permission('manage_field_definitions'));

drop policy if exists currency_rates_select on public.currency_rates;
create policy currency_rates_select on public.currency_rates
  for select to authenticated
  using (true);

drop policy if exists currency_rates_write on public.currency_rates;
create policy currency_rates_write on public.currency_rates
  for all to authenticated
  using (public.auth_has_permission('manage_field_definitions'))
  with check (public.auth_has_permission('manage_field_definitions'));

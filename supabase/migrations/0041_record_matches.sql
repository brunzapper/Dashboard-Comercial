-- Versão: 1.0 | Data: 12/07/2026
-- Fase 2: matching configurável entre fontes. Duas tabelas GLOBAIS:
--   match_rules     — regras de auto-match entre duas fontes (record_type), por
--                     2 pares de campos com fallback (par 1 → par 2).
--   record_matches  — matches gravados (auto ou manual) entre dois registros.
-- Diferente do `related_lead_id` (vínculo "gêmeo" lead↔negócio, hardcoded no
-- sync): aqui o usuário liga QUALQUER par de fontes (ex.: lead ↔ venda do site)
-- por campos que ele escolhe, e complementa manualmente. Os campos do registro
-- casado são expostos como `match:<fonte>:<campo>` no widget query (migração
-- 0042). Leitura liberada a autenticados (o RPC lê via subconsulta); escrita
-- exige manage_field_definitions (mesma regra de Campos/Correspondências).
-- Idempotente.

create table if not exists public.match_rules (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  source_a text not null check (source_a in ('lead', 'negocio', 'venda_site')),
  source_b text not null check (source_b in ('lead', 'negocio', 'venda_site')),
  -- Pares de campos comparados (ref = coluna do núcleo ou 'custom:<key>'). Par 1
  -- é tentado primeiro; par 2 (opcional) é o fallback.
  field_a_1 text not null,
  field_b_1 text not null,
  field_a_2 text,
  field_b_2 text,
  enabled boolean not null default true,
  priority int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_a <> source_b)
);

create table if not exists public.record_matches (
  id uuid primary key default gen_random_uuid(),
  -- Convenção: record_a é da fonte source_a da regra; record_b da source_b.
  record_a_id uuid not null references public.records (id) on delete cascade,
  record_b_id uuid not null references public.records (id) on delete cascade,
  rule_id uuid references public.match_rules (id) on delete set null,
  mode text not null default 'auto' check (mode in ('auto', 'manual')),
  matched_on text,               -- qual par casou (diagnóstico), ex.: 'email'
  created_at timestamptz not null default now(),
  unique (record_a_id, record_b_id),
  check (record_a_id <> record_b_id)
);

create index if not exists idx_record_matches_a on public.record_matches (record_a_id);
create index if not exists idx_record_matches_b on public.record_matches (record_b_id);
create index if not exists idx_match_rules_enabled on public.match_rules (enabled);

drop trigger if exists trg_match_rules_updated_at on public.match_rules;
create trigger trg_match_rules_updated_at
  before update on public.match_rules
  for each row execute function public.set_updated_at();

-- ============ RLS ============
alter table public.match_rules    enable row level security;
alter table public.record_matches enable row level security;

-- match_rules: leitura p/ autenticados; escrita = manage_field_definitions.
drop policy if exists match_rules_select on public.match_rules;
create policy match_rules_select on public.match_rules
  for select to authenticated using (true);

drop policy if exists match_rules_write on public.match_rules;
create policy match_rules_write on public.match_rules
  for all to authenticated
  using (public.auth_has_permission('manage_field_definitions'))
  with check (public.auth_has_permission('manage_field_definitions'));

-- record_matches: leitura p/ autenticados (o RPC run_widget_query resolve
-- match:<fonte> via subconsulta, security invoker); escrita = mesma permissão.
drop policy if exists record_matches_select on public.record_matches;
create policy record_matches_select on public.record_matches
  for select to authenticated using (true);

drop policy if exists record_matches_write on public.record_matches;
create policy record_matches_write on public.record_matches
  for all to authenticated
  using (public.auth_has_permission('manage_field_definitions'))
  with check (public.auth_has_permission('manage_field_definitions'));

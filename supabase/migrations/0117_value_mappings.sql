-- 0117_value_mappings.sql
-- Versão: 1.0 | Data: 07/08/2026
-- MAPEAMENTOS DE VALORES (de-para): classifica valores CRUS de um campo em
-- categorias (ex.: cargo livre do Meetime → Área + Nível hierárquico;
-- segmento livre → Segmento classificado), substituindo os caches
-- "Map Cargos"/"Map Segmentos" do dashboard antigo em Apps Script.
-- Os DOMÍNIOS (qual base/campo cru → quais campos alvo) vivem em CÓDIGO
-- (lib/mappings/domains.ts); esta tabela guarda só as ENTRADAS do de-para.
-- A aplicação é 100% engine-side (lib/mappings/apply.ts, service role com org
-- explícita): grava os campos ALVO no custom_fields dos registros como
-- ESPELHO DERIVADO (carimbos field_modified_at + locally_modified_at; sem
-- audit/webhook) — RPCs de widget INTOCADOS. Valores não mapeados geram/
-- atualizam uma TAREFA para o org_admin (sino de tarefas).
-- Lookup por raw_norm = lower(trim(raw_value)) — mesma normalização do cache
-- do Apps Script antigo. Unicidade por org+domínio+raw_norm.
-- RLS: leitura da org; escrita admin (espelho de source_auto_operations 0106).
-- NUNCA policy para anon. Idempotente.

create table if not exists public.value_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
    references public.organizations (id) on delete cascade,
  -- Domínio do catálogo em código (lib/mappings/domains.ts), ex.: 'cargo',
  -- 'segmento'. Slug minúsculo como data_sources.key.
  domain text not null check (domain ~ '^[a-z][a-z0-9_]{1,39}$'),
  -- Valor como aparece no registro (preservado p/ exibição).
  raw_value text not null,
  -- Chave de lookup: lower(trim(raw_value)). O app SEMPRE grava as duas.
  raw_norm text not null,
  -- Saídas por campo alvo do domínio, ex.:
  --   cargo    → {"cargo_area": "TI", "cargo_nivel": "Gerente"}
  --   segmento → {"segmento_classificado": "Agronegócio"}
  outputs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_value_mappings_org_domain_norm
  on public.value_mappings (organization_id, domain, raw_norm);

create index if not exists idx_value_mappings_org_domain
  on public.value_mappings (organization_id, domain);

drop trigger if exists trg_value_mappings_updated on public.value_mappings;
create trigger trg_value_mappings_updated
  before update on public.value_mappings
  for each row execute function public.set_updated_at();

alter table public.value_mappings enable row level security;

drop policy if exists value_mappings_select on public.value_mappings;
create policy value_mappings_select on public.value_mappings
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists value_mappings_write on public.value_mappings;
create policy value_mappings_write on public.value_mappings
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  );

revoke all on public.value_mappings from anon;

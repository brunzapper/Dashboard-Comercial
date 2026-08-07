-- 0119_mapping_domains.sql
-- Versão: 1.0 | Data: 07/08/2026
-- DOMÍNIOS DINÂMICOS de reclassificação (mapeamentos de valores): permite
-- criar pela UI (aba Campos → Reclassificações) um domínio novo de de-para
-- sem código — base(s) + campo cru + campos alvo + categorias canônicas.
-- O registry EFETIVO em runtime é código ∪ banco (lib/mappings/registry.ts;
-- colisão de key: código vence). A LINHA é o registry do domínio dinâmico:
-- as categorias canônicas moram em targets[].options (nunca lista paralela).
-- Domínio dinâmico NÃO tem classificador codificado — o motor aprendido
-- (banco de palavras, lib/mappings/classify/learned.ts) é o único suggester.
-- key segue o MESMO check de slug de value_mappings.domain (0117) — as
-- entradas do domínio dinâmico passam no check existente sem tocá-lo.
-- raw_field_key tem check de slug como DEFESA: o valor é interpolado em
-- select PostgREST (custom_fields->>key) pelos loaders.
-- RLS: leitura da org; escrita admin (espelho de value_mappings 0117).
-- NUNCA policy para anon. Idempotente.

create table if not exists public.mapping_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
    references public.organizations (id) on delete cascade,
  -- Identidade do domínio (= value_mappings.domain das entradas). Imutável
  -- na edição; não pode colidir com os domínios em código (validado na
  -- action — a lista de código é viva, não vai a SQL).
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null,
  -- record_types das bases RAIZ que carregam o campo cru.
  record_types text[] not null check (cardinality(record_types) >= 1),
  -- Chave custom (SEM prefixo custom:) do campo CRU lido nos registros.
  raw_field_key text not null check (raw_field_key ~ '^[a-z][a-z0-9_]{0,59}$'),
  raw_field_label text not null,
  -- Campos alvo derivados + categorias canônicas:
  --   [{"fieldKey": "porte_classificado", "label": "Porte", "options": ["P","M","G"]}]
  -- Parse FAIL-CLOSED no loader (linha malformada é ignorada com aviso).
  targets jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_mapping_domains_org_key
  on public.mapping_domains (organization_id, key);

drop trigger if exists trg_mapping_domains_updated on public.mapping_domains;
create trigger trg_mapping_domains_updated
  before update on public.mapping_domains
  for each row execute function public.set_updated_at();

alter table public.mapping_domains enable row level security;

drop policy if exists mapping_domains_select on public.mapping_domains;
create policy mapping_domains_select on public.mapping_domains
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists mapping_domains_write on public.mapping_domains;
create policy mapping_domains_write on public.mapping_domains
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  );

revoke all on public.mapping_domains from anon;

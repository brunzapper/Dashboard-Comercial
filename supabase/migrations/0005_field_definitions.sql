-- Versão: 1.0 | Data: 04/07/2026
-- Colunas dinâmicas: definições de campo com visibilidade/edição por papel.
-- Os valores vivem em records.custom_fields; nenhum schema físico muda ao criar
-- uma coluna. is_local = campo que existe só no app (nunca vem de fonte).
-- Idempotente.

create table if not exists public.field_definitions (
  id uuid primary key default gen_random_uuid(),
  field_key text not null unique,
  label text not null,
  data_type text not null check (data_type in ('texto', 'numero', 'data', 'selecao', 'moeda')),
  options jsonb not null default '[]'::jsonb,      -- opções para data_type = 'selecao'
  visible_to_roles text[] not null default '{}',
  editable_by_roles text[] not null default '{}',
  is_local boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_field_definitions_updated_at on public.field_definitions;
create trigger trg_field_definitions_updated_at
  before update on public.field_definitions
  for each row execute function public.set_updated_at();

-- Versão: 1.0 | Data: 11/07/2026
-- Valores de campos personalizados ligados a uma ENTIDADE (responsável ou
-- operação), e não a um registro. Usado pelas tabelas de dashboard em modo lista
-- cuja "Fonte das linhas" é Responsáveis/Operações: uma coluna personalizada não
-- calculada editável grava aqui, chaveada por (entity_type, entity_id, field_key).
-- Os valores são GLOBAIS (uma operação/responsável tem um valor por campo,
-- compartilhado entre todos os dashboards que listam a mesma entidade). A estrutura
-- (quais colunas) vive em widgets.settings.columns; só os valores vivem aqui.
-- Idempotente.

create table if not exists public.entity_custom_values (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('responsible', 'operation')),
  entity_id uuid not null,
  field_key text not null,
  value jsonb, -- número/texto/data (ISO) etc.; null/ausente = célula vazia
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_type, entity_id, field_key)
);

create index if not exists idx_entity_custom_values_entity
  on public.entity_custom_values (entity_type, entity_id);

drop trigger if exists trg_entity_custom_values_updated_at on public.entity_custom_values;
create trigger trg_entity_custom_values_updated_at
  before update on public.entity_custom_values
  for each row execute function public.set_updated_at();

alter table public.entity_custom_values enable row level security;

-- Leitura: qualquer usuário autenticado (valores são compartilhados/globais).
drop policy if exists entity_custom_values_select on public.entity_custom_values;
create policy entity_custom_values_select on public.entity_custom_values
  for select to authenticated
  using (true);

-- Escrita: quem tem a permissão de editar valores de registro. O reforço por
-- `editable_by_roles` do campo específico é feito na server action updateEntityField.
drop policy if exists entity_custom_values_write on public.entity_custom_values;
create policy entity_custom_values_write on public.entity_custom_values
  for all to authenticated
  using (public.auth_has_permission('edit_record_values'))
  with check (public.auth_has_permission('edit_record_values'));

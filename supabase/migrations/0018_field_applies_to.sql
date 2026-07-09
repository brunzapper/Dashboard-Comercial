-- Versão: 1.0 | Data: 09/07/2026
-- Fase 8: separação de fontes. field_definitions ganha `applies_to` — a quais
-- record_type (fonte) a coluna pertence. Usado para (a) mostrar só as colunas
-- relevantes de cada aba de Registros e (b) listar candidatos por fonte ao
-- montar correspondências de colunas. Populado pelo catálogo do sync
-- (lib/sync/bitrix/catalog.ts: deal→'negocio', lead→'lead') e por um seed dos
-- campos da planilha "Estudo de Fechamentos" (venda_site). Idempotente.

alter table public.field_definitions
  add column if not exists applies_to text[] not null default '{}';

-- Seed dos campos da planilha (Estudo de Fechamentos) — hoje eles vão direto
-- para records.custom_fields sem catálogo, então sem esta linha não teriam
-- rótulo visual nem fonte. Upsert por field_key (unique). show_in_builder=true
-- pois já eram usados; source_system='sheet_site'.
insert into public.field_definitions
  (field_key, label, data_type, options, visible_to_roles, editable_by_roles,
   is_local, show_in_builder, source_system, applies_to)
values
  ('products',   'Produtos',            'texto',  '[]'::jsonb, '{}', '{}', false, true, 'sheet_site', '{venda_site}'),
  ('seats',      'Assentos (licenças)', 'numero', '[]'::jsonb, '{}', '{}', false, true, 'sheet_site', '{venda_site}'),
  ('campanha',   'Campanha',            'texto',  '[]'::jsonb, '{}', '{}', false, true, 'sheet_site', '{venda_site}'),
  ('email',      'E-mail',              'texto',  '[]'::jsonb, '{}', '{}', false, true, 'sheet_site', '{venda_site,lead}')
on conflict (field_key) do update
  set applies_to = (
        select array_agg(distinct e)
        from unnest(field_definitions.applies_to || excluded.applies_to) as e
      );

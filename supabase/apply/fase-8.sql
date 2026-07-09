-- ============================================================================
-- Versão: 1.0 | Data: 09/07/2026
-- BLOCO ÚNICO — FASE 8 — colar no SQL Editor do Supabase APÓS a Fase 7.
-- Separação de fontes: applies_to nas colunas, correspondências globais de
-- colunas, run_widget_query com campos unificados e widgets.sources/split.
-- Idempotente.
-- ============================================================================


-- >>>>>>>>>>>>>>>>>>>> migrations/0018_field_applies_to.sql <<<<<<<<<<<<<<<<<<<<
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


-- >>>>>>>>>>>>>>>>>>>> migrations/0019_field_correspondences.sql <<<<<<<<<<<<<<<<<<<<
-- Versão: 1.0 | Data: 09/07/2026
-- Fase 8: correspondências de colunas GLOBAIS (compartilhadas entre todos os
-- dashboards). Um "campo unificado" (field_correspondences) agrupa colunas
-- equivalentes de fontes diferentes (field_correspondence_members) para que o
-- construtor de widgets possa tratá-las como a mesma coluna nos cálculos.
--   field_ref = coluna do núcleo (ex.: 'mrr') ou 'custom:<field_key>'.
-- Leitura liberada a todo autenticado (é config global); escrita exige
-- manage_field_definitions (mesma permissão de Campos). Idempotente.

create table if not exists public.field_correspondences (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  data_type text not null default 'texto'
    check (data_type in ('texto', 'numero', 'data', 'selecao', 'moeda', 'booleano', 'calculado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.field_correspondence_members (
  id uuid primary key default gen_random_uuid(),
  correspondence_id uuid not null
    references public.field_correspondences (id) on delete cascade,
  record_type text not null check (record_type in ('lead', 'negocio', 'venda_site')),
  field_ref text not null,           -- coluna do núcleo ou 'custom:<key>'
  created_at timestamptz not null default now(),
  unique (correspondence_id, record_type)
);

create index if not exists idx_fc_members_correspondence
  on public.field_correspondence_members (correspondence_id);

drop trigger if exists trg_field_correspondences_updated_at on public.field_correspondences;
create trigger trg_field_correspondences_updated_at
  before update on public.field_correspondences
  for each row execute function public.set_updated_at();

-- ============ RLS ============
alter table public.field_correspondences        enable row level security;
alter table public.field_correspondence_members enable row level security;

-- field_correspondences: leitura p/ autenticados; escrita = manage_field_definitions.
drop policy if exists field_correspondences_select on public.field_correspondences;
create policy field_correspondences_select on public.field_correspondences
  for select to authenticated using (true);

drop policy if exists field_correspondences_write on public.field_correspondences;
create policy field_correspondences_write on public.field_correspondences
  for all to authenticated
  using (public.auth_has_permission('manage_field_definitions'))
  with check (public.auth_has_permission('manage_field_definitions'));

-- members: mesma regra.
drop policy if exists fc_members_select on public.field_correspondence_members;
create policy fc_members_select on public.field_correspondence_members
  for select to authenticated using (true);

drop policy if exists fc_members_write on public.field_correspondence_members;
create policy fc_members_write on public.field_correspondence_members
  for all to authenticated
  using (public.auth_has_permission('manage_field_definitions'))
  with check (public.auth_has_permission('manage_field_definitions'));


-- >>>>>>>>>>>>>>>>>>>> migrations/0020_widget_rpc_sources.sql <<<<<<<<<<<<<<<<<<<<
-- Versão: 1.0 | Data: 09/07/2026
-- Fase 8: estende run_widget_query para campos UNIFICADOS (correspondências).
-- A seleção de fontes e o "quebrar por fonte" são resolvidos no engine (via um
-- filtro record_type in (...) e uma dimensão record_type), então aqui só entra o
-- novo parâmetro p_correspondences.
--
--   p_correspondences: { "<key>": ["custom:a", "mrr", ...] } — ao encontrar um
--   field = 'unified:<key>' em dimensão/métrica/filtro, monta coalesce(<partes>)
--   com CADA ref resolvido e validado pela MESMA whitelist (sem SQL livre).
--
-- Como CREATE OR REPLACE não altera a assinatura, dropamos a versão de 4 args
-- (0015) e criamos a de 5. O helper _widget_col_expr resolve/valida um ref
-- (coluna do núcleo ou custom:<key>) e é reusado por campos simples e unificados.

-- ---- Helper: ref (coluna do núcleo ou custom:<key>) -> expressão SQL segura ----
create or replace function public._widget_col_expr(p_ref text, p_numeric boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_allowed_cols text[] := array[
    'record_type','source_system','owner_user_id','pipeline','stage','stage_semantic',
    'temperature','sale_type','channel','currency','closed','value','mrr',
    'responsible_id','operation_id','related_lead_id','lead_time_days',
    'closed_at','opened_at','source_created_at','source_modified_at',
    'created_at','updated_at','last_synced_at'
  ];
  v_num_cols text[] := array['value','mrr','lead_time_days'];
begin
  if p_ref is null or p_ref = '' then
    raise exception 'Referência de coluna vazia';
  end if;
  if p_ref like 'custom:%' then
    if p_numeric then
      return format('nullif(custom_fields ->> %L, %L)::numeric', substring(p_ref from 8), '');
    end if;
    return format('(custom_fields ->> %L)', substring(p_ref from 8));
  elsif p_ref = any(v_allowed_cols) then
    if p_numeric and not (p_ref = any(v_num_cols)) then
      raise exception 'Coluna % não é numérica', p_ref;
    end if;
    return format('%I', p_ref);
  else
    raise exception 'Coluna não permitida: %', p_ref;
  end if;
end;
$$;

-- Monta a expressão de um campo unificado: coalesce das partes (cada membro).
create or replace function public._widget_unified_expr(
  p_key text, p_correspondences jsonb, p_numeric boolean
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_arr jsonb := coalesce(p_correspondences -> p_key, '[]'::jsonb);
  v_parts text[] := array[]::text[];
  v_ref text;
begin
  for v_ref in select jsonb_array_elements_text(v_arr)
  loop
    v_parts := v_parts || public._widget_col_expr(v_ref, p_numeric);
  end loop;
  if array_length(v_parts, 1) is null then
    raise exception 'Correspondência sem colunas: %', p_key;
  end if;
  return 'coalesce(' || array_to_string(v_parts, ', ') || ')';
end;
$$;

drop function if exists public.run_widget_query(text, jsonb, jsonb, jsonb);

create or replace function public.run_widget_query(
  p_source text,
  p_dimensions jsonb default '[]'::jsonb,
  p_metrics jsonb default '[]'::jsonb,
  p_filters jsonb default '[]'::jsonb,
  p_correspondences jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_allowed_cols text[] := array[
    'record_type','source_system','owner_user_id','pipeline','stage','stage_semantic',
    'temperature','sale_type','channel','currency','closed','value','mrr',
    'responsible_id','operation_id','related_lead_id','lead_time_days',
    'closed_at','opened_at','source_created_at','source_modified_at',
    'created_at','updated_at','last_synced_at'
  ];
  v_num_cols  text[] := array['value','mrr','lead_time_days'];
  v_date_cols text[] := array[
    'closed_at','opened_at','source_created_at','source_modified_at',
    'created_at','updated_at','last_synced_at'
  ];
  v_select_parts text[] := array[]::text[];
  v_group_parts  text[] := array[]::text[];
  v_where_parts  text[] := array[]::text[];
  v_item jsonb;
  v_field text; v_transform text; v_agg text; v_alias text;
  v_expr text; v_op text; v_val jsonb;
  v_sql text; v_result jsonb; v_idx int;
begin
  if p_source is distinct from 'records' then
    raise exception 'Fonte não suportada: %', p_source;
  end if;

  -- ===== Dimensões =====
  v_idx := 0;
  for v_item in select value from jsonb_array_elements(coalesce(p_dimensions, '[]'::jsonb))
  loop
    v_idx := v_idx + 1;
    v_field := v_item->>'field';
    v_transform := coalesce(v_item->>'transform', 'none');
    if v_field is null then raise exception 'Dimensão sem "field"'; end if;

    if v_field like 'unified:%' then
      v_expr := public._widget_unified_expr(substring(v_field from 9), p_correspondences, false);
    elsif v_field like 'custom:%' then
      v_expr := format('(custom_fields ->> %L)', substring(v_field from 8));
    elsif v_field = any(v_allowed_cols) then
      if v_transform <> 'none' then
        if not (v_field = any(v_date_cols)) then
          raise exception 'transform "%" exige coluna de data', v_transform;
        end if;
        if v_transform not in ('day','week','month','quarter','year') then
          raise exception 'transform inválido: %', v_transform;
        end if;
        v_expr := format('date_trunc(%L, %I)', v_transform, v_field);
      else
        v_expr := format('%I', v_field);
      end if;
    else
      raise exception 'Coluna de dimensão não permitida: %', v_field;
    end if;

    v_alias := 'dim_' || v_idx;
    v_select_parts := v_select_parts || format('%s as %I', v_expr, v_alias);
    v_group_parts  := v_group_parts || v_expr;
  end loop;

  -- ===== Métricas =====
  v_idx := 0;
  for v_item in select value from jsonb_array_elements(coalesce(p_metrics, '[]'::jsonb))
  loop
    v_idx := v_idx + 1;
    v_field := v_item->>'field';
    v_agg := lower(coalesce(v_item->>'agg', 'count'));
    if v_agg not in ('sum','count','avg') then
      raise exception 'Agregação inválida: %', v_agg;
    end if;
    v_alias := 'metric_' || v_idx;

    if v_agg = 'count' then
      if v_field is null or v_field = '*' then
        v_expr := 'count(*)';
      elsif v_field like 'unified:%' then
        v_expr := format('count(%s)', public._widget_unified_expr(substring(v_field from 9), p_correspondences, false));
      elsif v_field like 'custom:%' then
        v_expr := format('count(custom_fields ->> %L)', substring(v_field from 8));
      elsif v_field = any(v_allowed_cols) then
        v_expr := format('count(%I)', v_field);
      else
        raise exception 'Coluna de métrica não permitida: %', v_field;
      end if;
    else
      if v_field like 'unified:%' then
        v_expr := format('%s(%s)', v_agg, public._widget_unified_expr(substring(v_field from 9), p_correspondences, true));
      elsif v_field like 'custom:%' then
        v_expr := format('%s(nullif(custom_fields ->> %L, %L)::numeric)', v_agg, substring(v_field from 8), '');
      elsif v_field = any(v_num_cols) then
        v_expr := format('%s(%I)', v_agg, v_field);
      else
        raise exception 'Métrica %/% requer coluna numérica', v_agg, coalesce(v_field, 'null');
      end if;
    end if;

    v_select_parts := v_select_parts || format('%s as %I', v_expr, v_alias);
  end loop;

  if array_length(v_select_parts, 1) is null then
    raise exception 'Widget sem dimensões nem métricas';
  end if;

  -- ===== Filtros =====
  for v_item in select value from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb))
  loop
    v_field := v_item->>'field';
    v_op := lower(coalesce(v_item->>'op', 'eq'));
    v_val := v_item->'value';
    if v_field is null then raise exception 'Filtro sem "field"'; end if;

    if v_field like 'unified:%' then
      v_expr := public._widget_unified_expr(substring(v_field from 9), p_correspondences, false);
    elsif v_field like 'custom:%' then
      v_expr := format('(custom_fields ->> %L)', substring(v_field from 8));
    elsif v_field = any(v_allowed_cols) then
      v_expr := format('%I', v_field);
    else
      raise exception 'Coluna de filtro não permitida: %', v_field;
    end if;

    if v_op = 'is_null' then
      v_where_parts := v_where_parts || format('%s is null', v_expr);
    elsif v_op = 'not_null' then
      v_where_parts := v_where_parts || format('%s is not null', v_expr);
    elsif v_op = 'in' then
      v_where_parts := v_where_parts || format(
        '%s in (select jsonb_array_elements_text(%L::jsonb))', v_expr, coalesce(v_val, '[]'::jsonb)::text
      );
    else
      v_op := case v_op
        when 'eq'  then '='
        when 'neq' then '<>'
        when 'gt'  then '>'
        when 'gte' then '>='
        when 'lt'  then '<'
        when 'lte' then '<='
        else null
      end;
      if v_op is null then raise exception 'Operador inválido'; end if;
      v_where_parts := v_where_parts || format('%s %s %L', v_expr, v_op,
        case when jsonb_typeof(v_val) = 'string' then v_val #>> '{}' else v_val::text end);
    end if;
  end loop;

  -- ===== Monta e executa =====
  v_sql := 'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select '
        || array_to_string(v_select_parts, ', ')
        || ' from public.records';
  if array_length(v_where_parts, 1) is not null then
    v_sql := v_sql || ' where ' || array_to_string(v_where_parts, ' and ');
  end if;
  if array_length(v_group_parts, 1) is not null then
    v_sql := v_sql || ' group by ' || array_to_string(v_group_parts, ', ');
  end if;
  v_sql := v_sql || ') t';

  execute v_sql into v_result;
  return coalesce(v_result, '[]'::jsonb);
end;
$$;

grant execute on function public.run_widget_query(text, jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public._widget_col_expr(text, boolean) to authenticated;
grant execute on function public._widget_unified_expr(text, jsonb, boolean) to authenticated;


-- >>>>>>>>>>>>>>>>>>>> migrations/0021_widget_sources.sql <<<<<<<<<<<<<<<<<<<<
-- Versão: 1.0 | Data: 09/07/2026
-- Fase 8: seleção de fontes por widget. `sources` guarda quais fontes o widget
-- usa (subconjunto de 'leads'|'deals'|'estudo'; vazio = todas). `split_by_source`
-- liga o modo "quebrar por fonte" (série por fonte) em vez de combinar tudo.
-- Idempotente.

alter table public.widgets
  add column if not exists sources jsonb not null default '[]'::jsonb,
  add column if not exists split_by_source boolean not null default false;


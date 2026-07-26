-- Versão: 1.0 | Data: 26/07/2026
-- Parcerias (fase A): os helpers de registro casado passam a resolver a fonte
-- do ref `match:<fonte>:<ref>` por LOOKUP em data_sources (key -> record_type),
-- com fallback no mapeamento histórico dos builtins — antes o `case` hardcoded
-- (leads/deals/estudo) erguia exceção para QUALQUER base criada em
-- Configurações -> Bases, quebrando widget agregado com campo `↪` de base
-- dinâmica (ex.: `match:parceiros:title`). Corpos idênticos aos vigentes
-- (0042 base / 0056 snap) fora do lookup; volatilidade immutable -> stable
-- (agora leem tabela). Espelhamento fiscalizado por tests/rpc-parity.test.ts.
-- Sub-fontes NÃO casam (compartilham o record_type da pai): o client não gera
-- mais refs `match:<sub>:*` (buildMatchFields filtra raízes) e a key de uma
-- sub não existe em data_sources — um ref desses segue caindo na exceção.
-- Idempotente (create or replace).

-- ---- Helper base: match:<fonte>:<ref> -> subconsulta escalar segura ----
create or replace function public._widget_match_expr(p_spec text, p_numeric boolean)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_pos int := position(':' in p_spec);
  v_src text;
  v_ref text;
  v_rt text;
  v_inner text;
  v_match_sub text;
  v_lead_sub text;
begin
  if v_pos = 0 then
    raise exception 'match: sem "<fonte>:<campo>" — %', p_spec;
  end if;
  v_src := substring(p_spec from 1 for v_pos - 1);
  v_ref := substring(p_spec from v_pos + 1);
  select ds.record_type into v_rt from public.data_sources ds where ds.key = v_src;
  if v_rt is null then
    v_rt := case v_src
      when 'leads' then 'lead'
      when 'deals' then 'negocio'
      when 'estudo' then 'venda_site'
      else null
    end;
  end if;
  if v_rt is null then
    raise exception 'Fonte de match inválida: %', v_src;
  end if;

  -- Coluna do registro casado (mm). _widget_col_expr devolve refs sem qualificar;
  -- dentro da subconsulta só mm (public.records) tem essas colunas.
  v_inner := public._widget_col_expr(v_ref, p_numeric);

  -- O SELECT do valor tem SÓ public.records mm no FROM (assim v_inner, sem
  -- qualificar, resolve para mm — evita ambiguidade com colunas homônimas de
  -- record_matches, ex.: created_at). A escolha do parceiro (prioriza manual,
  -- depois mais recente, filtra pela fonte alvo) vai numa subconsulta interna.
  v_match_sub :=
    '(select ' || v_inner || ' from public.records mm where mm.id = (' ||
    'select case when rm.record_a_id = records.id then rm.record_b_id' ||
    '   else rm.record_a_id end' ||
    ' from public.record_matches rm' ||
    ' join public.records p on p.id = (case when rm.record_a_id = records.id' ||
    '   then rm.record_b_id else rm.record_a_id end)' ||
    ' where (rm.record_a_id = records.id or rm.record_b_id = records.id)' ||
    '   and p.record_type = ' || quote_literal(v_rt) ||
    ' order by (rm.mode = ''manual'') desc, rm.created_at desc limit 1))';

  if v_rt = 'lead' then
    v_lead_sub :=
      '(select ' || v_inner ||
      ' from public.records mm where mm.id = records.related_lead_id)';
    return 'coalesce(' || v_match_sub || ', ' || v_lead_sub || ')';
  end if;

  return v_match_sub;
end;
$$;

grant execute on function public._widget_match_expr(text, boolean) to authenticated;

-- ---- Helper snapshot: espelho sobre as tabelas congeladas ----
-- Mesmo corpo, com snapshot_records/snapshot_record_matches e a correlação
-- extra por snapshot_id em cada nível (divergências allowlistadas no teste).
create or replace function public._widget_match_expr_snap(p_spec text, p_numeric boolean)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_pos int := position(':' in p_spec);
  v_src text;
  v_ref text;
  v_rt text;
  v_inner text;
  v_match_sub text;
  v_lead_sub text;
begin
  if v_pos = 0 then
    raise exception 'match: sem "<fonte>:<campo>" — %', p_spec;
  end if;
  v_src := substring(p_spec from 1 for v_pos - 1);
  v_ref := substring(p_spec from v_pos + 1);
  select ds.record_type into v_rt from public.data_sources ds where ds.key = v_src;
  if v_rt is null then
    v_rt := case v_src
      when 'leads' then 'lead'
      when 'deals' then 'negocio'
      when 'estudo' then 'venda_site'
      else null
    end;
  end if;
  if v_rt is null then
    raise exception 'Fonte de match inválida: %', v_src;
  end if;

  v_inner := public._widget_col_expr(v_ref, p_numeric);

  v_match_sub :=
    '(select ' || v_inner || ' from public.snapshot_records mm' ||
    ' where mm.snapshot_id = records.snapshot_id and mm.id = (' ||
    'select case when rm.record_a_id = records.id then rm.record_b_id' ||
    '   else rm.record_a_id end' ||
    ' from public.snapshot_record_matches rm' ||
    ' join public.snapshot_records p on p.snapshot_id = records.snapshot_id' ||
    '   and p.id = (case when rm.record_a_id = records.id' ||
    '   then rm.record_b_id else rm.record_a_id end)' ||
    ' where rm.snapshot_id = records.snapshot_id' ||
    '   and (rm.record_a_id = records.id or rm.record_b_id = records.id)' ||
    '   and p.record_type = ' || quote_literal(v_rt) ||
    ' order by (rm.mode = ''manual'') desc, rm.created_at desc limit 1))';

  if v_rt = 'lead' then
    v_lead_sub :=
      '(select ' || v_inner || ' from public.snapshot_records mm' ||
      ' where mm.snapshot_id = records.snapshot_id' ||
      '   and mm.id = records.related_lead_id)';
    return 'coalesce(' || v_match_sub || ', ' || v_lead_sub || ')';
  end if;

  return v_match_sub;
end;
$$;

revoke execute on function public._widget_match_expr_snap(text, boolean) from public, anon, authenticated;
grant execute on function public._widget_match_expr_snap(text, boolean) to service_role;

-- Índice de apoio ao auto-match incremental pós-sync (lado A restrito por
-- last_synced_at dentro de um record_type).
create index if not exists idx_records_type_synced
  on public.records (record_type, last_synced_at);

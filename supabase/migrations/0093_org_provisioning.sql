-- Versão: 1.0 | Data: 23/07/2026
-- MULTI-ORGANIZAÇÃO (provisionamento): funções do console do Owner
-- (app/(owner)/owner) — chamadas EXCLUSIVAMENTE via service role (EXECUTE
-- revogado de anon/authenticated; o guard requireOwner() valida o Owner no
-- servidor antes de cada chamada).
--   * seed_org_defaults(p_org): infra INICIAL de uma organização nova — as
--     linhas core de field_definitions (0086) parametrizadas pela org, com
--     options do pipeline vazias (org nova não tem registros). A org NÃO
--     recebe nenhum dado da Zapper: catálogo de bases, campos custom,
--     dashboards etc. nascem vazios (RLS 0091 isola o resto).
--   * delete_organization(p_org): exclusão com cascade (FKs de organization_id
--     da 0090 + memberships) — liga o GUC transaction-local para atravessar os
--     triggers de proteção da 0089. A organização INICIAL (Zapper) não é
--     excluível pelo console (só via SQL direto — "a menos que pelo banco").
-- Idempotente.

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
end;
$$;

create or replace function public.delete_organization(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org = '00000000-0000-4000-a000-000000000001' then
    raise exception
      'A organização inicial não pode ser excluída pelo console (só via SQL direto)';
  end if;
  -- Atravessa os triggers de proteção (org_admin/organizations) SÓ nesta
  -- transação — o cascade das FKs de organization_id (0090) limpa os dados.
  perform set_config('app.allow_protected_change', 'on', true);
  delete from public.organizations where id = p_org;
end;
$$;

revoke execute on function public.seed_org_defaults(uuid) from public, anon, authenticated;
grant execute on function public.seed_org_defaults(uuid) to service_role;
revoke execute on function public.delete_organization(uuid) from public, anon, authenticated;
grant execute on function public.delete_organization(uuid) to service_role;

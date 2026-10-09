-- Versão: 1.0 | Data: 09/10/2026
-- 0152 — a leitura de volta do Bitrix sabe QUANDO o Tree foi ligado.
--
-- As atividades de acompanhamento passaram a nascer NO Bitrix (automação de
-- lá), e o sistema deixou de criá-las. A leitura de volta (0137,
-- lib/sync/bitrix/activity-inbound.ts v1.3) passou a importar a atividade
-- desconhecida só em registro com o atributo `tree` ATIVO e, das CONCLUÍDAS,
-- só as de até 30 dias antes da ativação. Para isso a RPC dos donos (0151)
-- devolve a data de ativação: `config.activatedAt` (gravada ao ligar/retomar o
-- atributo) ou, nas linhas antigas, `created_at`.
--
-- O tipo de retorno muda, então a função é DERRUBADA e recriada (create or
-- replace não troca colunas de uma função `returns table`). Mesmo corpo da
-- 0151 fora a coluna nova. RPCs de widget INTOCADAS. Idempotente.

drop function if exists public.activity_inbound_owners(int);

create function public.activity_inbound_owners(p_max int default 400)
returns table (
  record_id uuid,
  organization_id uuid,
  record_type text,
  source_id text,
  entity text,
  tree boolean,
  tree_activated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with cand as (
    select t.record_id, false as tree, null::timestamptz as activated_at
      from public.tasks t
     where t.bitrix_activity_id is not null
       and t.completed_at is null
       and t.record_id is not null
    union all
    select a.record_id, true as tree,
           coalesce(
             case
               when (a.config->>'activatedAt') ~ '^\d{4}-\d{2}-\d{2}'
               then (a.config->>'activatedAt')::timestamptz
             end,
             a.created_at
           ) as activated_at
      from public.record_attributes a
     where a.attribute_key = 'tree'
       and a.status = 'ativo'
  ),
  ids as (
    select c.record_id, bool_or(c.tree) as tree, max(c.activated_at) as activated_at
      from cand c
     group by c.record_id
  )
  select r.id, r.organization_id, r.record_type, r.source_id,
         s.bitrix_activity_owner, i.tree, i.activated_at
    from ids i
    join public.records r on r.id = i.record_id
    join public.data_sources s on s.record_type = r.record_type
   where r.source_id is not null
     and s.bitrix_activity_owner is not null
   order by r.id
   limit greatest(p_max, 0);
$$;
revoke all on function public.activity_inbound_owners(int) from public, anon, authenticated;
grant execute on function public.activity_inbound_owners(int) to service_role;

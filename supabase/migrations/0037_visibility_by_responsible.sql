-- Versão: 1.0 | Data: 12/07/2026
-- Visibilidade de `records` passa a seguir o vínculo VIVO
-- record.responsible_id -> responsibles.user_id, em vez do snapshot owner_user_id
-- (que envelhecia: uma reatribuição p/ responsável sem usuário deixava o dono
-- antigo enxergando o registro). Vincular um usuário a um responsável libera os
-- registros na hora, sem re-sync. Idempotente (create or replace / drop policy).

-- ===================== Helper: responsáveis do usuário logado =====================
-- Ids de responsibles vinculados ao usuário atual (1 usuário -> vários responsáveis).
-- security definer p/ ler responsibles sem depender da RLS da tabela.
create or replace function public.auth_responsible_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id
  from public.responsibles r
  where r.user_id = (select auth.uid());
$$;

grant execute on function public.auth_responsible_ids() to authenticated, anon;

-- ===================== records: visão e edição por responsável =====================
-- Substitui `owner_user_id = auth.uid()` pelo vínculo vivo via responsável.
-- Mantém view_all_records / edit_record_values como estavam (gestor/admin veem tudo).
drop policy if exists records_select on public.records;
create policy records_select on public.records for select to authenticated
  using (
    public.auth_has_permission('view_all_records')
    or responsible_id in (select public.auth_responsible_ids())
  );

drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated
  using (
    public.auth_has_permission('edit_record_values')
    and (
      public.auth_has_permission('view_all_records')
      or responsible_id in (select public.auth_responsible_ids())
    )
  )
  with check (
    public.auth_has_permission('edit_record_values')
    and (
      public.auth_has_permission('view_all_records')
      or responsible_id in (select public.auth_responsible_ids())
    )
  );

-- ===================== Backfill dos vínculos atuais =====================
-- Preserva quem já enxerga hoje: copia bitrix_user_map (bitrix_id -> user_id) para
-- responsibles.user_id (casando por bitrix_user_id). A partir daqui, a fonte da
-- verdade do vínculo é responsibles.user_id.
update public.responsibles r
set user_id = m.user_id
from public.bitrix_user_map m
where m.bitrix_id = r.bitrix_user_id
  and m.user_id is not null
  and r.user_id is distinct from m.user_id;

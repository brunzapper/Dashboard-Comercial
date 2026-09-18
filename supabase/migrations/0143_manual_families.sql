-- 0143 — FAMÍLIAS DA BASE MANUAL: o mesmo número repartido, e níveis que não somam
-- Versão: 1.0 | Data: 18/09/2026
--
-- POR QUE EXISTE. A Base manual (0142) é uma lista PLANA: vários lançamentos do
-- mesmo dado SOMAM. Só que estas quatro linhas são QUATRO LEITURAS DO MESMO
-- 1000, não quatro números:
--
--   total .................. 1000
--   por canal .............. 500 ligação + 500 e-mail
--   por responsável ........ 200 Paulo + 400 Gabriella + 350 Daniela + 50 sem resp.
--   canal × responsável .... 100 + 250 + 150
--
-- Na base plana, lançar as quatro daria 3500. Daí o conceito que esta migração
-- introduz e a regra que o acompanha:
--
--   * FAMÍLIA (`manual_families`) — um eixo categórico ("Canal"). É da
--     ORGANIZAÇÃO e reutilizável: a dimensão `manualdim:<chave>` tem UM
--     significado no dashboard inteiro, e é isso que permite um gráfico
--     repartir dois dados diferentes pelo mesmo eixo.
--   * MEMBRO (`manual_family_members`) — um valor do eixo. `sort_order` é a
--     ordem das barras no gráfico.
--   * COORDENADA (`manual_entries.coords`) — o que UM lançamento endereça.
--   * NÍVEL — o CONJUNTO de famílias que um lançamento endereça (as chaves de
--     `coords`). **NÍVEIS NUNCA SOMAM ENTRE SI**: uma consulta escolhe UM nível
--     e lê só os lançamentos dele (`lib/manual-base/levels.ts`).
--
-- O QUE É LOAD-BEARING AQUI:
--
-- 1) `coords` é jsonb E ENTRA NO ÍNDICE ÚNICO. O jsonb normaliza ordem de
--    chaves, espaços e duplicatas na serialização, então ele mesmo é a forma
--    canônica — não há coluna denormalizada com dever de espelho entre SQL e
--    TypeScript, e `ON CONFLICT (…, coords)` infere este índice normalmente.
--    É o que mantém viva a história do UPSERT da 0142 ("relançar a tabela do
--    mês ATUALIZA, não dobra").
--
-- 2) `coords` tem DUAS formas de vazio, e a distinção é a feature inteira:
--    chave AUSENTE = o lançamento não endereça a família (outro nível);
--    valor `null`  = endereça o RESIDUAL dela ("50 sem responsável direto" é um
--    grupo de 50, não a ausência de informação). `'{"resp":null}'::jsonb` e
--    `'{}'::jsonb` são valores DISTINTOS, então o índice os trata como slots
--    diferentes sem nenhum sentinela de texto.
--
-- 3) `coords not null default '{}'` ⇒ **toda linha existente entra no nível ∅ e
--    a unicidade não muda para ninguém**. Nenhuma migração de dados, e nenhuma
--    inferência de nível a partir de `responsible_id is not null` — isso
--    mudaria o número de bases já em uso. Quem opta pelo modelo hierárquico é a
--    DECLARAÇÃO (`manual_series_families`), explícita.
--
-- 4) As duas FKs (`responsible_id`, `operation_id`) CONTINUAM no índice: um
--    lançamento de nível ∅ atribuído ao Paulo e outro à Gabriella são slots
--    distintos. E as famílias EMBUTIDAS `responsavel`/`operacao` (constantes em
--    `lib/manual-base/families.ts`, registry em CÓDIGO no molde do
--    `loadMappingDomains`) usam essas colunas como ESPELHO da coordenada — é o
--    que mantém a projeção sobre as dimensões de registro e o dobramento
--    apelido→principal (0101) funcionando sem tocar em `buckets.ts`.
--
-- NÃO RECRIA `run_widget_query`/`run_widget_query_snapshot` (invariante 1): a
-- Base manual não é `data_sources`, não tem `record_type` e nunca entra em
-- `widgets.sources`; toda a resolução é no ENGINE. `snapshot_refresh_copy` é
-- recriado inteiro, e ele não é RPC de widget — a invariante 1 não é acionada.
--
-- Idempotente. Aplicar ANTES do deploy (invariante 6).

-- ===================== 1) manual_families =====================
-- `key` é IMUTÁVEL (a UI não a edita): ela é o <chave> de `manualdim:<chave>`
-- numa dimensão gravada. Mudá-la orfanaria widgets em silêncio — mesma razão do
-- `manual_series.key` e do `presetKey`. O rótulo é livre.
create table if not exists public.manual_families (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.organizations (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null,
  sort_order integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_manual_families_org_key
  on public.manual_families (organization_id, key);

drop trigger if exists trg_manual_families_updated on public.manual_families;
create trigger trg_manual_families_updated
  before update on public.manual_families
  for each row execute function public.set_updated_at();

-- ===================== 2) manual_family_members =====================
-- `key` também IMUTÁVEL: ela é o VALOR gravado num filtro de widget e no ref
-- com escopo `manual:<dado>@<familia>=<membro>`. Renomear "Ligação" para
-- "Telefone" é mudança de rótulo, nunca de chave.
create table if not exists public.manual_family_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.organizations (id) on delete cascade,
  family_id uuid not null references public.manual_families (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null,
  sort_order integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_manual_family_members_key
  on public.manual_family_members (family_id, key);

create index if not exists idx_manual_family_members_family
  on public.manual_family_members (organization_id, family_id, sort_order);

drop trigger if exists trg_manual_family_members_updated on public.manual_family_members;
create trigger trg_manual_family_members_updated
  before update on public.manual_family_members
  for each row execute function public.set_updated_at();

-- ===================== 3) manual_series_families =====================
-- O DADO DECLARA suas famílias. Esta tabela é o OPT-IN EXPLÍCITO, e é o que faz
-- a compatibilidade ser estrutural em vez de uma flag: sem declaração, todo
-- lançamento do dado está no nível ∅ e a soma da 0142 continua valendo —
-- inclusive para lançamentos que JÁ têm `responsible_id` preenchido.
--
-- `family_key` NÃO é FK de propósito: ela pode nomear uma família EMBUTIDA
-- (`responsavel`/`operacao`), que vive em código e não tem linha aqui — mesmo
-- padrão do registry código ∪ banco de `mapping_domains` (0119).
--
-- Ela também (a) desenha as colunas de coordenada na grade, (b) limita os
-- níveis candidatos e (c) limita a emissão dos operandos com escopo no
-- catálogo (sem ela seriam dados × famílias × membros).
create table if not exists public.manual_series_families (
  organization_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.organizations (id) on delete cascade,
  series_id uuid not null references public.manual_series (id) on delete cascade,
  family_key text not null check (family_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (series_id, family_key)
);

create index if not exists idx_manual_series_families_org
  on public.manual_series_families (organization_id, series_id, sort_order);

-- ===================== 4) coords no lançamento =====================
alter table public.manual_entries
  add column if not exists coords jsonb not null default '{}'::jsonb;

-- Objeto, sempre. `not valid` para não varrer a tabela agora; validar no
-- runbook quando conveniente (nenhuma linha existente viola: o default é '{}').
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'manual_entries_coords_object'
      and conrelid = 'public.manual_entries'::regclass
  ) then
    alter table public.manual_entries
      add constraint manual_entries_coords_object
      check (jsonb_typeof(coords) = 'object') not valid;
  end if;
end $$;

-- O índice natural ganha `coords`. Linha legada tem `coords = '{}'`, então a
-- semântica não muda para ela. `nulls not distinct` segue pelas FKs, com a
-- mesma razão da 0142: "sem operação" é UMA atribuição, não infinitas.
drop index if exists public.uq_manual_entries_slot;
create unique index if not exists uq_manual_entries_slot
  on public.manual_entries (
    organization_id, series_id, period_start, period_end,
    responsible_id, operation_id, coords
  ) nulls not distinct;

-- ===================== 5) RLS =====================
-- Espelho literal da 0142: ler é de qualquer membro da org; escrever pede
-- `edit_record_values` (o mesmo gate dos registros manuais). EXCLUIR uma
-- FAMÍLIA é admin, pela mesma razão de excluir um DADO: leva os membros junto e
-- deixa `coords` órfãs e widgets exibindo "—". Excluir um MEMBRO é
-- `edit_record_values` (é linha de catálogo, como um lançamento), com bloqueio
-- em uso na action — o gate dá a mensagem, a policy dá a garantia.
alter table public.manual_families enable row level security;
alter table public.manual_family_members enable row level security;
alter table public.manual_series_families enable row level security;

drop policy if exists manual_families_select on public.manual_families;
create policy manual_families_select on public.manual_families
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists manual_families_insert on public.manual_families;
create policy manual_families_insert on public.manual_families
  for insert to authenticated
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('edit_record_values'))
  );

drop policy if exists manual_families_update on public.manual_families;
create policy manual_families_update on public.manual_families
  for update to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('edit_record_values'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('edit_record_values'))
  );

drop policy if exists manual_families_delete on public.manual_families;
create policy manual_families_delete on public.manual_families
  for delete to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  );

drop policy if exists manual_family_members_select on public.manual_family_members;
create policy manual_family_members_select on public.manual_family_members
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists manual_family_members_write on public.manual_family_members;
create policy manual_family_members_write on public.manual_family_members
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('edit_record_values'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('edit_record_values'))
  );

drop policy if exists manual_series_families_select on public.manual_series_families;
create policy manual_series_families_select on public.manual_series_families
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists manual_series_families_write on public.manual_series_families;
create policy manual_series_families_write on public.manual_series_families
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('edit_record_values'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('edit_record_values'))
  );

-- ===================== 6) Espelhos congelados =====================
-- Mesmo molde dos da 0142: o viewer público lê DAQUI, e editar a base depois
-- não mexe no link já enviado. Sem policies — service role apenas.
-- NOTA: snapshot capturado ANTES desta migração tem famílias vazias, então um
-- eixo de família nele degrada para "—". É a consequência correta de "o link
-- compartilhado é um RETRATO"; passthrough contradiria o §4.26.
create table if not exists public.snapshot_manual_families (
  snapshot_id uuid not null references public.snapshots (id) on delete cascade,
  id uuid not null,
  key text not null,
  label text not null,
  sort_order integer not null default 0,
  primary key (snapshot_id, id)
);

create table if not exists public.snapshot_manual_family_members (
  snapshot_id uuid not null references public.snapshots (id) on delete cascade,
  id uuid not null,
  family_id uuid not null,
  key text not null,
  label text not null,
  sort_order integer not null default 0,
  primary key (snapshot_id, id)
);

create table if not exists public.snapshot_manual_series_families (
  snapshot_id uuid not null references public.snapshots (id) on delete cascade,
  series_id uuid not null,
  family_key text not null,
  sort_order integer not null default 0,
  primary key (snapshot_id, series_id, family_key)
);

create index if not exists idx_snapshot_manual_family_members_family
  on public.snapshot_manual_family_members (snapshot_id, family_id);

alter table public.snapshot_manual_entries
  add column if not exists coords jsonb not null default '{}'::jsonb;

alter table public.snapshot_manual_families enable row level security;
alter table public.snapshot_manual_family_members enable row level security;
alter table public.snapshot_manual_series_families enable row level security;

-- ===================== 7) snapshot_refresh_copy =====================
-- Corpo da 0142 (versão vigente) + as famílias e as coordenadas.
create or replace function public.snapshot_refresh_copy(p_snapshot_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_snap public.snapshots%rowtype;
  v_org uuid;
  v_rows integer := 0;
begin
  select * into v_snap from public.snapshots where id = p_snapshot_id;
  if not found then
    raise exception 'Snapshot inexistente: %', p_snapshot_id;
  end if;

  delete from public.snapshot_record_matches where snapshot_id = p_snapshot_id;
  delete from public.snapshot_records where snapshot_id = p_snapshot_id;
  delete from public.snapshot_manual_entries where snapshot_id = p_snapshot_id;
  delete from public.snapshot_manual_series_families where snapshot_id = p_snapshot_id;
  delete from public.snapshot_manual_family_members where snapshot_id = p_snapshot_id;
  delete from public.snapshot_manual_families where snapshot_id = p_snapshot_id;
  delete from public.snapshot_manual_series where snapshot_id = p_snapshot_id;

  -- Linhas de dados: records dentro das restrições (null = sem restrição) OU
  -- mocks de Data Reunião (sempre — a regra 0052 decide na consulta quando
  -- eles contam; is_mock é copiado como está).
  insert into public.snapshot_records (
    snapshot_id, id, record_type, source_system, owner_user_id, title, pipeline,
    stage, stage_semantic, temperature, value, mrr, currency, sale_type, channel,
    closed, closed_at, opened_at, source_created_at, source_modified_at,
    custom_fields, created_at, updated_at, last_synced_at, locally_modified_at,
    responsible_id, operation_id, related_lead_id, lead_time_days, is_mock,
    partner_only
  )
  select
    p_snapshot_id, r.id, r.record_type, r.source_system, r.owner_user_id,
    r.title, r.pipeline, r.stage, r.stage_semantic, r.temperature, r.value,
    r.mrr, r.currency, r.sale_type, r.channel, r.closed, r.closed_at,
    r.opened_at, r.source_created_at, r.source_modified_at, r.custom_fields,
    r.created_at, r.updated_at, r.last_synced_at, r.locally_modified_at,
    r.responsible_id, r.operation_id, r.related_lead_id, r.lead_time_days,
    r.is_mock, false
  from public.records r
  -- 0121: a lixeira fica fora do dataset congelado (defesa em profundidade
  -- também para mocks — a action de lixeira já os pula).
  where r.deleted_at is null
    and (r.is_mock
     or ((v_snap.allowed_sources is null
          or r.record_type = any (v_snap.allowed_sources))
     and (v_snap.allowed_responsible_ids is null
          or r.responsible_id = any (v_snap.allowed_responsible_ids))
     and (v_snap.allowed_operation_ids is null
          or r.operation_id = any (v_snap.allowed_operation_ids))));

  get diagnostics v_rows = row_count;

  -- Matches com ao menos um lado dentro do snapshot.
  insert into public.snapshot_record_matches
    (snapshot_id, record_a_id, record_b_id, mode, created_at)
  select p_snapshot_id, rm.record_a_id, rm.record_b_id, rm.mode, rm.created_at
  from public.record_matches rm
  where exists (
    select 1 from public.snapshot_records sr
    where sr.snapshot_id = p_snapshot_id
      and sr.id in (rm.record_a_id, rm.record_b_id)
  );

  -- Parceiros ausentes (lado de fora dos matches + related_lead_id): entram
  -- SÓ para resolver colunas match:<fonte>:<ref>, marcados partner_only.
  insert into public.snapshot_records (
    snapshot_id, id, record_type, source_system, owner_user_id, title, pipeline,
    stage, stage_semantic, temperature, value, mrr, currency, sale_type, channel,
    closed, closed_at, opened_at, source_created_at, source_modified_at,
    custom_fields, created_at, updated_at, last_synced_at, locally_modified_at,
    responsible_id, operation_id, related_lead_id, lead_time_days, is_mock,
    partner_only
  )
  select
    p_snapshot_id, r.id, r.record_type, r.source_system, r.owner_user_id,
    r.title, r.pipeline, r.stage, r.stage_semantic, r.temperature, r.value,
    r.mrr, r.currency, r.sale_type, r.channel, r.closed, r.closed_at,
    r.opened_at, r.source_created_at, r.source_modified_at, r.custom_fields,
    r.created_at, r.updated_at, r.last_synced_at, r.locally_modified_at,
    r.responsible_id, r.operation_id, r.related_lead_id, r.lead_time_days,
    r.is_mock, true
  from public.records r
  where r.id in (
      select m.record_a_id from public.snapshot_record_matches m
      where m.snapshot_id = p_snapshot_id
      union
      select m.record_b_id from public.snapshot_record_matches m
      where m.snapshot_id = p_snapshot_id
      union
      select sr.related_lead_id from public.snapshot_records sr
      where sr.snapshot_id = p_snapshot_id and sr.related_lead_id is not null
    )
    and not exists (
      select 1 from public.snapshot_records sr2
      where sr2.snapshot_id = p_snapshot_id and sr2.id = r.id
    );

  -- 0142: Base manual da ORG DO DASHBOARD, congelada inteira. Ela não conhece
  -- as restrições do snapshot (não tem record_type, e allowed_responsible_ids
  -- recortaria um lançamento não atribuído para fora sem que ninguém peça
  -- isso) — o recorte que vale é o do PERÍODO, aplicado na consulta.
  -- 0143: as famílias, os membros, a declaração por dado e as coordenadas vão
  -- junto — sem elas um eixo de família no link viraria "—".
  select d.organization_id into v_org
  from public.dashboards d where d.id = v_snap.dashboard_id;

  if v_org is not null then
    insert into public.snapshot_manual_series
      (snapshot_id, id, key, label, default_spread, sort_order)
    select p_snapshot_id, s.id, s.key, s.label, s.default_spread, s.sort_order
    from public.manual_series s
    where s.organization_id = v_org;

    insert into public.snapshot_manual_families
      (snapshot_id, id, key, label, sort_order)
    select p_snapshot_id, f.id, f.key, f.label, f.sort_order
    from public.manual_families f
    where f.organization_id = v_org;

    insert into public.snapshot_manual_family_members
      (snapshot_id, id, family_id, key, label, sort_order)
    select p_snapshot_id, m.id, m.family_id, m.key, m.label, m.sort_order
    from public.manual_family_members m
    where m.organization_id = v_org;

    insert into public.snapshot_manual_series_families
      (snapshot_id, series_id, family_key, sort_order)
    select p_snapshot_id, sf.series_id, sf.family_key, sf.sort_order
    from public.manual_series_families sf
    where sf.organization_id = v_org;

    insert into public.snapshot_manual_entries (
      snapshot_id, id, series_id, period_start, period_end, value,
      responsible_id, operation_id, spread, note, coords
    )
    select
      p_snapshot_id, e.id, e.series_id, e.period_start, e.period_end, e.value,
      e.responsible_id, e.operation_id, e.spread, e.note, e.coords
    from public.manual_entries e
    where e.organization_id = v_org;
  end if;

  return v_rows;
end;
$$;

revoke execute on function public.snapshot_refresh_copy(uuid) from public, anon, authenticated;
grant execute on function public.snapshot_refresh_copy(uuid) to service_role;

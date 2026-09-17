-- 0142_manual_base.sql
-- Versão: 1.0 | Data: 17/09/2026
-- BASE MANUAL: números DIGITADOS que se misturam aos registros nas fórmulas.
--
-- Por que existe: nem toda métrica vale o custo de virar registro. "5.261
-- contas alcançadas por e-mail em agosto" é UM número, não 5.261 linhas — e
-- sem lugar para ele, o dashboard simplesmente não fala de mensageria. O
-- pedido é poder dividir registros vindos do Sync por um número digitado à mão
-- ("conversão = negócios fechados ÷ e-mails respondidos"), o que obriga o
-- número manual a ser um OPERANDO de primeira classe, não uma anotação.
--
-- É GLOBAL por organização, porém OCULTA: não é linha de `data_sources`, não
-- tem `record_type` e nunca entra em `widgets.sources`. Por isso NÃO aciona
-- `planSourceLegs` nem o par `run_widget_query`/`_snapshot`, que ficam
-- INTOCADOS (invariante 1). Toda a resolução é no ENGINE — lib/manual-base/*.
--
-- Dois objetos, e a distinção é load-bearing:
--   * manual_series  — o DADO nomeado. A `key` é o <chave> do ref
--     `manual:<chave>` que as fórmulas citam; renomear o RÓTULO nunca move a
--     chave (mesma razão do presetKey: o ref gravado sobreviveria à edição).
--   * manual_entries — o LANÇAMENTO: valor, período próprio e, opcionalmente,
--     responsável/operação. Vários lançamentos do mesmo dado SOMAM.
--
-- A unicidade de (dado, período, atribuição) é o que faz "ir atualizando
-- conforme o mês avança" ser um UPSERT em vez de uma segunda linha — na mão e
-- pela IA. `nulls not distinct` porque "sem operação" é UMA atribuição, não
-- infinitas.
--
-- SNAPSHOT: congelado na CAPTURA (decisão de produto — o link enviado é um
-- retrato). Espelhos `snapshot_manual_*` + `snapshot_refresh_copy` recriado
-- inteiro. Ele não é RPC de widget: não aciona a invariante 1.
--
-- Idempotente. Aplicar ANTES do deploy do código (invariante 6).

-- ===================== 1) manual_series =====================
create table if not exists public.manual_series (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
    references public.organizations (id) on delete cascade,
  -- Mesma regra de slug de data_sources.key / mapping_domains.key. IMUTÁVEL na
  -- prática: é o que as fórmulas gravadas citam.
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null,
  -- Modo padrão dos lançamentos NOVOS deste dado. A decisão vale por LINHA
  -- (manual_entries.spread) — aqui é só a semente do formulário.
  default_spread text not null default 'ancora'
    check (default_spread in ('ancora', 'intersecao', 'contido', 'diario')),
  sort_order integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_manual_series_org_key
  on public.manual_series (organization_id, key);

drop trigger if exists trg_manual_series_updated on public.manual_series;
create trigger trg_manual_series_updated
  before update on public.manual_series
  for each row execute function public.set_updated_at();

-- ===================== 2) manual_entries =====================
create table if not exists public.manual_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
    references public.organizations (id) on delete cascade,
  series_id uuid not null references public.manual_series (id) on delete cascade,
  -- Datas de CALENDÁRIO (date, não timestamptz): o lançamento tem dia, não
  -- instante. É o que mantém o read side prefix-based (invariante 11) sem
  -- nenhuma ancoragem de fuso.
  period_start date not null,
  period_end date not null,
  constraint manual_entries_period_check check (period_end >= period_start),
  value numeric not null,
  responsible_id uuid references public.responsibles (id) on delete set null,
  operation_id uuid references public.operations (id) on delete set null,
  spread text not null default 'ancora'
    check (spread in ('ancora', 'intersecao', 'contido', 'diario')),
  note text,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Um número por dado × período × atribuição. É a trava que transforma
-- "relançar a tabela do mês" em atualização, e não em contagem dobrada.
create unique index if not exists uq_manual_entries_slot
  on public.manual_entries (
    organization_id, series_id, period_start, period_end,
    responsible_id, operation_id
  )
  nulls not distinct;

create index if not exists idx_manual_entries_series
  on public.manual_entries (organization_id, series_id, period_start);

drop trigger if exists trg_manual_entries_updated on public.manual_entries;
create trigger trg_manual_entries_updated
  before update on public.manual_entries
  for each row execute function public.set_updated_at();

-- ===================== 3) RLS =====================
-- Leitura: qualquer membro da org (os números alimentam os dashboards dela).
-- Escrita de LANÇAMENTO: quem já pode digitar valor de registro manual — é a
-- analogia mais próxima que existe, e é o gate que o widget "Base do
-- Dashboard" precisa para ser útil a quem opera.
-- Escrita de DADO: idem para criar/editar; EXCLUIR é admin, porque apagar um
-- dado derruba os lançamentos dele e deixa fórmulas gravadas órfãs.
alter table public.manual_series enable row level security;
alter table public.manual_entries enable row level security;

drop policy if exists manual_series_select on public.manual_series;
create policy manual_series_select on public.manual_series
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists manual_series_insert on public.manual_series;
create policy manual_series_insert on public.manual_series
  for insert to authenticated
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('edit_record_values'))
  );

drop policy if exists manual_series_update on public.manual_series;
create policy manual_series_update on public.manual_series
  for update to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('edit_record_values'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('edit_record_values'))
  );

drop policy if exists manual_series_delete on public.manual_series;
create policy manual_series_delete on public.manual_series
  for delete to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  );

drop policy if exists manual_entries_select on public.manual_entries;
create policy manual_entries_select on public.manual_entries
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists manual_entries_write on public.manual_entries;
create policy manual_entries_write on public.manual_entries
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('edit_record_values'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('edit_record_values'))
  );

-- ===================== 4) Espelhos congelados do snapshot =====================
-- Mesmo molde de snapshot_records: o viewer público lê DAQUI, e editar a base
-- depois não mexe no link já enviado. Sem policies — service role apenas
-- (o caminho público é app/s/[token] + service role após validar o token).
create table if not exists public.snapshot_manual_series (
  snapshot_id uuid not null references public.snapshots (id) on delete cascade,
  id uuid not null,
  key text not null,
  label text not null,
  default_spread text not null,
  sort_order integer not null default 0,
  primary key (snapshot_id, id)
);

create table if not exists public.snapshot_manual_entries (
  snapshot_id uuid not null references public.snapshots (id) on delete cascade,
  id uuid not null,
  series_id uuid not null,
  period_start date not null,
  period_end date not null,
  value numeric not null,
  responsible_id uuid,
  operation_id uuid,
  spread text not null,
  note text,
  primary key (snapshot_id, id)
);

create index if not exists idx_snapshot_manual_entries_series
  on public.snapshot_manual_entries (snapshot_id, series_id);

alter table public.snapshot_manual_series enable row level security;
alter table public.snapshot_manual_entries enable row level security;

-- ===================== 5) snapshot_refresh_copy =====================
-- Corpo da 0121 (versão vigente) + a Base manual da ORG do dashboard.
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
  select d.organization_id into v_org
  from public.dashboards d where d.id = v_snap.dashboard_id;

  if v_org is not null then
    insert into public.snapshot_manual_series
      (snapshot_id, id, key, label, default_spread, sort_order)
    select p_snapshot_id, s.id, s.key, s.label, s.default_spread, s.sort_order
    from public.manual_series s
    where s.organization_id = v_org;

    insert into public.snapshot_manual_entries (
      snapshot_id, id, series_id, period_start, period_end, value,
      responsible_id, operation_id, spread, note
    )
    select
      p_snapshot_id, e.id, e.series_id, e.period_start, e.period_end, e.value,
      e.responsible_id, e.operation_id, e.spread, e.note
    from public.manual_entries e
    where e.organization_id = v_org;
  end if;

  return v_rows;
end;
$$;

revoke execute on function public.snapshot_refresh_copy(uuid) from public, anon, authenticated;
grant execute on function public.snapshot_refresh_copy(uuid) to service_role;

-- ===================== 6) Sessão de IA da Base manual =====================
-- Molde da 0124 (operacao_ai_sessions): a ORG entra na PK porque a base é por
-- organização e um usuário multi-org veria numa org a prévia gerada na outra —
-- a RLS não pega isso, ele é membro das duas. UMA conversa por pessoa: o gestor
-- aparece em três superfícies (⋮ do dashboard, /registros/base-manual e o
-- widget), mas a base é uma só.
create table if not exists public.manual_base_ai_sessions (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Turnos do modelo (contrato interno) e o log exibido na tela.
  turns jsonb not null default '[]'::jsonb,
  chat jsonb not null default '[]'::jsonb,
  -- A prévia AINDA NÃO APLICADA. O servidor é dono dela: o apply lê DAQUI,
  -- nunca de um argumento do cliente.
  pending jsonb,
  -- Retrato pré-turno para o Desfazer.
  undo_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

drop trigger if exists trg_manual_base_ai_sessions_updated on public.manual_base_ai_sessions;
create trigger trg_manual_base_ai_sessions_updated
  before update on public.manual_base_ai_sessions
  for each row execute function public.set_updated_at();

alter table public.manual_base_ai_sessions enable row level security;

drop policy if exists manual_base_ai_sessions_own on public.manual_base_ai_sessions;
create policy manual_base_ai_sessions_own on public.manual_base_ai_sessions
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and organization_id in (select public.auth_org_ids())
  )
  with check (
    user_id = (select auth.uid())
    and organization_id in (select public.auth_org_ids())
  );

-- ===================== 7) Widget "Base do Dashboard" =====================
-- O CHECK de visual_type é sempre recriado INTEIRO, nunca alterado
-- (precedente literal da 0100 e da 0134). A configuração do widget vive em
-- widgets.settings.baseManual; os dados são as tabelas acima.
alter table public.widgets
  drop constraint if exists widgets_visual_type_check;

alter table public.widgets
  add constraint widgets_visual_type_check
  check (visual_type in (
    'tabela', 'barra', 'barra_horizontal', 'linha', 'pizza', 'kpi',
    'funil', 'filtro', 'filtro_campo', 'tabela_editavel', 'calculado',
    'calculadora', 'nota', 'forma', 'kanban', 'agenda', 'imagem',
    'linha_divisoria', 'tree', 'base_manual'
  ));

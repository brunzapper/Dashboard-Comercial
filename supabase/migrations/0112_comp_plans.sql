-- Versão: 1.0 | Data: 30/07/2026
-- Remuneração variável (Configurações → Remuneração):
-- (a) comp_plans — plano de remuneração por org: nome, base variável default e
--     `config` jsonb VERSIONADO ({v:1, factors:[...], memberIds?, totalFormula?})
--     com parse FAIL-CLOSED em lib/comp/model.ts (padrão kanban_automations).
--     Fatores guardam peso %, fórmula AGREGADA (realizado computado SÓ pelo
--     engine via runCalculatedWidget — RPCs de widget INTOCADOS), fontes,
--     cap/floor e o vínculo `metricKey` com o registry goal_metrics: os ALVOS
--     por pessoa×mês são LINHAS de `goals` (scope 'responsible', id CANÔNICO),
--     nunca colunas daqui — a área Metas gerencia os mesmos alvos.
-- (b) comp_entries — lançamento por (plano, responsável, ano, mês): base
--     individual (null = default do plano), `inputs` (overrides manuais +
--     bônus — SEM targets), `computed` (snapshot CRU do recompute:
--     {v, at, realized:{fid}, errors?}) e `total` EFETIVO derivado na leitura
--     por computeEntry (efetivo = manual ?? calculado; recompute nunca toca
--     inputs). `mirror_record_id` deduplica o registro publicado na Base
--     espelho "Remuneração" (records; publicação via createRecord/updateRecord
--     com o client RLS do admin — invariante 25).
-- Tabelas RAIZ org-scoped (0089-0091): sem pai derivável ⇒ carimbo de org na
-- ACTION via getActiveOrgId() (padrão 0111), sem trigger set_org. Fora de
-- PASSTHROUGH_TABLES ⇒ snapshots públicos nunca as leem. Sem acesso anon.
-- Acesso: escrita admin-only nas duas; leitura de comp_plans org-wide (o
-- vendedor precisa do DESENHO do plano p/ renderizar o próprio detalhamento);
-- leitura de comp_entries = admin OU o PRÓPRIO grupo canônico via
-- auth_responsible_ids() (0101 — cobre login vinculado a um apelido).
-- Idempotente.

-- ============ comp_plans (planos de remuneração variável) ============
create table if not exists public.comp_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
                    references public.organizations (id) on delete cascade,
  name text not null,
  active boolean not null default true,
  -- Base variável default (R$) — linha sem base própria herda daqui. Org que
  -- considere o valor sensível deixa null e digita a base por pessoa na grade.
  base_amount_default numeric,
  -- {v:1, factors:[{id,label,weightPct,metricKey,money?,formula,sources,
  --  filters?,capPct?,floorPct?}], memberIds?, totalFormula?}
  -- Parse FAIL-CLOSED em lib/comp/model.ts — config inválido nunca "roda como
  -- der". totalFormula (fórmula livre do total) avalia SÓ por evaluateFormula
  -- sobre o mapa comp:* montado em computeEntry (nunca parser paralelo).
  config jsonb not null default '{"v":1,"factors":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_comp_plans_org
  on public.comp_plans (organization_id);

drop trigger if exists trg_comp_plans_updated_at on public.comp_plans;
create trigger trg_comp_plans_updated_at
  before update on public.comp_plans
  for each row execute function public.set_updated_at();

alter table public.comp_plans enable row level security;

-- Org inteira lê o DESENHO do plano (rótulos/pesos/fórmulas/base default):
-- o vendedor renderiza o próprio detalhamento com ele. Valores por pessoa
-- ficam protegidos pela policy de comp_entries.
drop policy if exists comp_plans_select on public.comp_plans;
create policy comp_plans_select on public.comp_plans
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

-- Escrita admin-only (shape goals_write da 0091).
drop policy if exists comp_plans_write on public.comp_plans;
create policy comp_plans_write on public.comp_plans
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  );

revoke all on public.comp_plans from anon;

-- ============ comp_entries (lançamentos por responsável×mês) ============
create table if not exists public.comp_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
                    references public.organizations (id) on delete cascade,
  plan_id uuid not null references public.comp_plans (id) on delete cascade,
  responsible_id uuid not null references public.responsibles (id) on delete cascade,
  period_year int not null check (period_year between 2000 and 2100),
  period_month int not null check (period_month between 1 and 12),
  -- Base variável individual (R$); null = base_amount_default do plano.
  base_amount numeric,
  -- {overrides:{factors:{fid:{realized?,attainmentPct?,payout?}}, total?},
  --  bonuses:[{id,label,amount}], note?} — SEM targets (alvos vivem em goals).
  inputs jsonb not null default '{}'::jsonb,
  -- Snapshot CRU do recompute: {v:1, at, realized:{fid:num|null}, errors?}.
  -- Atingimento/valor/total efetivos são DERIVADOS na leitura (computeEntry).
  computed jsonb,
  -- Total EFETIVO (listagem/ordenação); regravado em todo save/recompute.
  total numeric,
  -- Registro publicado na Base espelho (dedup do Publicar). Registro apagado
  -- à mão ⇒ set null ⇒ o próximo Publicar recria.
  mirror_record_id uuid references public.records (id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Uma célula por (org, plano, responsável, ano, mês).
create unique index if not exists uq_comp_entries_cell
  on public.comp_entries (organization_id, plan_id, responsible_id, period_year, period_month);

-- Consulta canônica: grade do mês.
create index if not exists idx_comp_entries_month
  on public.comp_entries (organization_id, plan_id, period_year, period_month);

drop trigger if exists trg_comp_entries_updated_at on public.comp_entries;
create trigger trg_comp_entries_updated_at
  before update on public.comp_entries
  for each row execute function public.set_updated_at();

alter table public.comp_entries enable row level security;

-- Admin OU o PRÓPRIO: auth_responsible_ids() (0101) devolve o grupo canônico
-- do responsável vinculado ao uid — usuário ligado a um APELIDO enxerga a
-- linha do principal e vice-versa. Remuneração é dado sensível: NUNCA
-- afrouxar para org-wide.
drop policy if exists comp_entries_select on public.comp_entries;
create policy comp_entries_select on public.comp_entries
  for select to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (
      (select public.auth_has_role('admin'))
      or responsible_id in (select public.auth_responsible_ids())
    )
  );

-- Escrita admin-only.
drop policy if exists comp_entries_write on public.comp_entries;
create policy comp_entries_write on public.comp_entries
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  );

revoke all on public.comp_entries from anon;

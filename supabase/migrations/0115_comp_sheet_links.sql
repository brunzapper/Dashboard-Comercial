-- Versão: 1.0 | Data: 02/08/2026
-- Export da Remuneração p/ Google Planilhas via Apps Script Web App "execute
-- as: user accessing" — NENHUMA credencial Google no app; a planilha nasce no
-- Drive do PRÓPRIO usuário que clica.
-- (a) comp_sheet_links — mapeamento DURÁVEL usuário×escopo→planilha: mês já
--     exportado vira UPDATE da aba; outro mês vira aba NOVA na MESMA planilha.
--     Escopos: 'visao-geral' (admin) e 'minha' (vendedor) — uma planilha por
--     escopo por usuário. RLS linha própria (padrão dashboard_ai_sessions
--     0098): a ACTION lê o spreadsheet_id conhecido com o client do usuário;
--     a ESCRITA real vem da rota pública via service role com org/user/escopo
--     tirados DA LINHA DO TICKET (nunca do corpo da requisição).
-- (b) comp_sheet_export_tickets — ticket EFÊMERO single-use do handshake com
--     o Web App: token 256-bit exibido uma vez (só o sha256 persiste — mesmo
--     desenho de snapshots/api_keys), snapshot jsonb do payload (o usuário só
--     exporta o que a tela dele já renderiza; destino é o Drive dele —
--     tradeoff documentado em docs/arquitetura.md §4.18), TTL de 15 min
--     aplicado no app, consumed_at (GET do script) / completed_at (POST de
--     volta). SEM POLICIES: leitura/escrita SÓ via service role (padrão
--     api_keys/org_features — RLS não expressa os gates da action: caps,
--     feature/deny da área, admin no escopo visao-geral); a action insere com
--     service client + carimbo EXPLÍCITO de org via getActiveOrgId (tabela
--     RAIZ sem pai derivável, padrão 0112). NUNCA policy anon: o caminho
--     público é token + service role (doutrina dos snapshots). Idempotente.

-- ============ comp_sheet_links (planilha por usuário×escopo) ============
create table if not exists public.comp_sheet_links (
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
                    references public.organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  scope_key       text not null check (scope_key in ('visao-geral', 'minha')),
  spreadsheet_id  text not null,
  spreadsheet_url text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- PK composta JÁ É o unique exigido pelo upsert onConflict da rota.
  primary key (organization_id, user_id, scope_key)
);

create index if not exists idx_comp_sheet_links_user
  on public.comp_sheet_links (user_id);

drop trigger if exists trg_comp_sheet_links_updated_at on public.comp_sheet_links;
create trigger trg_comp_sheet_links_updated_at
  before update on public.comp_sheet_links
  for each row execute function public.set_updated_at();

alter table public.comp_sheet_links enable row level security;

drop policy if exists comp_sheet_links_all on public.comp_sheet_links;
create policy comp_sheet_links_all on public.comp_sheet_links
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and user_id = (select auth.uid())
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and user_id = (select auth.uid())
  );

revoke all on public.comp_sheet_links from anon;

-- ====== comp_sheet_export_tickets (handshake single-use c/ o Web App) ======
create table if not exists public.comp_sheet_export_tickets (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
                    references public.organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  scope_key       text not null check (scope_key in ('visao-geral', 'minha')),
  period_year     int  not null check (period_year between 2000 and 2100),
  period_month    int  not null check (period_month between 1 and 12),
  token_hash      text not null unique,
  payload         jsonb not null,
  created_at      timestamptz not null default now(),
  consumed_at     timestamptz,
  completed_at    timestamptz
);

-- Limpeza oportunista (delete de tickets >24h do MESMO usuário no create).
create index if not exists idx_comp_sheet_tickets_user_created
  on public.comp_sheet_export_tickets (user_id, created_at);

alter table public.comp_sheet_export_tickets enable row level security;
-- Sem policies: só service role. Belt-and-braces nos grants (padrão 0114):
revoke all on public.comp_sheet_export_tickets from anon;
revoke insert, update, delete on public.comp_sheet_export_tickets from authenticated;

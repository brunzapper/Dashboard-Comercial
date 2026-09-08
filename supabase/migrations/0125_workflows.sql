-- 0125_workflows.sql
-- Versão: 1.0 | Data: 08/09/2026
-- WORKFLOW — esquemas de automação configuráveis (área `workflow` de Operação).
-- Um ESQUEMA é um fluxo declarado como DADO: um formulário (lista PLANA de
-- campos) + uma sequência de PASSOS que consomem as respostas por referência
-- ({{form.<key>}}, {{steps.<id>.id}}). O primeiro esquema real é o
-- "Formulário de criação Bitrix" (empresa → contato → lead → registro local),
-- mas nada aqui é específico do Bitrix: os TIPOS de passo e as CONEXÕES vivem
-- num registry em CÓDIGO (lib/workflow/registry.ts, lib/workflow/connections.ts).
--
-- SEGREDO NUNCA ENTRA AQUI. O esquema referencia uma conexão pela CHAVE do
-- registry ("bitrix_webhook"); o registry a mapeia para um getter tipado de
-- lib/env.ts (BITRIX_WEBHOOK_URL, gerenciada na Vercel). Guardar o nome cru de
-- uma variável no jsonb viraria process.env[<dado gravável>] — leitura
-- arbitrária do ambiente do servidor (SUPABASE_SERVICE_ROLE_KEY,
-- KEY_ENCRYPTION_KEY) por quem edita um esquema.
--
-- Sem trigger de stamp de org: não há linha-pai de onde derivar. A action
-- carimba com getActiveOrgId() e o `with check` é a muralha — precedente das
-- tabelas-raiz sem pai (value_mappings 0117, operacao_ai_sessions 0124). O
-- gate do app FALHA ALTO sem org ativa, em vez de cair no default da org
-- legada. NUNCA policy para anon. Idempotente.

-- ---------------------------------------------------------------- esquemas --
create table if not exists public.workflow_schemas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
    references public.organizations (id) on delete cascade,
  -- Identidade do esquema dentro da org. IMUTÁVEL na edição (o app recusa a
  -- troca) — é por ela que o seed é idempotente e que um esquema de fábrica é
  -- reconhecido sem sobrescrever a edição do admin. Mesmo slug de 0117/0119.
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null,
  description text,
  -- WorkflowDefinition (lib/workflow/types.ts), versionado e com parse
  -- FAIL-CLOSED: jsonb sujo derruba o esquema inteiro, nunca meio-aplicado.
  definition jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_workflow_schemas_org_key
  on public.workflow_schemas (organization_id, key);

create index if not exists idx_workflow_schemas_org
  on public.workflow_schemas (organization_id);

drop trigger if exists trg_workflow_schemas_updated on public.workflow_schemas;
create trigger trg_workflow_schemas_updated
  before update on public.workflow_schemas
  for each row execute function public.set_updated_at();

alter table public.workflow_schemas enable row level security;

-- Leitura para toda a org: quem EXECUTA o formulário precisa do esquema (a
-- área `workflow` não tem gate de papel — a page ramifica admin/vendedor).
drop policy if exists workflow_schemas_select on public.workflow_schemas;
create policy workflow_schemas_select on public.workflow_schemas
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

-- Escrita admin-only (espelho de value_mappings 0117): configurar quais campos
-- aparecem e quais passos rodam é decisão de administração, não de operação.
drop policy if exists workflow_schemas_write on public.workflow_schemas;
create policy workflow_schemas_write on public.workflow_schemas
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  );

revoke all on public.workflow_schemas from anon;

-- --------------------------------------------------------------- execuções --
-- Histórico de execução. Existe por DUAS razões práticas: o executor faz
-- chamadas externas irreversíveis (um lead criado no CRM não volta), então o
-- que foi enviado e o que cada passo respondeu precisa ficar registrado; e o
-- resultado é POR PASSO — uma execução pode terminar 'partial' (empresa criada,
-- lead falhou), e sem o registro ninguém saberia o que sobrou no CRM.
create table if not exists public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
    references public.organizations (id) on delete cascade,
  -- O esquema pode ser excluído depois; a execução é registro histórico e
  -- sobrevive com a schema_key (texto) como identidade legível.
  schema_id uuid references public.workflow_schemas (id) on delete set null,
  schema_key text not null,
  status text not null check (status in ('ok', 'partial', 'error')),
  -- Respostas do formulário, como enviadas. Não carrega segredo: o formulário
  -- só coleta dados de negócio, e a conexão é resolvida no servidor.
  input jsonb not null default '{}'::jsonb,
  -- [{ id, type, ok, skipped, output, error }] — um item por passo TENTADO.
  steps jsonb not null default '[]'::jsonb,
  error text,
  -- Registro local criado pelo passo record.create, quando houver.
  record_id uuid references public.records (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_workflow_runs_org_created
  on public.workflow_runs (organization_id, created_at desc);

create index if not exists idx_workflow_runs_schema
  on public.workflow_runs (schema_id);

alter table public.workflow_runs enable row level security;

-- Admin vê tudo da org; quem executou vê as PRÓPRIAS execuções (é o histórico
-- de "o que eu lancei"). Sem ramo de leitura org-wide para não-admin: o input
-- carrega dado de contato de lead de outra pessoa.
drop policy if exists workflow_runs_select on public.workflow_runs;
create policy workflow_runs_select on public.workflow_runs
  for select to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (
      created_by = (select auth.uid())
      or (select public.auth_has_role('admin'))
    )
  );

-- Insert own-row: a action grava com o client RLS do usuário (nunca service
-- role) — o mesmo princípio dos applies de IA.
drop policy if exists workflow_runs_insert on public.workflow_runs;
create policy workflow_runs_insert on public.workflow_runs
  for insert to authenticated
  with check (
    organization_id in (select public.auth_org_ids())
    and created_by = (select auth.uid())
  );

revoke all on public.workflow_runs from anon;

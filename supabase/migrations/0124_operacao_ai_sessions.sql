-- Versão: 1.0 | Data: 07/09/2026
-- Sessões PERSISTIDAS do painel "IA da Operação" (/operacao): uma linha por
-- (org, usuário, ESCOPO) com os turnos do usuário, o log de exibição do chat,
-- a prévia pendente e o snapshot do Desfazer. Espelho da 0098
-- (dashboard_ai_sessions), com DUAS diferenças que a diferença de natureza
-- impõe:
--
--  1) `organization_id` entra na PK. Na 0098 a chave é (user_id, dashboard_id)
--     e o dashboard já é de UMA org. Aqui o escopo é uma chave de registry em
--     CÓDIGO ("remuneracao", "mapeamentos") — a mesma em toda org. Sem a org na
--     chave, um usuário multi-org (Owner/consultor) que gera uma prévia na org
--     A, troca de org pelo cookie e reabre a mesma tela na org B cairia na
--     MESMA linha: veria o `pending` (config de plano!) e o `undo_snapshot` da
--     org A e os sobrescreveria. A RLS não pega isso — ele é membro das duas.
--     É o precedente da 0123, que moveu organization_id para dentro da PK de
--     currencies pela mesma razão.
--
--  2) NÃO há trigger de stamp de org. A 0098 rederiva a org do dashboard; aqui
--     não existe linha-pai de onde derivar. A action carimba com
--     getActiveOrgId() e o `with check` da policy é a única muralha — padrão
--     das tabelas-raiz sem pai (value_mappings 0117, currencies 0123). Por
--     isso o gate do app FALHA ALTO quando não há org ativa, em vez de deixar
--     a linha cair no default da org legada.
--
-- Caps de tamanho (turns/chat) são aplicados no app. Idempotente.

create table if not exists public.operacao_ai_sessions (
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
                    references public.organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  -- Chave de ÁREA histórica (AREA_GATES) do escopo — mesmo slug de 0117.
  scope           text not null check (scope ~ '^[a-z][a-z0-9_]{1,39}$'),
  turns           jsonb not null default '[]'::jsonb, -- string[]: textos do usuário
  chat            jsonb not null default '[]'::jsonb, -- AiChatEntry[]: log de exibição
  -- { target, json, summary[] } | null. O ALVO fica DENTRO da prévia: a linha
  -- é por escopo, não por plano/domínio — sem ele, uma prévia gerada com o
  -- plano X selecionado seria aplicada no plano Y depois de trocar de pill.
  pending         jsonb,
  -- Snapshot pré-apply, com forma DEFINIDA PELO ESCOPO (o handler sabe
  -- restaurá-lo). Sem FK de propósito: o alvo pode ser excluído depois, e o
  -- restore precisa responder amigável em vez de recriar algo por baixo.
  undo_snapshot   jsonb,
  undo_saved_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (organization_id, user_id, scope)
);

create index if not exists idx_operacao_ai_sessions_user
  on public.operacao_ai_sessions (user_id);
create index if not exists idx_operacao_ai_sessions_org
  on public.operacao_ai_sessions (organization_id);

drop trigger if exists trg_operacao_ai_sessions_updated_at on public.operacao_ai_sessions;
create trigger trg_operacao_ai_sessions_updated_at
  before update on public.operacao_ai_sessions
  for each row execute function public.set_updated_at();

alter table public.operacao_ai_sessions enable row level security;

-- Linha própria + gate de org (0089). A autoridade de ESCREVER na área
-- (admin, área não bloqueada, feature ligada) fica nos handlers — as escritas
-- reais já são muradas pelas RLS de comp_plans/goals/value_mappings.
drop policy if exists operacao_ai_sessions_all on public.operacao_ai_sessions;
create policy operacao_ai_sessions_all on public.operacao_ai_sessions
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and user_id = (select auth.uid())
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and user_id = (select auth.uid())
  );

revoke all on public.operacao_ai_sessions from anon;

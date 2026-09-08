-- Versão: 1.0 | Data: 22/08/2026
-- Auditoria de segurança (22/08/2026) — dois furos de ISOLAMENTO no banco,
-- ambos anteriores à multi-org (0089-0091) e por isso fora do alcance dela.
-- Idempotente; nenhuma mudança de schema, só policies/grants.
--
-- 1) CATÁLOGO DE PAPÉIS (roles / permissions / role_permissions) — escalada
--    entre orgs. As três tabelas são GLOBAIS (não estão na 0090: não têm
--    organization_id e a 0091 não as recriou), mas a policy de escrita da 0009
--    era só `auth_has_permission('manage_users_roles')` — permissão de
--    USUÁRIO, não de org. Um admin da org A podia inserir
--    ('vendedor','view_all_records') em role_permissions e o grant valia para
--    TODAS as orgs: records_select (0091) lê exatamente essa permissão, então
--    todo vendedor do sistema passaria a ver todos os registros.
--    Correção: o catálogo é do SISTEMA — escrita SÓ por service role (padrão
--    0096/0114: sem policy de escrita + revoke nos grants). O app apenas LÊ
--    essas tabelas hoje (configuracoes/usuarios/page.tsx e lib/auth/session.ts);
--    o SELECT `using (true)` da 0009 segue valendo (é catálogo, não dado de
--    tenant). user_roles NÃO entra aqui: a 0092 já a recortou por
--    auth_org_member_ids() + auth_can_grant_admin.
--
-- 2) reuniao_freeze_backup (0051) — única tabela do schema criada SEM
--    `enable row level security`, sem policy e sem revoke. Com os grants
--    default do Supabase no schema public, qualquer autenticado de qualquer
--    org lia e escrevia o backup (record_id / field_key / old_value: Data
--    Reunião de registros REAIS — a 0051 só copia `not is_mock`).
--    Correção: RLS ligada e NENHUMA policy = fechada para authenticated/anon,
--    aberta só ao service role (mesma forma de comp_sheet_export_tickets,
--    0115). O único consumidor é o runbook
--    supabase/apply/undo-mock-reuniao.sql, que roda em SQL direto.

-- ===================== 1) Catálogo de papéis =====================
drop policy if exists roles_write on public.roles;
drop policy if exists permissions_write on public.permissions;
drop policy if exists role_permissions_write on public.role_permissions;

-- `revoke all` + `grant select` (e não `revoke insert, update, delete`): o
-- grant default do Supabase inclui TRUNCATE, que sobreviveria a um revoke
-- enumerado — um autenticado zeraria o catálogo de permissões do sistema
-- inteiro. Aqui a lista de privilégios volta a ser exatamente { SELECT }.
revoke all on public.roles            from authenticated, anon;
revoke all on public.permissions      from authenticated, anon;
revoke all on public.role_permissions from authenticated, anon;
grant select on public.roles            to authenticated;
grant select on public.permissions      to authenticated;
grant select on public.role_permissions to authenticated;

-- ===================== 2) reuniao_freeze_backup =====================
-- Guarda de existência: o runbook undo-mock-reuniao.sql prevê o drop da tabela
-- depois do undo (linha comentada), então um banco pode não tê-la.
do $$
begin
  if to_regclass('public.reuniao_freeze_backup') is not null then
    execute 'alter table public.reuniao_freeze_backup enable row level security';
    -- Sem policies de propósito: service role only.
    execute 'revoke all on public.reuniao_freeze_backup from anon, authenticated';
  end if;
end
$$;

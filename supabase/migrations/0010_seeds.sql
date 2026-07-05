-- Versão: 1.0 | Data: 04/07/2026
-- Seeds: papéis, permissões, vínculos e configuração inicial de sync.
-- Idempotente (on conflict). NÃO cria usuários — isso é feito na tela de admin.

-- Papéis
insert into public.roles (key, label) values
  ('admin', 'Administrador'),
  ('gestor', 'Gestor'),
  ('vendedor', 'Vendedor')
on conflict (key) do update set label = excluded.label;

-- Permissões (capacidades independentes)
insert into public.permissions (key, label) values
  ('edit_record_values',       'Editar valores de registros'),
  ('manage_field_definitions', 'Criar/alterar colunas (definições de campo)'),
  ('manage_users_roles',       'Gerenciar usuários, papéis e permissões'),
  ('create_dashboards',        'Criar e editar dashboards'),
  ('view_all_records',         'Ver todos os registros (não só os próprios)'),
  ('view_forecast_all',        'Ver o forecast de todos os vendedores')
on conflict (key) do update set label = excluded.label;

-- Vínculos papel -> permissão
-- admin: tudo
insert into public.role_permissions (role_key, permission_key)
select 'admin', p.key from public.permissions p
on conflict do nothing;

-- gestor/CEO: vê tudo e edita conforme configurado; não cria colunas nem gerencia usuários
insert into public.role_permissions (role_key, permission_key) values
  ('gestor', 'edit_record_values'),
  ('gestor', 'create_dashboards'),
  ('gestor', 'view_all_records'),
  ('gestor', 'view_forecast_all')
on conflict do nothing;

-- vendedor: edita os próprios registros e cria dashboards pessoais
insert into public.role_permissions (role_key, permission_key) values
  ('vendedor', 'edit_record_values'),
  ('vendedor', 'create_dashboards')
on conflict do nothing;

-- Configuração inicial de sync (filtros do forecast, janelas, flags).
-- Editável pelo admin. Valores em minúsculas para matching normalizado.
insert into public.sync_config (key, value) values
  (
    'forecast_ignored_owners',
    '["guillermo moane", "patricio marchionna", "daniela drielsma"]'::jsonb
  ),
  (
    'forecast_excluded_stages',
    '["demonstração de zapper", "demonstracao de zapper", "no show", "no-show", "noshow"]'::jsonb
  ),
  (
    'sync_windows',
    '{"reconcile_default_days": 3, "backfill_year": null, "page_pause_ms": 600}'::jsonb
  ),
  (
    'feature_flags',
    '{"sheets_direct_read": false}'::jsonb
  )
on conflict (key) do nothing;

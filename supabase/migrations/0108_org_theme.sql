-- Versão: 1.0 | Data: 27/07/2026
-- Tema padrão da ORGANIZAÇÃO (Configurações → Tema, seção do org_admin):
-- organizations.theme jsonb — shape { "mode": "light"|"dark"|"system",
-- "accentColor": "#RRGGBB" }; '{}' = sem padrão (vale o do app: claro +
-- #7431B3). A escolha individual (user_settings.settings.theme/accentColor)
-- SOBREPÕE este padrão — resolução em lib/theme.ts (resolveTheme).
-- Escrita coberta pelas policies existentes de organizations (só org_admin,
-- 0089/0091) — nenhuma policy nova. Idempotente.

alter table public.organizations
  add column if not exists theme jsonb not null default '{}'::jsonb;

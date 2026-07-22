-- Versão: 1.0 | Data: 22/07/2026
-- Ciclo de vida de boards (dashboards E kanbans — mesma tabela, kind 0062):
--   'active'   → aparece no hub (comportamento de sempre);
--   'archived' → sai da tela principal do hub (seção "Arquivados"), mas segue
--                ABRINDO normalmente, por tempo indeterminado;
--   'trashed'  → Lixeira do hub: NÃO abre (404 em /dashboards/[id],
--                /kanbans/[id] e /s/[token]), some dos pickers/preset, e é
--                purgado após 14 dias (apply/pg-cron-purge-trash.sql; o hub
--                também esconde itens vencidos mesmo sem o cron instalado).
-- Sem mudança de RLS: as transições passam por dashboards_update
-- (owner/admin), a exclusão permanente por dashboards_delete e a duplicação
-- por dashboards_insert (0009) — o "não abre" é garantido nas pages/actions
-- (invariante em docs/arquitetura.md), não em política.
-- Idempotente.

alter table public.dashboards
  add column if not exists status text not null default 'active';

alter table public.dashboards
  drop constraint if exists dashboards_status_check;
alter table public.dashboards
  add constraint dashboards_status_check
  check (status in ('active', 'archived', 'trashed'));

-- Carimbos das transições: exibição ("Expira em N dias") e corte da purga.
alter table public.dashboards
  add column if not exists archived_at timestamptz;
alter table public.dashboards
  add column if not exists trashed_at timestamptz;

create index if not exists idx_dashboards_status on public.dashboards (status);

-- Versão: 1.0 | Data: 04/07/2026
-- Mapeamentos e configuração de sync.
--   bitrix_user_map: ASSIGNED_BY_ID do Bitrix -> user_id do Supabase (owner/RLS)
--   bitrix_lookup_cache: cache persistente de status.list/user.get/enums
--   sync_config: configuração editável (filtros do forecast, janelas, flags)
-- Idempotente.

create table if not exists public.bitrix_user_map (
  bitrix_id text primary key,
  user_id uuid references auth.users (id) on delete set null,
  name text,
  updated_at timestamptz not null default now()
);

create table if not exists public.bitrix_lookup_cache (
  lookup_type text not null,   -- ex.: 'status', 'user', 'deal_enum:<field>'
  source_id text not null,
  label text,
  updated_at timestamptz not null default now(),
  primary key (lookup_type, source_id)
);

-- Configuração key-value (um registro por chave).
create table if not exists public.sync_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_bitrix_user_map_updated_at on public.bitrix_user_map;
create trigger trg_bitrix_user_map_updated_at
  before update on public.bitrix_user_map
  for each row execute function public.set_updated_at();

drop trigger if exists trg_sync_config_updated_at on public.sync_config;
create trigger trg_sync_config_updated_at
  before update on public.sync_config
  for each row execute function public.set_updated_at();

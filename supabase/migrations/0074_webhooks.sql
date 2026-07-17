-- Versão: 1.0 | Data: 17/07/2026
-- Webhooks / Integrações — fundação para receber e enviar dados de/para
-- sistemas externos (docs/estudo-ingestao-api.md, fase 1):
--   1) api_keys                — chaves de ENTRADA por integração/fonte
--                                (POST /api/ingest/<source_key>); só o sha256
--                                é persistido, plaintext exibido UMA vez.
--   2) webhook_endpoints       — destinos de SAÍDA (URLs https notificadas
--                                quando registros/tarefas/comentários mudam);
--                                segredo de assinatura HMAC cifrado (AES-GCM).
--   3) webhook_events +
--      webhook_deliveries      — outbox de saída (padrão da 0032): o app
--                                insere evento + entregas 'pending'; o tick
--                                (/api/webhooks/tick) drena com retry/backoff.
--   4) webhook_inbound_events  — log + idempotência da entrada (dedup por
--                                event_id externo).
-- RLS em todas: SELECT só admin; escrita SÓ via service role (sem policies de
-- escrita). NUNCA policy para anon (regra do projeto). Idempotente.

-- ============ 1) api_keys (entrada) ============
create table if not exists public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  key_hash      text not null unique,      -- sha256 hex da chave; NUNCA plaintext
  key_prefix    text not null,             -- ex.: 'dck_a1b2c3' (exibição na UI)
  label         text not null,             -- "Planilha de propostas", "Zapier"…
  source_key    text not null references public.data_sources (key) on delete restrict,
  mapping       jsonb,                     -- ColumnMapping[] (lib/import/csv.ts)
  dedup_columns jsonb,                     -- string[] (chave de dedup do ingest)
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz                -- revogação = update, efeito imediato
);

alter table public.api_keys enable row level security;
drop policy if exists api_keys_select on public.api_keys;
create policy api_keys_select on public.api_keys for select to authenticated
  using (public.auth_has_role('admin'));
-- Sem policies de escrita: só service role. Belt-and-braces nos grants:
revoke all on public.api_keys from anon;
revoke insert, update, delete on public.api_keys from authenticated;

-- ============ 2) webhook_endpoints (saída) ============
create table if not exists public.webhook_endpoints (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  url                  text not null
                         constraint webhook_endpoints_https_check
                         check (url ~* '^https://'),
  event_types          text[] not null default '{}',  -- vazio = todos os tipos
  secret_ciphertext    text not null,      -- AES-256-GCM "v1:<iv>:<tag>:<ct>"
  active               boolean not null default true,
  disabled_reason      text,               -- ex.: 'auto: falhas consecutivas'
  consecutive_failures int not null default 0,
  last_success_at      timestamptz,
  last_failure_at      timestamptz,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

drop trigger if exists trg_webhook_endpoints_updated_at on public.webhook_endpoints;
create trigger trg_webhook_endpoints_updated_at
  before update on public.webhook_endpoints
  for each row execute function public.set_updated_at();

alter table public.webhook_endpoints enable row level security;
drop policy if exists webhook_endpoints_select on public.webhook_endpoints;
create policy webhook_endpoints_select on public.webhook_endpoints for select to authenticated
  using (public.auth_has_role('admin'));
revoke all on public.webhook_endpoints from anon;
revoke insert, update, delete on public.webhook_endpoints from authenticated;

-- ============ 3) webhook_events + webhook_deliveries (outbox de saída) ============
create table if not exists public.webhook_events (
  id         uuid primary key default gen_random_uuid(),
  event_type text not null,               -- catálogo em lib/webhooks/events.ts
  payload    jsonb not null,              -- 'data' do envelope enviado
  created_at timestamptz not null default now()
);
create index if not exists idx_webhook_events_created
  on public.webhook_events (created_at);

alter table public.webhook_events enable row level security;
drop policy if exists webhook_events_select on public.webhook_events;
create policy webhook_events_select on public.webhook_events for select to authenticated
  using (public.auth_has_role('admin'));
revoke all on public.webhook_events from anon;
revoke insert, update, delete on public.webhook_events from authenticated;

create table if not exists public.webhook_deliveries (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.webhook_events (id) on delete cascade,
  endpoint_id     uuid not null references public.webhook_endpoints (id) on delete cascade,
  -- Falha retryável permanece 'pending' (attempts/next_attempt_at avançam);
  -- terminal é 'dead' (esgotou MAX_ATTEMPTS). Espelha a 0032.
  status          text not null default 'pending'
                    check (status in ('pending', 'delivered', 'dead')),
  attempts        int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  response_status int,
  delivered_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists trg_webhook_deliveries_updated_at on public.webhook_deliveries;
create trigger trg_webhook_deliveries_updated_at
  before update on public.webhook_deliveries
  for each row execute function public.set_updated_at();

-- Drain do tick: só pendentes, por vencimento (índice parcial).
create index if not exists idx_webhook_deliveries_due
  on public.webhook_deliveries (next_attempt_at) where status = 'pending';
-- Log recente por endpoint (UI de Integrações).
create index if not exists idx_webhook_deliveries_endpoint
  on public.webhook_deliveries (endpoint_id, created_at desc);

alter table public.webhook_deliveries enable row level security;
drop policy if exists webhook_deliveries_select on public.webhook_deliveries;
create policy webhook_deliveries_select on public.webhook_deliveries for select to authenticated
  using (public.auth_has_role('admin'));
revoke all on public.webhook_deliveries from anon;
revoke insert, update, delete on public.webhook_deliveries from authenticated;

-- ============ 4) webhook_inbound_events (log/idempotência de entrada) ============
create table if not exists public.webhook_inbound_events (
  id                uuid primary key default gen_random_uuid(),
  api_key_id        uuid not null references public.api_keys (id) on delete cascade,
  external_event_id text,                 -- payload.event_id (dedup opcional)
  kind              text not null default 'rows'
                      check (kind in ('rows', 'event')),
  payload           jsonb not null,
  status            text not null default 'received'
                      check (status in ('received', 'processed', 'error')),
  error             text,
  result            jsonb,                -- SyncResult resumido (modo rows)
  created_at        timestamptz not null default now(),
  processed_at      timestamptz
);

-- Idempotência: reenvio com o mesmo event_id pela mesma chave não reprocessa.
create unique index if not exists uq_webhook_inbound_dedup
  on public.webhook_inbound_events (api_key_id, external_event_id)
  where external_event_id is not null;
create index if not exists idx_webhook_inbound_key_created
  on public.webhook_inbound_events (api_key_id, created_at desc);

alter table public.webhook_inbound_events enable row level security;
drop policy if exists webhook_inbound_select on public.webhook_inbound_events;
create policy webhook_inbound_select on public.webhook_inbound_events for select to authenticated
  using (public.auth_has_role('admin'));
revoke all on public.webhook_inbound_events from anon;
revoke insert, update, delete on public.webhook_inbound_events from authenticated;

-- ============ 5) audit_log.origin: aceita 'api' ============
-- A ingestão via API audita com origin='api' (via service role); a policy de
-- INSERT p/ autenticados (0009) segue exigindo origin='app'. Mesmo mecanismo
-- da 0060: dropa o CHECK vigente por busca no catálogo e recria com o novo valor.
do $$
declare
  v_con text;
begin
  for v_con in
    select conname
    from pg_constraint
    where conrelid = 'public.audit_log'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%origin%'
  loop
    execute format('alter table public.audit_log drop constraint %I', v_con);
  end loop;
end $$;

alter table public.audit_log
  add constraint audit_log_origin_check
  check (origin in ('app', 'sync_bitrix', 'sync_sheet', 'import_csv', 'api'));

-- Versão: 1.0 | Data: 23/07/2026
-- Config de IA por ORGANIZAÇÃO para a geração DIRETA de dashboards via API
-- (lib/ai/*, app/(app)/dashboards/ai-generate-actions.ts). Uma linha por org:
-- provedor + modelo escolhidos + a chave de API CIFRADA (AES-256-GCM
-- "v1:<iv>:<tag>:<ct>", lib/crypto/secretbox.ts). O plaintext NUNCA é
-- persistido nem retornado ao browser; só o servidor decifra (loadOrgAiConfig,
-- service role) na hora de chamar o provedor.
-- RLS: SELECT só admin da PRÓPRIA org (org-scoped, padrão 0091); escrita SÓ via
-- service role (sem policy de escrita, igual api_keys/webhook_endpoints da
-- 0074) carimbando organization_id. NUNCA policy para anon. Idempotente.

create table if not exists public.ai_provider_config (
  organization_id    uuid primary key
                       references public.organizations (id) on delete cascade,
  provider           text not null
                       check (provider in ('gemini', 'claude', 'openai')),
  model              text not null,
  api_key_ciphertext text,                 -- AES-256-GCM; NULL = sem chave ainda
  updated_by         uuid references auth.users (id) on delete set null,
  updated_at         timestamptz not null default now()
);

drop trigger if exists trg_ai_provider_config_updated_at on public.ai_provider_config;
create trigger trg_ai_provider_config_updated_at
  before update on public.ai_provider_config
  for each row execute function public.set_updated_at();

alter table public.ai_provider_config enable row level security;
drop policy if exists ai_provider_config_select on public.ai_provider_config;
create policy ai_provider_config_select on public.ai_provider_config
  for select to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  );
-- Sem policies de escrita: só service role. Belt-and-braces nos grants:
revoke all on public.ai_provider_config from anon;
revoke insert, update, delete on public.ai_provider_config from authenticated;

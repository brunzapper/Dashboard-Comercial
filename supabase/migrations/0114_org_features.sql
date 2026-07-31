-- Versão: 1.0 | Data: 31/07/2026
-- Recursos SOB DEMANDA por organização (config custom): `org_features` guarda
-- um jsonb { "<feature>": true } por org — hoje só "remuneracao" (área
-- Configurações → Remuneração + preset "Remuneração Variável", construídos
-- sob demanda para a Zapper). O gate é de APP (lib/auth/access.ts
-- AREA_FEATURES + filtro de presets): feature desligado esconde área/preset e
-- barra actions; os DADOS (comp_plans/comp_entries/espelho) seguem com a RLS
-- própria da 0112 — desligar nunca apaga nem vaza nada.
-- RLS: SELECT p/ qualquer membro da org (o gate roda no request do usuário);
-- escrita SÓ via service role (sem policy — padrão 0096 ai_provider_config):
-- habilitar recurso sob demanda é decisão do APP OWNER (/owner), nunca do
-- org_admin (que poderia se auto-habilitar). NUNCA policy para anon.
-- Seed: a org Zapper (uuid semeado na 0089) nasce com remuneracao ligado —
-- deploy não muda nada para ela; orgs novas nascem sem linha = tudo off
-- (fail-closed no normalizeOrgFeatures). Idempotente.

create table if not exists public.org_features (
  organization_id uuid primary key
                    references public.organizations (id) on delete cascade,
  features        jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);

drop trigger if exists trg_org_features_updated_at on public.org_features;
create trigger trg_org_features_updated_at
  before update on public.org_features
  for each row execute function public.set_updated_at();

alter table public.org_features enable row level security;
drop policy if exists org_features_select on public.org_features;
create policy org_features_select on public.org_features
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));
-- Sem policies de escrita: só service role. Belt-and-braces nos grants:
revoke all on public.org_features from anon;
revoke insert, update, delete on public.org_features from authenticated;

-- Zapper (org semeada na 0089) mantém a Remuneração ligada. on conflict:
-- reaplicar a migração nunca sobrescreve toggles já ajustados pelo owner.
insert into public.org_features (organization_id, features)
values ('00000000-0000-4000-a000-000000000001', '{"remuneracao": true}'::jsonb)
on conflict (organization_id) do nothing;

-- 0107_source_folders.sql
-- Versão: 1.0 | Data: 26/07/2026
-- PASTAS DE BASES: agrupamento de EXIBIÇÃO das bases (data_sources) em
-- "Pastas" + ordenação manual (sort_order) de pastas, bases e sub-bases.
-- Motivação: com 13+ bases e 9+ sub-bases, as fileiras de abas de /registros
-- e /campos ficaram ingerenciáveis; a navegação vira Pasta → Base → Sub-base
-- e os pickers (widget-builder, diálogo Bases do board, matriz de Acessos...)
-- ganham headings por pasta.
-- Pasta é exibição PURA: nunca entra em consulta/engine/RPC — esta migração
-- NÃO recria run_widget_query/run_widget_query_snapshot (invariante 1 do
-- AGENTS.md não acionada).
-- Modelagem: PK uuid (pasta não entra em URL nem em config de widget — a
-- pasta ativa deriva da base `?fonte=`; uuid dispensa slug/colisão e torna o
-- rename trivial). `data_sources.folder_id` com on delete SET NULL: excluir a
-- pasta devolve as bases para "sem pasta" (grupo implícito "Geral"), nunca
-- derruba a base. Sub-bases não têm pasta própria (herdam a da pai via
-- parent_key no app); ganham só sort_order para o 3º nível da navegação.
-- folder_id NULL = "sem pasta". Sem seed/backfill: sort_order 0 preserva a
-- ordem atual do catálogo (builtin desc, created_at asc como desempate).
-- Idempotente.

create table if not exists public.source_folders (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  sort_order integer not null default 0,
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
    references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_source_folders_updated on public.source_folders;
create trigger trg_source_folders_updated
  before update on public.source_folders
  for each row execute function public.set_updated_at();

create index if not exists idx_source_folders_org
  on public.source_folders (organization_id);

alter table public.source_folders enable row level security;

-- Espelho das policies de data_sources (0091/0094): leitura da org; escrita
-- exige manage_field_definitions (mesma permissão que gere as bases).
drop policy if exists source_folders_select on public.source_folders;
create policy source_folders_select on public.source_folders
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists source_folders_write on public.source_folders;
create policy source_folders_write on public.source_folders
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_field_definitions'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_field_definitions'))
  );

-- Base → pasta (NULL = "sem pasta") + ordem manual dentro da pasta.
alter table public.data_sources
  add column if not exists folder_id uuid
    references public.source_folders (id) on delete set null;
alter table public.data_sources
  add column if not exists sort_order integer not null default 0;

create index if not exists idx_data_sources_folder
  on public.data_sources (folder_id);

-- Ordem manual das sub-bases dentro da pai (3º nível da navegação).
alter table public.sub_sources
  add column if not exists sort_order integer not null default 0;

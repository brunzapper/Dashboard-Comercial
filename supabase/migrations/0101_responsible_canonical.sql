-- Versão: 1.0 | Data: 26/07/2026
-- Agrupamento de responsáveis por EXIBIÇÃO, reversível (canonical_id):
-- um responsável com canonical_id preenchido vira "apelido" do principal — o
-- nome usado em dropdowns/widgets é o do principal e filtros por responsável
-- expandem para o grupo (resolução 100% no engine/loaders; ver
-- lib/config/responsible-canon.ts). records.responsible_id NUNCA é repontado:
-- limpar canonical_id desfaz o agrupamento por inteiro. Grupo sempre PLANO
-- (alias aponta direto ao principal; a action de Configurações repontea
-- filhos ao mesclar um principal).
-- NÃO recria run_widget_query/_snapshot (invariante 1 não acionada); a
-- restrição allowed_responsible_ids dos snapshots segue lida como está — a
-- expansão do grupo acontece ao GRAVAR a restrição (snapshot-actions).
-- APLICAR ANTES do deploy (o app passa a selecionar canonical_id). Idempotente.

alter table public.responsibles
  add column if not exists canonical_id uuid
    references public.responsibles (id) on delete set null;

comment on column public.responsibles.canonical_id is
  'Agrupamento de exibição: aponta o responsável principal cujo display_name é o "nome usado" deste apelido. NULL = responsável principal. Grupo plano (sem cadeias).';

create index if not exists idx_responsibles_canonical
  on public.responsibles (canonical_id) where canonical_id is not null;

-- ===================== auth_responsible_ids: grupo inteiro =====================
-- Invariante 8 (visibilidade do vendedor pelo vínculo vivo): como os records
-- SEGUEM apontando para o id original (apelido incluso), a função passa a
-- devolver o GRUPO — ids vinculados ao usuário + principais deles + apelidos
-- desses principais. Cobre de uma vez todas as policies que a referenciam
-- (records 0037/0068/0091/0094, tasks 0063, comments 0066, manuais 0061/0065).
-- Mantém security definer + search_path='' (0095); `create or replace`
-- preserva a ACL existente — nenhum grant novo (não re-conceder a anon).
create or replace function public.auth_responsible_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select r.id, r.canonical_id
    from public.responsibles r
    where r.user_id = (select auth.uid())
  ),
  roots as (
    select distinct coalesce(m.canonical_id, m.id) as id from mine m
  )
  select id from mine
  union
  select id from roots
  union
  select r.id
  from public.responsibles r
  join roots on r.canonical_id = roots.id
$$;

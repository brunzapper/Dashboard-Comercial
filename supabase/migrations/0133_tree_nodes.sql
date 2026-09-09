-- 0133_tree_nodes.sql
-- Versão: 1.0 | Data: 09/09/2026
-- NÓS DA TREE — e só os que o banco precisa guardar.
--
-- A árvore é DERIVADA dos fatos que já existem (as cobranças da série, as
-- tarefas, os comentários da 0066, as alterações de campo). Uma tabela que
-- copiasse cada tarefa como nó teria de ser mantida em sincronia com `tasks`
-- para sempre, e ficaria errada na primeira tarefa criada por fora.
--
-- Então aqui moram duas coisas, e nada além disso:
--  1. o nó LIVRE — a anotação digitada direto na árvore, que não é fato de mais
--     ninguém (é o que faz o mapa mental existir sem automação nenhuma);
--  2. a EXCEÇÃO de parentesco — o nó que alguém arrastou. A forma escolhida dá
--     o parentesco derivado; o arrastado vence, em qualquer forma. Foi o pedido
--     literal: "a opção 1 por padrão, mas sendo possível editar livremente
--     depois".
--
-- `scope_kind='record'` amarra a árvore a um registro (o histórico de
-- acompanhamento); `'livre'` é o mapa mental, cuja chave é do widget.
--
-- RLS: no escopo de registro, leitura TRANSITIVA (quem vê o registro vê a
-- árvore — precedente de `comments` 0066) e escrita para quem pode mexer nele;
-- no escopo livre, org inteira lê e o autor/admin edita (é desenho
-- compartilhado, como a anotação do dia da agenda na 0111). Sem anon.
-- Idempotente.

create table if not exists public.tree_nodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
    references public.organizations (id) on delete cascade,
  -- A que árvore o nó pertence.
  scope_kind text not null check (scope_kind in ('record', 'livre')),
  -- record_id (escopo de registro) ou a chave do mapa (escopo livre).
  scope_id text not null,
  -- Fato que este nó representa. `note` é o único que não referencia nada:
  -- é texto digitado na própria árvore.
  kind text not null check (kind in ('task', 'comment', 'record', 'field', 'note')),
  -- Entidade referenciada (tarefa, comentário, registro). Null em `note`.
  ref_id uuid,
  -- Só em nó LIVRE: o pai é outro nó desta tabela.
  parent_id uuid references public.tree_nodes (id) on delete cascade,
  -- EXCEÇÃO de parentesco sobre um fato DERIVADO: guarda o id lógico do pai
  -- ("occ:3", "task:<uuid>"). Vazio = segue a forma escolhida; a string vazia
  -- não é usada — soltar na raiz é `parent_ref = '-'`, decidido no app.
  parent_ref text,
  -- Id lógico do nó a que a exceção se aplica (o mesmo TreeFact.id).
  node_ref text,
  label text,
  body text,
  position double precision not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tree_nodes_scope
  on public.tree_nodes (organization_id, scope_kind, scope_id);

-- Uma exceção por nó dentro de uma árvore: arrastar de novo ATUALIZA a linha.
create unique index if not exists uq_tree_nodes_override
  on public.tree_nodes (scope_kind, scope_id, node_ref)
  where node_ref is not null;

drop trigger if exists trg_tree_nodes_updated on public.tree_nodes;
create trigger trg_tree_nodes_updated
  before update on public.tree_nodes
  for each row execute function public.set_updated_at();

alter table public.tree_nodes enable row level security;

-- Leitura: no escopo de registro, quem vê o registro (a RLS de records se
-- aplica no EXISTS); no escopo livre, a organização — é desenho compartilhado.
drop policy if exists tree_nodes_select on public.tree_nodes;
create policy tree_nodes_select on public.tree_nodes
  for select to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (
      scope_kind = 'livre'
      or exists (
        select 1 from public.records r
        where r.id::text = tree_nodes.scope_id
      )
    )
  );

-- Escrita: no escopo de registro, admin/gestor ou o responsável dele (o mesmo
-- recorte do atributo, 0131); no escopo livre, o autor ou admin/gestor.
drop policy if exists tree_nodes_write on public.tree_nodes;
create policy tree_nodes_write on public.tree_nodes
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (
      (select public.auth_has_role('admin'))
      or (select public.auth_has_role('gestor'))
      or created_by = (select auth.uid())
      or (
        scope_kind = 'record'
        and exists (
          select 1 from public.records r
          where r.id::text = tree_nodes.scope_id
            and r.responsible_id in (select public.auth_responsible_ids())
        )
      )
    )
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (
      (select public.auth_has_role('admin'))
      or (select public.auth_has_role('gestor'))
      or created_by = (select auth.uid())
      or (
        scope_kind = 'record'
        and exists (
          select 1 from public.records r
          where r.id::text = tree_nodes.scope_id
            and r.responsible_id in (select public.auth_responsible_ids())
        )
      )
    )
  );

revoke all on public.tree_nodes from anon;

comment on table public.tree_nodes is
  'Guarda SÓ o que não é derivável: o nó livre (anotação digitada na árvore) e a exceção de parentesco (o nó arrastado, que vence a forma escolhida). Tarefas, comentários e alterações NÃO viram linha — são lidos ao vivo.';

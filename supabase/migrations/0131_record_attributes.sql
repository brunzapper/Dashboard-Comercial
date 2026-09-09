-- 0131_record_attributes.sql
-- Versão: 1.0 | Data: 09/09/2026
-- ATRIBUTOS DE REGISTRO: uma funcionalidade de Operação pendurada num registro.
--
-- O primeiro é o "Tree" (a árvore de acompanhamento), concedido pela série de
-- tarefas periódicas. Mas o conceito é geral: um atributo diz "este registro
-- participa da funcionalidade X", e é o que a tabela do dashboard abre quando
-- alguém clica na linha.
--
-- A CHAVE vive num registry em CÓDIGO (lib/attributes/registry.ts), nunca aqui:
-- atributo novo é entrada no registry + a superfície que o desenha. Uma tabela
-- de tipos daria a ilusão de que dá para criar atributo sem código — e o que
-- torna um atributo útil é justamente a tela que ele abre.
--
-- PAUSAR NÃO É EXCLUIR (requisito explícito): `status='pausado'` mantém a
-- linha, o vínculo com a regra e o histórico; quem consulta o status é a
-- automação, que para de produzir tarefas sem tirar o registro da
-- funcionalidade. Excluir é outra ação, e ela some com o atributo.
--
-- RLS: leitura TRANSITIVA — quem enxerga o registro enxerga o atributo (o
-- EXISTS roda sob as policies de `records` para o mesmo usuário; precedente
-- literal de `comments` na 0066). Escrita = admin OU o responsável do registro:
-- o pedido é que a automação seja gerenciável "pelo admin também, além do
-- próprio responsável". Sem acesso anon (regra do projeto). Idempotente.

create table if not exists public.record_attributes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
    references public.organizations (id) on delete cascade,
  record_id uuid not null references public.records (id) on delete cascade,
  -- Chave do registry em código. Chave desconhecida = atributo sem superfície:
  -- a UI o LISTA como desconhecido em vez de sumir com ele (o dado existe).
  attribute_key text not null check (attribute_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  status text not null default 'ativo' check (status in ('ativo', 'pausado')),
  -- Quem concedeu. Regra excluída não apaga o atributo — ele continua sendo o
  -- histórico do registro; por isso `set null` e não `cascade`.
  granted_by_rule_id uuid references public.automation_rules (id) on delete set null,
  -- Ajustes daquele registro dentro da funcionalidade (ex.: uma cadência
  -- própria). Sem esquema fixo de propósito: cada atributo lê o que entende.
  config jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Um atributo por registro: conceder duas vezes é a MESMA participação.
create unique index if not exists uq_record_attributes_record_key
  on public.record_attributes (record_id, attribute_key);

create index if not exists idx_record_attributes_key
  on public.record_attributes (organization_id, attribute_key, status);

drop trigger if exists trg_record_attributes_updated on public.record_attributes;
create trigger trg_record_attributes_updated
  before update on public.record_attributes
  for each row execute function public.set_updated_at();

alter table public.record_attributes enable row level security;

-- Vê o atributo quem vê o registro (a RLS de records se aplica no EXISTS).
drop policy if exists record_attributes_select on public.record_attributes;
create policy record_attributes_select on public.record_attributes
  for select to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and exists (
      select 1 from public.records r where r.id = record_attributes.record_id
    )
  );

-- Escrita: admin/gestor OU o responsável do registro (auth_responsible_ids
-- devolve o GRUPO canônico do usuário — invariante 20, apelido incluso).
drop policy if exists record_attributes_write on public.record_attributes;
create policy record_attributes_write on public.record_attributes
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (
      (select public.auth_has_role('admin'))
      or (select public.auth_has_role('gestor'))
      or exists (
        select 1 from public.records r
        where r.id = record_attributes.record_id
          and r.responsible_id in (select public.auth_responsible_ids())
      )
    )
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (
      (select public.auth_has_role('admin'))
      or (select public.auth_has_role('gestor'))
      or exists (
        select 1 from public.records r
        where r.id = record_attributes.record_id
          and r.responsible_id in (select public.auth_responsible_ids())
      )
    )
  );

revoke all on public.record_attributes from anon;

comment on table public.record_attributes is
  'Funcionalidade de Operação pendurada num registro (a chave vem do registry em código, lib/attributes/registry.ts). status=pausado MANTÉM a participação e só interrompe a produção da automação — excluir é outra ação.';

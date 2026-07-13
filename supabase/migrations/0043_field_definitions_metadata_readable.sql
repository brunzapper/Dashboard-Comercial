-- Versão: 1.0 | Data: 13/07/2026
-- field_definitions guarda apenas METADADOS de schema (rótulo, tipo, opções,
-- fórmula) — não guarda valores de registros. A política anterior
-- (0009_rls_policies.sql) só liberava a leitura para o admin ou para papéis
-- listados em visible_to_roles, o que fazia widgets em dashboards compartilhados
-- (ex.: tabela "Licenças" em modo registros) renderizarem cabeçalhos com IDs crus
-- e agrupamento por data quebrado para vendedores, pois os metadados dos campos
-- não chegavam ao cliente.
--
-- Passamos a liberar a leitura dos metadados para qualquer usuário autenticado.
-- Os VALORES continuam protegidos pela RLS de public.records
-- (0009_rls_policies.sql + 0037_visibility_by_responsible.sql), então isto não
-- expõe dado de negócio. O ACL por papel (visible_to_roles) que controla quais
-- colunas o usuário pode NAVEGAR/ESCOLHER passa a ser aplicado na camada de
-- aplicação (Registros e o construtor de widgets).
--
-- Escrita continua restrita a manage_field_definitions (inalterada aqui).
-- Idempotente: drop policy if exists antes do create.

drop policy if exists field_definitions_select on public.field_definitions;
create policy field_definitions_select on public.field_definitions for select to authenticated
  using (true);

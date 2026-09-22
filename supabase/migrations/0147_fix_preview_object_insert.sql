-- v1.0 | 22/09/2026
-- CORREÇÃO: a policy de INSERT dos binários de prévia (0145) nunca aceitou
-- nenhum upload. Dentro do `exists (select 1 from public.dashboards d ...)`,
-- o `name` não qualificado resolve para `dashboards.name` (a tabela interna
-- SOMBREIA storage.objects), então o predicado comparava o id/org do
-- dashboard com os "diretórios" do NOME do dashboard — sempre falso.
-- Resultado: todo upload batia na RLS e o Storage respondia 400; a rota
-- devolvia 503 e a prévia ficava para sempre na outbox (zero linhas em
-- dashboard_preview_images e zero objetos no bucket).
-- Aqui o `name` externo é qualificado como `objects.name` (mesma forma que a
-- policy de SELECT já usava). Nada é afrouxado: identidade, org, status e
-- auth_board_visible seguem exigidos, agora sobre o CAMINHO do arquivo.

drop policy if exists preview_object_insert on storage.objects;

create policy preview_object_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'dashboard-previews'
  and (storage.foldername(objects.name))[2] = (select auth.uid())::text
  and exists (select 1 from public.dashboards d
    where d.id::text = (storage.foldername(objects.name))[3]
      and d.organization_id::text = (storage.foldername(objects.name))[1]
      and d.status <> 'trashed' and public.auth_board_visible(d.id))
);

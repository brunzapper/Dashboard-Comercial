-- v1.0 | 21/09/2026
-- Relaxa a RLS de dashboard_preview_images: o epoch deixa de ser GATE
-- (match exato) e vira marcador de staleness. A segurança se mantém por
-- auth_board_visible(dashboard_id) + org + user + status <> 'trashed'.
-- Prévias stale continuam visíveis e são recapturadas na próxima visita.

drop policy if exists preview_images_read on public.dashboard_preview_images;

create policy preview_images_read on public.dashboard_preview_images
  for select to authenticated using (
    user_id = (select auth.uid())
    and organization_id in (select public.auth_org_ids())
    and public.auth_board_visible(dashboard_id)
    and exists (select 1 from public.dashboards d where d.id = dashboard_id and d.status <> 'trashed')
  );

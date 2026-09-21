-- Prévias prontas no banco da organização. Imagens nunca são públicas.
-- Escopo por usuário é intencional: além de papéis existem responsáveis,
-- overrides individuais e traduções de operação por usuário.
create table public.dashboard_preview_access_epoch (
  singleton boolean primary key default true check (singleton),
  version bigint not null default 1
);
insert into public.dashboard_preview_access_epoch values (true, 1);
alter table public.dashboard_preview_access_epoch enable row level security;
create policy preview_epoch_read on public.dashboard_preview_access_epoch
  for select to authenticated using (true);
grant select on public.dashboard_preview_access_epoch to authenticated;

create table public.dashboard_preview_images (
  dashboard_id uuid not null references public.dashboards(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_version bigint not null,
  revision timestamptz not null,
  version uuid not null default gen_random_uuid(),
  object_path text not null unique,
  byte_size integer not null check (byte_size between 16 and 40000),
  width integer not null check (width between 320 and 5120),
  height integer not null check (height between 200 and 2880),
  captured_at timestamptz not null default now(),
  primary key (dashboard_id, user_id)
);
alter table public.dashboard_preview_images enable row level security;
create policy preview_images_read on public.dashboard_preview_images
  for select to authenticated using (
    user_id = (select auth.uid())
    and access_version = (select version from public.dashboard_preview_access_epoch)
    and organization_id in (select public.auth_org_ids())
    and public.auth_board_visible(dashboard_id)
    and exists (select 1 from public.dashboards d where d.id = dashboard_id and d.status <> 'trashed')
  );
grant select on public.dashboard_preview_images to authenticated;

-- Único writer: deriva identidade/org, rejeita captura de revisão antiga e
-- substitui a imagem inteira em uma transação. Não toca a revisão do board.
create function public.publish_dashboard_preview(
  p_dashboard uuid, p_revision timestamptz, p_access_version bigint,
  p_path text, p_bytes integer, p_width integer, p_height integer
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_revision timestamptz; v_epoch bigint; v_written integer;
begin
  if auth.uid() is null or not public.auth_board_visible(p_dashboard) then
    raise exception 'Sem acesso ao dashboard';
  end if;
  select organization_id, updated_at into v_org, v_revision from public.dashboards
    where id = p_dashboard and status <> 'trashed' for share;
  select version into v_epoch from public.dashboard_preview_access_epoch where singleton for share;
  if v_org is null or v_revision is distinct from p_revision or v_epoch is distinct from p_access_version then return false; end if;
  if p_path not like v_org::text || '/' || auth.uid()::text || '/' || p_dashboard::text || '/%' then
    raise exception 'Arquivo de outra identidade';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'dashboard-previews' and name = p_path) then
    raise exception 'Arquivo ausente';
  end if;
  insert into public.dashboard_preview_images(dashboard_id, organization_id, user_id,
    access_version, revision, object_path, byte_size, width, height)
  values(p_dashboard, v_org, auth.uid(), v_epoch, v_revision, p_path, p_bytes, p_width, p_height)
  on conflict(dashboard_id, user_id) do update set
    access_version = excluded.access_version, revision = excluded.revision,
    object_path = excluded.object_path, byte_size = excluded.byte_size, width = excluded.width, height = excluded.height,
    version = gen_random_uuid(), captured_at = now()
  where dashboard_preview_images.revision < excluded.revision
    or dashboard_preview_images.access_version <> excluded.access_version;
  get diagnostics v_written = row_count;
  return v_written > 0;
end;
$$;
revoke all on function public.publish_dashboard_preview(uuid,timestamptz,bigint,text,integer,integer,integer) from public, anon;
grant execute on function public.publish_dashboard_preview(uuid,timestamptz,bigint,text,integer,integer,integer) to authenticated;

-- Revogação de acesso também invalida imagens congeladas, inclusive quando
-- o usuário continua podendo abrir o board mas perde acesso a uma base/campo.
create function public.invalidate_dashboard_preview_access()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.dashboard_preview_access_epoch set version = version + 1;
  return null;
end;
$$;
revoke all on function public.invalidate_dashboard_preview_access() from public, anon, authenticated;
do $$ declare t text; begin
  foreach t in array array['user_roles','role_permissions','organization_members',
    'user_access_overrides','board_access','responsible_operations'] loop
    execute format('create trigger invalidate_preview_access after insert or update or delete on public.%I for each statement execute function public.invalidate_dashboard_preview_access()', t);
  end loop;
end $$;

-- Sync de nomes/datas não revoga acesso nem deve invalidar as imagens.
create trigger invalidate_preview_responsible_access after update of user_id, canonical_id on public.responsibles
  for each row when (old.user_id is distinct from new.user_id or old.canonical_id is distinct from new.canonical_id)
  execute function public.invalidate_dashboard_preview_access();
create trigger invalidate_preview_field_access after update of visible_to_roles on public.field_definitions
  for each row when (old.visible_to_roles is distinct from new.visible_to_roles)
  execute function public.invalidate_dashboard_preview_access();

create trigger invalidate_preview_responsible_delete after delete on public.responsibles
  for each statement execute function public.invalidate_dashboard_preview_access();

-- Binários WebP privados: o Postgres da aplicação guarda somente metadados.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('dashboard-previews', 'dashboard-previews', false, 40000, array['image/webp']);
create policy preview_object_read on storage.objects for select to authenticated using (
  bucket_id = 'dashboard-previews' and exists (
    select 1 from public.dashboard_preview_images p where p.object_path = name
  )
);
create policy preview_object_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'dashboard-previews'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and exists (select 1 from public.dashboards d
    where d.id::text = (storage.foldername(name))[3]
      and d.organization_id::text = (storage.foldername(name))[1]
      and d.status <> 'trashed' and public.auth_board_visible(d.id))
);
create policy preview_object_delete on storage.objects for delete to authenticated using (
  bucket_id = 'dashboard-previews' and (storage.foldername(name))[2] = (select auth.uid())::text
);

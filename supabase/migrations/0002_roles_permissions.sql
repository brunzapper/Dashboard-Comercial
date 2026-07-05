-- Versão: 1.0 | Data: 04/07/2026
-- Papéis, permissões e vínculos. As duas camadas de permissão da Parte 1.4
-- (editar valor vs criar/alterar coluna) são permissões distintas aqui.
-- Idempotente.

create table if not exists public.roles (
  key text primary key,
  label text not null
);

create table if not exists public.permissions (
  key text primary key,
  label text not null
);

create table if not exists public.role_permissions (
  role_key text not null references public.roles (key) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role_key, permission_key)
);

create table if not exists public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role_key text not null references public.roles (key) on delete cascade,
  primary key (user_id, role_key)
);

create index if not exists idx_user_roles_user on public.user_roles (user_id);

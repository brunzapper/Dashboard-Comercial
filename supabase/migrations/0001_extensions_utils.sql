-- Versão: 1.0 | Data: 04/07/2026
-- Extensões e utilitários compartilhados.
-- Idempotente: pode ser reaplicado sem quebrar.

-- gen_random_uuid() e funções de hash.
create extension if not exists pgcrypto;

-- Trigger genérico para manter updated_at.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

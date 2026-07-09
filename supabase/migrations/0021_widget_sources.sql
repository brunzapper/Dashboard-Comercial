-- Versão: 1.0 | Data: 09/07/2026
-- Fase 8: seleção de fontes por widget. `sources` guarda quais fontes o widget
-- usa (subconjunto de 'leads'|'deals'|'estudo'; vazio = todas). `split_by_source`
-- liga o modo "quebrar por fonte" (série por fonte) em vez de combinar tudo.
-- Idempotente.

alter table public.widgets
  add column if not exists sources jsonb not null default '[]'::jsonb,
  add column if not exists split_by_source boolean not null default false;

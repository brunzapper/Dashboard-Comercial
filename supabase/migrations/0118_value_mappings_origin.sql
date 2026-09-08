-- 0118_value_mappings_origin.sql
-- Versão: 1.0 | Data: 07/08/2026
-- ORIGEM das entradas do de-para (0117): 'manual' (página), 'seed' (import do
-- cache legado do Apps Script), 'auto' (classificador heurístico portado do
-- V5 — lib/mappings/classify/*) e 'ai' (assistente de IA, contrato
-- mapeamentos-classify). Informativa (badge na página; permite revisar o que
-- foi atribuído automaticamente) — nunca muda a semântica do lookup.
-- Backfill: as linhas existentes viram 'seed' (aproximação documentada — na
-- data desta migração praticamente tudo veio do seed de 07/08/2026; entradas
-- manuais criadas entre o seed e o deploy ficam rotuladas como seed, sem
-- efeito funcional). Idempotente.

alter table public.value_mappings
  add column if not exists origin text not null default 'manual'
    check (origin in ('manual', 'seed', 'auto', 'ai'));

-- Backfill único: marca como 'seed' o que existia antes da coluna (o default
-- 'manual' só passa a valer para linhas novas). Guarda de idempotência: só
-- reclassifica enquanto nenhuma linha tiver origem não-manual.
update public.value_mappings
set origin = 'seed'
where origin = 'manual'
  and not exists (select 1 from public.value_mappings where origin <> 'manual');

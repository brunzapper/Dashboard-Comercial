-- ============================================================================
-- Versão: 1.0 | Data: 05/07/2026
-- BLOCO ÚNICO — FASE 3 — colar no SQL Editor do Supabase APÓS a Fase 2.
-- Índice funcional para localizar lead por e-mail (migração 0013).
-- Idempotente.
-- ============================================================================

-- >>>>>>>>>>>>>>>>>>>> migrations/0013_lead_email_index.sql <<<<<<<<<<<<<<<<<<<<
-- Versão: 1.0 | Data: 05/07/2026
-- Índice funcional para localizar o lead pelo e-mail (custom_fields.email),
-- usado no match "venda do site → lead relacionado" da Fase 3. Idempotente.

create index if not exists idx_records_lead_email
  on public.records ((lower(custom_fields ->> 'email')))
  where record_type = 'lead';

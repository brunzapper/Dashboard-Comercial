-- Versão: 1.0 | Data: 05/07/2026
-- Índice funcional para localizar o lead pelo e-mail (custom_fields.email),
-- usado no match "venda do site → lead relacionado" da Fase 3. Idempotente.

create index if not exists idx_records_lead_email
  on public.records ((lower(custom_fields ->> 'email')))
  where record_type = 'lead';

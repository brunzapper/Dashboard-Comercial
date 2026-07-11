-- Versão: 1.0 | Data: 11/07/2026
-- Write-back configurável: quando um campo com write_back=true é editado no app,
-- a mudança é enfileirada (bitrix_writeback_queue) e enviada de volta ao Bitrix
-- (crm.deal/lead.update). Só faz sentido em campos de origem Bitrix (têm
-- source_field_id); a UI de Campos só expõe o toggle nesses. Idempotente.

alter table public.field_definitions
  add column if not exists write_back boolean not null default false;

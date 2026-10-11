-- Versão: 1.0 | Data: 11/10/2026
-- Liga as ATIVIDADES dos LEADS do Bitrix (ida e volta), equivalente a
-- Registros → Bases → Leads → "Espelhar tarefas no Bitrix" = "Como atividade
-- do lead". O código já cobre leads (0136/0137/0154); faltava a Base declarar.
-- A descoberta (lib/sync/bitrix/activity-discovery.ts v1.1) percebe o tipo de
-- dono novo e recomeça a varredura: pendentes de qualquer idade + concluídas
-- dos últimos 90 dias (somente leitura). Idempotente.
update public.data_sources
   set bitrix_activity_owner = 'lead'
 where record_type = 'lead'
   and bitrix_activity_owner is null;

-- Conferência:
-- select key, record_type, bitrix_activity_owner from public.data_sources
--  where bitrix_activity_owner is not null;

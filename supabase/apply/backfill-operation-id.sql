-- Versão: 1.0 | Data: 20/07/2026
-- BACKFILL de records.operation_id (coluna DERIVADA): preenche os NULL com a
-- operação priority=1 do responsável do registro. Rode no SQL Editor após
-- criar/alterar vínculos responsável↔operação (Configurações → Responsáveis).
-- Por que existe: o sync só grava operation_id no INSERT (e em UPDATE quando
-- ainda NULL) — vínculos criados DEPOIS deixam registros antigos sem
-- operação, o que afeta dimensões/agrupamentos "por Operação" e restrições
-- de snapshot (allowed_operation_ids). O FILTRO de Operação da visualização
-- NÃO depende desta coluna (resolve vínculo+perfil no server —
-- lib/config/operation-scope.ts). Idempotente; não sobrescreve valor já
-- preenchido (protege alocações manuais).

update public.records r
set operation_id = ro.operation_id
from public.responsible_operations ro
where r.operation_id is null
  and r.responsible_id is not null
  and ro.responsible_id = r.responsible_id
  and ro.priority = 1;

-- Conferência: registros com responsável e ainda sem operação (esperado:
-- responsáveis sem vínculo priority=1).
-- select r.record_type, count(*)
-- from public.records r
-- where r.operation_id is null and r.responsible_id is not null
-- group by 1;

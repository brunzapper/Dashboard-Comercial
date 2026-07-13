-- Versão: 1.0 | Data: 13/07/2026
-- Campos calculados: flag "aceitar número negativo". Quando false, um resultado
-- negativo é grampeado em 0 na materialização (computeFormulaFields). Default
-- true preserva o comportamento atual. Idempotente.
alter table public.field_definitions
  add column if not exists allow_negative boolean not null default true;

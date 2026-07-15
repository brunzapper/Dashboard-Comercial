-- Migração 0049 | Data: 15/07/2026
-- Exibição percentual por campo (numero/calculado/calculado_agg): o valor cru
-- armazenado (ex.: 0.35) passa a EXIBIR como "35%" quando o flag está ligado.
-- Somente exibição — nada gravado em records/custom_fields muda, e a edição
-- continua operando sobre o valor cru. Idempotente (padrão 0036).
alter table public.field_definitions
  add column if not exists show_as_percent boolean not null default false;

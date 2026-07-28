-- Versão: 1.0 | Data: 28/07/2026
-- Campo de período CUSTOM nas BASES (espelho da 0082 das sub-fontes):
-- data_sources.default_period_field passa a aceitar também um campo
-- personalizado de DATA ('custom:<field_key>'), além das colunas core (0060).
-- Caso de uso: base criada por CSV/parceria cujas datas vivem em campos
-- personalizados — as 6 colunas core não servem. O read side já suporta
-- (@period.byType aceita 'custom:' — defaultPeriodFieldBySource →
-- resolveFieldBySource; a regra dos mocks 0052 inspeciona o byType
-- serializado — lib/widgets/mock-reuniao.ts). A validação semântica (campo
-- existe, é de DATA, não é override core da 0086 e se aplica à base) fica na
-- server action (registros/bases). Após adotar um campo custom como período,
-- rode supabase/apply/indices-periodo-custom.sql (já cobre data_sources).
-- NÃO toca as RPCs run_widget_query/_snapshot (não aciona a invariante de
-- espelhamento). Idempotente.

alter table public.data_sources
  drop constraint if exists data_sources_period_field_check;

alter table public.data_sources
  add constraint data_sources_period_field_check check (
    default_period_field in (
      'closed_at', 'opened_at', 'source_created_at', 'source_modified_at',
      'created_at', 'updated_at'
    )
    or default_period_field ~ '^custom:[A-Za-z0-9_]{1,60}$'
  );

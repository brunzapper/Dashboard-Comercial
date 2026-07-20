-- Versão: 1.0 | Data: 20/07/2026
-- Sub-fontes (0078): default_period_field passa a aceitar também um campo
-- personalizado de DATA ('custom:<field_key>'), além das colunas core. Caso
-- de uso: sub-fonte "SQLs" da pai leads datada pela Data Reunião
-- (custom:bitrix_uf_crm_1743441331). O read side já suportava campos custom
-- no @period (byType aceita 'custom:'; a regra dos mocks 0052 inspeciona o
-- byType serializado — lib/widgets/mock-reuniao.ts). A validação semântica
-- (campo existe e é de data) fica na server action (configuracoes/fontes).
-- NÃO toca as RPCs run_widget_query/_snapshot (não aciona a invariante de
-- espelhamento). Idempotente.

alter table public.sub_sources
  drop constraint if exists sub_sources_period_field_check;

alter table public.sub_sources
  add constraint sub_sources_period_field_check check (
    default_period_field in (
      'closed_at', 'opened_at', 'source_created_at', 'source_modified_at',
      'created_at', 'updated_at'
    )
    or default_period_field ~ '^custom:[A-Za-z0-9_]{1,60}$'
  );

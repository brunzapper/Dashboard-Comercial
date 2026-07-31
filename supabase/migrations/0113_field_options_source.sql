-- Versão: 1.0 | Data: 31/07/2026
-- Dropdown VIVO de responsáveis (campo Seleção com options sincronizadas):
-- field_definitions.options_source marca um campo 'selecao' cujas options são
-- REESCRITAS pelo app a partir dos responsáveis ATIVOS PRINCIPAIS (apelidos
-- colapsados — invariante 20), no padrão do refresh do `pipeline` (só as
-- options; rótulo/olho/ordem do admin ficam intactos; não editar à mão).
-- Refresh: pós-sync (syncFieldCatalog), actions de Responsáveis e apply de
-- preset — lib/config/responsible-options.ts. Idempotente.

alter table public.field_definitions
  add column if not exists options_source text
  check (options_source in ('responsibles'));

comment on column public.field_definitions.options_source is
  'Origem viva das options (selecao): ''responsibles'' = reescritas com os responsáveis ativos principais; null = options manuais.';

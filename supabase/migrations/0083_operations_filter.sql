-- Versão: 1.0 | Data: 20/07/2026
-- Operações com FILTROS DE PERFIL: `operations.filter` guarda um
-- WidgetFilter[] (mesmo shape das sub-fontes) que define o RECORTE de dados
-- da operação, além do vínculo por responsáveis (responsible_operations).
-- Consumido no SERVER (lib/config/operation-scope.ts): o filtro de Operação
-- da visualização (filtro_campo/filtro rápido) NUNCA compara a coluna
-- derivada records.operation_id — resolve para responsible_id in (vínculo da
-- subárvore) + estes filtros. Não recria as RPCs (não aciona a invariante de
-- espelhamento). Idempotente.

alter table public.operations
  add column if not exists filter jsonb not null default '[]'::jsonb;

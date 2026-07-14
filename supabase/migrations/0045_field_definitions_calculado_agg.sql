-- Versão: 1.0 | Data: 14/07/2026
-- Campos calculados de AGREGADOS: data_type 'calculado_agg' em field_definitions.
--   Fórmula (jsonb em `formula`, mesma estrutura do 'calculado') cujos operandos
--   são agregações (refs agg:sum|avg|count:<campo>). Diferente do 'calculado'
--   por-registro: NUNCA é materializado em records.custom_fields — é avaliado
--   pelo engine de widgets sobre os totais do recorte (filtros/período), por
--   grupo/subtotal/Total geral. Exibição: número puro ou moeda FIXA
--   (currency_mode='fixed' + currency_code; 'inherit' não se aplica — não há
--   registro para herdar). Sem conversão multi-moeda na v1.
-- Reusa colunas existentes (formula/currency_mode/currency_code/allow_negative);
-- só estende o CHECK de data_type. Idempotente (mesmo padrão da 0017).

do $$
declare
  v_con text;
begin
  select conname into v_con
  from pg_constraint
  where conrelid = 'public.field_definitions'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%data_type%';
  if v_con is not null then
    execute format('alter table public.field_definitions drop constraint %I', v_con);
  end if;
end $$;

alter table public.field_definitions
  add constraint field_definitions_data_type_check
  check (data_type in ('texto', 'numero', 'data', 'selecao', 'moeda', 'booleano', 'calculado', 'calculado_agg'));

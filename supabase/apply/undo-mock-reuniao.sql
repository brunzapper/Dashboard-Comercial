-- Versão: 1.1 | Data: 15/07/2026
-- DESFAZ as Fases 12 e 13 (mock de "Data Reunião" + congelamento + operação).
-- Este é o "código SQL que desfaz" citado na especificação — é o ÚNICO
-- caminho para:
--   1) remover o trigger de congelamento;
--   2) restaurar os valores originais de Data Reunião (Lead e Negócio)
--      zerados pela 0051, a partir do backup `reuniao_freeze_backup`;
--   3) apagar TODOS os leads mock (270 Inbound da 0051 + 32 Outbound da 0053).
-- As operações Inbound/Outbound eventualmente criadas pela 0053 permanecem
-- (remova na tela de Operações, se quiser).
-- Colar no SQL Editor do Supabase. Idempotente.

-- Liga o bypass do trigger nesta sessão (necessário enquanto ele existir).
select set_config('app.reuniao_freeze_bypass', 'on', false);

-- 1) Remove o congelamento.
drop trigger if exists trg_records_reuniao_freeze on public.records;
drop function if exists public.enforce_reuniao_freeze();

-- 2) Restaura os valores originais a partir do backup.
update public.records r
set custom_fields = jsonb_set(
      coalesce(r.custom_fields, '{}'::jsonb),
      array[b.field_key],
      to_jsonb(b.old_value)
    )
from public.reuniao_freeze_backup b
where b.record_id = r.id;

-- 3) Apaga os leads mock.
delete from public.records where is_mock;

select set_config('app.reuniao_freeze_bypass', 'off', false);

-- Limpeza OPCIONAL (descomente se quiser remover também as estruturas).
-- A migração 0052 (regra dos mocks no run_widget_query) pode ficar: com
-- `is_mock` sempre false ela é um no-op. Se remover a COLUNA is_mock, saiba
-- que o app (widgets de lista e a página Registros) filtra por ela — remova
-- só se também reverter o código da Fase 12.
-- drop table if exists public.reuniao_freeze_backup;
-- alter table public.records drop column if exists is_mock;

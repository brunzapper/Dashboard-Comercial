-- Versão: 1.0 | Data: 19/07/2026
-- Backfill do fuso (0079): normaliza valores DATETIME gravados verbatim do
-- Bitrix (portal em Europe/Moscow, +03:00) em records.custom_fields para o
-- horário local de Brasília — o read side inteiro lê o prefixo "YYYY-MM-DD"
-- da string, então uma reunião às 18h+ BRT do dia 17 aparecia como dia 18.
--
-- Escopo INTENCIONAL:
--   - Lista EXPLÍCITA de chaves: field_definitions não guarda o tipo bruto do
--     Bitrix (date vs datetime — toDataType colapsa ambos em 'data'), e campo
--     `date` (calendário puro, ex. data_assinatura) NUNCA pode ser convertido
--     (recuaria um dia). Só entram chaves datetime conhecidas. Outros campos
--     datetime se normalizam sozinhos no próximo Backfill do sync (o mapper
--     v1.4 converte pelo tipo do schema live).
--   - Só valores datetime COM offset (regex): date-only (edições no app,
--     mocks 0051, CSV) e naive não casam — intocados por construção.
--   - snapshot_records fica FORA (decisão de produto: snapshot congelado
--     mantém o que foi capturado).
--   - America/Sao_Paulo não tem horário de verão desde 2019 e os valores são
--     >= 2026 → offset fixo '-03:00', byte-idêntico ao emitido por
--     lib/date/normalize.ts (sem isso o reconcile churnaria).
--   - O trigger de congelamento (0051) roda DE PROPÓSITO sem bypass: valor
--     normalizado que recair antes de 2026-06-01 (reunião 21h-23h59 BRT de
--     31/05) tem a chave removida — regra de negócio vigente.
--   - Sem audit_log e sem tocar field_modified_at/last_synced_at (reescrita
--     de representação, não mudança de dado).
-- Idempotente: '-03:00$' exclui valores já normalizados.
--
-- Para auditar OUTRAS chaves candidatas antes/depois (distribuição de horários
-- por chave; 100% "T00:00:00+03:00" indica semântica de calendário — NÃO
-- converter):
--   select k.field_key, substring(r.custom_fields ->> k.field_key from 12),
--          count(*)
--   from public.records r
--   join (select field_key from public.field_definitions
--         where data_type = 'data' and source_system = 'bitrix') k
--     on r.custom_fields ? k.field_key
--   where r.record_type in ('lead','negocio') and not r.is_mock
--     and (r.custom_fields ->> k.field_key) like '%+03:00'
--   group by 1, 2 order by 1, 3 desc;

with to_fix as (
  select r.id, k.field_key,
         to_char((r.custom_fields ->> k.field_key)::timestamptz
                   at time zone 'America/Sao_Paulo',
                 'YYYY-MM-DD"T"HH24:MI:SS') || '-03:00' as new_val
  from public.records r
  cross join (values
    ('bitrix_uf_crm_1743441331'),   -- Data Reunião (Lead)
    ('bitrix_uf_crm_67eacefcccd98'),-- Data Reunião (Negócio)
    ('bitrix_moved_time')           -- Data da mudança de etapa (MOVED_TIME)
  ) as k(field_key)
  where r.record_type in ('lead', 'negocio')
    and not r.is_mock
    and r.custom_fields ? k.field_key
    and (r.custom_fields ->> k.field_key)
        ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$'
    and (r.custom_fields ->> k.field_key) !~ '-03:00$'
),
agg as (
  select id, jsonb_object_agg(field_key, to_jsonb(new_val)) as patch
  from to_fix
  group by id
)
update public.records r
set custom_fields = r.custom_fields || a.patch
from agg a
where r.id = a.id;

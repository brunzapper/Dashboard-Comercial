-- Versão: 1.0 | Data: 19/07/2026
-- Fuso horário da ORIGEM por fonte: valores de data/hora ingeridos de uma fonte
-- com `timezone` configurado são normalizados para America/Sao_Paulo na ENTRADA
-- (lib/date/normalize.ts, aplicado no mapper do sync). NULL = sem conversão
-- (comportamento histórico). Só campos DATETIME convertem — campo Bitrix tipo
-- `date` é calendário puro e passa inalterado (converter recuaria um dia).
-- `sub_sources` NÃO recebe timezone: subs compartilham os registros (e a
-- ingestão) da fonte pai. A validação de nome IANA real é feita na Server
-- Action (Intl); aqui só um formato plausível. Idempotente.
-- NÃO toca em run_widget_query/_snapshot (regra de espelhamento não acionada).

alter table public.data_sources
  add column if not exists timezone text
  constraint data_sources_timezone_check
  check (timezone is null or timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)+$');

-- Seed: o portal Bitrix opera em Europe/Moscow (+03:00). O guard `is null`
-- preserva edições posteriores do admin em re-runs.
update public.data_sources
set timezone = 'Europe/Moscow'
where key in ('leads', 'deals') and timezone is null;

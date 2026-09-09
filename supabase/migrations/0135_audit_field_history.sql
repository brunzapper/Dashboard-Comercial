-- 0135_audit_field_history.sql
-- Versão: 1.0 | Data: 09/09/2026
-- HISTÓRICO DE ALTERAÇÃO POR CAMPO: o índice que torna barata a pergunta
-- "quando este campo deste registro mudou pela última vez?".
--
-- POR QUE ISSO EXISTE. A âncora `field_changed` da série (0132) e a condição de
-- tempo homônima do motor 0109 liam `records.field_modified_at` — e isso é um
-- ERRO DE DESENHO que só apareceu com dado real: naquele jsonb, `field_modified_at`
-- significa "editado LOCALMENTE, proteja do sync" (`isProtected`,
-- lib/sync/shared.ts), e quem escreve nela é só o app. Para todo campo que vem
-- do Bitrix ela é vazia — nos 36 deals em Nutrição,
-- `count(field_modified_at->>'stage')` era ZERO, e a série simplesmente nunca
-- tinha de onde contar.
--
-- Fazer o sync carimbar `field_modified_at` seria pior que o bug: TODO campo
-- sincronizado viraria "protegido" e o sync pararia de atualizar qualquer coisa.
--
-- O fato certo já estava gravado o tempo todo em `audit_log`, que o sync
-- alimenta a cada valor que muda (lib/sync/bitrix/sync.ts, `audits.push`):
-- 21.341 mudanças de `stage` com origem `sync_bitrix`. É fonte AGNÓSTICA de
-- quem mudou — sync, app ou automação entram na mesma tabela —, que é
-- exatamente a semântica que "desde que mudou de etapa" pede.
--
-- O índice que já existia (`idx_audit_record`) é (record_id, changed_at desc) e
-- não serve: a consulta recorta POR CAMPO, e sem `field` na chave o Postgres
-- varreria todo o histórico do registro para achar a última linha de um campo
-- só. Registro movimentado tem centenas de linhas.
--
-- Só um índice. Nenhuma coluna, nenhuma policy, nenhuma linha de dado tocada.
-- Idempotente.

create index if not exists idx_audit_record_field
  on public.audit_log (record_id, field, changed_at desc);

comment on index public.idx_audit_record_field is
  'Última alteração por (registro, campo) — âncora field_changed da série (0132) e condição de tempo do motor 0109. Ver lib/records/field-history.ts.';

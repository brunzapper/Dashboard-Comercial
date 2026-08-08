-- Versão: 1.0 | Data: 07/08/2026
-- SUBSTITUIÇÃO TOTAL da base Meetime (`meetime_outbound`) pelo relatório
-- report_leads_20260807 do Meetime (6.107 linhas; a base tinha 4.053 registros
-- de um export anterior do MESMO relatório). Executado via MCP/SQL Editor +
-- POST /api/ingest/meetime_outbound (motor real: ingestRows ancora datas core
-- em Brasília — invariante 11 —, materializa fórmulas e resolve responsáveis).
-- Este arquivo é o RUNBOOK da operação: registra o que foi feito, as queries de
-- conferência e o rollback. NÃO é idempotente nem re-executável às cegas — os
-- dados novos entram pela API (nada de PII neste arquivo).
--
-- Contexto/decisões:
--   * "Meetime inbound" do pedido = decisão do usuário: substituir a base
--     INTEIRA (o CSV novo traz Tipo Inbound + Outbound; coluna nova `Tipo`
--     mapeada para custom:tipo, field_definitions criada como no
--     prepareImportFields, source_field_id 'meetime_outbound:tipo').
--   * Dedup do import: coluna "URL pública" (única por linha no relatório) —
--     gravada em api_keys.dedup_columns; reimports futuros com a MESMA chave
--     de API fazem upsert limpo. Chave criada só p/ a operação e REVOGADA ao
--     final (Configurações → Integrações mostra a trilha).
--   * A cauda da rota de ingestão (runAutoMatch + recalcAllFormulaFields +
--     maybeApplyMappingsAfterImport) estoura os 60s da função (504) com a base
--     neste tamanho — as LINHAS persistem (ingest roda antes da cauda) e a
--     cauda foi replicada abaixo (matches em SQL espelhando o motor;
--     classificação rodando lib/mappings/classify/* reais via tsx; alvos do
--     de-para em UPDATE set-based espelhando planMappingWrites/applyDomain).
--   * "Paulo Vitor" do arquivo = "Paulo Vitor Santos": vínculo de apelido via
--     responsibles.canonical_id (0101) — registros NÃO são repontados.
--   * NÃO rodar supabase/apply/backfill-naive-tz.sql de novo (one-shot já
--     executado em 26/07/2026; registros novos já entram ancorados).
--   * Snapshots congelados preservam os números antigos por design
--     (snapshot_records sem FK) — atualizar pela UI se desejado.

-- ============ 1) Backup (ANTES do delete) ============
create table if not exists public.backup_meetime_20260807 as
  select * from public.records where record_type = 'meetime_outbound';
-- RLS on sem policies = acesso só via service role.
alter table public.backup_meetime_20260807 enable row level security;

-- ============ 2) Vínculo de apelido do responsável ============
-- "Paulo Vitor" (ad1662ee…) vira apelido de "Paulo Vitor Santos" (31123e76…).
-- Pré-conferido: ninguém aponta para ad1662ee como canônico (grupo segue plano).
update public.responsibles
   set canonical_id = '31123e76-3e54-4816-8930-9cb66d10d322'
 where id = 'ad1662ee-d9cc-4c3b-b351-432b7ad97e04'
   and canonical_id is null;

-- ============ 3) Delete escopado ============
-- Sem mocks na base (conferido); cascatas limpam audit_log, record_matches,
-- kanban_placements, tasks e comments. Nenhum webhook de saída ativo.
delete from public.records
 where record_type = 'meetime_outbound'
   and is_mock = false;

-- ============ 4) Carga ============
-- POST /api/ingest/meetime_outbound em chunks de 250 linhas (Bearer da chave
-- criada p/ a operação; mapping = 35 colunas espelhando o import anterior +
-- custom:tipo; dedup ["URL pública"]). ATENÇÃO operacional: chunks de 400
-- linhas quebram o "select existentes" do ingest (querystring de source_ids
-- acima do limite do PostgREST → Bad Request); 250–300 funciona (o wizard usa
-- 300). O 504 da rota é só a cauda — conferir o resultado REAL em
-- webhook_inbound_events.result (inserted/errors por chunk).

-- ============ 5) Cauda replicada: record_matches ============
-- Regra "Meets Outbound" (match_rules 93dd9875…): lead.custom:bitrix_uf_crm_1753299252
-- ↔ meetime.custom:e_mail, fallback title ↔ title. matchKey do motor
-- (normalizeName): trim + lower + sem acentos + espaços colapsados; primeiro
-- vence por chave; nunca sobrescreve par existente. Idempotente.
with b1 as (
  select distinct on (k) k, id from (
    select nullif(regexp_replace(unaccent(lower(trim(custom_fields->>'e_mail'))), '\s+', ' ', 'g'), '') as k,
           id, created_at
      from public.records
     where record_type = 'meetime_outbound' and is_mock = false
  ) t where k is not null
  order by k, created_at, id
), b2 as (
  select distinct on (k) k, id from (
    select nullif(regexp_replace(unaccent(lower(trim(title))), '\s+', ' ', 'g'), '') as k,
           id, created_at
      from public.records
     where record_type = 'meetime_outbound' and is_mock = false
  ) t where k is not null
  order by k, created_at, id
), a as (
  select id,
         nullif(regexp_replace(unaccent(lower(trim(custom_fields->>'bitrix_uf_crm_1753299252'))), '\s+', ' ', 'g'), '') as k1,
         nullif(regexp_replace(unaccent(lower(trim(title))), '\s+', ' ', 'g'), '') as k2
    from public.records
   where record_type = 'lead'
), pairs as (
  select a.id as record_a_id,
         coalesce(b1.id, b2.id) as record_b_id,
         case when b1.id is not null
              then 'custom:bitrix_uf_crm_1753299252' else 'title' end as matched_on
    from a
    left join b1 on b1.k = a.k1
    left join b2 on b2.k = a.k2 and b1.id is null
   where coalesce(b1.id, b2.id) is not null
)
insert into public.record_matches
  (record_a_id, record_b_id, rule_id, mode, matched_on, organization_id)
select distinct on (record_a_id, record_b_id)
       record_a_id, record_b_id,
       '93dd9875-5493-4658-8ef5-6b08b7209003', 'auto', matched_on,
       '00000000-0000-4000-a000-000000000001'
  from pairs
on conflict (record_a_id, record_b_id) do nothing;

-- ============ 6) Cauda replicada: de-para (0117) ============
-- 6a. Valores pendentes (sem entrada) saíram de records + value_mappings; a
--     classificação rodou os módulos REAIS lib/mappings/classify/{cargo,segmento}.ts
--     (tsx local, autoClassifyValues) e as entradas entraram com origin='auto'
--     via upsert ignoreDuplicates (nunca sobrescreve manual/seed/IA).
--     Divergência aceita: o banco de palavras APRENDIDO só alimentou o domínio
--     segmento (dump leve); p/ cargo rodou só o classificador específico V5 —
--     residual fica "Não Classificado" e a PRÓXIMA aplicação real
--     (maybeApplyMappingsAfterImport de um import futuro) cobre.
-- 6b. Alvos derivados (espelha planMappingWrites/applyDomain: lookup por
--     lower(trim), fallback "Não Classificado" — inclusive vazio —, carimbos
--     field_modified_at + locally_modified_at, só diferenças, mock fora).
--     Template (cargo; segmento é análogo com segmento_classificado):
--
--   update public.records r
--      set custom_fields = r.custom_fields
--            || jsonb_build_object('cargo_area', d.area, 'cargo_nivel', d.nivel),
--          field_modified_at = coalesce(r.field_modified_at, '{}'::jsonb)
--            || jsonb_build_object('cargo_area', to_jsonb(now()), 'cargo_nivel', to_jsonb(now())),
--          locally_modified_at = now()
--     from (
--       select rr.id,
--              coalesce(nullif(trim(vm.outputs->>'cargo_area'), ''), 'Não Classificado') as area,
--              coalesce(nullif(trim(vm.outputs->>'cargo_nivel'), ''), 'Não Classificado') as nivel
--         from public.records rr
--         left join public.value_mappings vm
--           on vm.organization_id = rr.organization_id
--          and vm.domain = 'cargo'
--          and vm.raw_norm = lower(trim(rr.custom_fields->>'cargo'))
--        where rr.record_type = 'meetime_outbound' and rr.is_mock = false
--     ) d
--    where d.id = r.id
--      and (r.custom_fields->>'cargo_area'  is distinct from d.area
--        or r.custom_fields->>'cargo_nivel' is distinct from d.nivel);

-- ============ 7) Conferência (rodar após a carga) ============
-- select count(*) from public.records where record_type='meetime_outbound';
--   -- esperado: 6107
-- select custom_fields->>'tipo', count(*) from public.records
--  where record_type='meetime_outbound' group by 1;
--   -- esperado: Inbound 2998 | Outbound 3109
-- select custom_fields->>'status', count(*) from public.records
--  where record_type='meetime_outbound' group by 1 order by 2 desc;
--   -- esperado: Perdido 3903 | Esperando início 1517 | Ativo 481 | Ganho 101 | …
-- select count(*) from public.record_matches rm
--   join public.records rb on rb.id = rm.record_b_id
--  where rb.record_type='meetime_outbound';
--   -- antes da operação: 1408 (magnitude esperada; CSV novo tem mais linhas)
-- select count(*) filter (where custom_fields->>'cargo_area' is null) as sem_area
--   from public.records where record_type='meetime_outbound';
--   -- esperado: 0 após o passo 6b

-- ============ 8) Rollback (se necessário) ============
-- delete from public.records where record_type='meetime_outbound' and is_mock=false;
-- insert into public.records select * from public.backup_meetime_20260807;
-- -- e re-rodar o passo 5 p/ os matches. O backup fica até a operação ser
-- -- validada; depois: drop table public.backup_meetime_20260807;

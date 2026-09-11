-- Versão: 1.1 | Data: 11/09/2026
-- LIMPEZA PONTUAL: 3 registros ÓRFÃOS da base "Estudo de Fechamentos"
-- (source_system='sheet_site', record_type='venda_site'), enviados à Lixeira.
-- APLICADO em produção em 11/09/2026 — este arquivo é o registro do que foi
-- rodado e o roteiro para desfazer.
--
-- POR QUE EXISTIAM: até 11/09/2026 a identidade da linha da planilha era
-- `sha256(normalizeName(nome) | data)` (lib/sync/sheets/adapter.ts), ou seja,
-- derivada de conteúdo MUTÁVEL. Quem editou o "Name" na aba Site em agosto/2026
-- (acrescentando o sufixo entre parênteses) mudou o hash: o adapter não achou a
-- linha existente e INSERIU um registro novo, deixando o antigo órfão — ele
-- seguia somando nos dashboards ao lado do substituto. Os pares (mesmo dia,
-- mesmo valor, MESMO E-MAIL):
--   10/08  Instituto Beltronense de Ortopedia e Traumatologia  -> ... (Agencia Gabana)
--   24/08  GRUPO SAFEROC                                       -> GRUPO SAFEROC (KTS)
--   26/08  Ami Industria                                       -> Ami Industria (feratex)
-- A recorrência foi fechada na MESMA entrega pela ADOÇÃO por impressão digital
-- (e-mail + dia) no adapter: renomear passou a ser UPDATE do mesmo registro.
-- Este arquivo trata só o passivo que a correção não alcança retroativamente.
--
-- SEGURANÇA: soft delete da 0121 — restaurável por 30 dias em /registros
-- (Lixeira); a purga definitiva é do pg_cron. Verificado antes de rodar: os 3
-- não tinham record_matches, comments, tasks, record_attributes,
-- kanban_placements nem linha em snapshot_records; nenhum era apontado por
-- related_lead_id ou por comp_entries.mirror_record_id.
--
-- O `set_config` é OBRIGATÓRIO: enviar à Lixeira é UPDATE de deleted_at e o
-- trigger enforce_records_trash_guard (0121) exige auth_has_role('admin') —
-- falso em SQL direto/service role (auth.uid() é NULL). O `true` deixa o escape
-- confinado à transação (precedente: delete_organization, 0093). O bloco DO
-- existe por causa disso: precisa ser UMA transação, e é o que faz o arquivo
-- rodar igual no SQL Editor e por conexão que dá autocommit por statement.
--
-- Idempotente: os alvos são capturados ANTES do update filtrando
-- `deleted_at is null`, então a 2ª execução não altera nada nem duplica a
-- linha de auditoria.

do $$
declare
  v_ids uuid[];
begin
  select array_agg(id) into v_ids
  from public.records
  where id in (
      'fa1157c9-f734-48a0-a89f-eb33c590db25',  -- Instituto Beltronense (sem sufixo)
      'ef7a620d-60b9-43e6-92fa-8afd1fbf4147',  -- GRUPO SAFEROC (sem sufixo)
      'ae7e19cb-f6e7-4564-8d4d-eb5f28d9d825'   -- Ami Industria (sem sufixo)
    )
    and record_type = 'venda_site'
    and source_system = 'sheet_site'
    and deleted_at is null;

  if v_ids is null or array_length(v_ids, 1) is null then
    raise notice 'nada a fazer (já estão na Lixeira)';
    return;
  end if;

  perform set_config('app.allow_protected_change', 'on', true);

  update public.records set deleted_at = now() where id = any(v_ids);

  -- Mesma auditoria que a Lixeira pela UI grava (lib/records/trash-actions.ts):
  -- sem ela o registro some do dashboard sem deixar rastro de quando.
  insert into public.audit_log (record_id, field, old_value, new_value, user_id, origin)
  select unnest(v_ids), 'deleted_at', null, to_jsonb(now()), null, 'app';

  raise notice 'enviados à Lixeira: %', array_length(v_ids, 1);
end $$;

-- Conferência (esperado: 3 linhas com deleted_at preenchido; agosto/2026 fecha
-- com 13 registros e R$ 3.960 em `value`):
-- select id, title, deleted_at from public.records where id in (
--   'fa1157c9-f734-48a0-a89f-eb33c590db25',
--   'ef7a620d-60b9-43e6-92fa-8afd1fbf4147',
--   'ae7e19cb-f6e7-4564-8d4d-eb5f28d9d825');
--
-- Desfazer (dentro dos 30 dias): restaure em /registros → Lixeira (caminho
-- normal, com auditoria), ou em SQL:
-- do $$ begin
--   perform set_config('app.allow_protected_change', 'on', true);
--   update public.records set deleted_at = null where id in (
--     'fa1157c9-f734-48a0-a89f-eb33c590db25',
--     'ef7a620d-60b9-43e6-92fa-8afd1fbf4147',
--     'ae7e19cb-f6e7-4564-8d4d-eb5f28d9d825');
-- end $$;

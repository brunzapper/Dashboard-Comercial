-- 0140_sheet_push_sweep.sql
-- Versão: 1.0 | Data: 11/09/2026
-- VARREDURA DO PUSH DA PLANILHA: registro que deixou de existir na planilha vai
-- para a LIXEIRA (0121), em vez de viver no app para sempre.
--
-- POR QUE: o adapter da planilha (lib/sync/sheets/adapter.ts) é upsert puro —
-- ele sabe o que CHEGOU, nunca o que SUMIU. Apagar uma linha da aba Site não
-- tinha efeito nenhum aqui. Com a ADOÇÃO por impressão digital (v1.5 do
-- adapter, mesma entrega) renomear virou UPDATE, então esta varredura passa a
-- disparar só em remoção REAL — e qualquer estouro do teto abaixo é sinal de
-- bug, não rotina.
--
-- O PROBLEMA DE ENQUADRAMENTO: o Apps Script fatia o envio em chunks de ≤500
-- linhas e cada chunk é um POST separado, então NENHUM request isolado vê a
-- planilha inteira. Daí as duas tabelas: o push ganha um id (`push_id`, gerado
-- no .gs), cada chunk deposita as chaves naturais que viu em `sync_push_seen`,
-- e a varredura só roda quando o ÚLTIMO chunk chega. Chunk que falha aborta os
-- seguintes no .gs ⇒ o último nunca chega ⇒ nada é varrido. Fail-closed pela
-- ESTRUTURA, não por uma checagem que alguém possa esquecer de fazer.
--
-- `chunks_seen` é ARRAY, não contador: chunk reenviado (retry) não pode
-- completar o quadro duas vezes. `poisoned` marca o push cujo conjunto visto
-- está incompleto (erro no adapter ou falha ao gravar o staging) — sem isso a
-- varredura rodaria sobre uma planilha meio-lida e apagaria o que faltou.
--
-- O `set_config` dentro da função é o ponto central: enviar à Lixeira é UPDATE
-- de `deleted_at` e o trigger enforce_records_trash_guard (0121) exige
-- auth_has_role('admin'), que resolve por auth.uid() — NULL no service role.
-- Então a rota nunca passaria. E o GUC não é setável pelo PostgREST de fora,
-- porque cada statement é sua própria transação e o `true` do set_config é
-- local. SECURITY DEFINER resolve os dois de uma vez, e mantém o escape
-- CONFINADO (precedente: delete_organization, 0093). Afrouxar o trigger para um
-- papel de sync seria enfraquecer a invariante 30 para todos os caminhos.
--
-- Os RPCs de widget ficam INTOCADOS (invariante 1 não é acionada): a lixeira já
-- entra em run_widget_query/_snapshot desde a 0121, então o registro varrido
-- some das consultas sem tocar em SQL de widget.
-- Idempotente.

-- ===================== 1) Enquadramento do push =====================
create table if not exists public.sync_push_runs (
  push_id         uuid primary key,
  source_system   text not null,
  record_type     text not null,
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
                    references public.organizations (id) on delete cascade,
  chunks_expected int  not null check (chunks_expected > 0),
  -- Quais chunks chegaram (1-based). Array e não contador: retry não conta 2x.
  chunks_seen     int[] not null default '{}',
  rows_seen       int  not null default 0,
  -- Conjunto visto INCOMPLETO: a varredura recusa. Ver cabeçalho.
  poisoned        boolean not null default false,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  swept_count     int,
  sweep_status    text
);

create index if not exists idx_sync_push_runs_started
  on public.sync_push_runs (started_at);

create table if not exists public.sync_push_seen (
  push_id   uuid not null references public.sync_push_runs (push_id) on delete cascade,
  source_id text not null,
  primary key (push_id, source_id)
);

-- Sem policies: só service role (padrão comp_sheet_export_tickets, 0115 — RLS
-- não expressa "o Apps Script autenticado por SYNC_SECRET"). Belt-and-braces
-- nos grants (padrão 0114).
alter table public.sync_push_runs enable row level security;
alter table public.sync_push_seen enable row level security;
revoke all on public.sync_push_runs from anon;
revoke all on public.sync_push_seen from anon;
revoke insert, update, delete on public.sync_push_runs from authenticated;
revoke insert, update, delete on public.sync_push_seen from authenticated;

-- ============ 1b) Registro de um chunk (upsert + append atômico) ============
-- Por que função e não upsert do PostgREST: `chunks_seen` é array e o append
-- precisa ser atômico com o upsert do run. Fazer read-modify-write da rota
-- abriria janela para dois chunks se sobrescreverem e o quadro nunca fechar
-- (ou, pior, fechar com um chunk faltando).
create or replace function public.sync_push_record_chunk(
  p_push_id         uuid,
  p_source_system   text,
  p_record_type     text,
  p_organization_id uuid,
  p_chunk           int,
  p_chunks          int,
  p_source_ids      text[],
  p_poisoned        boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.sync_push_runs (
    push_id, source_system, record_type, organization_id,
    chunks_expected, chunks_seen, rows_seen, poisoned)
  values (
    p_push_id, p_source_system, p_record_type, p_organization_id,
    p_chunks, array[p_chunk], coalesce(array_length(p_source_ids, 1), 0), p_poisoned)
  on conflict (push_id) do update set
    -- Chunk repetido (retry) não entra de novo: o quadro fecha uma vez só.
    chunks_seen = (
      select array(
        select distinct unnest(public.sync_push_runs.chunks_seen || array[p_chunk])
      )),
    rows_seen = public.sync_push_runs.rows_seen
                + coalesce(array_length(p_source_ids, 1), 0),
    -- Envenenado é ESTADO ABSORVENTE: um chunk ruim invalida o push inteiro.
    poisoned = public.sync_push_runs.poisoned or p_poisoned;

  if p_source_ids is not null and array_length(p_source_ids, 1) > 0 then
    insert into public.sync_push_seen (push_id, source_id)
    select p_push_id, unnest(p_source_ids)
    on conflict do nothing;
  end if;
end;
$$;

revoke execute on function public.sync_push_record_chunk(uuid, text, text, uuid, int, int, text[], boolean)
  from public, anon, authenticated;
grant execute on function public.sync_push_record_chunk(uuid, text, text, uuid, int, int, text[], boolean)
  to service_role;

-- ===================== 2) A varredura =====================
create or replace function public.sheet_push_sweep(
  p_push_id       uuid,
  p_max_ratio     numeric default 0.10,
  p_min_rows      int     default 1,
  p_dry_run       boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run       public.sync_push_runs%rowtype;
  v_total     int;
  v_missing   int;
  v_curated   int;
  v_limit     int;
  v_ids       uuid[];
  v_sample    text[];
begin
  select * into v_run from public.sync_push_runs where push_id = p_push_id;
  if not found then
    return jsonb_build_object('status', 'unknown_push');
  end if;

  -- Uma varredura por push: reentrada (retry do último chunk) não repete.
  if v_run.finished_at is not null then
    return jsonb_build_object('status', 'already_swept',
                              'swept', coalesce(v_run.swept_count, 0));
  end if;

  if v_run.poisoned then
    return jsonb_build_object('status', 'refused_poisoned');
  end if;

  -- Quadro incompleto = push parcial. Nunca varre.
  if coalesce(array_length(v_run.chunks_seen, 1), 0) <> v_run.chunks_expected then
    return jsonb_build_object(
      'status', 'refused_incomplete',
      'chunks_seen', coalesce(array_length(v_run.chunks_seen, 1), 0),
      'chunks_expected', v_run.chunks_expected);
  end if;

  -- Push sem nenhuma linha: planilha vazia/ilegível. Varrer aqui zeraria a base.
  if v_run.rows_seen = 0 then
    return jsonb_build_object('status', 'refused_empty');
  end if;

  select count(*) into v_total
  from public.records r
  where r.record_type = v_run.record_type
    and r.source_system = v_run.source_system
    and r.organization_id = v_run.organization_id
    and r.deleted_at is null
    and r.is_mock = false
    and r.source_id is not null;

  select coalesce(array_agg(r.id), '{}'),
         coalesce(array_agg(r.title) filter (where r.title is not null), '{}')
    into v_ids, v_sample
  from public.records r
  where r.record_type = v_run.record_type
    and r.source_system = v_run.source_system
    and r.organization_id = v_run.organization_id
    and r.deleted_at is null
    and r.is_mock = false
    and r.source_id is not null
    and not exists (
      select 1 from public.sync_push_seen s
      where s.push_id = p_push_id and s.source_id = r.source_id
    );

  v_missing := coalesce(array_length(v_ids, 1), 0);

  if v_missing = 0 then
    update public.sync_push_runs
    set finished_at = now(), swept_count = 0, sweep_status = 'done'
    where push_id = p_push_id;
    return jsonb_build_object('status', 'done', 'total', v_total, 'swept', 0);
  end if;

  -- Quantos dos que sairiam carregam curadoria manual: não bloqueia, mas é o
  -- número que merece olho no log (58 dos 94 registros tinham, em 09/2026).
  select count(*) into v_curated
  from public.records r
  where r.id = any(v_ids) and r.field_modified_at <> '{}'::jsonb;

  -- TETO: planilha truncada, filtrada ou lida pela metade nunca zera a base.
  v_limit := greatest(ceil(v_total * p_max_ratio)::int, p_min_rows);
  if v_missing > v_limit then
    update public.sync_push_runs
    set finished_at = now(), swept_count = 0, sweep_status = 'refused_cap'
    where push_id = p_push_id;
    return jsonb_build_object(
      'status', 'refused_cap', 'total', v_total, 'missing', v_missing,
      'limit', v_limit, 'curated', v_curated,
      'sample', to_jsonb(v_sample[1:10]));
  end if;

  if p_dry_run then
    update public.sync_push_runs
    set finished_at = now(), swept_count = 0, sweep_status = 'dry_run'
    where push_id = p_push_id;
    return jsonb_build_object(
      'status', 'dry_run', 'total', v_total, 'would_sweep', v_missing,
      'curated', v_curated, 'sample', to_jsonb(v_sample[1:10]));
  end if;

  -- Atravessa o enforce_records_trash_guard (0121) SÓ nesta transação.
  perform set_config('app.allow_protected_change', 'on', true);

  update public.records set deleted_at = now() where id = any(v_ids);

  -- Mesma auditoria da Lixeira pela UI (lib/records/trash-actions.ts): o
  -- registro nunca some do dashboard sem rastro.
  insert into public.audit_log (record_id, field, old_value, new_value, user_id, origin)
  select unnest(v_ids), 'deleted_at', null, to_jsonb(now()), null, 'sync_sheet';

  update public.sync_push_runs
  set finished_at = now(), swept_count = v_missing, sweep_status = 'done'
  where push_id = p_push_id;

  return jsonb_build_object(
    'status', 'done', 'total', v_total, 'swept', v_missing,
    'curated', v_curated, 'sample', to_jsonb(v_sample[1:10]));
end;
$$;

revoke execute on function public.sheet_push_sweep(uuid, numeric, int, boolean)
  from public, anon, authenticated;
grant execute on function public.sheet_push_sweep(uuid, numeric, int, boolean)
  to service_role;

-- ===================== 3) Limpeza dos runs antigos =====================
-- Push parcial deixa run + seen para trás. A rota chama isto no primeiro chunk
-- (barato: índice em started_at); o cascade leva o sync_push_seen junto.
create or replace function public.sync_push_purge_stale(p_days int default 2)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.sync_push_runs
  where started_at < now() - make_interval(days => p_days);
$$;

revoke execute on function public.sync_push_purge_stale(int)
  from public, anon, authenticated;
grant execute on function public.sync_push_purge_stale(int) to service_role;

-- 0132_task_series.sql
-- Versão: 1.0 | Data: 09/09/2026
-- SÉRIE DE TAREFAS PERIÓDICAS: a cobrança recorrente que uma automação mantém
-- sobre um registro ("enquanto o deal estiver em Nutrição, abra uma tarefa a
-- cada quinze dias").
--
-- POR QUE A TRAVA DA 0129 NÃO SERVE. Lá, `create_task` tem no máximo UMA tarefa
-- ABERTA por regra × registro: a regra cobra de novo só depois que a anterior é
-- concluída. Uma série é o contrário — a 3ª quinzena vence tenha ou não a 2ª
-- sido feita, e é exatamente ver a 2ª em aberto ao lado da 3ª que mostra como o
-- vendedor está conduzindo. A trava certa é por OCORRÊNCIA.
--
-- A OCORRÊNCIA É DERIVADA, NUNCA CONTADA: `floor((hoje - âncora) / cadência)`.
-- O tick calcula qual cobrança está devida hoje e tenta criá-la; repetir esbarra
-- no índice único e é NO-OP (23505 tratado como no-op, nunca last_error — o
-- precedente literal da 0129). Não há coluna de "última execução": o tick roda a
-- cada minuto e pode pular rodadas (deploy, orçamento de tempo), e um contador
-- incremental erraria a conta na primeira rodada perdida sem ninguém notar.
-- Derivar reconstrói sempre a mesma sequência a partir dos fatos.
--
-- `series_settings` guarda as EXCEÇÕES da cadência e o liga/desliga por recorte.
-- O padrão e a ordem de precedência vivem no esquema (o construtor declara quem
-- pode sobrescrever); a exceção é DADO, editável por um gestor na Tree sem abrir
-- o construtor. A mesma linha resolve "o João é mensal" e "o João não
-- participa" — quem sabe dizer uma sabe dizer a outra.
--
-- Idempotente. Não recria RPC nenhuma.

-- ------------------------------------------------------- tarefas da série --
alter table public.tasks
  -- Identidade da série (vem da ação da regra). Carimbada na tarefa para a
  -- Tree reconhecer o tronco e para o painel de exceções achar as cobranças.
  add column if not exists series_key text,
  -- N-ésima cobrança. DERIVADA da âncora e da cadência — ver lib/series.
  add column if not exists series_occurrence integer;

-- A TRAVA: uma tarefa por (regra, registro, ocorrência), para sempre.
-- Sem `where completed_at is null` de propósito: concluir a 2ª quinzena não
-- pode fazer a 2ª nascer de novo — ela já aconteceu. Quem traz a próxima é o
-- calendário, não o estado da anterior.
create unique index if not exists uq_tasks_series_occurrence
  on public.tasks (automation_rule_id, record_id, series_occurrence)
  where automation_rule_id is not null
    and record_id is not null
    and series_occurrence is not null;

-- A Tree lê as cobranças de um registro em ordem.
create index if not exists idx_tasks_series
  on public.tasks (record_id, series_key, series_occurrence)
  where series_key is not null;

comment on column public.tasks.series_occurrence is
  'N-ésima cobrança de uma série periódica, DERIVADA de floor((hoje - âncora)/cadência) — nunca um contador. Junto de (automation_rule_id, record_id) forma a trava uq_tasks_series_occurrence; o tick roda a cada minuto e recriar a mesma ocorrência é no-op.';

-- ------------------------------------------------- exceções da cadência ---
create table if not exists public.series_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
    references public.organizations (id) on delete cascade,
  -- Série a que a exceção se aplica (tasks.series_key / config da ação).
  series_key text not null,
  -- Em que recorte a exceção vale. `field` guarda "<ref>=<valor>" em
  -- scope_value (ex.: "stage=Nutrição") — é o que atende "ou qualquer outro
  -- campo do registro" sem uma coluna por campo.
  scope_kind text not null check (scope_kind in ('record', 'responsible', 'field')),
  scope_value text not null,
  -- null = a linha não mexe na cadência (existe só para ligar/desligar).
  cadence_days integer check (cadence_days is null or (cadence_days between 1 and 365)),
  -- false desliga a série NAQUELE recorte. Um "não" vence qualquer cadência
  -- mais específica (ver resolveCadence).
  active boolean not null default true,
  note text,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_series_settings_scope
  on public.series_settings (organization_id, series_key, scope_kind, scope_value);

create index if not exists idx_series_settings_series
  on public.series_settings (organization_id, series_key);

drop trigger if exists trg_series_settings_updated on public.series_settings;
create trigger trg_series_settings_updated
  before update on public.series_settings
  for each row execute function public.set_updated_at();

alter table public.series_settings enable row level security;

-- Leitura org-wide: a cadência de uma cobrança é contexto de quem opera (o
-- vendedor precisa saber por que a tarefa dele é mensal), e a linha não carrega
-- dado de negócio.
drop policy if exists series_settings_select on public.series_settings;
create policy series_settings_select on public.series_settings
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

-- Escrita: admin/gestor. Mudar a cadência de um responsável ou desligá-lo é
-- decisão de gestão — o próprio vendedor mudando a própria cobrança esvazia o
-- acompanhamento. A exceção POR REGISTRO segue a mesma regra: quem conduz o
-- acompanhamento decide, não quem é cobrado.
drop policy if exists series_settings_write on public.series_settings;
create policy series_settings_write on public.series_settings
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (
      (select public.auth_has_role('admin'))
      or (select public.auth_has_role('gestor'))
    )
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (
      (select public.auth_has_role('admin'))
      or (select public.auth_has_role('gestor'))
    )
  );

revoke all on public.series_settings from anon;

comment on table public.series_settings is
  'Exceções da cadência de uma série e o liga/desliga por recorte (registro, responsável ou campo). O PADRÃO e a ordem de precedência vivem no esquema; aqui só as exceções, editáveis sem abrir o construtor.';

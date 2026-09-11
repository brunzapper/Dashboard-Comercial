-- Versão: 1.0 | Data: 11/09/2026
-- DUAS coisas, ambas nascidas do mesmo caso: o comentário "o Oscar me pediu
-- para contactar no final de outubro" num registro com série quinzenal.
--
-- 1) `series_settings.snooze_until` — ADIAR a sequência, que é diferente de
--    encerrá-la (0132) e diferente de pausar o atributo (0131).
--
--    A semântica foi escolhida para NÃO abrir um ramo novo em lugar nenhum: a
--    linha com `active = false` MAIS `snooze_until = D` significa "desligada
--    ATÉ D". A travessia de liga/desliga de resolveCadence já sabe tratar o
--    `active = false`; ela ganha só a condição `hoje < snooze_until` e a
--    religação automática no dia D. `occurrencesToOpen` e o tick ficam
--    INTOCADOS — a série volta sozinha porque a exceção deixa de valer.
--
--    Coluna, e não uma tabela nova, porque é exatamente o mesmo recorte que a
--    0132 já modela (org × série × escopo) e porque o índice único
--    `uq_series_settings_scope` é o que impede duas decisões conflitantes sobre
--    o mesmo registro. `snooze_until` sem `active = false` não significa nada
--    (e o app nunca grava assim): quem desliga é o `active`.
--
-- 2) `tree_ai_threads` — as CONVERSAS com a IA a partir de um comentário.
--
--    Molde da 0124 (operacao_ai_sessions), com uma diferença: lá a chave é o
--    ESCOPO (um por tela), aqui são VÁRIAS conversas simultâneas por usuário —
--    é o pedido: comentar no próximo registro enquanto a análise do anterior
--    ainda roda. Por isso `id` próprio, e não uma PK composta pelo alvo.
--
--    Persistir foi decisão consciente (a alternativa era estado React que morre
--    no F5): é o SERVIDOR que guarda os turnos e a prévia pendente, como na
--    0098 — nada de transcrição crua viajando do cliente a cada réplica, e uma
--    proposta esperando confirmação sobrevive a um refresh acidental.
--
-- Idempotente. Não recria RPC nenhuma.

-- ---------------------------------------------------------------------------
-- 1) Adiamento da sequência
-- ---------------------------------------------------------------------------
alter table public.series_settings
  add column if not exists snooze_until date;

comment on column public.series_settings.snooze_until is
  'Com active = false: a série volta a valer NESTE dia (adiamento). Null = o desligamento não tem data de volta.';

-- ---------------------------------------------------------------------------
-- 2) Conversas da IA a partir de um comentário
-- ---------------------------------------------------------------------------
create table if not exists public.tree_ai_threads (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
                    references public.organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  -- O registro de que a conversa fala. Cascade: sem o registro, a conversa
  -- sobre ele não tem o que aplicar.
  record_id       uuid not null references public.records (id) on delete cascade,
  -- Título do registro no momento da abertura, para o dock rotular a aba sem
  -- uma segunda consulta (e sem depender de o registro ainda existir).
  record_title    text not null default '',
  turns           jsonb not null default '[]'::jsonb, -- string[]: o comentário + as réplicas
  chat            jsonb not null default '[]'::jsonb, -- AiChatEntry[]: log de exibição
  -- { json, acoes[] } | null — a proposta esperando confirmação. É daqui que o
  -- apply lê, nunca do cliente (precedente da 0098).
  pending         jsonb,
  status          text not null default 'aberta'
                    check (status in ('aberta', 'aplicada', 'descartada')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- O dock lista as abertas do usuário, mais recentes primeiro.
create index if not exists idx_tree_ai_threads_open
  on public.tree_ai_threads (organization_id, user_id, updated_at desc)
  where status = 'aberta';
create index if not exists idx_tree_ai_threads_record
  on public.tree_ai_threads (record_id);

drop trigger if exists trg_tree_ai_threads_updated_at on public.tree_ai_threads;
create trigger trg_tree_ai_threads_updated_at
  before update on public.tree_ai_threads
  for each row execute function public.set_updated_at();

alter table public.tree_ai_threads enable row level security;

-- Linha PRÓPRIA + gate de org (0089). A conversa é de quem comentou: nem um
-- admin lê a de outro por aqui. Quem mura a ESCRITA real continua sendo a RLS
-- de tasks (0063) e a de series_settings (0132) — aplicar passa pelos choke
-- points de sempre, com o client do usuário.
drop policy if exists tree_ai_threads_all on public.tree_ai_threads;
create policy tree_ai_threads_all on public.tree_ai_threads
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and user_id = (select auth.uid())
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and user_id = (select auth.uid())
  );

revoke all on public.tree_ai_threads from anon;

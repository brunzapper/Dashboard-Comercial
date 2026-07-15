-- ============================================================================
-- Versão: 1.0 | Data: 15/07/2026
-- BLOCO ÚNICO — FASE 13 — colar no SQL Editor do Supabase APÓS a Fase 12.
-- Operação nos leads mock: Inbound nos 270 existentes + 32 novos mocks
-- Outbound (CSV "Outbound Zapper"). Para DESFAZER tudo (Fases 12+13), use
-- apply/undo-mock-reuniao.sql. Idempotente.
-- ============================================================================

-- >>>>>>>>>>>>>>>>>>>> migrations/0053_mock_operacoes.sql <<<<<<<<<<<<<<<<<<<<

-- Versão: 1.0 | Data: 15/07/2026
-- Fase 13: Operação nos leads mock de "Data Reunião" (Fase 12).
--   1) Resolve (ou cria) as operações "Inbound" e "Outbound";
--   2) atribui Inbound aos 270 mocks existentes (CSV Inbound Zapper) — eles
--      passam a responder aos filtros de operação com esse nome;
--   3) insere os 32 mocks do CSV "Outbound Zapper" (mesma lógica da Fase 12:
--      só a Data Reunião preenchida, is_mock, datas do núcleo NULL, congelados
--      pelo trigger e fora de qualquer contagem que não referencie Data
--      Reunião), com Operação = Outbound.
-- O undo continua sendo apply/undo-mock-reuniao.sql (o delete por is_mock
-- cobre também estes; as operações criadas aqui permanecem).
-- Idempotente. Requer a Fase 12 (0051–0052).

-- Bypass do trigger de congelamento: necessário para INSERIR mocks com Data
-- Reunião < 01/06/2026 (mesmo padrão do 0051).
select set_config('app.reuniao_freeze_bypass', 'on', false);

-- ===================== 1) Operações Inbound/Outbound =====================
-- Por nome do pedido: match exato (case-insensitive) > fuzzy (contém) > cria.
-- Fuzzy cobre operações já cadastradas com nome composto (ex.: "Inbound
-- Zapper"). Empate: ativa primeiro, depois a mais antiga.
create or replace function pg_temp.op_id_for(p_name text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.operations
  where lower(name) = lower(p_name)
  order by active desc, created_at asc limit 1;
  if v_id is not null then return v_id; end if;

  select id into v_id from public.operations
  where name ilike '%' || p_name || '%'
  order by active desc, created_at asc limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.operations (name) values (p_name) returning id into v_id;
  return v_id;
end;
$$;

-- ===================== 2) Inbound nos mocks existentes =====================
-- Só os do CSV Inbound (source_id numérico); os Outbound têm prefixo próprio.
update public.records
set operation_id = pg_temp.op_id_for('Inbound')
where is_mock and source_id ~ '^mock_reuniao_[0-9]+$';

-- ===================== 3) Leads mock Outbound (CSV Outbound Zapper, 32 linhas) =====================
with dados (n, data_reuniao, responsavel, titulo) as (
  values
    (1, '2026-01-06', 'Gabriella Salles', 'RNS Technology'),
    (2, '2026-01-06', 'Gabriella Salles', 'Otis Elevadores'),
    (3, '2026-01-07', 'Paulo Vitor Santos', 'Grupo Jacto'),
    (4, '2026-01-14', 'Paulo Vitor Santos', 'Schmidt Agrícola'),
    (5, '2026-01-15', 'Gabriella Salles', 'Adubos Real'),
    (6, '2026-01-19', 'Paulo Vitor Santos', 'JSF Empreendimentos Florestais'),
    (7, '2026-01-20', 'Paulo Vitor Santos', 'SAFM Mineração'),
    (8, '2026-01-21', 'Paulo Vitor Santos', 'Promofarma'),
    (9, '2026-01-22', 'Paulo Vitor Santos', 'Baterias Pioneiro'),
    (10, '2026-02-02', 'Gabriella Salles', 'SIMM Soluções'),
    (11, '2026-02-04', 'Gabriella Salles', 'METALLOYS & CHEMICALS'),
    (12, '2026-02-04', 'Gabriella Salles', 'Equilíbrio Fertilizantes'),
    (13, '2026-02-10', 'Felipe Machado', 'Hoepers S/A'),
    (14, '2026-02-13', 'Felipe Machado', 'União Química'),
    (15, '2026-02-13', 'Felipe Machado', 'Midea Carrier'),
    (16, '2026-02-13', 'Felipe Machado', 'ITA FROTAS'),
    (17, '2026-02-19', 'Felipe Machado', 'Broadcast | Agência Estado'),
    (18, '2026-02-20', 'Felipe Machado', 'GDBR Toyoda Gosei 豊田合成'),
    (19, '2026-02-26', 'Felipe Machado', 'Redebrasil Gestão de Ativos'),
    (20, '2026-03-17', 'Gabriella Salles', 'Jalles'),
    (21, '2026-03-24', 'Gabriella Salles', 'Mococa S/A - Produtos Alimentícios'),
    (22, '2026-03-30', 'Gabriella Salles', 'FEMME - Laboratório da Mulher'),
    (23, '2026-04-01', 'Gabriella Salles', 'TOTVS TECHFIN - uma empresa TOTVS + ITAÚ'),
    (24, '2026-04-01', 'Gabriella Salles', 'I4PRO S.A'),
    (25, '2026-04-08', 'Gabriella Salles', 'Nilpel Ind.'),
    (26, '2026-04-17', 'Gabriella Salles', 'Grupo Alvorada'),
    (27, '2026-05-21', 'Gabriella Salles', 'Hospital Felicio Rocho'),
    (28, '2026-05-25', 'Gabriella Salles', 'Borsari Imóveis'),
    (29, '2026-05-26', 'Gabriella Salles', 'Holden'),
    (30, '2026-05-26', 'Gabriella Salles', 'Celetro'),
    (31, '2026-05-26', 'Gabriella Salles', 'GNA Corporation'),
    (32, '2026-05-29', 'Gabriella Salles', 'Noiva da Colina Corretora de Seguros')
)
insert into public.records (
  record_type, source_system, source_id, title, stage, stage_semantic,
  responsible_id, operation_id, is_mock, custom_fields
)
select
  'lead',
  'manual',
  'mock_reuniao_out_' || lpad(d.n::text, 3, '0'),
  d.titulo,
  'Lead Qualificado',
  'open',
  resp.id,
  pg_temp.op_id_for('Outbound'),
  true,
  jsonb_build_object('bitrix_uf_crm_1743441331', d.data_reuniao)
from dados d
-- distinct on: nomes duplicados em responsibles não podem multiplicar linhas
-- (o ON CONFLICT não aceita a mesma linha duas vezes no mesmo INSERT).
left join (
  select distinct on (display_name) id, display_name
  from public.responsibles
  order by display_name, created_at
) resp on resp.display_name = d.responsavel
on conflict (source_system, source_id) do nothing;

drop function if exists pg_temp.op_id_for(text);

select set_config('app.reuniao_freeze_bypass', 'off', false);

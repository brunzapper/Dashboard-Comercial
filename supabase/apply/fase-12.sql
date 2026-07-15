-- ============================================================================
-- Versão: 1.0 | Data: 15/07/2026
-- BLOCO ÚNICO — FASE 12 — colar no SQL Editor do Supabase APÓS a Fase 11.
-- Mock de "Data Reunião" (01/01/2026–31/05/2026) + congelamento do campo +
-- regra dos mocks no motor de widgets. Para DESFAZER, use
-- apply/undo-mock-reuniao.sql. Idempotente.
-- ============================================================================

-- >>>>>>>>>>>>>>>>>>>> migrations/0051_mock_data_reuniao.sql <<<<<<<<<<<<<<<<<<<<

-- Versão: 1.0 | Data: 15/07/2026
-- Fase 12: mock de "Data Reunião" (01/01/2026–31/05/2026) + congelamento.
-- A gestão a fundo começou em junho/2026; as datas de reunião de jan–mai no
-- Bitrix não são confiáveis. Este script:
--   1) marca registros mock (`records.is_mock`);
--   2) faz backup dos valores atuais de Data Reunião < 01/06/2026 (p/ undo);
--   3) ZERA Data Reunião de todos os registros reais com data < 01/06/2026 —
--      tanto a chave de Lead (bitrix_uf_crm_1743441331) quanto a de Negócio
--      (bitrix_uf_crm_67eacefcccd98);
--   4) insere os 270 leads mock (CSV "Inbound Zapper") — os ÚNICOS com Data
--      Reunião no período. Datas do núcleo ficam NULL: nenhum período por
--      criação/movimentação/fechamento os enxerga;
--   5) cria o trigger de congelamento: nenhum sync/edição volta a gravar Data
--      Reunião < 01/06/2026 nem altera os mocks. Só o SQL de undo
--      (supabase/apply/undo-mock-reuniao.sql), via GUC
--      app.reuniao_freeze_bypass, desfaz.
-- Idempotente: pode ser reexecutado (o bypass é ligado no topo para as
-- reexecuções passarem pelo trigger já existente).

select set_config('app.reuniao_freeze_bypass', 'on', false);

-- ===================== 1) Marcador de registro mock =====================
alter table public.records add column if not exists is_mock boolean not null default false;
create index if not exists idx_records_is_mock on public.records (is_mock) where is_mock;

-- ===================== 2) Backup para o undo =====================
create table if not exists public.reuniao_freeze_backup (
  record_id uuid not null references public.records (id) on delete cascade,
  field_key text not null,
  old_value text not null,
  captured_at timestamptz not null default now(),
  primary key (record_id, field_key)
);

insert into public.reuniao_freeze_backup (record_id, field_key, old_value)
select r.id, k.key, r.custom_fields ->> k.key
from public.records r
cross join (values ('bitrix_uf_crm_1743441331'), ('bitrix_uf_crm_67eacefcccd98')) as k(key)
where not r.is_mock
  and r.custom_fields ->> k.key is not null
  and left(r.custom_fields ->> k.key, 10) < '2026-06-01'
on conflict (record_id, field_key) do nothing;

-- ===================== 3) Zeragem (Data Reunião < 01/06/2026) =====================
update public.records
set custom_fields = custom_fields - 'bitrix_uf_crm_1743441331'
where not is_mock
  and custom_fields ->> 'bitrix_uf_crm_1743441331' is not null
  and left(custom_fields ->> 'bitrix_uf_crm_1743441331', 10) < '2026-06-01';

update public.records
set custom_fields = custom_fields - 'bitrix_uf_crm_67eacefcccd98'
where not is_mock
  and custom_fields ->> 'bitrix_uf_crm_67eacefcccd98' is not null
  and left(custom_fields ->> 'bitrix_uf_crm_67eacefcccd98', 10) < '2026-06-01';

-- ===================== 4) Leads mock (CSV Inbound Zapper, 270 linhas) =====================
-- source_system='manual' + source_id 'mock_reuniao_NNN': o sync do Bitrix nunca
-- toca essas linhas (upsert por (source_system, source_id) só com 'bitrix').
-- Datas do núcleo NULL de propósito; a única data é a Data Reunião (formato
-- YYYY-MM-DD, mesmo das edições do app — a comparação textual do @period casa).
with dados (n, data_reuniao, responsavel, titulo) as (
  values
    (1, '2026-01-05', 'Gabriella Salles', 'Michellin Vidros'),
    (2, '2026-01-05', 'Gabriella Salles', 'TopCom Maquinas'),
    (3, '2026-01-06', 'Paulo Vitor Santos', 'Elektra Blumenau'),
    (4, '2026-01-07', 'Gabriella Salles', 'ARS Eletrônica'),
    (5, '2026-01-07', 'Paulo Vitor Santos', 'Transpotech Peças e Serviços'),
    (6, '2026-01-07', 'Paulo Vitor Santos', 'Arraial Cana Brava Hotel'),
    (7, '2026-01-08', 'Gabriella Salles', 'VM Soluções e serviços'),
    (8, '2026-01-08', 'Gabriella Salles', 'Silvia Modas'),
    (9, '2026-01-08', 'Paulo Vitor Santos', 'Refrigeração Cata Vento'),
    (10, '2026-01-09', 'Paulo Vitor Santos', 'Calcinação Vitória'),
    (11, '2026-01-09', 'Gabriella Salles', 'Garagem 94'),
    (12, '2026-01-12', 'Paulo Vitor Santos', 'Navig Locações'),
    (13, '2026-01-12', 'Gabriella Salles', 'Sistema Sul Seguros'),
    (14, '2026-01-12', 'Paulo Vitor Santos', 'One Unity'),
    (15, '2026-01-13', 'Paulo Vitor Santos', 'Álamo Prospecção'),
    (16, '2026-01-13', 'Paulo Vitor Santos', 'Apex Solar'),
    (17, '2026-01-14', 'Gabriella Salles', 'Top Vida'),
    (18, '2026-01-14', 'Paulo Vitor Santos', 'Manetoni Soluções em Aço'),
    (19, '2026-01-15', 'Paulo Vitor Santos', 'Vida Farmácias'),
    (20, '2026-01-16', 'Paulo Vitor Santos', '2º Cartório de registros de SJC'),
    (21, '2026-01-19', 'Gabriella Salles', 'Royal Química'),
    (22, '2026-01-19', 'Paulo Vitor Santos', 'ASL'),
    (23, '2026-01-20', 'Gabriella Salles', 'Orion Nutrição Animal'),
    (24, '2026-01-20', 'Gabriella Salles', 'Centro Minas Distribuição'),
    (25, '2026-01-20', 'Paulo Vitor Santos', 'GRUPO SENTAX'),
    (26, '2026-01-21', 'Gabriella Salles', 'Dreams Intercâmbio'),
    (27, '2026-01-21', 'Gabriella Salles', 'Dutra seguros'),
    (28, '2026-01-22', 'Paulo Vitor Santos', 'Jelp Construtora'),
    (29, '2026-01-22', 'Paulo Vitor Santos', 'CRC Compressores'),
    (30, '2026-01-23', 'Paulo Vitor Santos', 'Nutrimilho alimentos'),
    (31, '2026-01-23', 'Gabriella Salles', 'Oticas Vitto'),
    (32, '2026-01-26', 'Paulo Vitor Santos', 'Carvalhão'),
    (33, '2026-01-26', 'Gabriella Salles', 'Rhema Refrigeração'),
    (34, '2026-01-26', 'Paulo Vitor Santos', 'Master Control'),
    (35, '2026-01-26', 'Gabriella Salles', 'Porto Suplementos e Emagrecedores'),
    (36, '2026-01-26', 'Paulo Vitor Santos', 'WORLD telecomunicações'),
    (37, '2026-01-26', 'Paulo Vitor Santos', 'MaqFroes Costura e Bordado'),
    (38, '2026-01-26', 'Gabriella Salles', 'Casa Cor Tintas'),
    (39, '2026-01-27', 'Paulo Vitor Santos', 'Novo Horizonte JPA'),
    (40, '2026-01-27', 'Paulo Vitor Santos', 'Matéria Prima'),
    (41, '2026-01-27', 'Gabriella Salles', 'CDI Barra'),
    (42, '2026-01-27', 'Gabriella Salles', 'Goroo'),
    (43, '2026-01-27', 'Gabriella Salles', 'EcarpayRH'),
    (44, '2026-01-27', 'Paulo Vitor Santos', 'Integra Gestão'),
    (45, '2026-01-28', 'Gabriella Salles', 'MobyWeb'),
    (46, '2026-01-28', 'Paulo Vitor Santos', 'Bureau Veritas'),
    (47, '2026-01-29', 'Gabriella Salles', 'Queiroz Cavalcanti Advocacia'),
    (48, '2026-01-29', 'Paulo Vitor Santos', 'Banco ABC'),
    (49, '2026-01-30', 'Gabriella Salles', 'DPV Químico'),
    (50, '2026-01-30', 'Paulo Vitor Santos', 'CT Maíra Silva'),
    (51, '2026-02-02', 'Felipe Machado', 'Extra Máquinas'),
    (52, '2026-02-02', 'Gabriella Salles', 'MGTEC Climatização'),
    (53, '2026-02-02', 'Gabriella Salles', 'Absolut Technologies'),
    (54, '2026-02-03', 'Gabriella Salles', 'Prima Manutenção e Serviços'),
    (55, '2026-02-03', 'Felipe Machado', 'Prima Manutenção e Serviços'),
    (56, '2026-02-03', 'Felipe Machado', 'Hospital MaterDei'),
    (57, '2026-02-03', 'Gabriella Salles', 'Salão de beleza B&C'),
    (58, '2026-02-03', 'Gabriella Salles', 'Corretora Me Protege'),
    (59, '2026-02-03', 'Gabriella Salles', 'Tecaut Automação'),
    (60, '2026-02-03', 'Gabriella Salles', 'Construtora Continental'),
    (61, '2026-02-04', 'Gabriella Salles', 'Lyon Veículos'),
    (62, '2026-02-04', 'Gabriella Salles', 'TAEC Módulos'),
    (63, '2026-02-05', 'Gabriella Salles', 'Bahia Ferramentas'),
    (64, '2026-02-05', 'Gabriella Salles', 'Simetria'),
    (65, '2026-02-05', 'Gabriella Salles', 'HUB Digital'),
    (66, '2026-02-05', 'Gabriella Salles', 'RM'),
    (67, '2026-02-05', 'Gabriella Salles', 'Cicampo'),
    (68, '2026-02-06', 'Gabriella Salles', 'Tesch Seguros'),
    (69, '2026-02-06', 'Gabriella Salles', 'SG Celular'),
    (70, '2026-02-06', 'Gabriella Salles', 'Lonax'),
    (71, '2026-02-06', 'Gabriella Salles', 'Esquadrimed'),
    (72, '2026-02-06', 'Gabriella Salles', 'Assecont Contabilidade'),
    (73, '2026-02-09', 'Felipe Machado', 'Jaguar Industrial'),
    (74, '2026-02-09', 'Felipe Machado', 'Solucon'),
    (75, '2026-02-09', 'Felipe Machado', 'RAMTEC Distribuidor'),
    (76, '2026-02-09', 'Felipe Machado', 'Action Educação'),
    (77, '2026-02-10', 'Felipe Machado', 'Real Diesel'),
    (78, '2026-02-10', 'Felipe Machado', 'Bellinati Perez'),
    (79, '2026-02-10', 'Felipe Machado', 'Grupo Itamaq'),
    (80, '2026-02-11', 'Felipe Machado', 'Loja Elita Brasil'),
    (81, '2026-02-11', 'Felipe Machado', 'Unifiltro'),
    (82, '2026-02-11', 'Felipe Machado', 'Almeida Motos'),
    (83, '2026-02-12', 'Felipe Machado', 'TCA Garantias'),
    (84, '2026-02-12', 'Felipe Machado', 'Laço de Fita'),
    (85, '2026-02-12', 'Felipe Machado', 'Chuva Comunica'),
    (86, '2026-02-13', 'Felipe Machado', 'CORE SP'),
    (87, '2026-02-13', 'Felipe Machado', 'RASA'),
    (88, '2026-02-13', 'Felipe Machado', 'Bem Proteção Veicular'),
    (89, '2026-02-19', 'Felipe Machado', 'Pluggo'),
    (90, '2026-02-19', 'Felipe Machado', 'Gammaros'),
    (91, '2026-02-19', 'Felipe Machado', 'Oceanik Group'),
    (92, '2026-02-20', 'Felipe Machado', 'Grupo Comaxin'),
    (93, '2026-02-20', 'Felipe Machado', 'Madetelhas'),
    (94, '2026-02-23', 'Gabriella Salles', 'Construcril'),
    (95, '2026-02-23', 'Gabriella Salles', 'ECAD'),
    (96, '2026-02-23', 'Gabriella Salles', 'Premium Acabamentos'),
    (97, '2026-02-23', 'Gabriella Salles', 'RH Mais'),
    (98, '2026-02-24', 'Gabriella Salles', 'Lino Geradores'),
    (99, '2026-02-24', 'Gabriella Salles', 'Bracell'),
    (100, '2026-02-24', 'Gabriella Salles', 'Exatta Bombas'),
    (101, '2026-02-24', 'Gabriella Salles', 'Grupo Elettromec'),
    (102, '2026-02-25', 'Gabriella Salles', 'DS Soluções Digitais'),
    (103, '2026-02-25', 'Gabriella Salles', 'Firedev'),
    (104, '2026-02-26', 'Gabriella Salles', 'VM Investimentos Imobiliários'),
    (105, '2026-02-26', 'Gabriella Salles', 'Cimento Nacional'),
    (106, '2026-02-26', 'Gabriella Salles', 'N-Multifibra'),
    (107, '2026-02-26', 'Gabriella Salles', 'Parada do Pão de Queijo'),
    (108, '2026-02-27', 'Gabriella Salles', 'Tec Calor'),
    (109, '2026-02-27', 'Gabriella Salles', 'beAnalytic'),
    (110, '2026-03-02', 'Gabriella Salles', 'Stavias'),
    (111, '2026-03-03', 'Gabriella Salles', 'Vinci Hair Clinic'),
    (112, '2026-03-03', 'Gabriella Salles', 'Sigestec'),
    (113, '2026-03-03', 'Gabriella Salles', 'Estratégia Contabilidade'),
    (114, '2026-03-04', 'Gabriella Salles', 'Griffe Store'),
    (115, '2026-03-04', 'Gabriella Salles', 'Cajuína São Gerealdo'),
    (116, '2026-03-05', 'Gabriella Salles', 'Gadita Alimentos'),
    (117, '2026-03-05', 'Gabriella Salles', 'Zander Eventos'),
    (118, '2026-03-05', 'Gabriella Salles', 'Input Center Informática'),
    (119, '2026-03-05', 'Gabriella Salles', 'RPM Material Hospitalar LTDA'),
    (120, '2026-03-05', 'Gabriella Salles', 'Brado Logística S.A'),
    (121, '2026-03-05', 'Gabriella Salles', 'Sig Multimarcas'),
    (122, '2026-03-06', 'Gabriella Salles', 'Polo Traex'),
    (123, '2026-03-06', 'Gabriella Salles', 'Wifire'),
    (124, '2026-03-06', 'Gabriella Salles', 'Livemê Calçados'),
    (125, '2026-03-06', 'Gabriella Salles', 'Facil Motos'),
    (126, '2026-03-06', 'Gabriella Salles', 'Dunelli'),
    (127, '2026-03-06', 'Paulo Vitor Santos', 'KLM Seguros'),
    (128, '2026-03-09', 'Gabriella Salles', 'ALZ Grãos'),
    (129, '2026-03-09', 'Gabriella Salles', 'Cartório Sousa'),
    (130, '2026-03-09', 'Gabriella Salles', 'Nosso Atacarejo'),
    (131, '2026-03-09', 'Gabriella Salles', 'Bird Viagens'),
    (132, '2026-03-10', 'Gabriella Salles', 'VED Imóveis'),
    (133, '2026-03-10', 'Gabriella Salles', 'Usina Santa Adélia'),
    (134, '2026-03-10', 'Gabriella Salles', 'Terras de São José'),
    (135, '2026-03-11', 'Gabriella Salles', 'Casa Limpa'),
    (136, '2026-03-11', 'Gabriella Salles', 'Grupo Dactel'),
    (137, '2026-03-11', 'Gabriella Salles', 'Fretou Brasil'),
    (138, '2026-03-11', 'Felipe Machado', 'Avana Móveis'),
    (139, '2026-03-11', 'Gabriella Salles', 'GAN Representações'),
    (140, '2026-03-12', 'Gabriella Salles', 'YES (Boots and Cloths)'),
    (141, '2026-03-12', 'Gabriella Salles', 'Grupo W3 Wolbert'),
    (142, '2026-03-12', 'Gabriella Salles', 'Ana Pedras'),
    (143, '2026-03-13', 'Gabriella Salles', 'RH Renováveis'),
    (144, '2026-03-13', 'Gabriella Salles', 'Zeno Auto Peças'),
    (145, '2026-03-13', 'Gabriella Salles', 'Lutech'),
    (146, '2026-03-13', 'Gabriella Salles', 'Stone Várzea'),
    (147, '2026-03-13', 'Gabriella Salles', 'Oliveira Neves Advogados'),
    (148, '2026-03-16', 'Gabriella Salles', 'RDF | Ferro e Aço'),
    (149, '2026-03-16', 'Gabriella Salles', 'Anderle Transportes'),
    (150, '2026-03-16', 'Gabriella Salles', 'Base Facilities'),
    (151, '2026-03-16', 'Gabriella Salles', 'Fattor Crédito Mercantil'),
    (152, '2026-03-16', 'Gabriella Salles', 'JT Representações'),
    (153, '2026-03-16', 'Gabriella Salles', 'PCM Seguros'),
    (154, '2026-03-17', 'Felipe Machado', 'AV Joias'),
    (155, '2026-03-17', 'Gabriella Salles', 'WF Medical'),
    (156, '2026-03-17', 'Gabriella Salles', 'RSolutions'),
    (157, '2026-03-17', 'Gabriella Salles', 'CGO'),
    (158, '2026-03-17', 'Gabriella Salles', 'Guepardo'),
    (159, '2026-03-18', 'Gabriella Salles', 'AMB Móveis'),
    (160, '2026-03-18', 'Gabriella Salles', 'Grupo Yes'),
    (161, '2026-03-18', 'Gabriella Salles', 'Pão da Hora'),
    (162, '2026-03-18', 'Gabriella Salles', 'Agromichels'),
    (163, '2026-03-19', 'Gabriella Salles', 'Grupo Veloso'),
    (164, '2026-03-19', 'Gabriella Salles', 'Lojas 360'),
    (165, '2026-03-19', 'Gabriella Salles', 'Módulo'),
    (166, '2026-03-19', 'Gabriella Salles', 'Iguá'),
    (167, '2026-03-20', 'Gabriella Salles', 'Compass Mania'),
    (168, '2026-03-20', 'Gabriella Salles', 'Nissan JRCA'),
    (169, '2026-03-20', 'Gabriella Salles', 'Marini'),
    (170, '2026-03-20', 'Gabriella Salles', 'Secoli'),
    (171, '2026-03-20', 'Gabriella Salles', 'Vetline Brasil'),
    (172, '2026-03-20', 'Gabriella Salles', 'Secoli'),
    (173, '2026-03-23', 'Gabriella Salles', 'Estrela Distribuidora'),
    (174, '2026-03-23', 'Gabriella Salles', 'Rede Top da Construção'),
    (175, '2026-03-23', 'Gabriella Salles', 'Carboroil'),
    (176, '2026-03-23', 'Gabriella Salles', 'SulBrasil Distribuidora'),
    (177, '2026-03-23', 'Gabriella Salles', 'Saude Bliss'),
    (178, '2026-03-24', 'Gabriella Salles', 'Adim Imoveis'),
    (179, '2026-03-24', 'Gabriella Salles', 'Grupo JCPM'),
    (180, '2026-03-24', 'Gabriella Salles', 'Era'),
    (181, '2026-03-25', 'Gabriella Salles', 'Positivo Seguros'),
    (182, '2026-03-25', 'Gabriella Salles', 'Tanques Paralelo'),
    (183, '2026-03-25', 'Gabriella Salles', 'Adonai Prestadora de Serviços'),
    (184, '2026-03-25', 'Paulo Vitor Santos', 'Mattara Sushi'),
    (185, '2026-03-25', 'Paulo Vitor Santos', 'Advance Transatur'),
    (186, '2026-03-26', 'Gabriella Salles', 'Flash Cover'),
    (187, '2026-03-26', 'Gabriella Salles', 'P&R Automação'),
    (188, '2026-03-26', 'Gabriella Salles', 'Binatural'),
    (189, '2026-03-27', 'Gabriella Salles', 'JF Informática'),
    (190, '2026-03-30', 'Gabriella Salles', 'Elétrica Copeli'),
    (191, '2026-03-30', 'Gabriella Salles', 'Alltech TI'),
    (192, '2026-03-30', 'Gabriella Salles', 'Essent Jus'),
    (193, '2026-03-30', 'Gabriella Salles', 'Radio Memory'),
    (194, '2026-03-31', 'Gabriella Salles', 'Amaggi'),
    (195, '2026-04-01', 'Gabriella Salles', 'Amigos do Bem'),
    (196, '2026-04-01', 'Gabriella Salles', 'Luxury Imoveis'),
    (197, '2026-04-02', 'Gabriella Salles', 'Solvera Capital'),
    (198, '2026-04-06', 'Gabriella Salles', 'Supermercados Osana'),
    (199, '2026-04-06', 'Gabriella Salles', 'Ticcolor'),
    (200, '2026-04-07', 'Gabriella Salles', 'C4 Científica'),
    (201, '2026-04-08', 'Gabriella Salles', 'Grupo Delta'),
    (202, '2026-04-09', 'Gabriella Salles', 'Alpha Elétrica'),
    (203, '2026-04-09', 'Gabriella Salles', 'Santuário Nacional de Aparecida'),
    (204, '2026-04-09', 'Gabriella Salles', 'EHTL Viagens Corporativas'),
    (205, '2026-04-10', 'Gabriella Salles', 'ATMO Energia'),
    (206, '2026-04-10', 'Gabriella Salles', 'Itatiaia'),
    (207, '2026-04-10', 'Gabriella Salles', 'Metric Usinagem'),
    (208, '2026-04-13', 'Gabriella Salles', 'WL Tec Field'),
    (209, '2026-04-13', 'Gabriella Salles', 'Felka Transportes e Logística'),
    (210, '2026-04-14', 'Gabriella Salles', 'VMED'),
    (211, '2026-04-15', 'Gabriella Salles', 'CHG Automotiva'),
    (212, '2026-04-15', 'Gabriella Salles', 'Óticas Oceano'),
    (213, '2026-04-16', 'Gabriella Salles', 'Hoff Analytics'),
    (214, '2026-04-16', 'Gabriella Salles', 'Labornatus'),
    (215, '2026-04-16', 'Gabriella Salles', 'Nonino Brasil'),
    (216, '2026-04-16', 'Gabriella Salles', 'Wall Street Broker LTDA'),
    (217, '2026-04-17', 'Gabriella Salles', 'Flash Cover'),
    (218, '2026-04-17', 'Gabriella Salles', 'RL Representação'),
    (219, '2026-04-17', 'Gabriella Salles', 'Flash Cover'),
    (220, '2026-04-17', 'Gabriella Salles', 'RL Representação'),
    (221, '2026-04-17', 'Gabriella Salles', 'Miolo Wine Group'),
    (222, '2026-04-20', 'Gabriella Salles', 'Laboratório Moema'),
    (223, '2026-04-20', 'Gabriella Salles', 'Maxgrass'),
    (224, '2026-04-20', 'Gabriella Salles', 'GS3 Comercio'),
    (225, '2026-04-22', 'Gabriella Salles', 'LT Imóveis'),
    (226, '2026-04-22', 'Gabriella Salles', 'Planet Sport'),
    (227, '2026-04-23', 'Gabriella Salles', 'Top Recupera'),
    (228, '2026-04-23', 'Gabriella Salles', 'Venezacar'),
    (229, '2026-04-23', 'Gabriella Salles', 'Querencia Máquinas'),
    (230, '2026-04-24', 'Gabriella Salles', 'BBP Telecom'),
    (231, '2026-04-24', 'Gabriella Salles', 'TuttiAgro do Brasil'),
    (232, '2026-04-24', 'Gabriella Salles', 'Aisin Automotive'),
    (233, '2026-04-24', 'Gabriella Salles', 'Ambpar'),
    (234, '2026-04-24', 'Gabriella Salles', 'KS PULVERIZADORES'),
    (235, '2026-04-24', 'Gabriella Salles', 'Dita Casa'),
    (236, '2026-04-27', 'Gabriella Salles', 'Banco Yamaha'),
    (237, '2026-04-27', 'Gabriella Salles', 'Chalés do Lago'),
    (238, '2026-04-27', 'Gabriella Salles', 'Gabriel Pedras'),
    (239, '2026-04-29', 'Gabriella Salles', 'Procer Automação'),
    (240, '2026-04-29', 'Gabriella Salles', 'Agencia Ideale'),
    (241, '2026-04-29', 'Gabriella Salles', 'Hospital Municipal M''Boi Mirim'),
    (242, '2026-04-30', 'Gabriella Salles', 'Kovr'),
    (243, '2026-04-30', 'Gabriella Salles', 'Grupo S.E.'),
    (244, '2026-04-30', 'Gabriella Salles', 'Exchange'),
    (245, '2026-05-04', 'Gabriella Salles', 'Basedtvm'),
    (246, '2026-05-05', 'Gabriella Salles', 'Obragen Engenharia'),
    (247, '2026-05-05', 'Gabriella Salles', 'SoftwareSul'),
    (248, '2026-05-06', 'Gabriella Salles', 'Monteiro Nascimento Advogados'),
    (249, '2026-05-07', 'Gabriella Salles', 'Loja das Tintas'),
    (250, '2026-05-07', 'Gabriella Salles', 'SAAM TOWAGE BRASIL'),
    (251, '2026-05-11', 'Gabriella Salles', 'Oggi Sorvetes'),
    (252, '2026-05-12', 'Gabriella Salles', 'Lojas Renner S.A'),
    (253, '2026-05-12', 'Gabriella Salles', 'Informatech'),
    (254, '2026-05-12', 'Gabriella Salles', 'Alfa Contabilidade'),
    (255, '2026-05-13', 'Gabriella Salles', 'SPE Moradas'),
    (256, '2026-05-13', 'Gabriella Salles', 'Cimentec'),
    (257, '2026-05-13', 'Gabriella Salles', 'Atos Tecidos'),
    (258, '2026-05-13', 'Gabriella Salles', 'Rev Sumare Com e Import.Ltda'),
    (259, '2026-05-14', 'Gabriella Salles', 'Works Construção & Serviços'),
    (260, '2026-05-14', 'Gabriella Salles', 'Safra Brasil Fertilizantes'),
    (261, '2026-05-14', 'Gabriella Salles', 'CLIC BORBA CONTACT CENTER'),
    (262, '2026-05-15', 'Gabriella Salles', 'Vin Service'),
    (263, '2026-05-15', 'Gabriella Salles', 'Skyler'),
    (264, '2026-05-18', 'Gabriella Salles', 'Gestão de TI'),
    (265, '2026-05-19', 'Gabriella Salles', 'Axiis Securitizadora'),
    (266, '2026-05-21', 'Gabriella Salles', 'Raizen'),
    (267, '2026-05-22', 'Gabriella Salles', 'Kilbra trading'),
    (268, '2026-05-28', 'Gabriella Salles', 'Centro Mundo dos Anjos'),
    (269, '2026-05-28', 'Gabriella Salles', 'MIG'),
    (270, '2026-05-29', 'Gabriella Salles', 'Iochpe-Maxion')
)
insert into public.records (
  record_type, source_system, source_id, title, stage, stage_semantic,
  responsible_id, is_mock, custom_fields
)
select
  'lead',
  'manual',
  'mock_reuniao_' || lpad(d.n::text, 3, '0'),
  d.titulo,
  'Lead Qualificado',
  'open',
  resp.id,
  true,
  jsonb_build_object('bitrix_uf_crm_1743441331', d.data_reuniao)
from dados d
-- distinct on: nomes duplicados em responsibles não podem multiplicar linhas
-- (o ON CONFLICT não aceita a mesma linha duas vezes no mesmo INSERT).
-- (user_id is null) prefere a linha vinculada a usuário: o RLS de records
-- (0037) libera por responsibles.user_id, senão o vendedor não vê o mock.
left join (
  select distinct on (display_name) id, display_name
  from public.responsibles
  order by display_name, (user_id is null), created_at
) resp on resp.display_name = d.responsavel
on conflict (source_system, source_id) do nothing;

-- ===================== 5) Trigger de congelamento =====================
-- Regras (sem o bypass app.reuniao_freeze_bypass = 'on'):
--   - is_mock é imutável em UPDATE;
--   - nos mocks, Data Reunião (Lead/Negócio) volta sempre ao valor antigo;
--   - nos demais, qualquer tentativa (sync, recalc, edição no app, INSERT novo
--     do Bitrix) de gravar Data Reunião < 01/06/2026 é descartada (chave
--     removida); datas >= 01/06/2026 passam normalmente.
create or replace function public.enforce_reuniao_freeze()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_keys constant text[] := array['bitrix_uf_crm_1743441331', 'bitrix_uf_crm_67eacefcccd98'];
  v_key text;
  v_new text;
begin
  if current_setting('app.reuniao_freeze_bypass', true) = 'on' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    new.is_mock := old.is_mock;
  end if;

  foreach v_key in array v_keys
  loop
    if tg_op = 'UPDATE' and old.is_mock then
      -- Mock: Data Reunião imutável (restaura o valor antigo, presente ou não).
      if old.custom_fields ? v_key then
        new.custom_fields := jsonb_set(
          coalesce(new.custom_fields, '{}'::jsonb), array[v_key], old.custom_fields -> v_key
        );
      else
        new.custom_fields := coalesce(new.custom_fields, '{}'::jsonb) - v_key;
      end if;
    else
      v_new := new.custom_fields ->> v_key;
      if v_new is not null and left(v_new, 10) < '2026-06-01' then
        new.custom_fields := new.custom_fields - v_key;
      end if;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_records_reuniao_freeze on public.records;
create trigger trg_records_reuniao_freeze
  before insert or update on public.records
  for each row execute function public.enforce_reuniao_freeze();

select set_config('app.reuniao_freeze_bypass', 'off', false);

-- >>>>>>>>>>>>>>>>>>>> migrations/0052_widget_rpc_mock_rule.sql <<<<<<<<<<<<<<<<<<<<

-- Versão: 1.0 | Data: 15/07/2026
-- Fase 12 (parte 2): regra dos registros MOCK no motor de widgets.
-- Os leads mock de "Data Reunião" (0051, `records.is_mock`) só devem ser
-- servidos quando a consulta REFERENCIA Data Reunião — período (`byType` do
-- `@period`), dimensão, métrica (contagem não-vazia) ou filtro, direto
-- (`custom:bitrix_uf_crm_1743441331` / `custom:bitrix_uf_crm_67eacefcccd98`)
-- ou via campo unificado cuja correspondência inclua uma dessas chaves.
-- Qualquer outra consulta — com ou sem período — exclui os mocks
-- (`not is_mock` no WHERE): eles nunca somam às contagens existentes.
-- Recria run_widget_query a partir de 0050_widget_rpc_normalized_cond.sql.
-- Requer a 0051 (coluna records.is_mock). Idempotente (create or replace).

create or replace function public.run_widget_query(
  p_source text,
  p_dimensions jsonb default '[]'::jsonb,
  p_metrics jsonb default '[]'::jsonb,
  p_filters jsonb default '[]'::jsonb,
  p_correspondences jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_allowed_cols text[] := array[
    'title',
    'record_type','source_system','owner_user_id','pipeline','stage','stage_semantic',
    'temperature','sale_type','channel','currency','closed','value','mrr',
    'responsible_id','operation_id','related_lead_id','lead_time_days',
    'closed_at','opened_at','source_created_at','source_modified_at',
    'created_at','updated_at','last_synced_at'
  ];
  v_num_cols  text[] := array['value','mrr','lead_time_days'];
  v_date_cols text[] := array[
    'closed_at','opened_at','source_created_at','source_modified_at',
    'created_at','updated_at','last_synced_at'
  ];
  v_select_parts text[] := array[]::text[];
  v_group_parts  text[] := array[]::text[];
  v_where_parts  text[] := array[]::text[];
  v_item jsonb;
  v_field text; v_transform text; v_agg text; v_alias text; v_week_mode text;
  v_expr text; v_op text; v_val jsonb; v_base text;
  v_sql text; v_result jsonb; v_idx int;
  -- Fase 12: mocks de Data Reunião (0051) só entram em consultas que
  -- referenciam uma das duas chaves do campo (lead/negócio).
  v_mock_params text;
  v_include_mocks boolean := false;
begin
  if p_source is distinct from 'records' then
    raise exception 'Fonte não suportada: %', p_source;
  end if;

  -- ===== Regra dos mocks (Fase 12) =====
  -- Referência direta em dimensões/métricas/filtros (inclui o byType do
  -- @period e o field do @bucket, que viajam dentro de p_filters)...
  v_mock_params := coalesce(p_dimensions::text, '')
    || coalesce(p_metrics::text, '') || coalesce(p_filters::text, '');
  v_include_mocks :=
    v_mock_params like '%bitrix_uf_crm_1743441331%'
    or v_mock_params like '%bitrix_uf_crm_67eacefcccd98%';
  -- ...ou indireta, via campo unificado REFERENCIADO cuja correspondência
  -- contenha uma das chaves de Data Reunião.
  if not v_include_mocks then
    declare
      v_ck text;
      v_carr jsonb;
    begin
      for v_ck, v_carr in
        select key, value from jsonb_each(coalesce(p_correspondences, '{}'::jsonb))
      loop
        if position('unified:' || v_ck in v_mock_params) > 0
           and (v_carr::text like '%bitrix_uf_crm_1743441331%'
                or v_carr::text like '%bitrix_uf_crm_67eacefcccd98%') then
          v_include_mocks := true;
          exit;
        end if;
      end loop;
    end;
  end if;
  if not v_include_mocks then
    -- `::text` explícito: literal sem tipo à direita de || vira array e quebra.
    v_where_parts := v_where_parts || 'not is_mock'::text;
  end if;

  -- ===== Dimensões =====
  v_idx := 0;
  for v_item in select value from jsonb_array_elements(coalesce(p_dimensions, '[]'::jsonb))
  loop
    v_idx := v_idx + 1;
    v_field := v_item->>'field';
    v_transform := coalesce(v_item->>'transform', 'none');
    v_week_mode := coalesce(v_item->>'weekMode', 'restricted');
    if v_field is null then raise exception 'Dimensão sem "field"'; end if;

    if v_field = '@rate_date' then
      if v_transform in ('day','week','month','quarter','year') then
        v_expr := format(
          'date_trunc(%L, coalesce(closed_at, opened_at, source_created_at))',
          v_transform
        );
      elsif v_transform = 'none' then
        v_expr := 'coalesce(closed_at, opened_at, source_created_at)';
      else
        raise exception 'transform "%" não suportado para @rate_date', v_transform;
      end if;
    elsif v_field like 'unified:%' then
      -- Campo unificado: sem transform usa o coalesce textual; com transform de
      -- data, os membros viram timestamptz (cast seguro) e aplica a mesma
      -- escada do ramo match:%.
      if v_transform = 'none' then
        v_expr := public._widget_unified_expr(substring(v_field from 9), p_correspondences, false);
      else
        v_base := public._widget_unified_date_expr(substring(v_field from 9), p_correspondences);
        if v_transform in ('day','week','month','quarter','year') then
          v_expr := format('date_trunc(%L, %s)', v_transform, v_base);
        elsif v_transform = 'weekday' then
          v_expr := format('extract(isodow from %s)::int', v_base);
        elsif v_transform in ('month_name','month_year') then
          v_expr := format('date_trunc(%L, %s)', 'month', v_base);
        elsif v_transform = 'week_year' then
          v_expr := format('date_trunc(%L, %s)', 'week', v_base);
        elsif v_transform = 'week_month' then
          if v_week_mode = 'full' then
            v_expr := format('date_trunc(%L, %s)', 'week', v_base);
          else
            v_expr := format('greatest(date_trunc(%L, %s), date_trunc(%L, %s))',
              'week', v_base, 'month', v_base);
          end if;
        else
          raise exception 'transform inválido: %', v_transform;
        end if;
      end if;
    elsif v_field like 'match:%' then
      -- Campo do registro casado: subconsulta escalar (aceita transform de data).
      v_base := public._widget_match_expr(substring(v_field from 7), false);
      if v_transform = 'none' then
        v_expr := v_base;
      elsif v_transform in ('day','week','month','quarter','year') then
        v_expr := format('date_trunc(%L, %s)', v_transform, v_base);
      elsif v_transform = 'weekday' then
        v_expr := format('extract(isodow from %s)::int', v_base);
      elsif v_transform in ('month_name','month_year') then
        v_expr := format('date_trunc(%L, %s)', 'month', v_base);
      elsif v_transform = 'week_year' then
        v_expr := format('date_trunc(%L, %s)', 'week', v_base);
      elsif v_transform = 'week_month' then
        if v_week_mode = 'full' then
          v_expr := format('date_trunc(%L, %s)', 'week', v_base);
        else
          v_expr := format('greatest(date_trunc(%L, %s), date_trunc(%L, %s))',
            'week', v_base, 'month', v_base);
        end if;
      else
        raise exception 'transform inválido: %', v_transform;
      end if;
    elsif v_field like 'custom:%' then
      v_expr := format('(custom_fields ->> %L)', substring(v_field from 8));
    elsif v_field = any(v_allowed_cols) then
      if v_transform <> 'none' then
        if not (v_field = any(v_date_cols)) then
          raise exception 'transform "%" exige coluna de data', v_transform;
        end if;
        if v_transform in ('day','week','month','quarter','year') then
          v_expr := format('date_trunc(%L, %I)', v_transform, v_field);
        elsif v_transform = 'weekday' then
          v_expr := format('extract(isodow from %I)::int', v_field);
        elsif v_transform in ('month_name','month_year') then
          v_expr := format('date_trunc(%L, %I)', 'month', v_field);
        elsif v_transform = 'week_year' then
          v_expr := format('date_trunc(%L, %I)', 'week', v_field);
        elsif v_transform = 'week_month' then
          if v_week_mode = 'full' then
            v_expr := format('date_trunc(%L, %I)', 'week', v_field);
          else
            v_expr := format(
              'greatest(date_trunc(%L, %I), date_trunc(%L, %I))',
              'week', v_field, 'month', v_field
            );
          end if;
        else
          raise exception 'transform inválido: %', v_transform;
        end if;
      else
        v_expr := format('%I', v_field);
      end if;
    else
      raise exception 'Coluna de dimensão não permitida: %', v_field;
    end if;

    v_alias := 'dim_' || v_idx;
    v_select_parts := v_select_parts || format('%s as %I', v_expr, v_alias);
    v_group_parts  := v_group_parts || v_expr;
  end loop;

  -- ===== Métricas =====
  v_idx := 0;
  for v_item in select value from jsonb_array_elements(coalesce(p_metrics, '[]'::jsonb))
  loop
    v_idx := v_idx + 1;
    v_field := v_item->>'field';
    v_agg := lower(coalesce(v_item->>'agg', 'count'));
    if v_agg not in ('sum','count','avg') then
      raise exception 'Agregação inválida: %', v_agg;
    end if;
    v_alias := 'metric_' || v_idx;

    if v_agg = 'count' then
      -- nullif(expr, ''): string vazia conta como "não preenchido" (0049).
      if v_field is null or v_field = '*' then
        v_expr := 'count(*)';
      elsif v_field like 'unified:%' then
        v_expr := format('count(nullif(%s, %L))', public._widget_unified_expr(substring(v_field from 9), p_correspondences, false), '');
      elsif v_field like 'match:%' then
        v_expr := format('count(nullif(%s, %L))', public._widget_match_expr(substring(v_field from 7), false), '');
      elsif v_field like 'custom:%' then
        v_expr := format('count(nullif(custom_fields ->> %L, %L))', substring(v_field from 8), '');
      elsif v_field = any(v_allowed_cols) then
        v_expr := format('count(%I)', v_field);
      else
        raise exception 'Coluna de métrica não permitida: %', v_field;
      end if;
    else
      if v_field like 'unified:%' then
        v_expr := format('%s(%s)', v_agg, public._widget_unified_expr(substring(v_field from 9), p_correspondences, true));
      elsif v_field like 'match:%' then
        v_expr := format('%s(%s)', v_agg, public._widget_match_expr(substring(v_field from 7), true));
      elsif v_field like 'custom:%' then
        v_expr := format('%s(nullif(custom_fields ->> %L, %L)::numeric)', v_agg, substring(v_field from 8), '');
      elsif v_field = any(v_num_cols) then
        v_expr := format('%s(%I)', v_agg, v_field);
      else
        raise exception 'Métrica %/% requer coluna numérica', v_agg, coalesce(v_field, 'null');
      end if;
    end if;

    v_select_parts := v_select_parts || format('%s as %I', v_expr, v_alias);
  end loop;

  if array_length(v_select_parts, 1) is null then
    raise exception 'Widget sem dimensões nem métricas';
  end if;

  -- ===== Filtros =====
  for v_item in select value from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb))
  loop
    v_field := v_item->>'field';
    v_op := lower(coalesce(v_item->>'op', 'eq'));
    v_val := v_item->'value';
    if v_field is null then raise exception 'Filtro sem "field"'; end if;

    -- Período por fonte: campo sintético `@period` (op 'between').
    if v_field = '@period' and v_op = 'between' then
      declare
        v_from text := v_val->>'from';
        v_to   text := v_val->>'to';
        v_or   text[] := array[]::text[];
        v_rt   text;
        v_col  text;
        v_colexpr text;
        v_conds text[];
      begin
        for v_rt, v_col in
          select key, value from jsonb_each_text(coalesce(v_val->'byType', '{}'::jsonb))
        loop
          -- Coluna de data por fonte: núcleo OU custom (comparação textual —
          -- os valores de data em custom_fields são ISO, ordem lexicográfica
          -- correta; mesmo precedente do ramo de filtro custom abaixo).
          if v_col like 'custom:%' then
            v_colexpr := format('(custom_fields ->> %L)', substring(v_col from 8));
          elsif v_col = any(v_date_cols) then
            v_colexpr := format('%I', v_col);
          else
            raise exception 'Coluna de data inválida no período: %', v_col;
          end if;
          v_conds := array[ format('record_type = %L', v_rt) ];
          if v_from is not null and v_from <> '' then
            v_conds := v_conds || format('%s >= %L', v_colexpr, v_from);
          end if;
          if v_to is not null and v_to <> '' then
            v_conds := v_conds || format('%s <= %L', v_colexpr, v_to);
          end if;
          v_or := v_or || ('(' || array_to_string(v_conds, ' and ') || ')');
        end loop;
        if array_length(v_or, 1) is not null then
          v_where_parts := v_where_parts || ('(' || array_to_string(v_or, ' or ') || ')');
        end if;
      end;
      continue;
    end if;

    -- Filtro rápido por BUCKET de data (formato das dimensões): campo sintético
    -- `@bucket` (op 'in'). value = { field, transform, weekMode, keys: [...] }.
    -- A chave canônica gerada aqui DEVE bater com canonicalBucketKey no cliente.
    if v_field = '@bucket' and v_op = 'in' then
      declare
        v_bfield text := v_val->>'field';
        v_btrans text := coalesce(v_val->>'transform', 'none');
        v_bweek  text := coalesce(v_val->>'weekMode', 'restricted');
        v_keys   jsonb := coalesce(v_val->'keys', '[]'::jsonb);
        v_dexpr  text;
        v_kexpr  text;
      begin
        if v_bfield is null or v_bfield = '' then
          raise exception 'Filtro @bucket sem "field"';
        end if;
        if jsonb_typeof(v_keys) is distinct from 'array'
           or jsonb_array_length(v_keys) = 0 then
          continue; -- sem seleção = sem filtro
        end if;

        -- Expressão de data (timestamptz) do campo, com os mesmos helpers das
        -- dimensões: núcleo/custom (cast seguro), unificado e registro casado.
        if v_bfield like 'unified:%' then
          v_dexpr := public._widget_unified_date_expr(substring(v_bfield from 9), p_correspondences);
        elsif v_bfield like 'match:%' then
          v_dexpr := public._widget_match_expr(substring(v_bfield from 7), false);
        else
          v_dexpr := public._widget_col_date_expr(v_bfield);
        end if;

        v_kexpr := case v_btrans
          when 'weekday'    then format('extract(isodow from %s)::int::text', v_dexpr)
          when 'month_name' then format('extract(month from %s)::int::text', v_dexpr)
          when 'year'       then format('extract(year from %s)::int::text', v_dexpr)
          when 'quarter'    then format('to_char(%s, %L)', v_dexpr, 'YYYY-"Q"Q')
          when 'month_year' then format('to_char(%s, %L)', v_dexpr, 'YYYY-MM')
          when 'week_year'  then format('to_char(date_trunc(%L, %s), %L)', 'week', v_dexpr, 'YYYY-MM-DD')
          when 'week_month' then
            case when v_bweek = 'full'
              then format('to_char(date_trunc(%L, %s), %L)', 'week', v_dexpr, 'YYYY-MM-DD')
              else format('to_char(greatest(date_trunc(%L, %s), date_trunc(%L, %s)), %L)',
                'week', v_dexpr, 'month', v_dexpr, 'YYYY-MM-DD')
            end
          else null
        end;
        if v_kexpr is null then
          raise exception 'transform inválido no @bucket: %', v_btrans;
        end if;

        v_where_parts := v_where_parts || format(
          '%s in (select jsonb_array_elements_text(%L::jsonb))', v_kexpr, v_keys::text
        );
      end;
      continue;
    end if;

    -- Busca textual (contém).
    if v_op = 'ilike' then
      declare
        v_or text[] := array[]::text[];
        v_sub text;
        v_sub_expr text;
        v_term text := '%' ||
          (case when jsonb_typeof(v_val) = 'string' then v_val #>> '{}'
                else coalesce(v_val::text, '') end) || '%';
      begin
        foreach v_sub in array string_to_array(v_field, '|')
        loop
          if v_sub is null or v_sub = '' then continue; end if;
          if v_sub like 'unified:%' then
            v_sub_expr := public._widget_unified_expr(substring(v_sub from 9), p_correspondences, false);
          elsif v_sub like 'match:%' then
            v_sub_expr := public._widget_match_expr(substring(v_sub from 7), false);
          else
            v_sub_expr := public._widget_col_expr(v_sub, false);
          end if;
          v_or := v_or || format('%s ilike %L', v_sub_expr, v_term);
        end loop;
        if array_length(v_or, 1) is not null then
          v_where_parts := v_where_parts || ('(' || array_to_string(v_or, ' or ') || ')');
        end if;
      end;
      continue;
    end if;

    if v_field like 'unified:%' then
      v_expr := public._widget_unified_expr(substring(v_field from 9), p_correspondences, false);
    elsif v_field like 'match:%' then
      v_expr := public._widget_match_expr(substring(v_field from 7), false);
    elsif v_field like 'custom:%' then
      v_expr := format('(custom_fields ->> %L)', substring(v_field from 8));
    elsif v_field = any(v_allowed_cols) then
      v_expr := format('%I', v_field);
    else
      raise exception 'Coluna de filtro não permitida: %', v_field;
    end if;

    if v_op = 'is_null' then
      v_where_parts := v_where_parts || format('%s is null', v_expr);
    elsif v_op = 'not_null' then
      v_where_parts := v_where_parts || format('%s is not null', v_expr);
    elsif v_op in ('eq_ci', 'neq_ci') then
      -- Igualdade de texto NORMALIZADA (0050; condições de SOMASE/CONT.SE):
      -- lower(btrim(...)) + booleanos canonizados + null ≡ ''. Colunas de data
      -- do núcleo comparam tipado plain (data não tem caixa).
      declare
        v_txt text := case when jsonb_typeof(v_val) = 'string'
          then v_val #>> '{}' else coalesce(v_val::text, '') end;
        v_cmp text := case when v_op = 'eq_ci' then '=' else '<>' end;
      begin
        if v_field = any(v_date_cols) then
          v_where_parts := v_where_parts || format('%s %s %L', v_expr, v_cmp, v_txt);
        else
          v_where_parts := v_where_parts || format(
            'public._widget_norm_text((%s)::text) %s public._widget_norm_text(%L)',
            v_expr, v_cmp, v_txt
          );
        end if;
      end;
    elsif v_op in ('eq_num', 'neq_num', 'gt_num', 'gte_num', 'lt_num', 'lte_num') then
      -- Comparação NUMÉRICA com cast seguro (0050; condição com literal
      -- numérico). Campo que não parseia → null: não casa em '=', casa em '<>'
      -- (IS DISTINCT FROM), como o valEquals do avaliador JS.
      declare
        v_num numeric := public._widget_safe_numeric(
          case when jsonb_typeof(v_val) = 'string'
            then v_val #>> '{}' else v_val::text end
        );
        v_lhs text;
        v_cmp text := case v_op
          when 'eq_num' then '=' when 'gt_num' then '>'
          when 'gte_num' then '>=' when 'lt_num' then '<'
          when 'lte_num' then '<=' else '<>' end;
      begin
        if v_num is null then
          raise exception 'Valor numérico inválido no filtro: %', v_val;
        end if;
        if v_field = any(v_num_cols) then
          v_lhs := v_expr;
        else
          v_lhs := format(
            'public._widget_safe_numeric(nullif((%s)::text, %L))', v_expr, ''
          );
        end if;
        if v_op = 'neq_num' then
          v_where_parts := v_where_parts || format('%s is distinct from %s', v_lhs, v_num);
        else
          v_where_parts := v_where_parts || format('%s %s %s', v_lhs, v_cmp, v_num);
        end if;
      end;
    elsif v_op = 'in' then
      -- `::text` no lado esquerdo: a lista vem do jsonb como TEXTO; colunas
      -- uuid (responsible_id/operation_id) não comparam com text sem cast.
      v_where_parts := v_where_parts || format(
        '(%s)::text in (select jsonb_array_elements_text(%L::jsonb))', v_expr, coalesce(v_val, '[]'::jsonb)::text
      );
    else
      v_op := case v_op
        when 'eq'  then '='
        when 'neq' then '<>'
        when 'gt'  then '>'
        when 'gte' then '>='
        when 'lt'  then '<'
        when 'lte' then '<='
        else null
      end;
      if v_op is null then raise exception 'Operador inválido'; end if;
      v_where_parts := v_where_parts || format('%s %s %L', v_expr, v_op,
        case when jsonb_typeof(v_val) = 'string' then v_val #>> '{}' else v_val::text end);
    end if;
  end loop;

  -- ===== Monta e executa =====
  v_sql := 'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select '
        || array_to_string(v_select_parts, ', ')
        || ' from public.records';
  if array_length(v_where_parts, 1) is not null then
    v_sql := v_sql || ' where ' || array_to_string(v_where_parts, ' and ');
  end if;
  if array_length(v_group_parts, 1) is not null then
    v_sql := v_sql || ' group by ' || array_to_string(v_group_parts, ', ');
  end if;
  v_sql := v_sql || ') t';

  execute v_sql into v_result;
  return coalesce(v_result, '[]'::jsonb);
end;
$$;

grant execute on function public.run_widget_query(text, jsonb, jsonb, jsonb, jsonb) to authenticated;

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
left join (
  select distinct on (display_name) id, display_name
  from public.responsibles
  order by display_name, created_at
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

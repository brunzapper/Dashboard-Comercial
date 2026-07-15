-- Versão: 1.0 | Data: 15/07/2026
-- Snapshots: período congelado (default_period). Guarda o filtro de período do
-- dashboard no MOMENTO DA CRIAÇÃO do snapshot, no shape SavedPeriod do app:
--   {"periodo"?: preset (ex. "este_ano"), "de"?: "YYYY-MM-DD",
--    "ate"?: "YYYY-MM-DD", "campo"?: chave do campo de data (aceita
--    "unified:<id>")}
-- O viewer público aplica esse período a TODOS os widgets de dados em tempo de
-- consulta (o dataset congelado não muda). Antes, o viewer rodava sempre em
-- "todo o período": os números divergiam do dashboard e os mocks de Data
-- Reunião caíam fora — a regra 0052/0057 só os inclui quando a consulta
-- referencia o campo de Data Reunião, e sem o filtro de período a referência
-- some. null = todo o período (comportamento anterior; snapshots antigos).
-- Sem mudança de RLS/grants: a coluna herda as políticas de public.snapshots
-- e o viewer lê via service role. Idempotente.

alter table public.snapshots
  add column if not exists default_period jsonb;

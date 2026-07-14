-- Versão: 1.0 | Data: 14/07/2026
-- Campos 'moeda' passam a suportar currency_mode='inherit' (moeda do registro).
-- Decisão do produto: TODOS os campos de moeda herdam a moeda do registro por
-- padrão (records.currency; registro sem moeda conta como Real). Quem quiser
-- moeda fixa reconfigura manualmente em /campos ('fixed' + currency_code) —
-- inclusive campos hoje fixados em USD, que eram o único workaround disponível.
-- O guard "is distinct from 'fixed'" torna a migração idempotente e nunca
-- sobrescreve um modo fixo escolhido na UI nova.
--
-- Obs.: valores materializados de campos 'calculado' que usam campos 'moeda'
-- como operando ficam com carimbo (__cur) defasado até o próximo sync ou save
-- em /campos (recalcAllFormulaFields roda nos dois caminhos).
update public.field_definitions
   set currency_mode = 'inherit',
       currency_code = null
 where data_type = 'moeda'
   and (currency_mode is distinct from 'fixed');

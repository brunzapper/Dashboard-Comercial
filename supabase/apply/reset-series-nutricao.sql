-- reset-series-nutricao.sql
-- Versão: 1.0 | Data: 10/09/2026
-- RUNBOOK (não é migração): recomeça a série de acompanhamento pelas regras
-- novas. Rode UMA vez, depois de aplicar a 0138 e publicar o código.
--
-- POR QUE: as ocorrências abertas hoje nasceram antes de a Base `deals` ligar o
-- espelho no Bitrix, então ficaram sem `bitrix_activity_id`. Sem esse id elas
-- não existem no CRM e a leitura de volta (0137) nunca as enxerga — nem para
-- concluir, nem para excluir. E a janela que as gerou era a antiga (a devida
-- hoje + as futuras do calendário, sem reposição por conclusão).
--
-- O QUE FAZ: apaga as ocorrências ABERTAS e NÃO espelhadas. O tick recria pela
-- janela nova em até um minuto, e o varredor da antecedência manda ao CRM só as
-- que estiverem perto de vencer.
--
-- O QUE NÃO FAZ, de propósito:
--   - não toca nas CONCLUÍDAS: são histórico, e a Tree as desenha;
--   - não toca nas que JÁ têm `bitrix_activity_id`: essas estão corretas, e
--     apagá-las aqui deixaria a atividade órfã no feed do negócio (nenhuma
--     ordem de exclusão passaria pela fila);
--   - não mexe no atributo `tree` nem em `comments`.
--
-- Idempotente: rodar de novo depois do tick não acha mais nada (as recriadas
-- ou já estão espelhadas, ou serão espelhadas pelo varredor).

begin;

-- 1) Confira ANTES o que vai sair.
select
  t.automation_rule_id,
  r.name as regra,
  count(*) as abertas_sem_espelho,
  min(t.series_occurrence) as occ_min,
  max(t.series_occurrence) as occ_max
from public.tasks t
join public.automation_rules r on r.id = t.automation_rule_id
where t.series_occurrence is not null
  and t.completed_at is null
  and t.bitrix_activity_id is null
group by 1, 2
order by 3 desc;

-- 2) A limpeza. Restrinja a uma regra específica acrescentando
--    `and t.automation_rule_id = '<uuid>'` se não quiser todas.
delete from public.tasks t
where t.series_occurrence is not null
  and t.completed_at is null
  and t.bitrix_activity_id is null;

commit;

-- 3) A regra em si: 3 futuras e 3 dias de antecedência.
--    Pode ser feito pela tela (Workflow → a regra → "Quantas adiantar" e
--    "Espelhar com (dias)"). O SQL abaixo é o mesmo ajuste, para quem preferir.
--
-- update public.automation_rules
--    set rule = jsonb_set(
--          jsonb_set(rule, '{action,series,lookahead}', '3'::jsonb, true),
--          '{action,series,mirrorLeadDays}', '3'::jsonb, true
--        )
--  where id = 'dbba41fd-f9a0-45c2-be9a-1999e11fa187';

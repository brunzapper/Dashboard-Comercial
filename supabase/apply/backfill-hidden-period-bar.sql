-- Versão: 1.0 | Data: 19/08/2026
-- OPCIONAL — preserva o comportamento ANTIGO dos dashboards que já estavam com
-- a barra de período OCULTA.
--
-- Contexto: até 19/08/2026, `settings.periodBar.enabled = false` ANULAVA o
-- período de todos os widgets ("todo o período"), ignorando o
-- `defaultPreset` salvo (o botão "Ocultar barra" preservava a chave). A partir
-- desta versão a barra oculta FIXA o período padrão do bucket para todos os
-- usuários — que é justamente o pedido (ver docs/arquitetura.md §4.2). Logo,
-- board oculto que carregava um `defaultPreset` esquecido passa a filtrar por
-- ele.
--
-- Este script torna esse "todo o período" EXPLÍCITO nesses boards, gravando o
-- sentinel `all`. Rode ANTES do deploy se preferir que nenhum board existente
-- mude de janela; sem ele, os boards adotam o novo comportamento (o desejado
-- na maioria dos casos) e o ajuste pode ser feito depois pela engrenagem da
-- barra.
--
-- Boards ocultos SEM `defaultPreset` não são tocados: sem padrão, o resolver
-- devolve null = todo o período, exatamente como antes.
--
-- Idempotente: a guarda `<> 'all'` faz a re-execução ser um no-op.
-- `periodBar.byTab` não existia antes desta versão, então não há o que migrar
-- por aba. Snapshots congelados (snapshots.config) NÃO são tocados — o viewer
-- sintetiza o próprio periodBar a partir de `snapshots.default_period`.

begin;

select
  id,
  name,
  settings -> 'periodBar' ->> 'defaultPreset' as preset_atual
from public.dashboards
where settings -> 'periodBar' ->> 'enabled' = 'false'
  and coalesce(settings -> 'periodBar' ->> 'defaultPreset', '') not in ('', 'all');

update public.dashboards
set settings = jsonb_set(
      settings,
      '{periodBar,defaultPreset}',
      '"all"'::jsonb,
      true
    )
where settings -> 'periodBar' ->> 'enabled' = 'false'
  and coalesce(settings -> 'periodBar' ->> 'defaultPreset', '') not in ('', 'all');

commit;

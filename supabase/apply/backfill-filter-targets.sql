-- Versão: 1.0 | Data: 26/07/2026
-- BACKFILL dos alvos do widget "Filtro de período" (visual_type 'filtro'):
-- converte a whitelist LEGADA `settings.targets` (lista congelada de ids —
-- widgets criados depois ficavam de fora) para a blacklist dinâmica
-- `settings.excludedTargets` (complemento calculado AGORA: widgets de dados do
-- mesmo dashboard que NÃO estavam na whitelist). Depois do backfill, widget
-- novo passa a reagir ao filtro automaticamente. Rode no SQL Editor.
--
-- IMPORTANTE: rodar SÓ APÓS o deploy do código que entende excludedTargets
-- (lib/widgets/period-resolve.ts) — o runtime antigo leria "targets ausente =
-- dashboard inteiro" e o filtro atingiria tudo até o deploy.
--
-- Idempotente: a guarda `excludedTargets is null` + a remoção de `targets`
-- fazem a re-execução ser um no-op. `targets: []` legado não é tocado (já era
-- dinâmico = dashboard inteiro; excludedTargets ausente cai no mesmo ramo).
-- Snapshots congelados (snapshots.config) NÃO são tocados — por isso o ramo
-- de compat da whitelist em period-resolve.ts é permanente.

begin;

update public.widgets w
set settings = (w.settings - 'targets')
  || jsonb_build_object(
       'excludedTargets',
       coalesce(
         (
           select jsonb_agg(to_jsonb(s.id::text))
           from public.widgets s
           where s.dashboard_id = w.dashboard_id
             and s.id <> w.id
             -- Mesmo recorte de dataWidgets/targetable do app: controles e
             -- decorativos nunca são alvo.
             and s.visual_type not in
               ('filtro', 'filtro_campo', 'forma', 'linha_divisoria', 'imagem')
             and not (w.settings -> 'targets') @> to_jsonb(s.id::text)
         ),
         '[]'::jsonb
       )
     )
where w.visual_type = 'filtro'
  and jsonb_typeof(w.settings -> 'targets') = 'array'
  and jsonb_array_length(w.settings -> 'targets') > 0
  and w.settings -> 'excludedTargets' is null;

commit;

-- Conferência: nenhum filtro com whitelist legada restante (esperado: 0).
-- select count(*) from public.widgets
-- where visual_type = 'filtro'
--   and jsonb_typeof(settings -> 'targets') = 'array'
--   and jsonb_array_length(settings -> 'targets') > 0;

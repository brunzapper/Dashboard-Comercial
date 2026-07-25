-- Versão: 1.0 | Data: 25/07/2026
-- BACKFILL do espaço de grid v2 (grade fina — lib/widgets/grid-space): converte
-- TODOS os dashboards ainda no espaço legado (settings->canvas->>gridVersion
-- ausente) de uma vez, tornando a migração lazy do write-path (ensureFineGrid,
-- app/(app)/dashboards/actions.ts) um no-op na prática. Rode no SQL Editor.
-- Também é o REPARO para o caso residual "carimbo sem conversão" (crash entre
-- o CAS e os updates de widgets): NÃO cobre esse caso automaticamente — para
-- reparar um board específico, apague o gridVersion dele e re-rode este script
-- (as posições dele terão ficado legadas; conferir visualmente após).
--
-- Matemática (espelho de convertLegacyPos/Line/Canvas — grid-space.ts):
--   x → x·10 | y → y·4 | w → max(1, w·10−1) | h → max(1, h·4−1)
--   linha (fracionária): pontas ×10/×4 sem o −1; bbox derivado (floor/ceil)
--   canvas: gridVersion=2; rowHeight=(coalesce(rowHeight,30)+12)/4 (=10.5);
--           cols ×10 (teto 480); rows ×4 (teto 800)
-- Idempotente: boards já carimbados (gridVersion presente) são ignorados.
-- Snapshots congelados (snapshots.config) NÃO são tocados — o viewer público
-- converte em runtime (app/s/[token]) até o próximo refresh.

begin;

-- 1) Linhas divisórias COM traçado salvo: escala as pontas e deriva o bbox
--    (mesma conta de lineGridBBox). Identidade nova ('linha_divisoria') e
--    legada (forma + shape.kind 'linha').
update public.widgets w
set
  settings = jsonb_set(
    w.settings,
    '{shape,line}',
    jsonb_build_object(
      'x1', (w.settings #>> '{shape,line,x1}')::numeric * 10,
      'y1', (w.settings #>> '{shape,line,y1}')::numeric * 4,
      'x2', (w.settings #>> '{shape,line,x2}')::numeric * 10,
      'y2', (w.settings #>> '{shape,line,y2}')::numeric * 4
    )
  ),
  grid_position = (
    select jsonb_build_object(
      'x', g.gx,
      'y', g.gy,
      'w', greatest(1, ceil(greatest(l.x1, l.x2))::int - g.gx),
      'h', greatest(1, ceil(greatest(l.y1, l.y2))::int - g.gy)
    )
    from (
      select
        (w.settings #>> '{shape,line,x1}')::numeric * 10 as x1,
        (w.settings #>> '{shape,line,x2}')::numeric * 10 as x2,
        (w.settings #>> '{shape,line,y1}')::numeric * 4  as y1,
        (w.settings #>> '{shape,line,y2}')::numeric * 4  as y2
    ) l,
    lateral (
      select
        greatest(0, floor(least(l.x1, l.x2)))::int as gx,
        greatest(0, floor(least(l.y1, l.y2)))::int as gy
    ) g
  )
from public.dashboards d
where d.id = w.dashboard_id
  and d.settings -> 'canvas' ->> 'gridVersion' is null
  and (
    w.visual_type = 'linha_divisoria'
    or (w.visual_type = 'forma' and w.settings #>> '{shape,kind}' = 'linha')
  )
  and jsonb_typeof(w.settings #> '{shape,line,x1}') = 'number';

-- 2) Demais widgets com grid_position preenchido ('{}' fica — o fallback do
--    posOf já é fino). Linhas SEM traçado salvo caem aqui de propósito
--    (espelho do convertLegacyWidget).
update public.widgets w
set grid_position = jsonb_build_object(
  'x', greatest(0, round((w.grid_position ->> 'x')::numeric * 10))::int,
  'y', greatest(0, round((w.grid_position ->> 'y')::numeric * 4))::int,
  'w', greatest(1, round((w.grid_position ->> 'w')::numeric * 10)::int - 1),
  'h', greatest(1, round((w.grid_position ->> 'h')::numeric * 4)::int - 1)
)
from public.dashboards d
where d.id = w.dashboard_id
  and d.settings -> 'canvas' ->> 'gridVersion' is null
  and jsonb_typeof(w.grid_position -> 'w') = 'number'
  and not (
    (
      w.visual_type = 'linha_divisoria'
      or (w.visual_type = 'forma' and w.settings #>> '{shape,kind}' = 'linha')
    )
    and jsonb_typeof(w.settings #> '{shape,line,x1}') = 'number'
  );

-- 3) Carimbo por último (é o guard das etapas acima e do ensureFineGrid).
update public.dashboards d
set settings = jsonb_set(
  coalesce(d.settings, '{}'::jsonb),
  '{canvas}',
  coalesce(d.settings -> 'canvas', '{}'::jsonb)
    || jsonb_build_object(
         'gridVersion', 2,
         'rowHeight',
         (coalesce((d.settings #>> '{canvas,rowHeight}')::numeric, 30) + 12) / 4
       )
    || (
      case
        when jsonb_typeof(d.settings #> '{canvas,cols}') = 'number'
             and (d.settings #>> '{canvas,cols}')::numeric > 0
        then jsonb_build_object(
          'cols',
          least(480, round((d.settings #>> '{canvas,cols}')::numeric * 10))::int
        )
        else '{}'::jsonb
      end
    )
    || (
      case
        when jsonb_typeof(d.settings #> '{canvas,rows}') = 'number'
             and (d.settings #>> '{canvas,rows}')::numeric > 0
        then jsonb_build_object(
          'rows',
          least(800, round((d.settings #>> '{canvas,rows}')::numeric * 4))::int
        )
        else '{}'::jsonb
      end
    )
)
where d.settings -> 'canvas' ->> 'gridVersion' is null;

commit;

-- Conferência: nenhum board legado restante (esperado: 0).
-- select count(*) from public.dashboards
-- where settings -> 'canvas' ->> 'gridVersion' is null;

// Versão: 1.0 | Data: 17/07/2026
// Paginação server-side do widget de lista de registros: o WidgetCard chama
// esta action ao trocar de página (a página 1 chega pelas props do RSC). O
// escopo (período/filtros/busca da URL) é reconstruído no servidor pelo MESMO
// loadWidgetScope do export — nunca confia em config vinda do client; RLS
// vale (client do usuário). Só atende widgets elegíveis (serverPaginatedList).
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { RecordRow } from "@/lib/records/types";
import { collectRecordFkLabels } from "@/lib/widgets/fk-labels";
import { runRecordListPage } from "@/lib/widgets/record-list";
import {
  RECORD_LIST_PAGE_SIZE,
  serverPaginatedList,
} from "@/lib/widgets/view-filters";
import { loadWidgetScope } from "@/lib/widgets/widget-scope";

export type WidgetRecordsPageResult =
  | {
      ok: true;
      rows: RecordRow[];
      total: number;
      // Rótulos de FK das linhas DESTA página (ids que o mapa inicial da page
      // pode não ter). O cliente mescla sobre o mapa que já possui.
      fkLabels: Record<string, string>;
    }
  | { ok: false; message: string };

export async function fetchWidgetRecordsPage(
  dashboardId: string,
  widgetId: string,
  // window.location.search do cliente — período/aba/filtros/busca (tf_) são
  // parâmetros de URL, resolvidos exatamente como a page (resolver único).
  search: string,
  // Índice 0-based da página pedida (página 1 da UI = índice 0).
  pageIndex: number
): Promise<WidgetRecordsPageResult> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();

  const scoped = await loadWidgetScope(
    supabase,
    session,
    dashboardId,
    widgetId,
    search
  );
  if (!scoped.ok) return scoped;
  const { widget, config, period, available } = scoped.scope;

  if (!serverPaginatedList(widget.settings)) {
    return { ok: false, message: "Widget não é paginado no servidor." };
  }

  try {
    const { rows, total } = await runRecordListPage(
      supabase,
      config,
      period,
      available,
      {
        pageIndex: Math.max(0, Math.floor(pageIndex)),
        pageSize: RECORD_LIST_PAGE_SIZE,
      }
    );
    const fkLabels = await collectRecordFkLabels(supabase, rows);
    return { ok: true, rows, total, fkLabels };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

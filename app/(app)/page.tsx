// Versão: 2.2 | Data: 17/07/2026
// Home = lista de dashboards (Fase 6A) e kanbans (dashboards.kind, 0062).
// v2.2 (17/07/2026): <RestoreLastView /> — ao REABRIR o app (sessão nova do
//   navegador), redireciona ao último board visitado (user_settings.lastView,
//   gravado pelo TrackLastView); visita in-session à Home limpa o lastView.
// v2.1 (16/07/2026): botão "Criar" (Dashboard | Kanban) no lugar do form fixo;
//   seções separadas p/ dashboards e kanbans (mesma tabela, kinds distintos).
import Link from "next/link";
import { SquareKanban, Trash2 } from "lucide-react";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import { loadUserSettings } from "@/lib/config/user-settings";
import { RestoreLastView } from "@/components/layout/restore-last-view";
import type { FieldDefinition } from "@/lib/records/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ROLE_LABELS, type RoleKey } from "@/lib/auth/roles";
import { CreateMenu } from "@/components/dashboards/create-menu";
import { deleteDashboard } from "@/app/(app)/dashboards/actions";

interface DashboardRow {
  id: string;
  name: string;
  owner_user_id: string | null;
  visible_to_roles: string[];
  kind: "dashboard" | "kanban";
}

// Valida o lastView gravado (user_settings): só /dashboards/<uuid> ou
// /kanbans/<uuid> (+ ?tab= opcional), e o board precisa estar na lista visível
// (RLS) com o kind da rota — board excluído/sem acesso não redireciona, e
// nenhum outro valor vira alvo de router.replace (sem open redirect).
function validateLastView(
  view: string | null,
  rows: DashboardRow[]
): string | null {
  if (!view) return null;
  const m = /^\/(dashboards|kanbans)\/([0-9a-f-]{36})(?:\?tab=[\w%-]+)?$/.exec(
    view
  );
  if (!m) return null;
  const row = rows.find((r) => r.id === m[2]);
  if (!row || (row.kind === "kanban") !== (m[1] === "kanbans")) return null;
  return view;
}

function BoardCard({
  row,
  href,
  isOwner,
  kanban,
}: {
  row: DashboardRow;
  href: string;
  isOwner: boolean;
  kanban?: boolean;
}) {
  return (
    <Card className="relative">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {kanban ? (
            <SquareKanban className="text-muted-foreground size-4 shrink-0" />
          ) : null}
          <Link href={href} className="hover:underline">
            {row.name}
          </Link>
        </CardTitle>
        <CardDescription>
          {row.visible_to_roles.length > 0
            ? `Compartilhado: ${row.visible_to_roles
                .map((r) => ROLE_LABELS[r as RoleKey] ?? r)
                .join(", ")}`
            : "Pessoal"}
        </CardDescription>
      </CardHeader>
      {isOwner ? (
        <form action={deleteDashboard} className="absolute top-3 right-3">
          <input type="hidden" name="id" value={row.id} />
          <Button
            type="submit"
            variant="ghost"
            size="icon"
            aria-label={kanban ? "Excluir kanban" : "Excluir dashboard"}
          >
            <Trash2 className="size-4" />
          </Button>
        </form>
      ) : null}
    </Card>
  );
}

export default async function HomePage() {
  const session = await getSessionInfo();
  const canCreate = session?.permissions.includes("create_dashboards") ?? false;

  const supabase = await createClient();
  const { data } = await supabase
    .from("dashboards")
    .select("id, name, owner_user_id, visible_to_roles, kind")
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as DashboardRow[];
  const dashboards = rows.filter((r) => r.kind !== "kanban");
  const kanbans = rows.filter((r) => r.kind === "kanban");

  // Última view p/ restaurar na REABERTURA do app (RestoreLastView). Leitura
  // de custo zero: o layout já chamou loadUserSettings (React cache()).
  const settings = session ? await loadUserSettings(session.user.id) : {};
  const storedView =
    typeof settings.lastView === "string" ? settings.lastView : null;
  const restoreTarget = validateLastView(storedView, rows);

  // Insumos do diálogo "Criar kanban" (fontes + campos p/ o agrupamento).
  let sources: Awaited<ReturnType<typeof loadSources>> = [];
  let fields: FieldDefinition[] = [];
  if (canCreate) {
    sources = await loadSources(supabase);
    // Campos p/ o seletor de colunas do kanban: NÃO filtramos por show_in_builder
    // (esse gate é dos construtores BI). Definir as colunas do quadro é escolha de
    // exibição — inclusive campos LOCAIS criados só para servir de "fase" (nunca
    // vêm da Sync). O filtro por tipo/fonte é feito no create-menu.
    const { data: fieldsData } = await supabase
      .from("field_definitions")
      .select("id, field_key, label, data_type, options, applies_to")
      .order("sort_order", { ascending: true });
    fields = (fieldsData ?? []) as FieldDefinition[];
  }

  return (
    <div className="flex flex-col gap-6">
      <RestoreLastView
        target={restoreTarget}
        hadStored={storedView !== null}
      />
      {/* pr-8: afasta o cluster de botões do sino fixo (TaskBell, topo-direito) */}
      <div className="flex items-start justify-between gap-4 pr-8">
        <div>
          <h1 className="text-2xl font-semibold">Workspace</h1>
          <p className="text-muted-foreground text-sm">
            Seu workspace: crie dashboards e kanbans a partir dos seus
            registros.
          </p>
        </div>
        {canCreate ? <CreateMenu sources={sources} fields={fields} /> : null}
      </div>

      {dashboards.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nenhum dashboard no workspace ainda.
          {canCreate ? " Use o botão Criar acima." : ""}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {dashboards.map((d) => (
            <BoardCard
              key={d.id}
              row={d}
              href={`/dashboards/${d.id}`}
              isOwner={d.owner_user_id === session?.user.id}
            />
          ))}
        </div>
      )}

      {kanbans.length > 0 ? (
        <>
          <div>
            <h2 className="text-lg font-semibold">Kanbans</h2>
            <p className="text-muted-foreground text-sm">
              Quadros de cards para gerir projetos e funis — mover um card
              altera o valor do campo no registro.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {kanbans.map((k) => (
              <BoardCard
                key={k.id}
                row={k}
                href={`/kanbans/${k.id}`}
                isOwner={k.owner_user_id === session?.user.id}
                kanban
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

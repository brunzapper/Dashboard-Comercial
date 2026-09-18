// Versão: 1.1 | Data: 18/09/2026
// v1.1 (18/09/2026): os EIXOS (0143) vão junto — sem eles o gestor no ⋮ e no
//   widget não desenhariam as colunas de coordenada, e lançar uma subdivisão
//   fora da página de Registros seria impossível.
// Leitura da BASE MANUAL (0142) para as superfícies do DASHBOARD: o widget
// "Base do Dashboard" e o painel do menu ⋮.
//
// Por que uma action em vez de props da page: a base é grande o bastante para
// não valer descer em TODA renderização do painel (a maioria dos dashboards
// não a usa), e pequena o bastante para caber numa leitura só quando usa. A
// escrita NÃO mora aqui — ela é dos choke points de
// app/(app)/registros/base-manual/actions.ts, os mesmos das outras duas
// superfícies (invariante 25).
//
// É leitura curta e com o client RLS do usuário: a policy da 0142 decide o que
// volta, e `canEdit` é só o que a UI precisa para desabilitar controles.
"use server";

import { checkSettingsArea } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadManualBase } from "@/lib/manual-base/load";
import type { ManualEntry, ManualSeries } from "@/lib/manual-base/types";
import { loadManualDeclarations } from "@/lib/manual-base/load";
import type {
  ManualFamily,
  ManualFamilyMember,
} from "@/lib/manual-base/families";

export interface ManualBaseOptionRow {
  id: string;
  name: string;
}

export interface ManualBaseState {
  ok: boolean;
  message?: string;
  series: ManualSeries[];
  entries: ManualEntry[];
  responsibles: ManualBaseOptionRow[];
  operations: ManualBaseOptionRow[];
  families: ManualFamily[];
  members: ManualFamilyMember[];
  declarations: Record<string, string[]>;
  canEdit: boolean;
}

const EMPTY: ManualBaseState = {
  ok: false,
  series: [],
  entries: [],
  responsibles: [],
  operations: [],
  families: [],
  members: [],
  declarations: {},
  canEdit: false,
};

export async function getManualBaseState(): Promise<ManualBaseState> {
  const session = await getSessionInfo();
  if (!session) return { ...EMPTY, message: "Sessão expirada." };
  // Deny individual da área esconde a Base manual em TODA superfície, não só
  // na página de Registros.
  if (!(await checkSettingsArea("base_manual"))) {
    return { ...EMPTY, message: "Você não tem acesso à Base manual." };
  }
  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  const [base, declarations, { data: respData }, { data: opData }] =
    await Promise.all([
    loadManualBase(supabase, orgId),
    loadManualDeclarations(supabase, orgId),
    supabase
      .from("responsibles")
      .select("id, display_name")
      .eq("active", true)
      .order("display_name"),
    supabase.from("operations").select("id, name").eq("active", true).order("name"),
  ]);
  return {
    ok: true,
    series: base.series,
    entries: base.entries,
    families: base.families,
    members: base.members,
    declarations,
    responsibles: (respData ?? []).map((r) => ({
      id: String(r.id),
      name: String(r.display_name ?? ""),
    })),
    operations: (opData ?? []).map((o) => ({
      id: String(o.id),
      name: String(o.name ?? ""),
    })),
    canEdit: session.permissions.includes("edit_record_values"),
  };
}

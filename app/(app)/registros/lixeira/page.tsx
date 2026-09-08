// Versão: 1.0 | Data: 07/08/2026
// Registros → Lixeira (soft delete 0121, retenção 30 dias). Lista os
// registros com deleted_at preenchido — TODAS as bases numa página só, com a
// coluna "Base" — dentro da janela de 30 dias (withinRecordsTrashTtl é a
// defesa em profundidade: vencidos somem daqui mesmo sem o cron de purga
// instalado). Restaurar/Excluir definitivamente por linha (trash-actions).
// Gate: SÓ admin (mesma régua das actions e do trigger 0121; sem chave de
// área nova — as chaves de Acessos são históricas e este gate é de papel,
// como a records_delete). Registro fora da RLS do admin nunca aparece (a
// consulta usa o client do usuário).
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import {
  RECORDS_TRASH_TTL_DAYS,
  RECORDS_TRASH_TTL_MS,
  recordsTrashExpiryLabel,
} from "@/lib/records/trash";
import { Button } from "@/components/ui/button";
import {
  TrashTable,
  type TrashItem,
} from "@/components/registros/trash-table";

// Título da aba (template do layout completa "— {appName}").
export const metadata = { title: "Lixeira de registros" };

interface TrashRow {
  id: string;
  title: string | null;
  record_type: string;
  responsible_id: string | null;
  deleted_at: string;
}

// Fora do corpo do componente (regra de pureza do render em RSC).
function trashCutoffIso(): string {
  return new Date(Date.now() - RECORDS_TRASH_TTL_MS).toISOString();
}

export default async function LixeiraPage() {
  const session = await getSessionInfo();
  if (!session?.roles.includes("admin")) redirect("/registros");

  const supabase = await createClient();
  const cutoffIso = trashCutoffIso();
  const [sources, { data: rowsData }] = await Promise.all([
    loadSources(supabase),
    supabase
      .from("records")
      .select("id, title, record_type, responsible_id, deleted_at")
      .not("deleted_at", "is", null)
      .gte("deleted_at", cutoffIso)
      .order("deleted_at", { ascending: false })
      .limit(200),
  ]);
  const rows = rowsData ?? [];

  // record_type → rótulo da base RAIZ (subs compartilham o record_type da pai
  // e não têm identidade própria na lixeira).
  const baseLabelByType = new Map<string, string>();
  for (const s of sources) {
    if (!s.parentKey && !baseLabelByType.has(s.recordType)) {
      baseLabelByType.set(s.recordType, s.label);
    }
  }

  const respIds = [
    ...new Set(
      rows
        .map((r: { responsible_id: string | null }) => r.responsible_id)
        .filter(Boolean)
    ),
  ] as string[];
  const respNameById = new Map<string, string>();
  if (respIds.length > 0) {
    const { data: respData } = await supabase
      .from("responsibles")
      .select("id, display_name")
      .in("id", respIds);
    for (const r of respData ?? []) {
      respNameById.set(r.id as string, (r.display_name as string) ?? "—");
    }
  }

  const items: TrashItem[] = rows.map((r: TrashRow) => ({
    id: r.id as string,
    title: (r.title as string) ?? "(sem título)",
    baseLabel:
      baseLabelByType.get(r.record_type as string) ?? (r.record_type as string),
    responsibleName: r.responsible_id
      ? respNameById.get(r.responsible_id as string) ?? "—"
      : "—",
    deletedAt: r.deleted_at as string,
    expiryLabel: recordsTrashExpiryLabel(r.deleted_at as string),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Lixeira</h1>
          <p className="text-muted-foreground text-sm">
            Registros excluídos ficam aqui por {RECORDS_TRASH_TTL_DAYS} dias e
            depois são excluídos definitivamente.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/registros">Voltar aos registros</Link>
        </Button>
      </div>
      <TrashTable items={items} />
    </div>
  );
}

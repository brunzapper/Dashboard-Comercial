// Versão: 1.0 | Data: 15/07/2026
// Configurações → Snapshots (admin): gestão GLOBAL dos links públicos
// congelados — todos os dashboards. Criação continua no menu ⋮ de cada
// dashboard (o snapshot nasce de uma aba específica); aqui é visão e controle:
// pausar/retomar, atualizar agora, editar e revogar.
import { listAllSnapshots } from "@/app/(app)/dashboards/snapshot-actions";
import { requireSettingsArea } from "@/lib/auth/access";
import { SnapshotsManager } from "@/components/admin/snapshots-manager";

export default async function SnapshotsPage() {
  await requireSettingsArea("snapshots");
  const snapshots = await listAllSnapshots();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Snapshots</h1>
        <p className="text-muted-foreground text-sm">
          Links públicos (sem login) com dados congelados de uma aba de
          dashboard. Para criar um novo, use o menu ⋮ do dashboard desejado. O
          link só é exibido no momento da criação.
        </p>
      </div>
      <SnapshotsManager snapshots={snapshots} />
    </div>
  );
}

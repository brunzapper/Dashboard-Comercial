// Versão: 1.0 | Data: 15/07/2026
// Gerência global de Snapshots (Configurações → Snapshots; admin): tabela com
// todos os snapshots de todos os dashboards + ações (atualizar agora, pausar/
// retomar, revogar com confirmação). Criação/edição fina ficam no menu ⋮ do
// dashboard (o snapshot pertence a uma aba específica).
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  pauseSnapshot,
  refreshSnapshotNow,
  resumeSnapshot,
  revokeSnapshot,
  type SnapshotWithDashboard,
} from "@/app/(app)/dashboards/snapshot-actions";
import {
  formatDateTime,
  scheduleLabel,
} from "@/components/snapshots/labels";

export function SnapshotsManager({
  snapshots,
}: {
  snapshots: SnapshotWithDashboard[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] =
    useState<SnapshotWithDashboard | null>(null);

  function run(fn: () => Promise<{ ok?: boolean; message?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setMessage(res.message ?? "Falha na ação.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {message ? <p className="text-destructive text-sm">{message}</p> : null}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dashboard</TableHead>
              <TableHead>Snapshot</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Agenda</TableHead>
              <TableHead>Atualizado</TableHead>
              <TableHead>Próxima</TableHead>
              <TableHead className="text-right">Acessos</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshots.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground text-sm">
                  Nenhum snapshot criado ainda. Use o menu ⋮ de um dashboard.
                </TableCell>
              </TableRow>
            ) : (
              snapshots.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="max-w-48 truncate">
                    {s.dashboardName}
                  </TableCell>
                  <TableCell className="max-w-48">
                    <span className="block truncate font-medium">{s.name}</span>
                    {s.last_refresh_error ? (
                      <span
                        className="text-destructive block truncate text-xs"
                        title={s.last_refresh_error}
                      >
                        Última atualização falhou
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.status === "active" ? "default" : "secondary"}>
                      {s.status === "active" ? "Ativo" : "Pausado"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{scheduleLabel(s)}</TableCell>
                  <TableCell className="text-sm">
                    {formatDateTime(s.last_refreshed_at)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {s.refresh_mode === "manual"
                      ? "—"
                      : formatDateTime(s.next_refresh_at)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {s.access_count}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        title="Atualizar agora"
                        aria-label="Atualizar agora"
                        disabled={pending}
                        onClick={() => run(() => refreshSnapshotNow(s.id))}
                      >
                        <RefreshCw className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        title={s.status === "active" ? "Pausar" : "Retomar"}
                        aria-label={s.status === "active" ? "Pausar" : "Retomar"}
                        disabled={pending}
                        onClick={() =>
                          run(() =>
                            s.status === "active"
                              ? pauseSnapshot(s.id)
                              : resumeSnapshot(s.id)
                          )
                        }
                      >
                        {s.status === "active" ? (
                          <Pause className="size-3.5" />
                        ) : (
                          <Play className="size-3.5" />
                        )}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive size-7"
                        title="Revogar (excluir)"
                        aria-label="Revogar (excluir)"
                        disabled={pending}
                        onClick={() => setConfirmRevoke(s)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={confirmRevoke !== null}
        onOpenChange={(o) => !o && setConfirmRevoke(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              O link público de
              {confirmRevoke ? ` "${confirmRevoke.name}"` : " este snapshot"}{" "}
              ({confirmRevoke?.dashboardName}) deixa de funcionar imediatamente e
              os dados congelados são apagados. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                const target = confirmRevoke;
                if (!target) return;
                startTransition(async () => {
                  const res = await revokeSnapshot(target.id);
                  if (!res.ok) setMessage(res.message ?? "Falha ao revogar.");
                  setConfirmRevoke(null);
                  router.refresh();
                });
              }}
            >
              Revogar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

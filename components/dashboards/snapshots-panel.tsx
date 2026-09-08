// Versão: 1.2 | Data: 07/08/2026
// v1.2 (07/08/2026): pending POR SNAPSHOT (busyId) nas ações de linha —
// "Atualizar agora" (que pode demorar) desabilita só a linha acionada, com
// spinner no botão; o resto do painel segue utilizável. O transition único
// fica para criar/editar/revogar (formulários one-shot).
// Painel "Snapshots" do menu ⋮ do dashboard: lista os snapshots deste
// dashboard e cria novos. O link público (/s/<token>) aparece UMA única vez,
// logo após a criação — o token não é recuperável depois (o banco guarda só o
// hash). Ações por snapshot: atualizar agora, pausar/retomar, editar
// (restrições/interatividade/agenda) e revogar (excluir; confirmação).
// Período congelado (0059): a criação captura o filtro de período ATIVO do
// dashboard (URL > defaults resolvidos no servidor — mesmo espelho da barra) e
// o grava em snapshots.default_period, aplicado a todos os widgets no viewer.
"use client";

import { useEffect, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import {
  Check,
  Copy,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import type { SnapshotListItem } from "@/lib/snapshots/types";
import {
  createSnapshot,
  getSnapshotFormOptions,
  listSnapshots,
  pauseSnapshot,
  refreshSnapshotNow,
  resumeSnapshot,
  revokeSnapshot,
  updateSnapshot,
  type SnapshotFormOptions,
  type SnapshotInput,
} from "@/app/(app)/dashboards/snapshot-actions";
import {
  formatDateTime,
  scheduleLabel,
} from "@/components/snapshots/labels";
import { SnapshotForm } from "@/components/snapshots/snapshot-form";
import {
  DEFAULT_PERIOD_FIELD,
  effectivePeriodBar,
  hasSelection,
  PERIOD_ALL,
  periodKeys,
  type EffectivePeriodBar,
  type PeriodScope,
  type PeriodSelection,
  type SavedPeriod,
} from "@/lib/widgets/period";
import type { DashboardSettings } from "@/lib/widgets/types";

// Contexto do filtro de período do dashboard, para capturar a seleção efetiva
// no momento da criação do snapshot (espelha a resolução da barra: URL >
// defaults por bucket resolvidos no servidor > config da barra).
export interface SnapshotPeriodCapture {
  periodBar?: DashboardSettings["periodBar"];
  // Config EFETIVA da barra por bucket (herança de periodBar.byTab resolvida no
  // servidor). Fallback local pelo mesmo helper quando o bucket não está aqui.
  barByTab?: Record<string, EffectivePeriodBar>;
  scope: PeriodScope;
  defaultsByTab: Record<string, PeriodSelection>;
  defaultFieldByTab: Record<string, string>;
  // Rótulos por chave de campo (exibição do campo de data do período).
  fieldLabels: Record<string, string>;
}

export function SnapshotsPanel({
  dashboardId,
  period,
}: {
  dashboardId: string;
  period?: SnapshotPeriodCapture;
}) {
  const sp = useSearchParams();
  // Seleção efetiva da aba: barra desabilitada → sem período; URL da barra >
  // defaults do bucket ("" no escopo global; id da aba no escopo por aba).
  const capturePeriod = period
    ? (tabId: string): SavedPeriod | null => {
        const keys = periodKeys(period.scope, tabId);
        const bucket = period.scope === "tab" ? tabId : "";
        // Config efetiva do bucket: barra OCULTA não significa mais "sem
        // período" — o padrão do bucket segue valendo (e é ele que o board
        // mostra), então é ele que o snapshot congela. Só a URL sai de cena.
        const bar =
          period.barByTab?.[bucket] ??
          effectivePeriodBar(period.periodBar, period.scope, bucket);
        const hidden = bar.enabled === false;
        const urlSel: PeriodSelection = hidden
          ? {}
          : {
              preset: sp.get(keys.preset) ?? "",
              de: sp.get(keys.de) ?? "",
              ate: sp.get(keys.ate) ?? "",
            };
        const defaults = period.defaultsByTab[bucket] ?? {
          preset: bar.defaultPreset ?? "",
        };
        const sel = hasSelection(urlSel) ? urlSel : defaults;
        const campo =
          (hidden ? "" : sp.get(keys.campo)) ||
          period.defaultFieldByTab[bucket] ||
          bar.field ||
          DEFAULT_PERIOD_FIELD;
        const preset =
          sel.preset && sel.preset !== PERIOD_ALL ? sel.preset : "";
        if (!preset && !sel.de && !sel.ate) return null;
        const out: SavedPeriod = { campo };
        if (preset) out.periodo = preset;
        if (sel.de) out.de = sel.de;
        if (sel.ate) out.ate = sel.ate;
        return out;
      }
    : undefined;
  const [items, setItems] = useState<SnapshotListItem[] | null>(null);
  const [options, setOptions] = useState<SnapshotFormOptions | null>(null);
  const [view, setView] = useState<
    { kind: "list" } | { kind: "create" } | { kind: "edit"; item: SnapshotListItem }
  >({ kind: "list" });
  const [created, setCreated] = useState<{ name: string; url: string } | null>(
    null
  );
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<SnapshotListItem | null>(
    null
  );
  const [pending, startTransition] = useTransition();

  // Carga inicial (o painel monta quando o Sheet abre). `loadNonce` permite
  // "Tentar novamente" — antes, uma rejeição deixava o "Carregando…" eterno.
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listSnapshots(dashboardId),
      getSnapshotFormOptions(dashboardId),
    ])
      .then(([list, opts]) => {
        if (cancelled) return;
        setLoadFailed(false);
        setItems(list);
        setOptions(opts);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [dashboardId, loadNonce]);

  const reload = async () => {
    setItems(await listSnapshots(dashboardId));
  };

  const tabName = (tabId: string) =>
    options?.tabs.find((t) => t.id === tabId)?.name ?? "";

  function onCreate(input: SnapshotInput) {
    setMessage(null);
    startTransition(async () => {
      const res = await createSnapshot(dashboardId, input);
      if (!res.ok || !res.token) {
        setMessage(res.message ?? "Falha ao criar snapshot.");
        return;
      }
      setCreated({
        name: input.name,
        url: `${window.location.origin}/s/${res.token}`,
      });
      if (res.message) setMessage(res.message);
      setView({ kind: "list" });
      await reload();
    });
  }

  function onUpdate(item: SnapshotListItem, input: SnapshotInput) {
    setMessage(null);
    startTransition(async () => {
      const res = await updateSnapshot(item.id, input);
      setMessage(res.ok ? null : (res.message ?? "Falha ao salvar."));
      if (res.ok) setView({ kind: "list" });
      await reload();
    });
  }

  // Ação de LINHA (atualizar/pausar/retomar): pending por snapshot — só a
  // linha acionada desabilita; as demais seguem utilizáveis.
  const [busyId, setBusyId] = useState<string | null>(null);
  function runAction(
    id: string,
    fn: () => Promise<{ ok?: boolean; message?: string }>
  ) {
    setMessage(null);
    setBusyId(id);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setMessage(res.message ?? "Falha na ação.");
      await reload();
      setBusyId(null);
    });
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard pode ser negado (permissão/contexto): mostra o link para
      // cópia manual em vez de falhar em silêncio.
      setMessage(`Não foi possível copiar automaticamente. Link: ${url}`);
    }
  }

  if (loadFailed) {
    return (
      <div className="flex flex-col items-start gap-2 px-4 py-6">
        <p className="text-destructive text-sm" role="alert">
          Não foi possível carregar os snapshots.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setLoadFailed(false);
            setLoadNonce((n) => n + 1);
          }}
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (items === null || options === null) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 px-4 py-6 text-sm">
        <Loader2 className="size-4 animate-spin" /> Carregando…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-8">
      {created ? (
        <div className="flex flex-col gap-2 rounded-md border border-primary/40 bg-primary/5 p-3">
          <p className="text-sm font-medium">
            Snapshot &quot;{created.name}&quot; criado!
          </p>
          <p className="text-muted-foreground text-xs">
            Guarde o link agora — por segurança ele NÃO será exibido novamente.
          </p>
          <div className="flex items-center gap-1.5">
            <code className="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1 text-xs">
              {created.url}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 gap-1 px-2 text-xs"
              onClick={() => copyLink(created.url)}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copiado!" : "Copiar"}
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 self-start px-2 text-xs"
            onClick={() => setCreated(null)}
          >
            Fechar aviso
          </Button>
        </div>
      ) : null}

      {message ? <p className="text-destructive text-sm">{message}</p> : null}

      {view.kind === "create" ? (
        <SnapshotForm
          options={options}
          submitLabel="Criar snapshot"
          pending={pending}
          onSubmit={onCreate}
          onCancel={() => setView({ kind: "list" })}
          capturePeriod={capturePeriod}
          fieldLabels={period?.fieldLabels}
        />
      ) : view.kind === "edit" ? (
        <SnapshotForm
          options={options}
          initial={view.item}
          submitLabel="Salvar alterações"
          pending={pending}
          onSubmit={(input) => onUpdate(view.item, input)}
          onCancel={() => setView({ kind: "list" })}
          capturePeriod={capturePeriod}
          fieldLabels={period?.fieldLabels}
        />
      ) : (
        <>
          <Button
            size="sm"
            className="self-start"
            onClick={() => setView({ kind: "create" })}
          >
            <Plus className="size-4" /> Novo snapshot
          </Button>

          {items.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nenhum snapshot deste dashboard ainda.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {items.map((s) => (
                <div key={s.id} className="flex flex-col gap-1.5 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{s.name}</span>
                    <Badge variant={s.status === "active" ? "default" : "secondary"}>
                      {s.status === "active" ? "Ativo" : "Pausado"}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {tabName(s.tab_id) ? `Aba: ${tabName(s.tab_id)} · ` : ""}
                    {scheduleLabel(s)} · Atualizado: {formatDateTime(s.last_refreshed_at)} ·{" "}
                    {s.access_count} acesso{s.access_count === 1 ? "" : "s"}
                  </p>
                  {s.last_refresh_error ? (
                    <p className="text-destructive truncate text-xs" title={s.last_refresh_error}>
                      Última atualização falhou: {s.last_refresh_error}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-xs"
                      disabled={busyId === s.id}
                      onClick={() => runAction(s.id, () => refreshSnapshotNow(s.id))}
                    >
                      {busyId === s.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}{" "}
                      Atualizar agora
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-xs"
                      disabled={busyId === s.id}
                      onClick={() =>
                        runAction(s.id, () =>
                          s.status === "active"
                            ? pauseSnapshot(s.id)
                            : resumeSnapshot(s.id)
                        )
                      }
                    >
                      {s.status === "active" ? (
                        <>
                          <Pause className="size-3.5" /> Pausar
                        </>
                      ) : (
                        <>
                          <Play className="size-3.5" /> Retomar
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-xs"
                      disabled={busyId === s.id}
                      onClick={() => setView({ kind: "edit", item: s })}
                    >
                      <Pencil className="size-3.5" /> Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive h-7 gap-1 px-2 text-xs"
                      disabled={busyId === s.id}
                      onClick={() => setConfirmRevoke(s)}
                    >
                      <Trash2 className="size-3.5" /> Revogar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <AlertDialog
        open={confirmRevoke !== null}
        onOpenChange={(o) => !o && setConfirmRevoke(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              O link público de
              {confirmRevoke ? ` "${confirmRevoke.name}"` : " este snapshot"} deixa
              de funcionar imediatamente e os dados congelados são apagados. Esta
              ação não pode ser desfeita.
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
                  await reload();
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

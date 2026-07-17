// Versão: 1.0 | Data: 17/07/2026
// Gestão dos endpoints de webhook de SAÍDA (Configurações → Integrações;
// admin): criar/editar/ativar/desativar/excluir, gerar novo segredo, disparar
// evento de teste (entrega inline) e inspecionar as últimas entregas.
// O segredo whsec_ aparece UMA vez (criação / novo segredo) — no banco fica
// só o ciphertext AES-GCM. Endpoints com falhas consecutivas são desativados
// automaticamente pelo tick (badge com o motivo); religar zera o contador.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  KeyRound,
  Pencil,
  Plus,
  Power,
  Send,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { formatDateTime } from "@/components/snapshots/labels";
import { WEBHOOK_EVENT_TYPES } from "@/lib/webhooks/events";
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  listRecentDeliveries,
  rollWebhookSecret,
  sendTestEvent,
  setWebhookEndpointActive,
  updateWebhookEndpoint,
  type DeliveryListItem,
} from "@/app/(app)/configuracoes/integracoes/actions";

export interface EndpointListItem {
  id: string;
  name: string;
  url: string;
  eventTypes: string[];
  active: boolean;
  disabledReason: string | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

const DELIVERY_STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  delivered: "Entregue",
  dead: "Desistiu",
};

export function WebhookEndpointsManager({
  endpoints,
}: {
  endpoints: EndpointListItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  // Form (criação OU edição — editingId decide).
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [eventTypes, setEventTypes] = useState<Set<string>>(new Set());
  // Segredo exibido uma vez (criação / roll).
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<EndpointListItem | null>(null);
  // Linha expandida + entregas carregadas sob demanda.
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, DeliveryListItem[]>>({});

  function openCreate() {
    setEditingId(null);
    setName("");
    setUrl("");
    setEventTypes(new Set());
    setShowForm(true);
  }

  function openEdit(e: EndpointListItem) {
    setEditingId(e.id);
    setName(e.name);
    setUrl(e.url);
    setEventTypes(new Set(e.eventTypes));
    setShowForm(true);
  }

  function submitForm() {
    setMessage(null);
    const input = { name, url, eventTypes: [...eventTypes] };
    startTransition(async () => {
      if (editingId) {
        const res = await updateWebhookEndpoint(editingId, input);
        if (!res.ok) {
          setMessage(res.message ?? "Falha ao salvar.");
          return;
        }
      } else {
        const res = await createWebhookEndpoint(input);
        if (!res.ok || !res.secret) {
          setMessage(res.message ?? "Falha ao criar.");
          return;
        }
        setSecret(res.secret);
      }
      setShowForm(false);
      router.refresh();
    });
  }

  function run(fn: () => Promise<{ ok?: boolean; message?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setMessage(res.message ?? "Falha na ação.");
      else if (res.message) setMessage(res.message);
      router.refresh();
    });
  }

  function toggleExpand(id: string) {
    const next = expanded === id ? null : id;
    setExpanded(next);
    if (next && !deliveries[next]) {
      startTransition(async () => {
        const rows = await listRecentDeliveries(next);
        setDeliveries((d) => ({ ...d, [next]: rows }));
      });
    }
  }

  async function copySecret() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Endpoints de webhook (saída)</h2>
          <p className="text-muted-foreground text-sm">
            URLs https notificadas quando dados mudam. Cada envio leva a
            assinatura HMAC no header{" "}
            <code className="text-xs">x-webhook-signature</code>.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 size-4" /> Novo endpoint
        </Button>
      </div>

      {message ? <p className="text-sm">{message}</p> : null}

      {secret ? (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
          <p className="text-sm font-medium">
            Segredo de assinatura — copie agora. Ele NÃO poderá ser exibido
            novamente (use &quot;Novo segredo&quot; para gerar outro).
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="bg-background flex-1 overflow-x-auto rounded border p-2 text-xs">
              {secret}
            </code>
            <Button size="sm" variant="outline" onClick={copySecret}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setSecret(null)}>
            Já copiei, fechar
          </Button>
        </div>
      ) : null}

      {showForm ? (
        <div className="grid gap-3 rounded-lg border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ep-name">Nome</Label>
              <Input
                id="ep-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: n8n — novos negócios"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ep-url">URL (https)</Label>
              <Input
                id="ep-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://exemplo.com/webhooks/dashboard"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Eventos (nenhum marcado = todos)</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {WEBHOOK_EVENT_TYPES.filter((t) => t !== "test.ping").map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={eventTypes.has(t)}
                    onCheckedChange={() =>
                      setEventTypes((prev) => {
                        const next = new Set(prev);
                        if (next.has(t)) next.delete(t);
                        else next.add(t);
                        return next;
                      })
                    }
                  />
                  <code className="text-xs">{t}</code>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={submitForm} disabled={pending || !name || !url}>
              {editingId ? "Salvar" : "Criar endpoint"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              <TableHead>Nome</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>Eventos</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Último sucesso</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {endpoints.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground text-sm">
                  Nenhum endpoint cadastrado ainda.
                </TableCell>
              </TableRow>
            ) : (
              endpoints.flatMap((e) => {
                const rows = [
                  <TableRow key={e.id}>
                    <TableCell className="w-8">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleExpand(e.id)}
                        title="Entregas recentes"
                      >
                        {expanded === e.id ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                      </Button>
                    </TableCell>
                    <TableCell className="max-w-40 truncate font-medium">
                      {e.name}
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-sm" title={e.url}>
                      {e.url}
                    </TableCell>
                    <TableCell className="text-sm">
                      {e.eventTypes.length === 0 ? (
                        <Badge variant="secondary">Todos</Badge>
                      ) : (
                        `${e.eventTypes.length} tipo(s)`
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={e.active ? "default" : "destructive"}>
                        {e.active ? "Ativo" : "Inativo"}
                      </Badge>
                      {!e.active && e.disabledReason ? (
                        <span
                          className="text-muted-foreground block truncate text-xs"
                          title={e.disabledReason}
                        >
                          {e.disabledReason}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDateTime(e.lastSuccessAt)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Enviar evento de teste"
                        disabled={pending}
                        onClick={() => run(() => sendTestEvent(e.id))}
                      >
                        <Send className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Editar"
                        onClick={() => openEdit(e)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Gerar novo segredo"
                        disabled={pending}
                        onClick={() =>
                          run(async () => {
                            const res = await rollWebhookSecret(e.id);
                            if (res.ok && res.secret) setSecret(res.secret);
                            return res;
                          })
                        }
                      >
                        <KeyRound className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title={e.active ? "Desativar" : "Reativar"}
                        disabled={pending}
                        onClick={() =>
                          run(() => setWebhookEndpointActive(e.id, !e.active))
                        }
                      >
                        <Power className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Excluir"
                        onClick={() => setConfirmDelete(e)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>,
                ];
                if (expanded === e.id) {
                  const list = deliveries[e.id];
                  rows.push(
                    <TableRow key={`${e.id}-deliveries`}>
                      <TableCell colSpan={7} className="bg-muted/30">
                        {!list ? (
                          <p className="text-muted-foreground text-sm">Carregando…</p>
                        ) : list.length === 0 ? (
                          <p className="text-muted-foreground text-sm">
                            Nenhuma entrega ainda — use o botão de teste.
                          </p>
                        ) : (
                          <div className="flex flex-col gap-1 py-1">
                            {list.map((d) => (
                              <div
                                key={d.id}
                                className="flex items-center gap-3 text-xs"
                              >
                                <Badge
                                  variant={
                                    d.status === "delivered"
                                      ? "default"
                                      : d.status === "pending"
                                        ? "secondary"
                                        : "destructive"
                                  }
                                >
                                  {DELIVERY_STATUS_LABEL[d.status] ?? d.status}
                                </Badge>
                                <code>{d.event_type}</code>
                                <span className="text-muted-foreground">
                                  {formatDateTime(d.created_at)}
                                </span>
                                <span>
                                  {d.attempts} tentativa(s)
                                  {d.response_status ? ` · HTTP ${d.response_status}` : ""}
                                </span>
                                {d.last_error ? (
                                  <span
                                    className="text-destructive max-w-64 truncate"
                                    title={d.last_error}
                                  >
                                    {d.last_error}
                                  </span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                }
                return rows;
              })
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir endpoint?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{confirmDelete?.name}&quot; deixará de receber notificações
              e o histórico de entregas dele será apagado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={() => {
                const id = confirmDelete?.id;
                setConfirmDelete(null);
                if (!id) return;
                run(() => deleteWebhookEndpoint(id));
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

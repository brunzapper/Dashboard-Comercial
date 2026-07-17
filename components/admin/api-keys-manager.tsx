// Versão: 1.0 | Data: 17/07/2026
// Gestão das chaves de API de ENTRADA (Configurações → Integrações; admin).
// Criação exibe o plaintext dck_... UMA única vez (o banco guarda só o sha256
// — padrão dos snapshots); revogação tem efeito imediato (sem redeploy).
// O mapeamento (ColumnMapping[] em JSON) é o mesmo shape do import de CSV.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { createApiKey, revokeApiKey } from "@/app/(app)/configuracoes/integracoes/actions";

export interface ApiKeyListItem {
  id: string;
  keyPrefix: string;
  label: string;
  sourceKey: string;
  hasMapping: boolean;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export function ApiKeysManager({
  keys,
  sources,
}: {
  keys: ApiKeyListItem[];
  sources: { key: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [label, setLabel] = useState("");
  const [sourceKey, setSourceKey] = useState("");
  const [mappingJson, setMappingJson] = useState("");
  const [dedup, setDedup] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<ApiKeyListItem | null>(null);

  function submitCreate() {
    setMessage(null);
    startTransition(async () => {
      const res = await createApiKey({
        label,
        sourceKey,
        mappingJson,
        dedupColumns: dedup
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
      });
      if (!res.ok || !res.plaintext) {
        setMessage(res.message ?? "Falha ao criar a chave.");
        return;
      }
      setCreated(res.plaintext);
      setShowCreate(false);
      setLabel("");
      setMappingJson("");
      setDedup("");
      router.refresh();
    });
  }

  async function copyCreated() {
    if (!created) return;
    await navigator.clipboard.writeText(created);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Chaves de API (entrada)</h2>
          <p className="text-muted-foreground text-sm">
            Sistemas externos enviam dados com{" "}
            <code className="text-xs">POST /api/ingest/&lt;fonte&gt;</code> e{" "}
            <code className="text-xs">Authorization: Bearer dck_...</code>
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
          <Plus className="mr-1 size-4" /> Nova chave
        </Button>
      </div>

      {message ? <p className="text-destructive text-sm">{message}</p> : null}

      {created ? (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
          <p className="text-sm font-medium">
            Chave criada — copie agora. Ela NÃO poderá ser exibida novamente.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="bg-background flex-1 overflow-x-auto rounded border p-2 text-xs">
              {created}
            </code>
            <Button size="sm" variant="outline" onClick={copyCreated}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => setCreated(null)}
          >
            Já copiei, fechar
          </Button>
        </div>
      ) : null}

      {showCreate ? (
        <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ak-label">Nome</Label>
            <Input
              id="ak-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex.: Zapier — propostas"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Fonte</Label>
            <Select value={sourceKey} onValueChange={setSourceKey}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha a fonte de destino" />
              </SelectTrigger>
              <SelectContent>
                {sources.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="ak-mapping">
              Mapeamento (JSON de ColumnMapping[], opcional — obrigatório p/
              enviar &quot;rows&quot;)
            </Label>
            <Textarea
              id="ak-mapping"
              value={mappingJson}
              onChange={(e) => setMappingJson(e.target.value)}
              rows={4}
              placeholder='[{"csvColumn":"Nome","target":"core:title"},{"csvColumn":"Valor","target":"core:value"}]'
              className="font-mono text-xs"
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="ak-dedup">
              Colunas de dedup (separadas por vírgula; vazio = linha inteira)
            </Label>
            <Input
              id="ak-dedup"
              value={dedup}
              onChange={(e) => setDedup(e.target.value)}
              placeholder="Ex.: Nome, Data"
            />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button size="sm" onClick={submitCreate} disabled={pending || !label || !sourceKey}>
              Criar chave
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Prefixo</TableHead>
              <TableHead>Fonte</TableHead>
              <TableHead>Mapeamento</TableHead>
              <TableHead>Último uso</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground text-sm">
                  Nenhuma chave criada ainda.
                </TableCell>
              </TableRow>
            ) : (
              keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="max-w-48 truncate font-medium">
                    {k.label}
                  </TableCell>
                  <TableCell>
                    <code className="text-xs">{k.keyPrefix}…</code>
                  </TableCell>
                  <TableCell className="text-sm">{k.sourceKey}</TableCell>
                  <TableCell>
                    <Badge variant={k.hasMapping ? "default" : "secondary"}>
                      {k.hasMapping ? "Configurado" : "Sem mapping"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatDateTime(k.lastUsedAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={k.revokedAt ? "destructive" : "default"}>
                      {k.revokedAt ? "Revogada" : "Ativa"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {!k.revokedAt ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmRevoke(k)}
                        title="Revogar"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={confirmRevoke !== null}
        onOpenChange={(open) => !open && setConfirmRevoke(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar chave?</AlertDialogTitle>
            <AlertDialogDescription>
              A integração &quot;{confirmRevoke?.label}&quot; deixará de
              conseguir enviar dados imediatamente. Esta ação não pode ser
              desfeita — para religar, crie uma chave nova.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={() => {
                const id = confirmRevoke?.id;
                setConfirmRevoke(null);
                if (!id) return;
                startTransition(async () => {
                  const res = await revokeApiKey(id);
                  if (!res.ok) setMessage(res.message ?? "Falha ao revogar.");
                  router.refresh();
                });
              }}
            >
              Revogar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

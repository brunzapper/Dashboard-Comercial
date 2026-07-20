// Versão: 1.0 | Data: 20/07/2026
// Manager da aba Configurações → Presets: lista o catálogo de presets com o
// estado (gerado/não gerado, versão aplicada, link p/ o dashboard) e os botões
// "Gerar"/"Atualizar" (applyPreset) e "Gerar/atualizar todos" (generatePresets).
// As actions são idempotentes; o resumo do resultado (widgets novos/
// atualizados/removidos) é exibido por linha.
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ExternalLink, RefreshCw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  applyPreset,
  generatePresets,
} from "@/app/(app)/dashboards/actions";

export interface PresetRow {
  presetKey: string;
  name: string;
  version: number;
  widgetCount: number;
  tabCount: number;
  appliedVersion: number | null; // null = não gerado
  dashboardId: string | null;
  // Existe dashboard homônimo sem marcador: gerar ADOTA em vez de duplicar.
  willAdopt: boolean;
}

export function PresetsManager({ rows }: { rows: PresetRow[] }) {
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<
    Record<string, { ok: boolean; text: string }>
  >({});
  const [globalMsg, setGlobalMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  function runOne(presetKey: string) {
    setBusyKey(presetKey);
    setGlobalMsg(null);
    startTransition(async () => {
      const res = await applyPreset(presetKey);
      setMessages((m) => ({
        ...m,
        [presetKey]: { ok: Boolean(res.ok), text: res.message ?? "" },
      }));
      setBusyKey(null);
    });
  }

  function runAll() {
    setBusyKey("__all__");
    setMessages({});
    startTransition(async () => {
      const res = await generatePresets();
      setGlobalMsg({ ok: Boolean(res.ok), text: res.message ?? "" });
      setBusyKey(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button onClick={runAll} disabled={pending}>
          <Sparkles className="size-4" /> Gerar/atualizar todos
        </Button>
        {globalMsg ? (
          <span
            className={
              globalMsg.ok
                ? "text-muted-foreground text-sm"
                : "text-destructive text-sm"
            }
          >
            {globalMsg.text}
          </span>
        ) : null}
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Preset</TableHead>
              <TableHead>Conteúdo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-muted-foreground text-center"
                >
                  Nenhum preset no catálogo.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const generated = r.appliedVersion != null;
                const msg = messages[r.presetKey];
                return (
                  <TableRow key={r.presetKey}>
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-muted-foreground text-xs">
                        {r.presetKey} · v{r.version}
                      </div>
                      {msg ? (
                        <div
                          className={
                            msg.ok
                              ? "text-muted-foreground mt-1 text-xs"
                              : "text-destructive mt-1 text-xs"
                          }
                        >
                          {msg.text}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {r.widgetCount} widget(s)
                      {r.tabCount > 0 ? ` · ${r.tabCount} aba(s)` : ""}
                    </TableCell>
                    <TableCell>
                      {generated ? (
                        <span className="inline-flex items-center gap-2 text-sm">
                          Gerado · v{r.appliedVersion}
                          {r.dashboardId ? (
                            <Link
                              href={`/dashboards/${r.dashboardId}`}
                              className="text-primary inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
                            >
                              Abrir <ExternalLink className="size-3" />
                            </Link>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">
                          {r.willAdopt
                            ? "Não gerado (adota o dashboard homônimo existente)"
                            : "Não gerado"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant={generated ? "outline" : "default"}
                        size="sm"
                        disabled={pending}
                        onClick={() => runOne(r.presetKey)}
                      >
                        {busyKey === r.presetKey ? (
                          <RefreshCw className="size-4 animate-spin" />
                        ) : generated ? (
                          <RefreshCw className="size-4" />
                        ) : (
                          <Sparkles className="size-4" />
                        )}
                        {generated ? "Atualizar" : "Gerar"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-muted-foreground text-xs">
        Sub-fontes e campos que o preset declara são criados só quando ausentes
        — os já existentes nunca são sobrescritos. Widgets sem identidade de
        preset (adicionados à mão no dashboard) não são tocados na atualização.
      </p>
    </div>
  );
}

// Versão: 1.0 | Data: 07/08/2026
// Sheet "Editar campos" da SELEÇÃO em massa (/registros): o usuário escolhe
// campos e valores (ou "limpar") e aplica a TODOS os registros selecionados.
// Reusa a máquina inteira do contrato registros-update em MODO SELEÇÃO — o
// catálogo de alvos vem de loadRecordsUpdateTargets (fonte única —
// loadRecordsUpdateContext), o JSON canônico sai de serializeRecordsUpdate
// (filtros []), a prévia obrigatória e o apply são as MESMAS actions da IA
// sobre selecionados (previewRecordsSelectionUpdateJson /
// applyRecordsSelectionUpdate): validador/coerção/choke point únicos, nunca
// um caminho paralelo de escrita. Painel de prévia compartilhado
// (update-preview.tsx).
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { EntryFieldSpec } from "@/lib/import/records/types";
import type {
  ApplyRecordsUpdateState,
  GenerateRecordsUpdateState,
  RecordsUpdatePreview,
} from "@/lib/ai/update-records";
import { serializeRecordsUpdate } from "@/lib/import/records/update-validate";
import type { UpdateChangeValue } from "@/lib/import/records/update-types";
import {
  applyRecordsSelectionUpdate,
  loadRecordsUpdateTargets,
  previewRecordsSelectionUpdateJson,
} from "@/app/(app)/registros/ai-update-actions";
import { UpdatePreviewPanel } from "./update-preview";

interface ChangeRow {
  key: string;
  value: string;
  clear: boolean;
}

function ValueEditor({
  spec,
  row,
  onChange,
  disabled,
}: {
  spec: EntryFieldSpec;
  row: ChangeRow;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  if (row.clear) {
    return (
      <span className="text-muted-foreground text-sm italic">
        o campo será limpo
      </span>
    );
  }
  if (spec.dataType === "booleano") {
    return (
      <Combobox
        options={[
          { value: "true", label: "Sim" },
          { value: "false", label: "Não" },
        ]}
        value={row.value}
        onValueChange={onChange}
        placeholder="—"
        className="w-full"
        aria-label={`Valor de ${spec.label}`}
      />
    );
  }
  if (
    (spec.dataType === "selecao" || spec.dataType === "relacao") &&
    (spec.options?.length ?? 0) > 0
  ) {
    return (
      <Combobox
        options={(spec.options ?? []).map((o) => ({ value: o, label: o }))}
        value={row.value}
        onValueChange={onChange}
        placeholder="—"
        className="w-full"
        aria-label={`Valor de ${spec.label}`}
      />
    );
  }
  if (spec.dataType === "data") {
    return (
      <Input
        type="date"
        value={row.value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={`Valor de ${spec.label}`}
      />
    );
  }
  if (spec.dataType === "numero" || spec.dataType === "moeda") {
    return (
      <Input
        type="number"
        step={spec.dataType === "moeda" ? "0.01" : "any"}
        value={row.value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={`Valor de ${spec.label}`}
      />
    );
  }
  return (
    <Input
      value={row.value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={`Valor de ${spec.label}`}
    />
  );
}

export function BulkEditSheet({
  source,
  selectedIds,
  open,
  onOpenChange,
  onApplied,
}: {
  source: { key: string; label: string };
  selectedIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Apply com escrita: limpar seleção + refresh (dono: a tabela). */
  onApplied: () => void;
}) {
  const router = useRouter();
  const [targets, setTargets] = useState<EntryFieldSpec[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<ChangeRow[]>([
    { key: "", value: "", clear: false },
  ]);
  const [preview, setPreview] = useState<RecordsUpdatePreview | null>(null);
  const [pendingJson, setPendingJson] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  // Abrir = estado zerado + catálogo fresco (options/permissões mudam).
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows([{ key: "", value: "", clear: false }]);
    setPreview(null);
    setPendingJson(null);
    setWarnings([]);
    setConfirmed(false);
    setMessage(null);
    setErrors([]);
    setTargets(null);
    setLoadError(null);
    let cancelled = false;
    void loadRecordsUpdateTargets(source.key).then((res) => {
      if (cancelled) return;
      if (res.ok) setTargets(res.fields);
      else setLoadError(res.message);
    });
    return () => {
      cancelled = true;
    };
  }, [open, source.key]);

  const specByKey = new Map((targets ?? []).map((f) => [f.key, f]));
  const usedKeys = new Set(rows.map((r) => r.key).filter(Boolean));

  const clearPreview = () => {
    setPreview(null);
    setPendingJson(null);
    setWarnings([]);
    setConfirmed(false);
  };

  const patchRow = (i: number, patch: Partial<ChangeRow>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    clearPreview();
  };

  const buildJson = (): string | null => {
    const changes: Record<string, UpdateChangeValue> = {};
    for (const row of rows) {
      if (!row.key) continue;
      if (row.clear) {
        changes[row.key] = null;
        continue;
      }
      const v = row.value.trim();
      if (v === "") continue;
      changes[row.key] = v;
    }
    if (Object.keys(changes).length === 0) return null;
    return serializeRecordsUpdate([], changes);
  };

  async function runPreview() {
    const json = buildJson();
    if (!json) {
      setMessage("Escolha ao menos um campo e um valor (ou “limpar”).");
      return;
    }
    setBusy(true);
    setMessage(null);
    setErrors([]);
    try {
      const res: GenerateRecordsUpdateState =
        await previewRecordsSelectionUpdateJson(json, source.key, selectedIds);
      if (res.ok) {
        setPreview(res.preview ?? null);
        setPendingJson(res.pendingJson ?? null);
        setWarnings(res.warnings ?? []);
        setConfirmed(false);
        setMessage(res.message ?? null);
      } else {
        clearPreview();
        setMessage(res.message ?? "Falha ao montar a prévia.");
        setErrors(res.errors ?? []);
      }
    } catch {
      setMessage("Falha de comunicação ao montar a prévia — tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  async function applyPending() {
    if (!pendingJson || !preview || busy || applying) return;
    if (preview.overCap || preview.total === 0 || !confirmed) return;
    setApplying(true);
    try {
      const res: ApplyRecordsUpdateState = await applyRecordsSelectionUpdate(
        pendingJson,
        source.key,
        selectedIds
      );
      setMessage(res.message ?? null);
      setErrors(
        res.errors ??
          (res.failures ?? []).map((f) => `${f.title}: ${f.message}`)
      );
      if ((res.changedCount ?? 0) > 0) {
        clearPreview();
        router.refresh();
        onApplied();
        onOpenChange(false);
      }
    } catch {
      setMessage(
        "Falha de comunicação ao aplicar — confira os registros antes de tentar de novo."
      );
    } finally {
      setApplying(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            Editar campos — {selectedIds.length} selecionado(s)
          </SheetTitle>
          <SheetDescription>
            Os valores abaixo serão gravados em TODOS os registros
            selecionados de {source.label}. Veja a prévia antes → depois e
            confirme — nada é gravado sem isso.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 px-4 pb-6">
          {loadError ? (
            <p className="text-destructive text-sm">{loadError}</p>
          ) : targets == null ? (
            <p className="text-muted-foreground text-sm">Carregando campos…</p>
          ) : (
            <div className="flex flex-col gap-2">
              {rows.map((row, i) => {
                const spec = row.key ? specByKey.get(row.key) : undefined;
                return (
                  <div
                    key={i}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-2"
                  >
                    <Combobox
                      options={targets
                        .filter((f) => f.key === row.key || !usedKeys.has(f.key))
                        .map((f) => ({ value: f.key, label: f.label }))}
                      value={row.key}
                      onValueChange={(k) =>
                        patchRow(i, { key: k, value: "", clear: false })
                      }
                      placeholder="Campo…"
                      className="w-full"
                      aria-label="Campo a alterar"
                    />
                    {spec ? (
                      <ValueEditor
                        spec={spec}
                        row={row}
                        onChange={(v) => patchRow(i, { value: v })}
                        disabled={busy || applying}
                      />
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                    {/* "title" nunca pode ser limpo (regra do contrato). */}
                    {spec && spec.key !== "title" ? (
                      <label className="flex items-center gap-1.5 text-xs">
                        <Checkbox
                          checked={row.clear}
                          onCheckedChange={(v) =>
                            patchRow(i, { clear: v === true })
                          }
                          disabled={busy || applying}
                          aria-label={`Limpar ${spec.label}`}
                        />
                        Limpar
                      </label>
                    ) : (
                      <span />
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label="Remover campo"
                      disabled={rows.length === 1 && !row.key}
                      onClick={() => {
                        setRows((rs) =>
                          rs.length === 1
                            ? [{ key: "", value: "", clear: false }]
                            : rs.filter((_, j) => j !== i)
                        );
                        clearPreview();
                      }}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                );
              })}
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={busy || applying}
                  onClick={() =>
                    setRows((rs) => [...rs, { key: "", value: "", clear: false }])
                  }
                >
                  <Plus className="size-3.5" /> Adicionar campo
                </Button>
              </div>
            </div>
          )}

          {message ? (
            <p className="text-muted-foreground text-sm" role="status">
              {message}
            </p>
          ) : null}
          {errors.length > 0 ? (
            <ul className="text-destructive list-disc pl-5 text-sm">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          ) : null}
          {warnings.length > 0 ? (
            <ul className="text-muted-foreground list-disc pl-5 text-xs">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}

          {preview && pendingJson ? (
            <UpdatePreviewPanel
              preview={preview}
              selectionCount={selectedIds.length}
              confirmed={confirmed}
              onConfirmedChange={setConfirmed}
              applying={applying}
              busy={busy}
              onApply={applyPending}
              onDiscard={clearPreview}
            />
          ) : (
            <div>
              <Button
                size="sm"
                onClick={runPreview}
                disabled={busy || applying || targets == null}
              >
                {busy ? "Montando prévia…" : "Ver prévia"}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

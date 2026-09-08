// Versão: 1.0 | Data: 07/08/2026
// Aba Campos → Reclassificações (domínios DINÂMICOS de mapeamento, 0119):
// cria/edita/exclui reclassificações pela UI (base + campo de origem + campos
// classificados + categorias definidas ANTES de começar) e embute o
// MappingsManager (mesmo gestor do card de Operação — pendências, dropdowns
// com valor livre, IA interna/externa, export CSV/JSON, "Aplicar agora").
// Carregamento LAZY: o overview (varredura por domínio) só carrega quando a
// aba fica VISÍVEL (IntersectionObserver — os painéis do CamposTabs ficam
// todos montados com `hidden`); as escritas recarregam via onChanged.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ResizableSheetContent } from "@/components/ui/resizable-sheet-content";
import { MappingsManager } from "@/components/operacao/mappings-manager";
import { slugify } from "@/lib/records/slug";
import {
  deleteMappingDomain,
  loadReclassOverview,
  saveMappingDomain,
  type ReclassDomainRow,
  type ReclassOverviewPayload,
  type ReclassTargetInput,
} from "@/app/(app)/campos/reclassificacoes-actions";

export interface ReclassBaseOption {
  recordType: string;
  label: string;
}

export interface ReclassFieldOption {
  fieldKey: string;
  label: string;
  /** applies_to do field_definition (vazio = geral, vale p/ toda base). */
  appliesTo: string[] | null;
}

const MAX_TARGETS = 3;

interface TargetDraft {
  fieldKey: string;
  label: string;
  optionsText: string;
}

const emptyTarget = (): TargetDraft => ({ fieldKey: "", label: "", optionsText: "" });

export function ReclassDomainsTab({
  bases,
  fieldOptions,
  ai,
}: {
  bases: ReclassBaseOption[];
  fieldOptions: ReclassFieldOption[];
  ai: { provider: string; model: string; hasKey: boolean } | null;
}) {
  const [payload, setPayload] = useState<ReclassOverviewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Wizard (criar/editar)
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ReclassDomainRow | null>(null);
  const [label, setLabel] = useState("");
  const [recordTypes, setRecordTypes] = useState<string[]>([]);
  const [rawFieldKey, setRawFieldKey] = useState("");
  const [targets, setTargets] = useState<TargetDraft[]>([emptyTarget()]);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<ReclassDomainRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await loadReclassOverview();
      setPayload(res);
      if (!res.ok && res.message) setMessage(res.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Lazy: carrega na 1ª vez que a aba fica visível (painel sai do hidden).
  useEffect(() => {
    const el = rootRef.current;
    if (!el || payload || loading) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        obs.disconnect();
        void load();
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [payload, loading, load]);

  function openCreate() {
    setEditing(null);
    setLabel("");
    setRecordTypes(bases.length === 1 ? [bases[0].recordType] : []);
    setRawFieldKey("");
    setTargets([emptyTarget()]);
    setOpen(true);
  }

  function openEdit(row: ReclassDomainRow) {
    setEditing(row);
    setLabel(row.label);
    setRecordTypes(row.recordTypes);
    setRawFieldKey(row.rawFieldKey);
    setTargets(
      row.targets.map((t) => ({
        fieldKey: t.fieldKey,
        label: t.label,
        optionsText: t.options.join("\n"),
      }))
    );
    setOpen(true);
  }

  const toggleBase = (recordType: string) =>
    setRecordTypes((prev) =>
      prev.includes(recordType)
        ? prev.filter((t) => t !== recordType)
        : [...prev, recordType]
    );

  // Campo de origem: aplica-se a TODAS as bases escolhidas (applies_to vazio
  // = geral). O alvo derivado não pode ser origem de si mesmo.
  const targetKeys = new Set(targets.map((t) => t.fieldKey).filter(Boolean));
  const rawCandidates = fieldOptions.filter(
    (f) =>
      !targetKeys.has(f.fieldKey) &&
      recordTypes.length > 0 &&
      recordTypes.every(
        (rt) => !f.appliesTo || f.appliesTo.length === 0 || f.appliesTo.includes(rt)
      )
  );

  const setTarget = (i: number, patch: Partial<TargetDraft>) =>
    setTargets((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });

  async function save() {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const input = {
        key: editing?.key,
        label,
        recordTypes,
        rawFieldKey,
        rawFieldLabel:
          fieldOptions.find((f) => f.fieldKey === rawFieldKey)?.label ??
          editing?.rawFieldLabel ??
          rawFieldKey,
        targets: targets
          .filter((t) => t.label.trim() || t.optionsText.trim())
          .map(
            (t): ReclassTargetInput => ({
              fieldKey: t.fieldKey || slugify(t.label),
              label: t.label,
              options: t.optionsText
                .split(/\r?\n/)
                .map((o) => o.trim())
                .filter(Boolean),
            })
          ),
      };
      const res = await saveMappingDomain(input);
      setMessage(res.message ?? null);
      if (res.ok) {
        setOpen(false);
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    const row = toDelete;
    if (!row) return;
    setToDelete(null);
    setMessage(null);
    const res = await deleteMappingDomain(row.key);
    setMessage(res.message ?? null);
    await load();
  }

  const rows = payload?.rows ?? [];

  return (
    <div ref={rootRef} className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-muted-foreground max-w-3xl text-sm">
          Reclassifique os valores de um campo em categorias suas (de-para):
          escolha a base e o campo de origem, defina os campos classificados e
          as categorias, e classifique manualmente, com a IA do sistema ou com
          uma IA externa (exportando CSV/JSON). O sistema aprende com as
          classificações feitas e passa a sugerir as próximas automaticamente.
        </p>
        <Button type="button" size="sm" onClick={openCreate}>
          <Plus className="size-4" />
          Nova reclassificação
        </Button>
      </div>

      {/* Reclassificações dinâmicas (as do sistema aparecem só no gestor). */}
      {rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {rows.map((row) => (
            <span
              key={row.key}
              className="flex items-center gap-1 rounded-full border py-1 pr-1 pl-3 text-sm"
            >
              {row.label}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-6"
                onClick={() => openEdit(row)}
                aria-label={`Editar reclassificação ${row.label}`}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-6"
                onClick={() => setToDelete(row)}
                aria-label={`Excluir reclassificação ${row.label}`}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </span>
          ))}
        </div>
      ) : null}

      {loading || !payload ? (
        <p className="text-muted-foreground rounded-lg border p-4 text-sm">
          Carregando reclassificações…
        </p>
      ) : payload.ok ? (
        <MappingsManager overview={payload.overview} ai={ai} onChanged={load} />
      ) : (
        <p className="text-destructive rounded-lg border p-4 text-sm">
          {payload.message ?? "Falha ao carregar."}
        </p>
      )}

      {message ? (
        <p className="text-muted-foreground text-sm" role="status">
          {message}
        </p>
      ) : null}

      <Sheet open={open} onOpenChange={setOpen}>
        <ResizableSheetContent
          storageKey="panel-w:reclass-form"
          defaultWidth={480}
          className="overflow-y-auto"
        >
          <SheetHeader>
            <SheetTitle>
              {editing ? "Editar reclassificação" : "Nova reclassificação"}
            </SheetTitle>
            <SheetDescription>
              Os campos classificados são preenchidos automaticamente a partir
              do de-para; valores sem classificação ficam pendentes e viram
              tarefa no sino.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reclass-label">Nome</Label>
              <Input
                id="reclass-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ex.: Porte de empresa"
              />
              {!editing && label.trim() ? (
                <p className="text-muted-foreground text-xs">
                  Chave: <code>{slugify(label)}</code>
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Bases</Label>
              <div className="flex flex-wrap gap-2">
                {bases.map((b) => (
                  <label
                    key={b.recordType}
                    className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={recordTypes.includes(b.recordType)}
                      onChange={() => toggleBase(b.recordType)}
                    />
                    {b.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reclass-raw">Campo de origem (valor cru)</Label>
              <select
                id="reclass-raw"
                value={rawFieldKey}
                onChange={(e) => setRawFieldKey(e.target.value)}
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                disabled={recordTypes.length === 0}
              >
                <option value="">
                  {recordTypes.length === 0
                    ? "Escolha a(s) base(s) primeiro…"
                    : "Escolha o campo…"}
                </option>
                {rawCandidates.map((f) => (
                  <option key={f.fieldKey} value={f.fieldKey}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-3">
              <Label>Campos classificados (até {MAX_TARGETS})</Label>
              {targets.map((t, i) => (
                <div key={i} className="flex flex-col gap-1.5 rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      value={t.label}
                      onChange={(e) =>
                        setTarget(i, {
                          label: e.target.value,
                          // fieldKey acompanha o nome até ser "travado" (edição).
                          ...(editing ? {} : { fieldKey: slugify(e.target.value) }),
                        })
                      }
                      placeholder={`Nome do campo classificado ${i + 1}`}
                      className="h-8"
                    />
                    {targets.length > 1 ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        onClick={() =>
                          setTargets((prev) => prev.filter((_, j) => j !== i))
                        }
                        aria-label="Remover campo classificado"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    ) : null}
                  </div>
                  {t.fieldKey ? (
                    <p className="text-muted-foreground text-xs">
                      Campo: <code>custom:{t.fieldKey}</code>
                    </p>
                  ) : null}
                  <Textarea
                    value={t.optionsText}
                    onChange={(e) => setTarget(i, { optionsText: e.target.value })}
                    placeholder={"Categorias (uma por linha)\nEx.:\nPequena\nMédia\nGrande"}
                    rows={4}
                  />
                </div>
              ))}
              {targets.length < MAX_TARGETS ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setTargets((prev) => [...prev, emptyTarget()])}
                >
                  <Plus className="size-4" />
                  Adicionar campo classificado
                </Button>
              ) : null}
              <p className="text-muted-foreground text-xs">
                Defina as categorias antes de começar — durante a classificação
                você ainda pode digitar categorias novas (o dropdown aceita
                valor livre).
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button type="button" onClick={save} disabled={saving}>
                {saving
                  ? "Salvando…"
                  : editing
                    ? "Salvar e reaplicar"
                    : "Criar reclassificação"}
              </Button>
            </div>
          </div>
        </ResizableSheetContent>
      </Sheet>

      <ConfirmDialog
        open={toDelete != null}
        onOpenChange={(o) => {
          if (!o) setToDelete(null);
        }}
        title="Excluir reclassificação?"
        description={
          toDelete
            ? `As ENTRADAS do de-para de "${toDelete.label}" serão excluídas. ` +
              `Os campos classificados e os valores já gravados nos registros ` +
              `serão preservados.`
            : ""
        }
        actionLabel="Excluir"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

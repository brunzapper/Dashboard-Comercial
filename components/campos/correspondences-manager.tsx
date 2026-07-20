// Versão: 1.0 | Data: 09/07/2026
// Fase 8: gestão das correspondências de colunas (campos unificados) na aba
// Campos. Tabela + Sheet para criar/editar. Cada correspondência liga uma coluna
// por fonte (Leads/Deals/Estudo); o construtor de widgets usa como `unified:<key>`.
"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { DATA_TYPE_LABELS, type DataType } from "@/lib/records/types";
import { sourceLabel, type SourceKey } from "@/lib/sources";
import { useSources } from "@/components/sources-context";
import type { Correspondence } from "@/lib/correspondences";
import {
  createCorrespondence,
  deleteCorrespondence,
  updateCorrespondence,
  type CorrespondenceActionState,
} from "@/app/(app)/campos/correspondences-actions";

export interface RefOption {
  ref: string;
  label: string;
}

const DATA_TYPE_OPTIONS: ComboboxOption[] = (
  Object.keys(DATA_TYPE_LABELS) as DataType[]
).map((t) => ({ value: t, label: DATA_TYPE_LABELS[t] }));

const initial: CorrespondenceActionState = {};

function CorrespondenceForm({
  correspondence,
  candidatesBySource,
  onDone,
}: {
  correspondence?: Correspondence;
  candidatesBySource: Record<SourceKey, RefOption[]>;
  onDone?: () => void;
}) {
  const isEdit = Boolean(correspondence);
  const action = isEdit ? updateCorrespondence : createCorrespondence;
  const [state, formAction, pending] = useActionState(action, initial);
  const catalog = useSources();
  const [dataType, setDataType] = useState<DataType>(
    correspondence?.data_type ?? "numero"
  );

  const defaultRef: Record<SourceKey, string> = Object.fromEntries(
    catalog.map((s) => [s.key, ""])
  );
  for (const m of correspondence?.members ?? []) {
    // Identidade do membro = source-key (0078); cai no record_type p/ membros
    // antigos (fontes dinâmicas: key === record_type).
    const src = m.source_key ?? m.record_type;
    if (src in defaultRef) defaultRef[src] = m.field_ref;
  }
  const [refs, setRefs] = useState<Record<SourceKey, string>>(defaultRef);

  useEffect(() => {
    if (state.ok && onDone) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {isEdit ? (
        <input type="hidden" name="id" value={correspondence!.id} />
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="label">Rótulo</Label>
        <Input
          id="label"
          name="label"
          defaultValue={correspondence?.label ?? ""}
          placeholder="Ex.: MRR unificado, Consultor, Grupo de origem"
          required
        />
        {isEdit ? (
          <p className="text-muted-foreground text-xs">
            Chave: <code>{correspondence!.key}</code> (não muda após criada)
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="data_type">Tipo</Label>
        <Combobox
          id="data_type"
          name="data_type"
          options={DATA_TYPE_OPTIONS}
          value={dataType}
          onValueChange={(t) => setDataType(t as DataType)}
          searchable={false}
          aria-label="Tipo"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Colunas por fonte</Label>
        <p className="text-muted-foreground text-xs">
          Escolha a coluna equivalente em cada fonte. Deixe em branco onde não se
          aplica (mínimo de duas fontes).
        </p>
        {catalog.map((s) => (
          <div key={s.key} className="flex flex-col gap-1">
            <span className="text-sm font-medium">{s.label}</span>
            <Combobox
              name={`member_${s.key}`}
              options={[
                { value: "", label: "— nenhuma —" },
                ...(candidatesBySource[s.key] ?? []).map((c) => ({
                  value: c.ref,
                  label: c.label,
                })),
              ]}
              value={refs[s.key] ?? ""}
              onValueChange={(ref) =>
                setRefs((prev) => ({ ...prev, [s.key]: ref }))
              }
              placeholder="— nenhuma —"
              aria-label={s.label}
            />
          </div>
        ))}
      </div>

      {state.message ? (
        <p
          className={
            state.ok ? "text-muted-foreground text-sm" : "text-destructive text-sm"
          }
          role="status"
        >
          {state.message}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Salvando..." : isEdit ? "Salvar alterações" : "Criar correspondência"}
      </Button>
    </form>
  );
}

export function CorrespondencesManager({
  correspondences,
  candidatesBySource,
}: {
  correspondences: Correspondence[];
  candidatesBySource: Record<SourceKey, RefOption[]>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Correspondence | undefined>(undefined);
  const catalog = useSources();

  // ref -> rótulo, por fonte (para exibir os membros de forma legível). Guarda
  // contra source-key sem candidatos (ex.: sub-fonte recém-criada).
  const labelForRef = (source: SourceKey, ref: string): string =>
    candidatesBySource[source]?.find((c) => c.ref === ref)?.label ?? ref;

  function openCreate() {
    setEditing(undefined);
    setOpen(true);
  }
  function openEdit(c: Correspondence) {
    setEditing(c);
    setOpen(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Correspondências de colunas</h2>
          <p className="text-muted-foreground text-sm">
            Ligue colunas equivalentes entre Leads, Deals e Estudo de Fechamentos.
            Elas ficam disponíveis no construtor de widgets como um campo único
            (↔) e são compartilhadas por todos os dashboards.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          Nova correspondência
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rótulo</TableHead>
              <TableHead>Chave</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Colunas ligadas</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {correspondences.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center">
                  Nenhuma correspondência ainda. Crie a primeira.
                </TableCell>
              </TableRow>
            ) : (
              correspondences.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.label}</TableCell>
                  <TableCell>
                    <code className="text-xs">{c.key}</code>
                  </TableCell>
                  <TableCell>{DATA_TYPE_LABELS[c.data_type]}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {c.members.map((m) => {
                      const src = m.source_key ?? m.record_type;
                      return (
                        <div key={src}>
                          {sourceLabel(src, catalog)}:{" "}
                          {labelForRef(src, m.field_ref)}
                        </div>
                      );
                    })}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(c)}
                        aria-label="Editar"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <ConfirmDeleteButton
                        action={deleteCorrespondence}
                        values={{ id: c.id }}
                        title={`Excluir a correspondência "${c.label}"?`}
                        description="Correspondências são globais: o campo unificado desaparece de TODOS os widgets e dashboards que o usam (as colunas de cada fonte continuam existindo). Esta ação não pode ser desfeita."
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {editing ? "Editar correspondência" : "Nova correspondência"}
            </SheetTitle>
            <SheetDescription>
              Um campo unificado soma/agrupa as colunas ligadas como se fossem a
              mesma nos cálculos de gráficos e tabelas.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <CorrespondenceForm
              key={editing?.id ?? "new"}
              correspondence={editing}
              candidatesBySource={candidatesBySource}
              onDone={() => setOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

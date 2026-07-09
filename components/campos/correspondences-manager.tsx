// Versão: 1.0 | Data: 09/07/2026
// Fase 8: gestão das correspondências de colunas (campos unificados) na aba
// Campos. Tabela + Sheet para criar/editar. Cada correspondência liga uma coluna
// por fonte (Leads/Deals/Estudo); o construtor de widgets usa como `unified:<key>`.
"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import {
  RECORD_TYPE_SOURCE,
  SOURCE_KEYS,
  SOURCE_LABELS,
  type SourceKey,
} from "@/lib/sources";
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

const selectClass =
  "border-input flex h-9 w-full rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";

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
  const [dataType, setDataType] = useState<DataType>(
    correspondence?.data_type ?? "numero"
  );

  const defaultRef: Record<SourceKey, string> = {
    leads: "",
    deals: "",
    estudo: "",
  };
  for (const m of correspondence?.members ?? []) {
    const src = RECORD_TYPE_SOURCE[m.record_type];
    if (src) defaultRef[src] = m.field_ref;
  }

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
        <select
          id="data_type"
          name="data_type"
          value={dataType}
          onChange={(e) => setDataType(e.target.value as DataType)}
          className={selectClass + " px-3"}
        >
          {(Object.keys(DATA_TYPE_LABELS) as DataType[]).map((t) => (
            <option key={t} value={t}>
              {DATA_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Colunas por fonte</Label>
        <p className="text-muted-foreground text-xs">
          Escolha a coluna equivalente em cada fonte. Deixe em branco onde não se
          aplica (mínimo de duas fontes).
        </p>
        {SOURCE_KEYS.map((key) => (
          <div key={key} className="flex flex-col gap-1">
            <span className="text-sm font-medium">{SOURCE_LABELS[key]}</span>
            <select
              name={`member_${key}`}
              defaultValue={defaultRef[key]}
              className={selectClass}
            >
              <option value="">— nenhuma —</option>
              {candidatesBySource[key].map((c) => (
                <option key={c.ref} value={c.ref}>
                  {c.label}
                </option>
              ))}
            </select>
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

  // ref -> rótulo, por fonte (para exibir os membros de forma legível).
  const labelForRef = (source: SourceKey, ref: string): string =>
    candidatesBySource[source].find((c) => c.ref === ref)?.label ?? ref;

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
                      const src = RECORD_TYPE_SOURCE[m.record_type];
                      return (
                        <div key={m.record_type}>
                          {src ? SOURCE_LABELS[src] : m.record_type}:{" "}
                          {src ? labelForRef(src, m.field_ref) : m.field_ref}
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
                      <form action={deleteCorrespondence}>
                        <input type="hidden" name="id" value={c.id} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="icon"
                          aria-label="Excluir"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </form>
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

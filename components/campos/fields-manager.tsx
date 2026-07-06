// Versão: 1.0 | Data: 05/07/2026
// Gerenciador de campos personalizados: tabela + Sheet para criar/editar.
"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { ROLE_LABELS, type RoleKey } from "@/lib/auth/roles";
import { DATA_TYPE_LABELS, type FieldDefinition } from "@/lib/records/types";
import { deleteField } from "@/app/(app)/campos/actions";
import { FieldForm } from "./field-form";

function roleLabels(keys: string[]): string {
  if (keys.length === 0) return "—";
  return keys.map((k) => ROLE_LABELS[k as RoleKey] ?? k).join(", ");
}

export function FieldsManager({ fields }: { fields: FieldDefinition[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FieldDefinition | undefined>(undefined);

  function openCreate() {
    setEditing(undefined);
    setOpen(true);
  }
  function openEdit(f: FieldDefinition) {
    setEditing(f);
    setOpen(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          Novo campo
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rótulo</TableHead>
              <TableHead>Chave</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Visível</TableHead>
              <TableHead>Editável</TableHead>
              <TableHead>Local</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground text-center">
                  Nenhum campo personalizado ainda. Crie o primeiro.
                </TableCell>
              </TableRow>
            ) : (
              fields.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.label}</TableCell>
                  <TableCell>
                    <code className="text-xs">{f.field_key}</code>
                  </TableCell>
                  <TableCell>{DATA_TYPE_LABELS[f.data_type]}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {roleLabels(f.visible_to_roles)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {roleLabels(f.editable_by_roles)}
                  </TableCell>
                  <TableCell>
                    {f.is_local ? <Badge variant="secondary">local</Badge> : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(f)}
                        aria-label="Editar"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <form action={deleteField}>
                        <input type="hidden" name="id" value={f.id} />
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
            <SheetTitle>{editing ? "Editar campo" : "Novo campo"}</SheetTitle>
            <SheetDescription>
              Campos personalizados aparecem na edição de registros conforme a
              visibilidade/editabilidade por papel.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <FieldForm
              key={editing?.id ?? "new"}
              field={editing}
              onDone={() => setOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

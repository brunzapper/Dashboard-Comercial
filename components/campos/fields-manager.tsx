// Versão: 1.1 | Data: 09/07/2026
// Gerenciador de campos personalizados: tabela + Sheet para criar/editar.
// v1.1 (09/07/2026): Fase 7 — coluna de origem (Bitrix/App), toggle "Exibir"
//   (show_in_builder) e passa as colunas numéricas ao formulário (fórmulas).
"use client";

import { useState } from "react";
import { Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";

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
import {
  DATA_TYPE_LABELS,
  NUMERIC_DATA_TYPES,
  type FieldDefinition,
} from "@/lib/records/types";
import { CORE_FIELDS } from "@/lib/widgets/fields";
import { deleteField, toggleShowInBuilder } from "@/app/(app)/campos/actions";
import { FieldForm } from "./field-form";
import type { RefOption } from "./formula-builder";

function roleLabels(keys: string[]): string {
  if (keys.length === 0) return "—";
  return keys.map((k) => ROLE_LABELS[k as RoleKey] ?? k).join(", ");
}

function SourceBadge({ field }: { field: FieldDefinition }) {
  if (field.source_system === "bitrix") return <Badge variant="outline">Bitrix</Badge>;
  if (field.is_local) return <Badge variant="secondary">Local</Badge>;
  return <Badge variant="secondary">App</Badge>;
}

export function FieldsManager({ fields }: { fields: FieldDefinition[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FieldDefinition | undefined>(undefined);

  // Operandos numéricos para o construtor de fórmula: colunas do núcleo
  // numéricas + campos personalizados numéricos que não sejam calculados.
  const numericRefs: RefOption[] = [
    ...CORE_FIELDS.filter((f) => f.isNumeric).map((f) => ({
      ref: f.field,
      label: f.label,
    })),
    ...fields
      .filter(
        (f) => NUMERIC_DATA_TYPES.includes(f.data_type) && f.data_type !== "calculado"
      )
      .map((f) => ({ ref: `custom:${f.field_key}`, label: f.label })),
  ];

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
              <TableHead>Origem</TableHead>
              <TableHead>Exibir</TableHead>
              <TableHead>Visível</TableHead>
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
              fields.map((f) => {
                const shown = f.show_in_builder ?? true;
                return (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.label}</TableCell>
                    <TableCell>
                      <code className="text-xs">{f.field_key}</code>
                    </TableCell>
                    <TableCell>{DATA_TYPE_LABELS[f.data_type]}</TableCell>
                    <TableCell>
                      <SourceBadge field={f} />
                    </TableCell>
                    <TableCell>
                      <form action={toggleShowInBuilder}>
                        <input type="hidden" name="id" value={f.id} />
                        <input type="hidden" name="show_in_builder" value={String(!shown)} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="icon"
                          aria-label={shown ? "Ocultar dos seletores" : "Exibir nos seletores"}
                          title={shown ? "Exibido — clique para ocultar" : "Oculto — clique para exibir"}
                        >
                          {shown ? (
                            <Eye className="size-4" />
                          ) : (
                            <EyeOff className="text-muted-foreground size-4" />
                          )}
                        </Button>
                      </form>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {roleLabels(f.visible_to_roles)}
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
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? "Editar campo" : "Novo campo"}</SheetTitle>
            <SheetDescription>
              Campos aparecem na edição de registros e nos seletores conforme a
              visibilidade por papel e o toggle &quot;Exibir&quot;.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <FieldForm
              key={editing?.id ?? "new"}
              field={editing}
              numericRefs={numericRefs}
              onDone={() => setOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

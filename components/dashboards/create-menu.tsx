// Versão: 1.0 | Data: 16/07/2026
// Botão "Criar" da home: menu com duas opções — Dashboard (form clássico) e
// Kanban (nome, visibilidade, fonte e agrupamento por campo OU bucket de data).
// Cada opção abre um Sheet; o kanban criado navega direto p/ /kanbans/[id].
"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ROLE_LABELS, type RoleKey } from "@/lib/auth/roles";
import { fieldAppliesToSource, type SourceDef } from "@/lib/sources";
import type { FieldDefinition } from "@/lib/records/types";
import {
  createBoard,
  type CreateBoardState,
} from "@/app/(app)/dashboards/actions";
import { NewDashboardForm } from "./new-dashboard-form";

const ROLE_KEYS = Object.keys(ROLE_LABELS) as RoleKey[];
const initialBoard: CreateBoardState = {};

// Colunas do núcleo que fazem sentido como agrupamento (valores discretos).
const CORE_GROUP_OPTIONS: ComboboxOption[] = [
  { value: "stage", label: "Etapa" },
  { value: "pipeline", label: "Pipeline" },
  { value: "sale_type", label: "Tipo de venda" },
  { value: "channel", label: "Canal" },
];

const CORE_DATE_OPTIONS: ComboboxOption[] = [
  { value: "closed_at", label: "Data de fechamento" },
  { value: "opened_at", label: "Data de abertura" },
  { value: "source_created_at", label: "Data de criação (origem)" },
];

const BUCKET_OPTIONS: ComboboxOption[] = [
  { value: "weekday", label: "Dia da semana" },
  { value: "month_name", label: "Mês do ano" },
  { value: "month_year", label: "Mês/Ano" },
];

const GROUP_KIND_OPTIONS: ComboboxOption[] = [
  { value: "field", label: "Valores de um campo (ex.: etapa)" },
  { value: "date", label: "Períodos de um campo de data" },
  { value: "custom", label: "Personalizar (colunas livres)" },
];

const MODE_OPTIONS: ComboboxOption[] = [
  { value: "registros", label: "Registros de uma base" },
  { value: "tarefas", label: "Tarefas (fases de execução)" },
];

function NewBoardForm({
  sources,
  fields,
}: {
  sources: SourceDef[];
  fields: FieldDefinition[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createBoard, initialBoard);
  const [mode, setMode] = useState("registros");
  const [source, setSource] = useState(sources[0]?.key ?? "");
  const [groupKind, setGroupKind] = useState("field");
  const [groupField, setGroupField] = useState("stage");
  const [dateField, setDateField] = useState("source_created_at");
  const [dateBucket, setDateBucket] = useState("weekday");

  useEffect(() => {
    if (state.ok && state.id) router.push(`/kanbans/${state.id}`);
  }, [state.ok, state.id, router]);

  const groupOptions = useMemo<ComboboxOption[]>(
    () => [
      ...CORE_GROUP_OPTIONS,
      ...fields
        .filter(
          (f) =>
            (f.data_type === "selecao" || f.data_type === "texto") &&
            fieldAppliesToSource(f.applies_to, source)
        )
        .map((f) => ({ value: `custom:${f.field_key}`, label: f.label })),
    ],
    [fields, source]
  );
  const dateOptions = useMemo<ComboboxOption[]>(
    () => [
      ...CORE_DATE_OPTIONS,
      ...fields
        .filter(
          (f) =>
            f.data_type === "data" && fieldAppliesToSource(f.applies_to, source)
        )
        .map((f) => ({ value: `custom:${f.field_key}`, label: f.label })),
    ],
    [fields, source]
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="source" value={source} />
      <input type="hidden" name="group_kind" value={groupKind} />
      <input type="hidden" name="group_field" value={groupField} />
      <input type="hidden" name="date_field" value={dateField} />
      <input type="hidden" name="date_bucket" value={dateBucket} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="board-name">Nome</Label>
        <Input
          id="board-name"
          name="name"
          placeholder="Ex.: Funil de propostas"
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Visível para (além de você)</Label>
        <div className="flex flex-wrap gap-3">
          {ROLE_KEYS.map((role) => (
            <label key={role} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="visible_to_roles"
                value={role}
                className="size-4 accent-primary"
              />
              {ROLE_LABELS[role]}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Tipo de quadro</Label>
        <Combobox
          options={MODE_OPTIONS}
          value={mode}
          onValueChange={setMode}
          searchable={false}
          className="w-full"
          aria-label="Tipo de quadro"
        />
        {mode === "tarefas" ? (
          <p className="text-muted-foreground text-xs">
            Quadro de tarefas com fases (A fazer / Em andamento / Concluída —
            editáveis depois). Soltar na fase final conclui a tarefa.
          </p>
        ) : null}
      </div>

      {mode === "registros" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>Base dos registros</Label>
            <Combobox
              options={sources.map((s) => ({ value: s.key, label: s.label }))}
              value={source}
              onValueChange={setSource}
              className="w-full"
              aria-label="Base dos registros"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Colunas do quadro</Label>
            <Combobox
              options={GROUP_KIND_OPTIONS}
              value={groupKind}
              onValueChange={setGroupKind}
              searchable={false}
              className="w-full"
              aria-label="Tipo de agrupamento"
            />
            <p className="text-muted-foreground text-xs">
              {groupKind === "custom"
                ? "Colunas livres: mover um card NÃO altera o registro — a posição vale só para este quadro."
                : "Mover um card entre colunas altera o valor (ou a data) do campo no registro."}
            </p>
          </div>
        </>
      ) : null}

      {mode === "registros" && groupKind === "date" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>Campo de data</Label>
            <Combobox
              options={dateOptions}
              value={dateField}
              onValueChange={setDateField}
              className="w-full"
              aria-label="Campo de data"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Período de cada coluna</Label>
            <Combobox
              options={BUCKET_OPTIONS}
              value={dateBucket}
              onValueChange={setDateBucket}
              searchable={false}
              className="w-full"
              aria-label="Período de cada coluna"
            />
          </div>
        </>
      ) : mode === "registros" ? (
        <div className="flex flex-col gap-1.5">
          <Label>Campo que define as colunas</Label>
          <Combobox
            options={groupOptions}
            value={groupField}
            onValueChange={setGroupField}
            className="w-full"
            aria-label="Campo que define as colunas"
          />
        </div>
      ) : null}

      {state.message && !state.ok ? (
        <p className="text-destructive text-sm" role="status">
          {state.message}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Criando..." : "Criar kanban"}
      </Button>
    </form>
  );
}

export function CreateMenu({
  sources,
  fields,
}: {
  sources: SourceDef[];
  fields: FieldDefinition[];
}) {
  const [open, setOpen] = useState<null | "dashboard" | "kanban">(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>
            <Plus className="size-4" />
            Criar
            <ChevronDown className="size-4 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => setOpen("dashboard")}>
            Dashboard
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpen("kanban")}>
            Kanban
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Sheet
        open={open === "dashboard"}
        onOpenChange={(v) => setOpen(v ? "dashboard" : null)}
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Novo dashboard</SheetTitle>
            <SheetDescription>
              Monte widgets a partir dos seus registros.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <NewDashboardForm />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={open === "kanban"}
        onOpenChange={(v) => setOpen(v ? "kanban" : null)}
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Novo kanban</SheetTitle>
            <SheetDescription>
              Quadro de cards para gerir projetos e funis: as colunas
              representam valores de um campo dos registros.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <NewBoardForm sources={sources} fields={fields} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

// Versão: 1.2 | Data: 19/07/2026
// Gestão do catálogo de fontes (data_sources, 0060): listar, criar, editar e
// excluir fontes dinâmicas. Fontes novas mapeiam key === record_type; a chave
// é gerada do nome (slugify) e imutável após a criação. Excluir exige fonte
// sem registros (FK em records.record_type restringe).
// v1.1 (16/07/2026): flag "Permite criação manual" (manual_entry, 0061) —
//   habilita o botão "Novo registro" (Registros/kanbans) para a fonte.
// v1.2 (19/07/2026): fuso horário da origem (timezone, 0079) — datetimes
//   ingeridos da fonte são convertidos desse fuso p/ Brasília na entrada.
"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SourceDef } from "@/lib/sources";
import {
  createSource,
  deleteSource,
  updateSource,
  type SourceActionState,
} from "@/app/(app)/configuracoes/fontes/actions";

const initial: SourceActionState = {};

const PERIOD_FIELD_OPTIONS: ComboboxOption[] = [
  { value: "source_created_at", label: "Data de criação (origem)" },
  { value: "closed_at", label: "Data de fechamento" },
  { value: "opened_at", label: "Data de abertura" },
  { value: "source_modified_at", label: "Data de modificação (origem)" },
  { value: "created_at", label: "Criado no app" },
  { value: "updated_at", label: "Atualizado no app" },
];

function periodFieldLabel(value: string): string {
  return PERIOD_FIELD_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

// Fusos IANA do runtime (guard: supportedValuesOf existe em todo alvo moderno;
// sem ele a lista fica só com "sem conversão").
const TZ_OPTIONS: ComboboxOption[] = [
  { value: "", label: "— (sem conversão)" },
  ...(typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone").map((z) => ({ value: z, label: z }))
    : []),
];

function SourceForm({
  source,
  onDone,
}: {
  source?: SourceDef;
  onDone?: () => void;
}) {
  const isEdit = Boolean(source);
  const action = isEdit ? updateSource : createSource;
  const [state, formAction, pending] = useActionState(action, initial);
  const [periodField, setPeriodField] = useState(
    source?.defaultPeriodField ?? "source_created_at"
  );
  // Fontes novas nascem aceitando criação manual; builtins (Sync) desligados.
  const [manualEntry, setManualEntry] = useState(source?.manualEntry ?? true);
  const [timezone, setTimezone] = useState(source?.timezone ?? "");
  // Valor salvo fora da lista do runtime (raro) segue selecionável.
  const tzOptions = useMemo(
    () =>
      timezone && !TZ_OPTIONS.some((o) => o.value === timezone)
        ? [...TZ_OPTIONS, { value: timezone, label: timezone }]
        : TZ_OPTIONS,
    [timezone]
  );

  useEffect(() => {
    if (state.ok && onDone) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {isEdit ? <input type="hidden" name="key" value={source!.key} /> : null}
      <input type="hidden" name="default_period_field" value={periodField} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="source-label">Nome da fonte</Label>
        <Input
          id="source-label"
          name="label"
          defaultValue={source?.label ?? ""}
          placeholder="Ex.: Propostas"
          maxLength={60}
          required
        />
        {!isEdit ? (
          <p className="text-muted-foreground text-xs">
            A chave da fonte é gerada do nome (minúsculas, sem acentos) e não
            muda depois.
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            Chave: <code>{source!.key}</code>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="source-short-label">Nome curto (chips/prefixos)</Label>
        <Input
          id="source-short-label"
          name="short_label"
          defaultValue={source?.shortLabel ?? ""}
          placeholder="Ex.: Propostas"
          maxLength={40}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Campo de data do filtro de período</Label>
        <Combobox
          options={PERIOD_FIELD_OPTIONS}
          value={periodField}
          onValueChange={setPeriodField}
          searchable={false}
          aria-label="Campo de data do filtro de período"
        />
        <p className="text-muted-foreground text-xs">
          Onde a barra de período do dashboard busca a data desta fonte quando
          não há override configurado.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Fuso horário da origem</Label>
        <Combobox
          options={tzOptions}
          value={timezone}
          onValueChange={setTimezone}
          name="timezone"
          searchPlaceholder="Buscar fuso..."
          aria-label="Fuso horário da origem"
        />
        <p className="text-muted-foreground text-xs">
          Datas/horas desta fonte são convertidas deste fuso para o horário de
          Brasília na entrada (ex.: Bitrix em Europe/Moscow). Vazio = sem
          conversão.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="manual_entry"
            value="1"
            checked={manualEntry}
            onChange={(e) => setManualEntry(e.target.checked)}
            className="size-4 accent-primary"
          />
          Permite criação manual de registros
        </label>
        <p className="text-muted-foreground text-xs">
          Habilita o botão &quot;Novo registro&quot; para esta fonte (Registros e
          kanbans). Fontes alimentadas por Sync normalmente ficam desligadas.
        </p>
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
        {pending ? "Salvando..." : isEdit ? "Salvar alterações" : "Criar fonte"}
      </Button>
    </form>
  );
}

function DeleteSourceButton({ sourceKey }: { sourceKey: string }) {
  const [state, formAction, pending] = useActionState(deleteSource, initial);
  return (
    <form action={formAction} className="flex items-center gap-1">
      <input type="hidden" name="key" value={sourceKey} />
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        disabled={pending}
        aria-label="Excluir fonte"
      >
        <Trash2 className="size-4" />
      </Button>
      {state.message && !state.ok ? (
        <span className="text-destructive text-xs" role="status">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

export function SourcesManager({ sources }: { sources: SourceDef[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SourceDef | undefined>(undefined);

  function openCreate() {
    setEditing(undefined);
    setOpen(true);
  }
  function openEdit(s: SourceDef) {
    setEditing(s);
    setOpen(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Catálogo de fontes</h2>
          <p className="text-muted-foreground text-sm">
            Cada fonte agrupa registros próprios e aparece nas abas de
            Registros, no construtor de widgets e no import de CSV. Fontes
            internas (Bitrix/planilha) não podem ser excluídas.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          Nova fonte
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Chave</TableHead>
              <TableHead>Nome curto</TableHead>
              <TableHead>Campo de período</TableHead>
              <TableHead>Fuso</TableHead>
              <TableHead>Criação manual</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((s) => (
              <TableRow key={s.key}>
                <TableCell className="font-medium">{s.label}</TableCell>
                <TableCell>
                  <code className="text-xs">{s.key}</code>
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {s.shortLabel}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {periodFieldLabel(s.defaultPeriodField)}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {s.timezone || "—"}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {s.manualEntry ? "Sim" : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {s.builtin ? "Interna" : "Personalizada"}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(s)}
                      aria-label="Editar fonte"
                    >
                      <Pencil className="size-4" />
                    </Button>
                    {!s.builtin ? (
                      <DeleteSourceButton sourceKey={s.key} />
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? "Editar fonte" : "Nova fonte"}</SheetTitle>
            <SheetDescription>
              {editing
                ? "Nome, nome curto e campo de período. A chave não muda."
                : "A fonte nasce vazia — importe um CSV ou conecte uma integração para populá-la."}
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <SourceForm
              key={editing?.key ?? "new"}
              source={editing}
              onDone={() => setOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

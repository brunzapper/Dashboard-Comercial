// Versão: 1.4 | Data: 28/07/2026
// Gestão do catálogo de fontes (data_sources, 0060): listar, criar, editar e
// excluir fontes dinâmicas. Fontes novas mapeiam key === record_type; a chave
// é gerada do nome (slugify) e imutável após a criação. Excluir exige fonte
// sem registros (FK em records.record_type restringe).
// v1.1 (16/07/2026): flag "Permite criação manual" (manual_entry, 0061) —
//   habilita o botão "Novo registro" (Registros/kanbans) para a fonte.
// v1.2 (19/07/2026): fuso horário da origem (timezone, 0079) — datetimes
//   ingeridos da fonte são convertidos desse fuso p/ Brasília na entrada.
// v1.3 (26/07/2026): PASTAS (0107) — campo "Pasta" no formulário, tabela
//   agrupada por pasta (groupSourcesByFolder; só bases RAIZ — subs vivem na
//   seção Sub-bases) e botões ↑/↓ de ordem manual dentro da pasta.
// v1.4 (28/07/2026): campo de período por base (0110) — o picker deixa a lista
//   fixa de colunas core e recebe por prop a lista "só colunas com dados" da
//   base (montada no servidor: core + campos custom de DATA com ≥1 linha
//   preenchida não-mock; valor salvo sempre presente). Criação segue nas core
//   (base nova não tem linhas). Opções/rótulos canônicos em
//   lib/source-date-fields.ts.
"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";

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
  CORE_PERIOD_FIELD_OPTIONS,
  ensurePeriodOption,
  periodFieldLabel,
} from "@/lib/source-date-fields";
import {
  groupSourcesByFolder,
  IMPLICIT_FOLDER_LABEL,
  type SourceFolder,
  type SourceFolderGroup,
} from "@/lib/source-folders";
import {
  createSource,
  deleteSource,
  reorderSource,
  updateSource,
  type SourceActionState,
} from "@/app/(app)/registros/bases/actions";

const initial: SourceActionState = {};

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
  folders,
  periodOptions,
  onDone,
}: {
  source?: SourceDef;
  folders: SourceFolder[];
  // Lista "só colunas com dados" da base (servidor). Ausente (criação — base
  // nova não tem linhas) = colunas core.
  periodOptions?: ComboboxOption[];
  onDone?: () => void;
}) {
  const isEdit = Boolean(source);
  const action = isEdit ? updateSource : createSource;
  const [state, formAction, pending] = useActionState(action, initial);
  const [periodField, setPeriodField] = useState(
    source?.defaultPeriodField ?? "source_created_at"
  );
  // Valor selecionado fora da lista filtrada segue selecionável (padrão do
  // tzOptions abaixo).
  const periodFieldOptions = useMemo(
    () =>
      ensurePeriodOption(periodOptions ?? CORE_PERIOD_FIELD_OPTIONS, periodField),
    [periodOptions, periodField]
  );
  // Fontes novas nascem aceitando criação manual; builtins (Sync) desligados.
  const [manualEntry, setManualEntry] = useState(source?.manualEntry ?? true);
  const [timezone, setTimezone] = useState(source?.timezone ?? "");
  // Pasta (0107): "" = sem pasta. O campo só aparece quando há pasta criada.
  const [folderId, setFolderId] = useState(source?.folderId ?? "");
  const folderOptions = useMemo<ComboboxOption[]>(
    () => [
      { value: "", label: "— (sem pasta)" },
      ...folders.map((f) => ({ value: f.id, label: f.label })),
    ],
    [folders]
  );
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
      <input type="hidden" name="folder_id" value={folderId} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="source-label">Nome da base</Label>
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

      {folders.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Label>Pasta</Label>
          <Combobox
            options={folderOptions}
            value={folderId}
            onValueChange={setFolderId}
            searchable={false}
            aria-label="Pasta"
          />
          <p className="text-muted-foreground text-xs">
            Agrupa a base nas abas de Registros/Campos e nos seletores. Só
            organização visual — não muda consultas nem permissões.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label>Campo de data do filtro de período</Label>
        <Combobox
          options={periodFieldOptions}
          value={periodField}
          onValueChange={setPeriodField}
          searchable={false}
          aria-label="Campo de data do filtro de período"
        />
        <p className="text-muted-foreground text-xs">
          Onde a barra de período do dashboard busca a data desta base quando
          não há override configurado. Só aparecem campos de data com ao menos
          um registro preenchido nesta base (mocks não contam); base sem
          registros mostra as colunas padrão.
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
          kanbans). Bases alimentadas por Sync normalmente ficam desligadas.
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
        {pending ? "Salvando..." : isEdit ? "Salvar alterações" : "Criar base"}
      </Button>
    </form>
  );
}

// ↑/↓ dentro da pasta (0107): cada clique re-sequencia o grupo no servidor
// (reorderSource). Bordas viram no-op na action (resequenceAfterMove).
function MoveSourceButtons({ sourceKey }: { sourceKey: string }) {
  const [, formAction, pending] = useActionState(reorderSource, initial);
  return (
    <form action={formAction} className="flex items-center">
      <input type="hidden" name="key" value={sourceKey} />
      <Button
        type="submit"
        name="dir"
        value="up"
        variant="ghost"
        size="icon"
        disabled={pending}
        aria-label="Mover base para cima"
      >
        <ArrowUp className="size-4" />
      </Button>
      <Button
        type="submit"
        name="dir"
        value="down"
        variant="ghost"
        size="icon"
        disabled={pending}
        aria-label="Mover base para baixo"
      >
        <ArrowDown className="size-4" />
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
        aria-label="Excluir base"
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

export function SourcesManager({
  sources,
  folders,
  periodOptionsBySource,
}: {
  sources: SourceDef[];
  folders: SourceFolder[];
  // Por base RAIZ: lista "só colunas com dados" do campo de período (0110),
  // com o valor salvo da base já injetado no servidor.
  periodOptionsBySource?: Record<string, ComboboxOption[]>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SourceDef | undefined>(undefined);

  // Só bases RAIZ, agrupadas por pasta (subs vivem na seção Sub-bases).
  const groups = useMemo(
    () => groupSourcesByFolder(folders, sources),
    [folders, sources]
  );
  const showFolders = groups.some((g) => g.folder != null);

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
          <h2 className="text-lg font-semibold">Catálogo de bases</h2>
          <p className="text-muted-foreground text-sm">
            Cada base agrupa registros próprios e aparece nas abas de
            Registros, no construtor de widgets e no import de CSV. Bases
            internas (Bitrix/planilha) não podem ser excluídas.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          Nova base
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
            {groups.map((g) => (
              <FragmentGroup
                key={g.folder?.id ?? "__sem_pasta__"}
                group={g}
                showFolders={showFolders}
                onEdit={openEdit}
                periodOptionsBySource={periodOptionsBySource}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? "Editar base" : "Nova base"}</SheetTitle>
            <SheetDescription>
              {editing
                ? "Nome, nome curto, pasta e campo de período. A chave não muda."
                : "A base nasce vazia — importe um CSV ou conecte uma integração para populá-la."}
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <SourceForm
              key={editing?.key ?? "new"}
              source={editing}
              folders={folders}
              periodOptions={
                editing ? periodOptionsBySource?.[editing.key] : undefined
              }
              onDone={() => setOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// Bloco de uma pasta na tabela: linha-cabeçalho (só quando há pastas) +
// linhas das bases do grupo com ↑/↓ (ordem dentro da pasta).
function FragmentGroup({
  group,
  showFolders,
  onEdit,
  periodOptionsBySource,
}: {
  group: SourceFolderGroup<SourceDef>;
  showFolders: boolean;
  onEdit: (s: SourceDef) => void;
  periodOptionsBySource?: Record<string, ComboboxOption[]>;
}) {
  return (
    <>
      {showFolders ? (
        <TableRow className="bg-muted/50 hover:bg-muted/50">
          <TableCell
            colSpan={8}
            className="text-muted-foreground text-xs font-medium uppercase"
          >
            {group.folder?.label ?? IMPLICIT_FOLDER_LABEL}
          </TableCell>
        </TableRow>
      ) : null}
      {group.roots.map((s) => (
        <TableRow key={s.key}>
          <TableCell className="font-medium">{s.label}</TableCell>
          <TableCell>
            <code className="text-xs">{s.key}</code>
          </TableCell>
          <TableCell className="text-muted-foreground text-xs">
            {s.shortLabel}
          </TableCell>
          <TableCell className="text-muted-foreground text-xs">
            {periodFieldLabel(
              s.defaultPeriodField,
              periodOptionsBySource?.[s.key]
            )}
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
            <div className="flex items-center justify-end gap-1">
              <MoveSourceButtons sourceKey={s.key} />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onEdit(s)}
                aria-label="Editar base"
              >
                <Pencil className="size-4" />
              </Button>
              {!s.builtin ? <DeleteSourceButton sourceKey={s.key} /> : null}
            </div>
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

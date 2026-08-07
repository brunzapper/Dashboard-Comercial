// Versão: 1.4 | Data: 06/08/2026
// SUB-FONTES (0078): CRUD das sub-fontes (fonte derivada de uma pai, recortada
// por um filtro). Tabela + Sheet com formulário: pai (imutável na edição), nome,
// nome curto, campo de período e um editor de CONDIÇÕES (field/op/value) que
// serializa o predicado como JSON (WidgetFilter[]) num input escondido. Os
// campos do filtro dependem da PAI escolhida (fieldOptionsByParent, montado no
// servidor a partir de applies_to). Escrita = manage_field_definitions (admin).
// v1.1 (26/07/2026): ↑/↓ de ordem manual dentro da pai (sort_order, 0107).
// v1.2 (28/07/2026): o picker de campo de período usa a lista "só colunas com
//   dados" da PAI (periodOptionsByParent, montada no servidor com probe
//   não-mock — 0110); o valor salvo da SUB é injetado aqui (o mapa é por pai)
//   com rótulo de dateFieldOptionsByParent. Opções/rótulos canônicos em
//   lib/source-date-fields.ts.
// v1.3 (31/07/2026): valor de filtro AMIGÁVEL — responsável/operação/etapa e
//   campos seleção ganham picker de rótulos (FilterValuePicker). O predicado
//   da sub compara a coluna CRUA (fora do pipeline do engine), então relações
//   GRAVAM O ID (storeAs "value") e o picker só exibe o rótulo; `in` guarda
//   array (valor com vírgula sobrevive).
// v1.4 (06/08/2026): checkbox "Ignorar filtro de período" (0116) + badge na
//   tabela — a sub isenta entra nos widgets sem recorte de período (engine).
// v1.5 (07/08/2026): as actions não revalidam mais ("/", "layout") — refresh
//   pós-sucesso via useRefreshOnActionOk (form libera quando a action retorna).
"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ResizableSheetContent } from "@/components/ui/resizable-sheet-content";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CORE_PERIOD_FIELD_OPTIONS,
  ensurePeriodOption,
} from "@/lib/source-date-fields";
import { useRefreshOnActionOk } from "@/lib/use-debounced-refresh";
import { sourceLabel, type SourceDef, type SourceKey } from "@/lib/sources";
import type { WidgetFilter } from "@/lib/widgets/types";
import {
  FilterValuePicker,
  type FilterValueSource,
} from "@/components/filters/filter-value-picker";
import { listFilterOptionCandidates } from "@/app/(app)/dashboards/actions";
import {
  createSubSource,
  deleteSubSource,
  reorderSubSource,
  updateSubSource,
  type SourceActionState,
} from "@/app/(app)/registros/bases/actions";

const initial: SourceActionState = {};

// Operadores do editor (espelham SUB_FILTER_OPS na action).
const OP_OPTIONS: ComboboxOption[] = [
  { value: "eq", label: "igual a" },
  { value: "neq", label: "diferente de" },
  { value: "in", label: "está em (lista, vírgulas)" },
  { value: "ilike", label: "contém" },
  { value: "gt", label: "maior que" },
  { value: "gte", label: "maior ou igual a" },
  { value: "lt", label: "menor que" },
  { value: "lte", label: "menor ou igual a" },
  { value: "is_null", label: "vazio" },
  { value: "not_null", label: "não vazio" },
];
const NO_VALUE_OPS = new Set(["is_null", "not_null"]);

interface Cond {
  field: string;
  op: string;
  // Array quando veio do picker de valor (`in`); string no texto livre.
  value: string | string[];
}

function toConds(filter: WidgetFilter[] | undefined): Cond[] {
  return (filter ?? []).map((f) => ({
    field: f.field,
    op: f.op,
    value:
      f.value == null
        ? ""
        : Array.isArray(f.value)
          ? f.value.map((v) => String(v))
          : String(f.value),
  }));
}

// Serializa condições → WidgetFilter[]. `in` em ARRAY (picker) passa intacto
// (nome/valor com vírgula sobrevive); string divide por vírgula (digitação
// manual). Ops sem valor não carregam value.
function toFilter(conds: Cond[]): WidgetFilter[] {
  return conds
    .filter((c) => c.field && c.op)
    .map((c) => {
      if (NO_VALUE_OPS.has(c.op)) {
        return { field: c.field, op: c.op as WidgetFilter["op"] };
      }
      const value =
        c.op === "in"
          ? Array.isArray(c.value)
            ? c.value.map((v) => String(v).trim()).filter(Boolean)
            : c.value.split(",").map((v) => v.trim()).filter(Boolean)
          : Array.isArray(c.value)
            ? (c.value[0] ?? "")
            : c.value;
      return { field: c.field, op: c.op as WidgetFilter["op"], value };
    });
}

// Cache de MÓDULO das listas do picker de valor (responsável/operação por id;
// etapa por base pai) — compartilhado entre os formulários da página.
const subValueOptionCache = new Map<
  string,
  Promise<{ value: string; label: string }[]>
>();

// Picker de VALOR (31/07/2026): o predicado da sub compara a COLUNA CRUA
// (fora do pipeline de filtros do engine) — relações GRAVAM O ID e o picker
// exibe o rótulo; etapa/seleção gravam o próprio rótulo (valor = rótulo).
function subFilterValueSource(
  field: string,
  parentKey: string,
  selectOptionsByField?: Record<string, string[]>
): FilterValueSource | null {
  if (field === "responsible_id" || field === "operation_id" || field === "stage") {
    const kind =
      field === "responsible_id"
        ? ("responsible" as const)
        : field === "operation_id"
          ? ("operation" as const)
          : ("stage" as const);
    const cacheKey = kind === "stage" ? `stage:${parentKey}` : kind;
    return {
      kind,
      storeAs: "value",
      load: () => {
        const cached = subValueOptionCache.get(cacheKey);
        if (cached) return cached;
        const p = listFilterOptionCandidates(
          kind,
          kind === "stage" ? [parentKey as SourceKey] : undefined
        );
        subValueOptionCache.set(cacheKey, p);
        return p;
      },
    };
  }
  const opts = selectOptionsByField?.[field];
  if (!opts || opts.length === 0) return null;
  return {
    kind: "static",
    storeAs: "value",
    load: () => Promise.resolve(opts.map((o) => ({ value: o, label: o }))),
  };
}

function SubSourceForm({
  sub,
  roots,
  fieldOptionsByParent,
  dateFieldOptionsByParent,
  periodOptionsByParent,
  selectOptionsByField,
  onDone,
}: {
  sub?: SourceDef;
  roots: SourceDef[];
  fieldOptionsByParent: Record<string, ComboboxOption[]>;
  // Campos personalizados de DATA da pai (0082): fonte de RÓTULOS do período.
  dateFieldOptionsByParent?: Record<string, ComboboxOption[]>;
  // Lista "só colunas com dados" da pai (0110, probe no servidor).
  periodOptionsByParent?: Record<string, ComboboxOption[]>;
  // Options dos campos seleção (picker de valor do filtro).
  selectOptionsByField?: Record<string, string[]>;
  onDone?: () => void;
}) {
  const isEdit = Boolean(sub);
  const action = isEdit ? updateSubSource : createSubSource;
  const [state, formAction, pending] = useActionState(action, initial);
  // A action não revalida — o refresh pós-sucesso reconcilia lista/sidebar.
  useRefreshOnActionOk(state);
  const [parentKey, setParentKey] = useState(
    sub?.parentKey ?? roots[0]?.key ?? ""
  );
  const [periodField, setPeriodField] = useState(
    sub?.defaultPeriodField ?? "source_created_at"
  );
  const [conds, setConds] = useState<Cond[]>(
    sub?.filter && sub.filter.length > 0
      ? toConds(sub.filter)
      : [{ field: "", op: "eq", value: "" }]
  );
  const [ignorePeriod, setIgnorePeriod] = useState(
    Boolean(sub?.ignorePeriod)
  );

  useEffect(() => {
    if (state.ok && onDone) onDone();
  }, [state.ok, onDone]);

  const fieldOptions = fieldOptionsByParent[parentKey] ?? [];
  const filterJson = useMemo(() => JSON.stringify(toFilter(conds)), [conds]);
  // O valor salvo DA SUB entra aqui (a lista probed é por PAI), com rótulo do
  // catálogo de datas da pai; campo excluído degrada para o valor cru.
  const periodOptions = useMemo(
    () =>
      ensurePeriodOption(
        periodOptionsByParent?.[parentKey] ?? CORE_PERIOD_FIELD_OPTIONS,
        periodField,
        dateFieldOptionsByParent?.[parentKey]
      ),
    [periodOptionsByParent, dateFieldOptionsByParent, parentKey, periodField]
  );

  const setCond = (i: number, patch: Partial<Cond>) =>
    setConds((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const addCond = () =>
    setConds((prev) => [...prev, { field: "", op: "eq", value: "" }]);
  const removeCond = (i: number) =>
    setConds((prev) => prev.filter((_, j) => j !== i));

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {isEdit ? <input type="hidden" name="key" value={sub!.key} /> : null}
      <input type="hidden" name="parent_key" value={parentKey} />
      <input type="hidden" name="default_period_field" value={periodField} />
      <input type="hidden" name="filter" value={filterJson} />
      <input
        type="hidden"
        name="ignore_period"
        value={ignorePeriod ? "1" : ""}
      />

      <div className="flex flex-col gap-1.5">
        <Label>Base pai</Label>
        <Combobox
          options={roots.map((r) => ({ value: r.key, label: r.label }))}
          value={parentKey}
          onValueChange={setParentKey}
          searchable={false}
          disabled={isEdit}
          aria-label="Base pai"
        />
        <p className="text-muted-foreground text-xs">
          As linhas da sub-base são as da pai que satisfazem o filtro abaixo. A
          pai não muda depois de criada.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sub-label">Nome da sub-base</Label>
        <Input
          id="sub-label"
          name="label"
          defaultValue={sub?.label ?? ""}
          placeholder="Ex.: Leads / Clientes Lite"
          maxLength={60}
          required
        />
        {isEdit ? (
          <p className="text-muted-foreground text-xs">
            Chave: <code>{sub!.key}</code>
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sub-short-label">Nome curto</Label>
        <Input
          id="sub-short-label"
          name="short_label"
          defaultValue={sub?.shortLabel ?? ""}
          placeholder="Ex.: Clientes Lite"
          maxLength={40}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Campo de data do filtro de período</Label>
        <Combobox
          options={periodOptions}
          value={periodField}
          onValueChange={setPeriodField}
          searchable={false}
          aria-label="Campo de data do filtro de período"
        />
        <p className="text-muted-foreground text-xs">
          Só aparecem campos de data com ao menos um registro preenchido na
          base pai (mocks não contam).
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={ignorePeriod}
            onCheckedChange={(v) => setIgnorePeriod(v === true)}
          />
          Ignorar filtro de período
        </label>
        <p className="text-muted-foreground text-xs">
          As linhas desta sub-base entram nos widgets independentemente do
          período selecionado no dashboard (ex.: &quot;todos os leads ativos
          hoje&quot;). Filtros de data do próprio widget seguem valendo.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Filtro (todas as condições, em E)</Label>
        {conds.map((c, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <div className="flex-1">
              <Combobox
                options={fieldOptions}
                value={c.field}
                onValueChange={(v) => setCond(i, { field: v })}
                placeholder="Campo"
                aria-label="Campo"
              />
            </div>
            <div className="w-40">
              <Combobox
                options={OP_OPTIONS}
                value={c.op}
                onValueChange={(v) => setCond(i, { op: v })}
                searchable={false}
                aria-label="Operador"
              />
            </div>
            {!NO_VALUE_OPS.has(c.op) ? (
              (() => {
                const vs = subFilterValueSource(
                  c.field,
                  parentKey,
                  selectOptionsByField
                );
                return vs && ["eq", "neq", "in"].includes(c.op) ? (
                  <FilterValuePicker
                    source={vs}
                    multi={c.op === "in"}
                    value={c.value}
                    onChange={(value) => setCond(i, { value })}
                    ariaLabel="Valor"
                  />
                ) : (
                  <Input
                    value={Array.isArray(c.value) ? c.value.join(", ") : c.value}
                    onChange={(e) => setCond(i, { value: e.target.value })}
                    placeholder="Valor"
                    className="flex-1"
                    aria-label="Valor"
                  />
                );
              })()
            ) : (
              <div className="flex-1" />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeCond(i)}
              aria-label="Remover condição"
              disabled={conds.length <= 1}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addCond}>
          <Plus className="size-4" />
          Adicionar condição
        </Button>
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
        {pending ? "Salvando..." : isEdit ? "Salvar alterações" : "Criar sub-base"}
      </Button>
    </form>
  );
}

// ↑/↓ dentro da PAI (0107): re-sequencia as subs da mesma pai no servidor.
function MoveSubButtons({ subKey }: { subKey: string }) {
  const [state, formAction, pending] = useActionState(reorderSubSource, initial);
  // Rajada de ↑/↓ coalesce num único refresh (debounce do hook).
  useRefreshOnActionOk(state);
  return (
    <form action={formAction} className="flex items-center">
      <input type="hidden" name="key" value={subKey} />
      <Button
        type="submit"
        name="dir"
        value="up"
        variant="ghost"
        size="icon"
        disabled={pending}
        aria-label="Mover sub-base para cima"
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
        aria-label="Mover sub-base para baixo"
      >
        <ArrowDown className="size-4" />
      </Button>
    </form>
  );
}

function DeleteSubButton({ subKey, label }: { subKey: string; label: string }) {
  const [state, formAction, pending] = useActionState(deleteSubSource, initial);
  useRefreshOnActionOk(state);
  const [confirm, setConfirm] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={formAction} className="flex items-center gap-1">
      <input type="hidden" name="key" value={subKey} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={pending}
        aria-label="Excluir sub-base"
        onClick={() => setConfirm(true)}
      >
        <Trash2 className="size-4" />
      </Button>
      {state.message && !state.ok ? (
        <span className="text-destructive text-xs" role="alert">
          {state.message}
        </span>
      ) : null}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Excluir sub-base?"
        description={
          <>
            A sub-base <strong>{label}</strong> será removida — widgets e
            filtros que a referenciam deixam de funcionar. Esta ação não pode
            ser desfeita.
          </>
        }
        onConfirm={() => {
          setConfirm(false);
          formRef.current?.requestSubmit();
        }}
      />
    </form>
  );
}

export function SubSourcesManager({
  sources,
  fieldOptionsByParent,
  dateFieldOptionsByParent,
  periodOptionsByParent,
  selectOptionsByField,
}: {
  sources: SourceDef[];
  fieldOptionsByParent: Record<string, ComboboxOption[]>;
  dateFieldOptionsByParent?: Record<string, ComboboxOption[]>;
  periodOptionsByParent?: Record<string, ComboboxOption[]>;
  selectOptionsByField?: Record<string, string[]>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SourceDef | undefined>(undefined);
  const roots = sources.filter((s) => !s.parentKey);
  // Agrupadas por PAI (na ordem das raízes do catálogo): o ↑/↓ move dentro da
  // pai, então a tabela precisa mostrar as irmãs juntas.
  const subs = roots.flatMap((r) =>
    sources.filter((s) => s.parentKey === r.key)
  );

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
          <h2 className="text-lg font-semibold">Sub-bases</h2>
          <p className="text-muted-foreground text-sm">
            Uma sub-base é a base pai recortada por um filtro (ex.: Leads só da
            etapa &quot;Clientes Lite&quot;), com campo de data próprio. Aparece
            como base no construtor de widgets e nos campos unificados. Quando a
            pai também está no widget, a sub é absorvida (sem duplicar) — salvo se
            você marcar &quot;conviver&quot; no widget.
          </p>
        </div>
        <Button onClick={openCreate} disabled={roots.length === 0}>
          <Plus className="size-4" />
          Nova sub-base
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Chave</TableHead>
              <TableHead>Pai</TableHead>
              <TableHead>Condições</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center">
                  Nenhuma sub-base ainda.
                </TableCell>
              </TableRow>
            ) : (
              subs.map((s) => (
                <TableRow key={s.key}>
                  <TableCell className="font-medium">
                    {s.label}
                    {s.ignorePeriod ? (
                      <span className="text-muted-foreground ml-2 rounded border px-1.5 py-0.5 text-[10px] font-normal whitespace-nowrap">
                        ignora período
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <code className="text-xs">{s.key}</code>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {sourceLabel(s.parentKey ?? "", sources)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {(s.filter ?? []).length}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <MoveSubButtons subKey={s.key} />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(s)}
                        aria-label="Editar sub-base"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <DeleteSubButton subKey={s.key} label={s.label} />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <ResizableSheetContent
          storageKey="panel-w:sub-sources"
          defaultWidth={448}
          className="overflow-y-auto"
        >
          <SheetHeader>
            <SheetTitle>
              {editing ? "Editar sub-base" : "Nova sub-base"}
            </SheetTitle>
            <SheetDescription>
              As linhas são as da base pai que satisfazem o filtro.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <SubSourceForm
              key={editing?.key ?? "new"}
              sub={editing}
              roots={roots}
              fieldOptionsByParent={fieldOptionsByParent}
              dateFieldOptionsByParent={dateFieldOptionsByParent}
              periodOptionsByParent={periodOptionsByParent}
              selectOptionsByField={selectOptionsByField}
              onDone={() => setOpen(false)}
            />
          </div>
        </ResizableSheetContent>
      </Sheet>
    </div>
  );
}

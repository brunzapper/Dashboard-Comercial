// Versão: 1.0 | Data: 26/07/2026
// Sub-operações AUTOMÁTICAS por base (0106, Parcerias): config 1-por-base que
// materializa uma sub-operação por registro (ex.: cada parceiro da base
// Parceiros vira uma "parceria" sob a operação-pai), com perfil gerado
// comparando um campo do LEAD ao identificador do registro. Tabela + Sheet
// (padrão SubSourcesManager); "Gerar agora" roda a rotina imediatamente.
// O perfil gerado pertence à rotina — edições manuais do perfil da sub-operação
// são sobrescritas na próxima rodada.
"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
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
import { sourceLabel, type SourceDef } from "@/lib/sources";
import {
  deleteAutoOperations,
  runAutoOperationsNow,
  saveAutoOperations,
  type SourceActionState,
} from "@/app/(app)/registros/bases/actions";

export interface AutoOperationsConfigRow {
  source_key: string;
  parent_operation_id: string;
  name_field: string;
  value_field: string;
  target_field: string;
  target_sources: string[];
  profile_op: "eq" | "eq_ci";
  enabled: boolean;
}

const initial: SourceActionState = {};

const OP_OPTIONS: ComboboxOption[] = [
  { value: "eq_ci", label: "igual (ignora caixa/acentos)" },
  { value: "eq", label: "igual (exato)" },
];

const ENABLED_OPTIONS: ComboboxOption[] = [
  { value: "on", label: "Ativa" },
  { value: "off", label: "Inativa" },
];

function AutoOperationsForm({
  config,
  roots,
  operationOptions,
  fieldOptionsByParent,
  onDone,
}: {
  config?: AutoOperationsConfigRow;
  roots: SourceDef[];
  operationOptions: ComboboxOption[];
  fieldOptionsByParent: Record<string, ComboboxOption[]>;
  onDone?: () => void;
}) {
  const isEdit = Boolean(config);
  const [state, formAction, pending] = useActionState(
    saveAutoOperations,
    initial
  );
  const [sourceKey, setSourceKey] = useState(
    config?.source_key ?? roots[0]?.key ?? ""
  );
  const [parentId, setParentId] = useState(config?.parent_operation_id ?? "");
  const [nameField, setNameField] = useState(config?.name_field ?? "title");
  const [valueField, setValueField] = useState(config?.value_field ?? "");
  const [targetSource, setTargetSource] = useState(
    config?.target_sources?.[0] ?? "leads"
  );
  const [targetField, setTargetField] = useState(config?.target_field ?? "");
  const [profileOp, setProfileOp] = useState<string>(
    config?.profile_op ?? "eq_ci"
  );
  const [enabled, setEnabled] = useState(
    config ? (config.enabled ? "on" : "off") : "on"
  );

  useEffect(() => {
    if (state.ok && onDone) onDone();
  }, [state.ok, onDone]);

  const rootOptions: ComboboxOption[] = roots.map((s) => ({
    value: s.key,
    label: s.label,
  }));
  const baseFieldOptions = fieldOptionsByParent[sourceKey] ?? [];
  const targetFieldOptions = fieldOptionsByParent[targetSource] ?? [];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="source_key" value={sourceKey} />
      <input type="hidden" name="parent_operation_id" value={parentId} />
      <input type="hidden" name="name_field" value={nameField} />
      <input type="hidden" name="value_field" value={valueField} />
      <input type="hidden" name="target_source" value={targetSource} />
      <input type="hidden" name="target_field" value={targetField} />
      <input type="hidden" name="profile_op" value={profileOp} />
      <input type="hidden" name="enabled" value={enabled} />

      <div className="flex flex-col gap-1.5">
        <Label>Base geradora</Label>
        <Combobox
          options={rootOptions}
          value={sourceKey}
          onValueChange={(v) => {
            setSourceKey(v);
            setValueField("");
          }}
          disabled={isEdit}
          placeholder="Base"
        />
        <p className="text-muted-foreground text-xs">
          Cada registro desta base vira uma sub-operação (ex.: Parceiros).
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Operação-pai</Label>
        <Combobox
          options={operationOptions}
          value={parentId}
          onValueChange={setParentId}
          placeholder="Operação que agrupa as sub-operações"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Campo do nome</Label>
          <Combobox
            options={baseFieldOptions}
            value={nameField}
            onValueChange={setNameField}
            placeholder="Nome da sub-operação"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Campo do identificador</Label>
          <Combobox
            options={baseFieldOptions}
            value={valueField}
            onValueChange={setValueField}
            placeholder="Ex.: E-mail do parceiro"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Base-alvo do perfil</Label>
          <Combobox
            options={rootOptions}
            value={targetSource}
            onValueChange={(v) => {
              setTargetSource(v);
              setTargetField("");
            }}
            placeholder="Base filtrada"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Campo comparado</Label>
          <Combobox
            options={targetFieldOptions}
            value={targetField}
            onValueChange={setTargetField}
            placeholder="Ex.: Email parceiro (lead)"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Comparação</Label>
          <Combobox
            options={OP_OPTIONS}
            value={profileOp}
            onValueChange={setProfileOp}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Situação</Label>
          <Combobox
            options={ENABLED_OPTIONS}
            value={enabled}
            onValueChange={setEnabled}
          />
        </div>
      </div>

      {state.message ? (
        <p
          className={`text-sm ${state.ok ? "text-muted-foreground" : "text-destructive"}`}
        >
          {state.message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar"}
      </Button>
    </form>
  );
}

function RowActions({
  config,
  onEdit,
  onMessage,
}: {
  config: AutoOperationsConfigRow;
  onEdit: () => void;
  onMessage: (m: SourceActionState) => void;
}) {
  const [runState, runAction, runPending] = useActionState(
    runAutoOperationsNow,
    initial
  );
  const [delState, delAction, delPending] = useActionState(
    deleteAutoOperations,
    initial
  );
  useEffect(() => {
    if (runState.message) onMessage(runState);
  }, [runState, onMessage]);
  useEffect(() => {
    if (delState.message) onMessage(delState);
  }, [delState, onMessage]);

  return (
    <div className="flex items-center justify-end gap-1">
      <form action={runAction}>
        <input type="hidden" name="source_key" value={config.source_key} />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          disabled={runPending}
          title="Gerar sub-operações agora"
        >
          <Zap className="size-4" />
        </Button>
      </form>
      <Button variant="ghost" size="sm" onClick={onEdit} title="Editar">
        <Pencil className="size-4" />
      </Button>
      <form action={delAction}>
        <input type="hidden" name="source_key" value={config.source_key} />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          disabled={delPending}
          title="Excluir config (mantém as operações geradas)"
        >
          <Trash2 className="size-4" />
        </Button>
      </form>
    </div>
  );
}

export function AutoOperationsManager({
  sources,
  configs,
  operationOptions,
  fieldOptionsByParent,
}: {
  sources: SourceDef[];
  configs: AutoOperationsConfigRow[];
  operationOptions: ComboboxOption[];
  fieldOptionsByParent: Record<string, ComboboxOption[]>;
}) {
  const roots = sources.filter((s) => !s.parentKey);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AutoOperationsConfigRow | undefined>();
  const [message, setMessage] = useState<SourceActionState>({});
  const opNameById = new Map(operationOptions.map((o) => [o.value, o.label]));
  const fieldLabel = (src: string, ref: string) =>
    (fieldOptionsByParent[src] ?? []).find((o) => o.value === ref)?.label ??
    ref;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Sub-operações automáticas</h2>
          <p className="text-muted-foreground text-sm">
            Cada registro da base configurada vira uma sub-operação sob a
            operação-pai (ex.: cada parceiro vira uma parceria), com o filtro
            de operação gerado automaticamente.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(undefined);
            setOpen(true);
          }}
        >
          <Plus className="size-4" /> Nova config
        </Button>
      </div>

      {message.message ? (
        <p
          className={`text-sm ${message.ok ? "text-muted-foreground" : "text-destructive"}`}
        >
          {message.message}
        </p>
      ) : null}

      {configs.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nenhuma base configurada.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Base</TableHead>
              <TableHead>Operação-pai</TableHead>
              <TableHead>Identificador</TableHead>
              <TableHead>Campo no alvo</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {configs.map((c) => (
              <TableRow key={c.source_key}>
                <TableCell>{sourceLabel(c.source_key, sources)}</TableCell>
                <TableCell>
                  {opNameById.get(c.parent_operation_id) ?? "—"}
                </TableCell>
                <TableCell>
                  {fieldLabel(c.source_key, c.value_field)}
                </TableCell>
                <TableCell>
                  {fieldLabel(c.target_sources[0] ?? "", c.target_field)}
                </TableCell>
                <TableCell>{c.enabled ? "Ativa" : "Inativa"}</TableCell>
                <TableCell>
                  <RowActions
                    config={c}
                    onEdit={() => {
                      setEditing(c);
                      setOpen(true);
                    }}
                    onMessage={setMessage}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <ResizableSheetContent
          storageKey="panel-w:auto-operations"
          defaultWidth={448}
          className="overflow-y-auto"
        >
          <SheetHeader>
            <SheetTitle>
              {editing ? "Editar sub-operações automáticas" : "Nova config"}
            </SheetTitle>
            <SheetDescription>
              O perfil das sub-operações geradas é reescrito pela rotina a cada
              rodada — personalize a config, não o perfil.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            <AutoOperationsForm
              key={editing?.source_key ?? "new"}
              config={editing}
              roots={roots}
              operationOptions={operationOptions}
              fieldOptionsByParent={fieldOptionsByParent}
              onDone={() => setOpen(false)}
            />
          </div>
        </ResizableSheetContent>
      </Sheet>
    </div>
  );
}

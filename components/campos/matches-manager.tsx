// Versão: 1.0 | Data: 12/07/2026
// Fase 2: gestão das regras de match entre fontes (Conexões) na aba Campos.
// Tabela + Sheet para criar/editar uma regra (2 pares de campos com fallback) e
// um botão para rodar o auto-match. Espelha CorrespondencesManager.
"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import {
  RECORD_TYPE_SOURCE,
  SOURCE_KEYS,
  SOURCE_LABELS,
  type SourceKey,
} from "@/lib/sources";
import type { MatchRule } from "@/lib/matching";
import type { RefOption } from "@/components/campos/correspondences-manager";
import {
  createMatchRule,
  deleteMatchRule,
  runAutoMatchAction,
  updateMatchRule,
  type MatchActionState,
} from "@/app/(app)/campos/matches-actions";

const initial: MatchActionState = {};

const SOURCE_OPTIONS: ComboboxOption[] = SOURCE_KEYS.map((k) => ({
  value: k,
  label: SOURCE_LABELS[k],
}));

const ENABLED_OPTIONS: ComboboxOption[] = [
  { value: "on", label: "Ativa" },
  { value: "off", label: "Inativa" },
];

function fieldOptions(refs: RefOption[]): ComboboxOption[] {
  return [
    { value: "", label: "— nenhum —" },
    ...refs.map((c) => ({ value: c.ref, label: c.label })),
  ];
}

function MatchRuleForm({
  rule,
  candidatesBySource,
  onDone,
}: {
  rule?: MatchRule;
  candidatesBySource: Record<SourceKey, RefOption[]>;
  onDone?: () => void;
}) {
  const isEdit = Boolean(rule);
  const action = isEdit ? updateMatchRule : createMatchRule;
  const [state, formAction, pending] = useActionState(action, initial);

  const [sourceA, setSourceA] = useState<SourceKey>(
    rule ? RECORD_TYPE_SOURCE[rule.source_a] : "leads"
  );
  const [sourceB, setSourceB] = useState<SourceKey>(
    rule ? RECORD_TYPE_SOURCE[rule.source_b] : "estudo"
  );
  const [fieldA1, setFieldA1] = useState(rule?.field_a_1 ?? "");
  const [fieldB1, setFieldB1] = useState(rule?.field_b_1 ?? "");
  const [fieldA2, setFieldA2] = useState(rule?.field_a_2 ?? "");
  const [fieldB2, setFieldB2] = useState(rule?.field_b_2 ?? "");
  const [enabled, setEnabled] = useState(rule ? (rule.enabled ? "on" : "off") : "on");

  useEffect(() => {
    if (state.ok && onDone) onDone();
  }, [state.ok, onDone]);

  const optsA = fieldOptions(candidatesBySource[sourceA]);
  const optsB = fieldOptions(candidatesBySource[sourceB]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {isEdit ? <input type="hidden" name="id" value={rule!.id} /> : null}
      <input type="hidden" name="source_a" value={sourceA} />
      <input type="hidden" name="source_b" value={sourceB} />
      <input type="hidden" name="field_a_1" value={fieldA1} />
      <input type="hidden" name="field_b_1" value={fieldB1} />
      <input type="hidden" name="field_a_2" value={fieldA2} />
      <input type="hidden" name="field_b_2" value={fieldB2} />
      <input type="hidden" name="enabled" value={enabled} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="label">Rótulo</Label>
        <Input
          id="label"
          name="label"
          defaultValue={rule?.label ?? ""}
          placeholder="Ex.: Leads → Vendas do site"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Fonte A</Label>
          <Combobox
            options={SOURCE_OPTIONS}
            value={sourceA}
            onValueChange={(v) => setSourceA(v as SourceKey)}
            searchable={false}
            aria-label="Fonte A"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Fonte B</Label>
          <Combobox
            options={SOURCE_OPTIONS}
            value={sourceB}
            onValueChange={(v) => setSourceB(v as SourceKey)}
            searchable={false}
            aria-label="Fonte B"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Par 1 (tentado primeiro)</Label>
        <div className="grid grid-cols-2 gap-3">
          <Combobox
            options={optsA}
            value={fieldA1}
            onValueChange={setFieldA1}
            placeholder="Campo em A"
            aria-label="Par 1 — campo em A"
          />
          <Combobox
            options={optsB}
            value={fieldB1}
            onValueChange={setFieldB1}
            placeholder="Campo em B"
            aria-label="Par 1 — campo em B"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Par 2 (fallback, opcional)</Label>
        <div className="grid grid-cols-2 gap-3">
          <Combobox
            options={optsA}
            value={fieldA2}
            onValueChange={setFieldA2}
            placeholder="Campo em A"
            aria-label="Par 2 — campo em A"
          />
          <Combobox
            options={optsB}
            value={fieldB2}
            onValueChange={setFieldB2}
            placeholder="Campo em B"
            aria-label="Par 2 — campo em B"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Situação</Label>
        <Combobox
          options={ENABLED_OPTIONS}
          value={enabled}
          onValueChange={setEnabled}
          searchable={false}
          aria-label="Situação"
        />
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
        {pending ? "Salvando..." : isEdit ? "Salvar alterações" : "Criar regra"}
      </Button>
    </form>
  );
}

function RunAutoMatchButton() {
  const [state, formAction, pending] = useActionState(runAutoMatchAction, initial);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <Button type="submit" variant="outline" disabled={pending}>
        <Zap className="size-4" />
        {pending ? "Rodando..." : "Rodar auto-match"}
      </Button>
      {state.message ? (
        <span
          className={
            state.ok ? "text-muted-foreground text-xs" : "text-destructive text-xs"
          }
          role="status"
        >
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

export function MatchesManager({
  rules,
  candidatesBySource,
}: {
  rules: MatchRule[];
  candidatesBySource: Record<SourceKey, RefOption[]>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MatchRule | undefined>(undefined);

  const labelForRef = (rt: MatchRule["source_a"], ref: string | null): string => {
    if (!ref) return "—";
    const src = RECORD_TYPE_SOURCE[rt];
    return candidatesBySource[src]?.find((c) => c.ref === ref)?.label ?? ref;
  };

  function openCreate() {
    setEditing(undefined);
    setOpen(true);
  }
  function openEdit(r: MatchRule) {
    setEditing(r);
    setOpen(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Conexões entre fontes</h2>
          <p className="text-muted-foreground text-sm">
            Case registros de fontes diferentes (ex.: um lead do Bitrix com sua
            compra no site) por até 2 pares de campos com fallback. Os campos do
            registro casado ficam disponíveis nos widgets como{" "}
            <code className="text-xs">match:&lt;fonte&gt;:&lt;campo&gt;</code>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RunAutoMatchButton />
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            Nova regra
          </Button>
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rótulo</TableHead>
              <TableHead>Fontes</TableHead>
              <TableHead>Par 1</TableHead>
              <TableHead>Par 2</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground text-center">
                  Nenhuma regra ainda. Crie a primeira.
                </TableCell>
              </TableRow>
            ) : (
              rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {SOURCE_LABELS[RECORD_TYPE_SOURCE[r.source_a]]} ↔{" "}
                    {SOURCE_LABELS[RECORD_TYPE_SOURCE[r.source_b]]}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {labelForRef(r.source_a, r.field_a_1)} ↔{" "}
                    {labelForRef(r.source_b, r.field_b_1)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {r.field_a_2
                      ? `${labelForRef(r.source_a, r.field_a_2)} ↔ ${labelForRef(r.source_b, r.field_b_2)}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.enabled ? "Ativa" : "Inativa"}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(r)}
                        aria-label="Editar"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <form action={deleteMatchRule}>
                        <input type="hidden" name="id" value={r.id} />
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
            <SheetTitle>{editing ? "Editar regra" : "Nova regra"}</SheetTitle>
            <SheetDescription>
              O auto-match tenta o Par 1; sem resultado, tenta o Par 2. Matches
              manuais nunca são sobrescritos.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <MatchRuleForm
              key={editing?.id ?? "new"}
              rule={editing}
              candidatesBySource={candidatesBySource}
              onDone={() => setOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

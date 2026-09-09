// Versão: 1.0 | Data: 09/09/2026
// Editor dos CAMPOS de um esquema — a lista única que quem lança preenche.
//
// Antes só dava para renomear, ocultar e reordenar o que já existia; um campo
// novo exigia alguém escrever a definição por fora. Aqui ele nasce na tela: a
// `key` é derivada do rótulo (é ela que as refs `{{form.<key>}}` endereçam) e
// fica IMUTÁVEL depois de criada — renomear órfãria as refs dos passos, e o
// parse fail-closed do servidor não tem como adivinhar a intenção.
//
// O que este editor NÃO faz: decidir em que passo o campo é usado. O formulário
// é plano de propósito (§4.23) — o destrinchar é dos passos.
"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { workflowKeyFromLabel } from "@/lib/workflow/schemas";
import {
  WORKFLOW_FIELD_TYPES,
  WORKFLOW_OPTIONS_SOURCES,
  type WorkflowFormField,
} from "@/lib/workflow/types";
import { optionsSourceDef } from "@/lib/workflow/registry";

const TYPE_LABELS: Record<(typeof WORKFLOW_FIELD_TYPES)[number], string> = {
  texto: "Texto",
  texto_longo: "Texto longo",
  email: "E-mail",
  telefone: "Telefone",
  numero: "Número",
  data: "Data",
  selecao: "Seleção",
};

const TYPE_OPTIONS: ComboboxOption[] = WORKFLOW_FIELD_TYPES.map((t) => ({
  value: t,
  label: TYPE_LABELS[t],
}));

const OPTIONS_SOURCE_OPTIONS: ComboboxOption[] = WORKFLOW_OPTIONS_SOURCES.map(
  (k) => ({ value: k, label: optionsSourceDef(k)?.label ?? k })
);

export function FieldRow({
  field,
  index,
  total,
  busy,
  onChange,
  onMove,
  onRemove,
}: {
  field: WorkflowFormField;
  index: number;
  total: number;
  busy: boolean;
  onChange: (patch: Partial<WorkflowFormField>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          disabled={busy}
          onClick={() => onChange({ visible: !field.visible })}
          aria-label={field.visible ? "Ocultar do formulário" : "Mostrar no formulário"}
          title={
            field.visible
              ? "Ocultar do formulário"
              : "Mostrar no formulário (oculto, vale o valor padrão)"
          }
        >
          {field.visible ? (
            <Eye className="size-4" />
          ) : (
            <EyeOff className="text-muted-foreground size-4" />
          )}
        </Button>

        <Input
          className="w-56"
          value={field.label}
          disabled={busy}
          onChange={(e) => onChange({ label: e.target.value })}
          aria-label={`Rótulo de ${field.key}`}
        />

        <code className="text-muted-foreground text-xs">{field.key}</code>

        <label className="flex items-center gap-1.5 text-sm">
          <Checkbox
            checked={field.required}
            disabled={busy || !field.visible}
            onCheckedChange={(v) => onChange({ required: v === true })}
          />
          Obrigatório
        </label>

        {field.optionsSource && field.optionsSource !== "static" ? (
          <Badge variant="outline" className="text-xs">
            lista automática
          </Badge>
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Menos" : "Mais"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={busy || index === 0}
            onClick={() => onMove(-1)}
            aria-label="Subir"
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={busy || index === total - 1}
            onClick={() => onMove(1)}
            aria-label="Descer"
          >
            <ArrowDown className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive size-7"
            disabled={busy}
            onClick={onRemove}
            aria-label={`Remover ${field.label}`}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {open ? (
        <div className="flex flex-wrap items-end gap-2 border-t pt-2">
          <div className="flex w-40 flex-col gap-1">
            <Label className="text-xs">Tipo</Label>
            <Combobox
              options={TYPE_OPTIONS}
              value={field.type}
              onValueChange={(v) =>
                onChange({
                  type: v as WorkflowFormField["type"],
                  // Seleção sem provedor não teria de onde tirar as opções — o
                  // parse recusaria o esquema inteiro.
                  ...(v === "selecao" && !field.optionsSource
                    ? { optionsSource: "static" as const }
                    : {}),
                })
              }
              searchable={false}
              aria-label="Tipo do campo"
            />
          </div>

          {field.type === "selecao" ? (
            <div className="flex w-48 flex-col gap-1">
              <Label className="text-xs">Opções</Label>
              <Combobox
                options={OPTIONS_SOURCE_OPTIONS}
                value={field.optionsSource ?? "static"}
                onValueChange={(v) =>
                  onChange({
                    optionsSource: v as WorkflowFormField["optionsSource"],
                  })
                }
                searchable={false}
                aria-label="Origem das opções"
              />
            </div>
          ) : null}

          {field.type === "selecao" && (field.optionsSource ?? "static") === "static" ? (
            <div className="flex min-w-56 flex-1 flex-col gap-1">
              <Label className="text-xs">Lista (uma por linha, separada por vírgula)</Label>
              <Input
                value={(field.options ?? []).join(", ")}
                disabled={busy}
                onChange={(e) =>
                  onChange({
                    options: e.target.value
                      .split(",")
                      .map((o) => o.trim())
                      .filter(Boolean),
                  })
                }
                aria-label="Opções fixas"
              />
            </div>
          ) : null}

          <div className="flex min-w-40 flex-1 flex-col gap-1">
            <Label className="text-xs">Valor padrão</Label>
            <Input
              value={field.defaultValue ?? ""}
              disabled={busy}
              onChange={(e) => onChange({ defaultValue: e.target.value })}
              placeholder="vazio"
              aria-label="Valor padrão"
            />
          </div>

          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <Label className="text-xs">De onde vem numa automação</Label>
            <Input
              value={field.sourceRef ?? ""}
              disabled={busy}
              onChange={(e) => onChange({ sourceRef: e.target.value })}
              placeholder="ex.: title, custom:fonte, source_id"
              aria-label="Campo do registro que alimenta este"
            />
            <p className="text-muted-foreground text-xs">
              Quando quem dispara é uma regra, o valor sai deste campo do
              registro. Vazio = usa o valor padrão.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Acrescenta um campo. A `key` sai do rótulo e é única no esquema — ela é o
 * endereço da ref, não um rótulo, e por isso não é perguntada.
 */
export function NewFieldButton({
  busy,
  existing,
  onAdd,
}: {
  busy: boolean;
  existing: WorkflowFormField[];
  onAdd: (field: WorkflowFormField) => void;
}) {
  const [label, setLabel] = useState("");

  const add = () => {
    const clean = label.trim();
    if (clean === "") return;
    const taken = new Set(existing.map((f) => f.key));
    let key = workflowKeyFromLabel(clean);
    for (let i = 2; taken.has(key); i += 1) key = `${workflowKeyFromLabel(clean)}_${i}`;
    onAdd({
      key,
      label: clean,
      type: "texto",
      required: false,
      visible: true,
      order: existing.length,
    });
    setLabel("");
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        className="w-56"
        value={label}
        disabled={busy}
        placeholder="Nome do campo novo"
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        aria-label="Nome do campo novo"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1"
        disabled={busy || label.trim() === ""}
        onClick={add}
      >
        <Plus className="size-4" /> Adicionar campo
      </Button>
    </div>
  );
}

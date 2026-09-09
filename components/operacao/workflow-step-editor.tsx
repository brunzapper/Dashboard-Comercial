// Versão: 1.0 | Data: 09/09/2026
// Editor dos PASSOS de um esquema — o que o fluxo de fato faz, em ordem.
//
// Até aqui a tela só ligava e desligava passos que alguém já tinha escrito no
// jsonb: "criar um fluxo novo" não existia. Aqui o passo é montado: tipo (do
// catálogo em código), conexão (pela CHAVE do registry — o valor da credencial
// nunca aparece) e, para cada campo do destino, um TEMPLATE.
//
// Duas decisões que evitam adivinhação:
//  - o campo do destino não é digitado de cabeça: quando a conexão existe, a
//    lista vem do próprio portal (`crm.<entidade>.fields`), e "Título" é mais
//    honesto que UF_CRM_1729887583805. Sem conexão, degrada para texto livre.
//  - o valor não é sintaxe adivinhada: um seletor insere as refs que EXISTEM —
//    campos do formulário, passos anteriores e o contexto do servidor.
//
// Este editor não valida nada por conta própria: quem decide o que entra no
// banco é `parseWorkflowDefinition` (fail-closed) no save.
"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EDITABLE_CORE_COLUMNS } from "@/lib/config/core-writeback";
import {
  stepTypeDef,
  WORKFLOW_CTX_KEYS,
  WORKFLOW_STEP_TYPES_CATALOG,
} from "@/lib/workflow/registry";
import type {
  WorkflowFieldSpec,
  WorkflowFormField,
  WorkflowStep,
} from "@/lib/workflow/types";
import type { BitrixFieldOption } from "@/app/(app)/operacao/workflow/actions";

export interface StepSourceOption {
  key: string;
  label: string;
  manualEntry: boolean;
}

const ENTITY_OPTIONS: ComboboxOption[] = [
  { value: "lead", label: "Lead" },
  { value: "deal", label: "Negócio" },
  { value: "company", label: "Empresa" },
  { value: "contact", label: "Contato" },
];

/** Refs oferecíveis num passo: o que EXISTE, na ordem em que se pensa nelas. */
function refOptions(
  formFields: WorkflowFormField[],
  previousSteps: WorkflowStep[]
): ComboboxOption[] {
  return [
    ...formFields.map((f) => ({
      value: `{{form.${f.key}}}`,
      label: `Formulário · ${f.label}`,
    })),
    ...previousSteps.map((s) => ({
      value: `{{steps.${s.id}.id}}`,
      label: `Passo anterior · ${s.label} (id)`,
    })),
    ...WORKFLOW_CTX_KEYS.map((c) => ({
      value: `{{ctx.${c.key}}}`,
      label: `Contexto · ${c.label}`,
    })),
  ];
}

/** Input de template com inserção de ref — nada de sintaxe decorada. */
function TemplateInput({
  value,
  onChange,
  refs,
  placeholder,
  ariaLabel,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  refs: ComboboxOption[];
  placeholder?: string;
  ariaLabel: string;
  busy: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Input
        className="min-w-0 flex-1"
        value={value}
        disabled={busy}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
      />
      <Combobox
        options={refs}
        value=""
        onValueChange={(v) => onChange(`${value}${v}`)}
        placeholder="+ ref"
        aria-label={`Inserir referência em ${ariaLabel}`}
        className="w-28 shrink-0"
      />
    </div>
  );
}

/** Tabela campo do destino → template. */
function PairTable({
  pairs,
  onChange,
  refs,
  busy,
  keyOptions,
  keyPlaceholder,
  emptyNote,
}: {
  pairs: Record<string, WorkflowFieldSpec>;
  onChange: (next: Record<string, WorkflowFieldSpec>) => void;
  refs: ComboboxOption[];
  busy: boolean;
  /** Lista do destino; vazia = texto livre (conexão ausente/portal fora). */
  keyOptions: ComboboxOption[];
  keyPlaceholder: string;
  emptyNote: string;
}) {
  const [novo, setNovo] = useState("");
  const entries = Object.entries(pairs);

  const setPair = (key: string, spec: WorkflowFieldSpec) =>
    onChange({ ...pairs, [key]: spec });
  const removePair = (key: string) => {
    const next = { ...pairs };
    delete next[key];
    onChange(next);
  };
  const add = (key: string) => {
    const k = key.trim();
    if (k === "" || pairs[k]) return;
    onChange({ ...pairs, [k]: { value: "" } });
    setNovo("");
  };

  const available = keyOptions.filter((o) => !pairs[o.value]);

  return (
    <div className="flex flex-col gap-1.5">
      {entries.length === 0 ? (
        <p className="text-muted-foreground text-xs">{emptyNote}</p>
      ) : null}
      {entries.map(([key, spec]) => (
        <div key={key} className="flex flex-wrap items-center gap-2">
          <code className="w-44 shrink-0 truncate text-xs" title={key}>
            {keyOptions.find((o) => o.value === key)?.label ?? key}
          </code>
          <TemplateInput
            value={spec.value}
            onChange={(v) => setPair(key, { ...spec, value: v })}
            refs={refs}
            ariaLabel={`Valor de ${key}`}
            busy={busy}
          />
          <label className="flex items-center gap-1 text-xs">
            <Checkbox
              checked={spec.shape === "comm"}
              disabled={busy}
              onCheckedChange={(v) =>
                setPair(key, {
                  value: spec.value,
                  ...(v === true ? { shape: "comm" as const } : {}),
                })
              }
            />
            multi
          </label>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive size-7"
            disabled={busy}
            onClick={() => removePair(key)}
            aria-label={`Remover ${key}`}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        {available.length > 0 ? (
          <Combobox
            options={available}
            value=""
            onValueChange={add}
            placeholder={keyPlaceholder}
            aria-label={keyPlaceholder}
            className="w-56"
          />
        ) : (
          <Input
            className="w-56"
            value={novo}
            disabled={busy}
            placeholder={keyPlaceholder}
            onChange={(e) => setNovo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(novo);
              }
            }}
            aria-label={keyPlaceholder}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Patch nos params de um passo do Bitrix. Existe porque o spread apaga a
 * discriminação da união (add não tem `entityId`): sem os dois ramos
 * explícitos, o TypeScript aceita montar um `update` sem alvo.
 */
function patchBitrixParams(
  step: Extract<
    WorkflowStep,
    { type: "bitrix.entity.add" | "bitrix.entity.update" }
  >,
  patch: {
    entity?: "company" | "contact" | "lead" | "deal";
    fields?: Record<string, WorkflowFieldSpec>;
    entityId?: WorkflowFieldSpec;
  }
): WorkflowStep {
  if (step.type === "bitrix.entity.update") {
    return {
      ...step,
      params: {
        ...step.params,
        ...(patch.entity ? { entity: patch.entity } : {}),
        ...(patch.fields ? { fields: patch.fields } : {}),
        ...(patch.entityId ? { entityId: patch.entityId } : {}),
      },
    };
  }
  return {
    ...step,
    params: {
      ...step.params,
      ...(patch.entity ? { entity: patch.entity } : {}),
      ...(patch.fields ? { fields: patch.fields } : {}),
    },
  };
}

export function StepRow({
  step,
  index,
  total,
  busy,
  formFields,
  previousSteps,
  sources,
  connectionLabel,
  loadBitrixFields,
  onChange,
  onMove,
  onRemove,
}: {
  step: WorkflowStep;
  index: number;
  total: number;
  busy: boolean;
  formFields: WorkflowFormField[];
  previousSteps: WorkflowStep[];
  sources: StepSourceOption[];
  connectionLabel: { envName: string; configured: boolean } | null;
  loadBitrixFields: (entity: string) => Promise<BitrixFieldOption[]>;
  onChange: (next: WorkflowStep) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [bitrixFields, setBitrixFields] = useState<BitrixFieldOption[]>([]);
  const def = stepTypeDef(step.type);
  const refs = refOptions(formFields, previousSteps);
  const isBitrix =
    step.type === "bitrix.entity.add" || step.type === "bitrix.entity.update";
  const entity = isBitrix ? step.params.entity : null;

  // A lista do portal só é buscada quando o passo é aberto — abrir a tela não
  // deve conversar com o CRM por causa de passos que ninguém vai editar.
  useEffect(() => {
    if (!open || !entity) return;
    let alive = true;
    loadBitrixFields(entity).then((f) => {
      if (alive) setBitrixFields(f);
    });
    return () => {
      alive = false;
    };
  }, [open, entity, loadBitrixFields]);

  const bitrixKeyOptions: ComboboxOption[] = bitrixFields.map((f) => ({
    value: f.value,
    label: f.label,
  }));
  const coreKeyOptions: ComboboxOption[] = Object.keys(EDITABLE_CORE_COLUMNS).map(
    (c) => ({ value: c, label: c })
  );

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox
          checked={step.enabled}
          disabled={busy}
          onCheckedChange={(v) => onChange({ ...step, enabled: v === true })}
          aria-label={`Ligar o passo ${step.label}`}
        />
        <Input
          className="w-56"
          value={step.label}
          disabled={busy}
          onChange={(e) => onChange({ ...step, label: e.target.value })}
          aria-label={`Nome do passo ${step.id}`}
        />
        <Badge variant="outline" className="text-xs">
          {def?.label ?? step.type}
        </Badge>
        {connectionLabel ? (
          <Badge
            variant={connectionLabel.configured ? "outline" : "destructive"}
            className="text-xs"
          >
            {connectionLabel.envName}
            {connectionLabel.configured ? " ✓" : " ausente"}
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
            {open ? "Fechar" : "Configurar"}
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
            aria-label={`Remover ${step.label}`}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {def ? <p className="text-muted-foreground text-xs">{def.description}</p> : null}

      {open ? (
        <div className="flex flex-col gap-3 border-t pt-2">
          {isBitrix ? (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex w-40 flex-col gap-1">
                  <Label className="text-xs">Entidade</Label>
                  <Combobox
                    options={ENTITY_OPTIONS}
                    value={step.params.entity}
                    onValueChange={(v) =>
                      onChange(
                        patchBitrixParams(step, {
                          entity: v as typeof step.params.entity,
                        })
                      )
                    }
                    searchable={false}
                    aria-label="Entidade do CRM"
                  />
                </div>
                {step.type === "bitrix.entity.update" ? (
                  <div className="flex min-w-56 flex-1 flex-col gap-1">
                    <Label className="text-xs">Id da entidade a alterar</Label>
                    <TemplateInput
                      value={step.params.entityId.value}
                      onChange={(v) =>
                        onChange(
                          patchBitrixParams(step, { entityId: { value: v } })
                        )
                      }
                      refs={refs}
                      placeholder="ex.: {{form.bitrix_id}}"
                      ariaLabel="Id da entidade a alterar"
                      busy={busy}
                    />
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col gap-1">
                <Label className="text-xs">Campos enviados</Label>
                <PairTable
                  pairs={step.params.fields}
                  onChange={(fields) =>
                    onChange(patchBitrixParams(step, { fields }))
                  }
                  refs={refs}
                  busy={busy}
                  keyOptions={bitrixKeyOptions}
                  keyPlaceholder={
                    bitrixKeyOptions.length > 0
                      ? "Adicionar campo do CRM"
                      : "Id do campo (ex.: TITLE)"
                  }
                  emptyNote="Nenhum campo ainda. Campo com valor vazio não é enviado — o destino mantém o que já tinha."
                />
              </div>
            </>
          ) : null}

          {step.type === "record.create" ? (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex w-56 flex-col gap-1">
                  <Label className="text-xs">Base de destino</Label>
                  <Combobox
                    options={sources
                      .filter((s) => s.manualEntry)
                      .map((s) => ({ value: s.key, label: s.label }))}
                    value={step.params.sourceKey}
                    onValueChange={(v) =>
                      onChange({
                        ...step,
                        params: { ...step.params, sourceKey: v },
                      })
                    }
                    placeholder="Base"
                    aria-label="Base de destino"
                  />
                  <p className="text-muted-foreground text-xs">
                    Só bases que aceitam criação manual.
                  </p>
                </div>
                <div className="flex w-56 flex-col gap-1">
                  <Label className="text-xs">Vincular ao id do passo</Label>
                  <Combobox
                    options={[
                      { value: "", label: "Sem vínculo" },
                      ...previousSteps.map((s) => ({
                        value: s.id,
                        label: s.label,
                      })),
                    ]}
                    value={step.params.linkSourceIdFrom ?? ""}
                    onValueChange={(v) =>
                      onChange({
                        ...step,
                        params: {
                          ...step.params,
                          ...(v ? { linkSourceIdFrom: v } : {}),
                        },
                      })
                    }
                    searchable={false}
                    aria-label="Passo que devolve o id do CRM"
                  />
                  <p className="text-muted-foreground text-xs">
                    Com vínculo, o próximo sync adota a linha em vez de duplicar.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <Label className="text-xs">Colunas do registro</Label>
                <PairTable
                  pairs={step.params.core}
                  onChange={(core) =>
                    onChange({ ...step, params: { ...step.params, core } })
                  }
                  refs={refs}
                  busy={busy}
                  keyOptions={coreKeyOptions}
                  keyPlaceholder="Adicionar coluna"
                  emptyNote="O nome do registro (title) é obrigatório — sem ele o passo falha."
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label className="text-xs">Campos personalizados</Label>
                <PairTable
                  pairs={step.params.custom}
                  onChange={(custom) =>
                    onChange({ ...step, params: { ...step.params, custom } })
                  }
                  refs={refs}
                  busy={busy}
                  keyOptions={[]}
                  keyPlaceholder="Chave do campo (sem custom:)"
                  emptyNote="Nenhum campo personalizado."
                />
              </div>
            </>
          ) : null}

          {step.type === "record.update" ? (
            <>
              <div className="flex min-w-56 flex-col gap-1">
                <Label className="text-xs">Registro a alterar</Label>
                <TemplateInput
                  value={step.params.recordIdFrom}
                  onChange={(v) =>
                    onChange({
                      ...step,
                      params: { ...step.params, recordIdFrom: v },
                    })
                  }
                  refs={refs}
                  placeholder="ex.: {{ctx.triggerRecordId}}"
                  ariaLabel="Registro a alterar"
                  busy={busy}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Campos alterados</Label>
                <PairTable
                  pairs={step.params.fields}
                  onChange={(fields) =>
                    onChange({ ...step, params: { ...step.params, fields } })
                  }
                  refs={refs}
                  busy={busy}
                  keyOptions={coreKeyOptions}
                  keyPlaceholder="Coluna ou custom:<chave>"
                  emptyNote="Nenhum campo ainda."
                />
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Passo em branco do tipo escolhido. Precisa nascer VÁLIDO para o parse
 * fail-closed: um passo recém-adicionado que derruba o esquema inteiro no
 * primeiro save tornaria "adicionar passo" inútil. Exportado para o teste pinar
 * exatamente isso.
 */
export function blankStep(type: string, id: string, label: string): WorkflowStep | null {
  switch (type) {
    case "bitrix.entity.add":
      return {
        id,
        type,
        label,
        enabled: true,
        connection: "bitrix_webhook",
        params: { entity: "lead", fields: {} },
      };
    case "bitrix.entity.update":
      return {
        id,
        type,
        label,
        enabled: true,
        connection: "bitrix_webhook",
        params: { entity: "lead", entityId: { value: "" }, fields: {} },
      };
    case "record.create":
      return {
        id,
        type,
        label,
        enabled: true,
        params: { sourceKey: "", core: {}, custom: {} },
      };
    case "record.update":
      return {
        id,
        type,
        label,
        enabled: true,
        params: { recordIdFrom: "{{ctx.triggerRecordId}}", fields: {} },
      };
    default:
      return null;
  }
}

export function NewStepButton({
  busy,
  existing,
  onAdd,
}: {
  busy: boolean;
  existing: WorkflowStep[];
  onAdd: (step: WorkflowStep) => void;
}) {
  const [type, setType] = useState("");

  const add = () => {
    const def = stepTypeDef(type);
    if (!def) return;
    const taken = new Set(existing.map((s) => s.id));
    const base = type.replace(/[^a-z]+/g, "_").replace(/^_+|_+$/g, "");
    let id = base;
    for (let i = 2; taken.has(id); i += 1) id = `${base}_${i}`;
    const step = blankStep(type, id, def.label);
    if (step) onAdd(step);
    setType("");
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Combobox
        options={WORKFLOW_STEP_TYPES_CATALOG.map((t) => ({
          value: t.type,
          label: t.label,
        }))}
        value={type}
        onValueChange={setType}
        placeholder="Tipo do passo"
        aria-label="Tipo do passo novo"
        className="w-64"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1"
        disabled={busy || type === ""}
        onClick={add}
      >
        <Plus className="size-4" /> Adicionar passo
      </Button>
    </div>
  );
}

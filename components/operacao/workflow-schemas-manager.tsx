// Versão: 1.0 | Data: 08/09/2026
// Configuração dos esquemas de Workflow (0125) — visão do ADMIN.
//
// Duas abas: "Esquemas" (o que dá para configurar) e "Fluxos do sistema" (o que
// já roda sozinho, somente leitura). A segunda existe porque essa lista não
// tinha resposta em lugar nenhum: as automações estavam espalhadas por tick de
// cron, hook pós-sync e fila em background, cada uma configurada numa tela
// diferente — e algumas sem tela nenhuma.
//
// O que se edita num esquema: quais campos o formulário PERGUNTA (e com que
// rótulo, obrigatoriedade e valor padrão), a ordem deles, e quais passos rodam.
// O que NÃO se edita aqui: as referências entre passos — trocar
// {{steps.criar_empresa.id}} por outra coisa é mudar o fluxo, não configurá-lo,
// e o parse fail-closed do servidor é quem guarda essa fronteira.
//
// Save otimista em background (§4.10): estado local ANTES do await, action com
// { revalidate: false }, erro reverte o controle e o refresh debounced
// reconcilia.
"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink, Eye, EyeOff } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import { stepTypeDef } from "@/lib/workflow/registry";
import type { SystemFlow } from "@/lib/workflow/system-schemas";
import type {
  WorkflowDefinition,
  WorkflowFormField,
  WorkflowStep,
} from "@/lib/workflow/types";
import { saveWorkflowSchema } from "@/app/(app)/operacao/workflow/actions";

export interface ManagedSchema {
  id: string;
  key: string;
  label: string;
  description: string | null;
  enabled: boolean;
  definition: WorkflowDefinition | null;
}

export interface ConnectionStatus {
  key: string;
  label: string;
  envName: string;
  description: string;
  configured: boolean;
}

type Tab = "esquemas" | "sistema";

function moved<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(index, 1);
  copy.splice(target, 0, item);
  return copy;
}

function FieldRow({
  field,
  index,
  total,
  busy,
  onChange,
  onMove,
}: {
  field: WorkflowFormField;
  index: number;
  total: number;
  busy: boolean;
  onChange: (patch: Partial<WorkflowFormField>) => void;
  onMove: (delta: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        disabled={busy}
        onClick={() => onChange({ visible: !field.visible })}
        aria-label={field.visible ? "Ocultar do formulário" : "Mostrar no formulário"}
        title={field.visible ? "Ocultar do formulário" : "Mostrar no formulário"}
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
      </div>
    </div>
  );
}

function StepRow({
  step,
  busy,
  connection,
  onToggle,
}: {
  step: WorkflowStep;
  busy: boolean;
  connection: ConnectionStatus | null;
  onToggle: (enabled: boolean) => void;
}) {
  const def = stepTypeDef(step.type);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
      <Checkbox
        checked={step.enabled}
        disabled={busy}
        onCheckedChange={(v) => onToggle(v === true)}
        aria-label={`Ligar o passo ${step.label}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{step.label}</span>
          {connection ? (
            <Badge
              variant={connection.configured ? "outline" : "destructive"}
              className="text-xs"
            >
              {connection.envName}
              {connection.configured ? " ✓" : " ausente"}
            </Badge>
          ) : null}
        </div>
        {def ? (
          <p className="text-muted-foreground text-xs">{def.description}</p>
        ) : null}
      </div>
    </div>
  );
}

function SchemaCard({
  schema,
  connections,
}: {
  schema: ManagedSchema;
  connections: ConnectionStatus[];
}) {
  const { save, pendingKeys } = useBackgroundSave();
  const [def, setDef] = useState<WorkflowDefinition | null>(schema.definition);
  const [enabled, setEnabled] = useState(schema.enabled);
  const busy = pendingKeys.has(schema.id);

  const persist = (next: WorkflowDefinition, revertTo: WorkflowDefinition) => {
    setDef(next);
    save({
      key: schema.id,
      context: "Não foi possível salvar o esquema",
      action: () =>
        saveWorkflowSchema(
          schema.id,
          { definition: next },
          { revalidate: false }
        ),
      revert: () => setDef(revertTo),
    });
  };

  if (!def) {
    return (
      <div className="rounded-md border p-4">
        <p className="font-medium">{schema.label}</p>
        <p className="text-destructive text-sm">
          A configuração deste esquema está inválida e não pode ser executada.
          Restaure-a a partir do banco ou recrie o esquema.
        </p>
      </div>
    );
  }

  const connByKey = new Map(connections.map((c) => [c.key, c]));

  return (
    <div className="flex flex-col gap-4 rounded-md border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{schema.label}</p>
          {schema.description ? (
            <p className="text-muted-foreground text-sm">{schema.description}</p>
          ) : null}
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <Checkbox
            checked={enabled}
            disabled={busy}
            onCheckedChange={(v) => {
              const next = v === true;
              const prev = enabled;
              setEnabled(next);
              save({
                key: schema.id,
                context: "Não foi possível salvar o esquema",
                action: () =>
                  saveWorkflowSchema(
                    schema.id,
                    { enabled: next },
                    { revalidate: false }
                  ),
                revert: () => setEnabled(prev),
              });
            }}
          />
          Ativo
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-muted-foreground text-xs uppercase">
          Campos do formulário
        </Label>
        <p className="text-muted-foreground text-xs">
          O formulário é uma lista única — quem lança não vê os passos. Um campo
          oculto continua valendo no fluxo com o valor padrão dele.
        </p>
        {def.form.fields.map((field, i) => (
          <FieldRow
            key={field.key}
            field={field}
            index={i}
            total={def.form.fields.length}
            busy={busy}
            onChange={(patch) => {
              const next = {
                ...def,
                form: {
                  fields: def.form.fields.map((f) =>
                    f.key === field.key ? { ...f, ...patch } : f
                  ),
                },
              };
              persist(next, def);
            }}
            onMove={(delta) => {
              const reordered = moved(def.form.fields, i, delta).map(
                (f, idx) => ({ ...f, order: idx })
              );
              persist({ ...def, form: { fields: reordered } }, def);
            }}
          />
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-muted-foreground text-xs uppercase">
          Passos
        </Label>
        <p className="text-muted-foreground text-xs">
          Rodam nesta ordem, e cada um aproveita o que o anterior devolveu.
          Desligar um passo faz os seguintes seguirem sem o resultado dele.
        </p>
        {def.steps.map((step) => (
          <StepRow
            key={step.id}
            step={step}
            busy={busy}
            connection={
              step.type === "bitrix.entity.add"
                ? (connByKey.get(step.connection) ?? null)
                : null
            }
            onToggle={(next) => {
              const updated = {
                ...def,
                steps: def.steps.map((s) =>
                  s.id === step.id ? { ...s, enabled: next } : s
                ),
              };
              persist(updated, def);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function SystemFlowCard({ flow }: { flow: SystemFlow }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{flow.label}</p>
        <Badge variant="outline" className="text-xs">
          {flow.trigger}
        </Badge>
      </div>
      <p className="text-muted-foreground text-sm">{flow.description}</p>
      <ol className="ml-4 list-decimal text-sm">
        {flow.steps.map((s) => (
          <li key={s.label}>
            <span className="font-medium">{s.label}</span>{" "}
            <span className="text-muted-foreground">— {s.detail}</span>
          </li>
        ))}
      </ol>
      <p className="text-muted-foreground text-xs">
        Configura-se em: {flow.configuredWhere}{" "}
        {flow.configuredAt ? (
          <Link
            href={flow.configuredAt}
            className="text-primary inline-flex items-center gap-1 hover:underline"
          >
            abrir <ExternalLink className="size-3" />
          </Link>
        ) : null}
      </p>
    </div>
  );
}

export function WorkflowSchemasManager({
  schemas,
  connections,
  systemFlows,
}: {
  schemas: ManagedSchema[];
  connections: ConnectionStatus[];
  systemFlows: SystemFlow[];
}) {
  const [tab, setTab] = useState<Tab>("esquemas");

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="flex gap-2">
        {(
          [
            ["esquemas", "Esquemas"],
            ["sistema", "Fluxos do sistema"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <Button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            variant={tab === key ? "default" : "outline"}
            size="sm"
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {tab === "esquemas" ? (
        <div className="flex flex-col gap-4">
          {schemas.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nenhum esquema nesta organização.
            </p>
          ) : (
            schemas.map((s) => (
              <SchemaCard key={s.id} schema={s} connections={connections} />
            ))
          )}
          <div className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
            As credenciais dos sistemas externos continuam nas variáveis de
            ambiente do deploy — o esquema só aponta para elas pelo nome, e o
            valor nunca é exibido nem gravado no banco.
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            O que o sistema já roda sozinho. Estes fluxos não são executados
            pelo motor de esquemas — a lista existe para saber que eles
            existem e onde se mexe em cada um.
          </p>
          {systemFlows.map((f) => (
            <SystemFlowCard key={f.key} flow={f} />
          ))}
        </div>
      )}
    </div>
  );
}

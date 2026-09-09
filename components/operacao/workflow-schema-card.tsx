// Versão: 1.0 | Data: 09/09/2026
// O CARD DE UM ESQUEMA — e, desde esta versão, o construtor dele.
//
// Extraído do manager (que ficou com a lista e as abas) porque deixou de ser um
// card: aqui se cria o formulário campo a campo, se monta a sequência de passos,
// se duplica e se exclui. Antes era só um painel de liga/desliga sobre uma
// definição que alguém tinha escrito por fora.
//
// O save continua sendo `saveWorkflowSchema`, que REPARSEIA com
// `parseWorkflowDefinition` antes de gravar: o construtor pode montar o que
// quiser: quem decide o que entra no banco é o fail-closed do servidor. Por
// isso o editor não duplica validação — ele mostra o erro que o save devolveu.
//
// Save otimista em background (§4.10): estado local ANTES do await, action com
// { revalidate: false }, erro reverte o controle e o refresh reconcilia.
"use client";

import { useCallback, useState } from "react";
import { Check, Copy, ExternalLink, Trash2 } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import { formSchemaHref } from "@/lib/operacao/form-routes";
import {
  parseWorkflowDefinition,
  type WorkflowDefinition,
} from "@/lib/workflow/types";
import {
  createWorkflowSchema,
  deleteWorkflowSchema,
  loadBitrixEntityFields,
  saveWorkflowSchema,
} from "@/app/(app)/operacao/workflow/actions";
import { FieldRow, NewFieldButton } from "./workflow-field-editor";
import {
  NewStepButton,
  StepRow,
  type StepSourceOption,
} from "./workflow-step-editor";

export interface ManagedSchema {
  id: string;
  key: string;
  label: string;
  description: string | null;
  enabled: boolean;
  triggerKind: "form" | "automacao";
  showCard: boolean;
  definition: WorkflowDefinition | null;
}

export interface ConnectionStatus {
  key: string;
  label: string;
  envName: string;
  description: string;
  configured: boolean;
}

function moved<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(index, 1);
  copy.splice(target, 0, item);
  return copy;
}

/**
 * Onde o esquema foi parar. A URL absoluta é montada no CLIENTE
 * (window.location.origin): o servidor não conhece o domínio pelo qual o
 * usuário chegou, e um link com o host errado é pior que link nenhum.
 */
function FormDestination({
  schemaKey,
  enabled,
}: {
  schemaKey: string;
  enabled: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const path = formSchemaHref(schemaKey);

  const copy = async () => {
    try {
      const origin =
        typeof window === "undefined" ? "" : window.location.origin;
      await navigator.clipboard.writeText(`${origin}${path}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard bloqueado (http, permissão): o caminho segue visível ao
      // lado para seleção manual — nada de toast de erro por isso.
    }
  };

  return (
    <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md border p-2">
      <span className="text-muted-foreground text-xs">
        {enabled ? "Disponível em" : "Ficará em"}
      </span>
      <code className="text-xs">{path}</code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2"
        onClick={copy}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? "Copiado" : "Copiar link"}
      </Button>
      {enabled ? (
        <Link
          href={path}
          className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
        >
          abrir <ExternalLink className="size-3" />
        </Link>
      ) : null}
    </div>
  );
}

export function SchemaCard({
  schema,
  connections,
  sources,
}: {
  schema: ManagedSchema;
  connections: ConnectionStatus[];
  /** Bases da org — destino do passo que grava registro local. */
  sources: StepSourceOption[];
}) {
  const { save, pendingKeys } = useBackgroundSave();
  const [def, setDef] = useState<WorkflowDefinition | null>(schema.definition);
  const [enabled, setEnabled] = useState(schema.enabled);
  const [showCard, setShowCard] = useState(schema.showCard);
  const [label, setLabel] = useState(schema.label);
  const [description, setDescription] = useState(schema.description ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Rascunho que ainda não fecha: passo sem alvo, base não escolhida…
  const [pendente, setPendente] = useState(false);
  const [gone, setGone] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // A lista de campos do portal é buscada pelo passo que estiver aberto; o
  // callback vive aqui para os passos compartilharem uma função estável.
  const loadBitrixFields = useCallback(async (entity: string) => {
    const res = await loadBitrixEntityFields(entity);
    return res.fields;
  }, []);
  const busy = pendingKeys.has(schema.id);
  const isForm = schema.triggerKind === "form";

  /**
   * Grava a definição — mas SÓ quando ela está inteira.
   *
   * Montar um fluxo é incremental: um passo nasce sem alvo, e o parse
   * fail-closed recusa (com razão) um `record.create` sem base ou um
   * `bitrix.entity.update` sem id. Mandar isso ao servidor a cada tecla
   * encheria a tela de "configuração inválida" enquanto a pessoa trabalha. O
   * editor então segura o rascunho na tela e avisa o que falta; quando a
   * definição passa no MESMO parse do servidor, ela é salva.
   *
   * O parse é puro e client-safe: isto não é uma régua paralela — é a mesma.
   */
  const persist = (next: WorkflowDefinition, revertTo: WorkflowDefinition) => {
    setDef(next);
    setErro(null);
    if (!parseWorkflowDefinition(next)) {
      setPendente(true);
      return;
    }
    setPendente(false);
    save({
      key: schema.id,
      context: "Não foi possível salvar o esquema",
      action: async () => {
        const res = await saveWorkflowSchema(
          schema.id,
          { definition: next },
          { revalidate: false }
        );
        // O parse fail-closed é a régua: em vez de esconder a recusa num toast
        // genérico, ela aparece no card, ao lado do que a causou.
        if (!res.ok && res.message) setErro(res.message);
        return res;
      },
      revert: () => setDef(revertTo),
    });
  };

  const patch = (
    p: Parameters<typeof saveWorkflowSchema>[1],
    revert: () => void
  ) =>
    save({
      key: schema.id,
      context: "Não foi possível salvar o esquema",
      action: () => saveWorkflowSchema(schema.id, p, { revalidate: false }),
      revert,
    });

  if (gone) return null;

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
        <div className="flex min-w-56 flex-1 flex-col gap-1">
          <Input
            className="max-w-md font-medium"
            value={label}
            disabled={busy}
            onChange={(e) => {
              const prev = label;
              setLabel(e.target.value);
              patch({ label: e.target.value }, () => setLabel(prev));
            }}
            aria-label="Nome do fluxo"
          />
          <Input
            className="max-w-md text-sm"
            value={description}
            disabled={busy}
            placeholder="Para que serve (opcional)"
            onChange={(e) => {
              const prev = description;
              setDescription(e.target.value);
              patch({ description: e.target.value }, () => setDescription(prev));
            }}
            aria-label="Descrição do fluxo"
          />
          <code className="text-muted-foreground text-xs">{schema.key}</code>
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

      {isForm ? (
        <div className="flex flex-col gap-2">
          <FormDestination schemaKey={schema.key} enabled={enabled} />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={showCard}
              disabled={busy}
              onCheckedChange={(v) => {
                const next = v === true;
                const prev = showCard;
                setShowCard(next);
                save({
                  key: schema.id,
                  context: "Não foi possível salvar o esquema",
                  action: () =>
                    saveWorkflowSchema(
                      schema.id,
                      { showCard: next },
                      { revalidate: false }
                    ),
                  revert: () => setShowCard(prev),
                });
              }}
            />
            Aparece como card em Operação
            <span className="text-muted-foreground text-xs">
              (desmarcado, existe só pelo link)
            </span>
          </label>
        </div>
      ) : null}

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
            onRemove={() => {
              // Ref órfã resolve vazio e cala o erro — avisa antes de deixar.
              const usado = def.steps.some((st) =>
                JSON.stringify(st.params).includes(`{{form.${field.key}}}`)
              );
              if (
                usado &&
                !window.confirm(
                  `O campo "${field.label}" é usado por algum passo. Removê-lo deixa aquele passo sem esse valor. Remover mesmo assim?`
                )
              ) {
                return;
              }
              persist(
                {
                  ...def,
                  form: {
                    fields: def.form.fields
                      .filter((f) => f.key !== field.key)
                      .map((f, idx) => ({ ...f, order: idx })),
                  },
                },
                def
              );
            }}
          />
        ))}
        <NewFieldButton
          busy={busy}
          existing={def.form.fields}
          onAdd={(field) =>
            persist({ ...def, form: { fields: [...def.form.fields, field] } }, def)
          }
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-muted-foreground text-xs uppercase">
          Passos
        </Label>
        <p className="text-muted-foreground text-xs">
          Rodam nesta ordem, e cada um aproveita o que o anterior devolveu.
          Desligar um passo faz os seguintes seguirem sem o resultado dele.
        </p>
        {def.steps.map((step, i) => (
          <StepRow
            key={step.id}
            step={step}
            index={i}
            total={def.steps.length}
            busy={busy}
            formFields={def.form.fields}
            previousSteps={def.steps.slice(0, i)}
            sources={sources}
            connectionLabel={
              step.type === "bitrix.entity.add" ||
              step.type === "bitrix.entity.update"
                ? (connByKey.get(step.connection) ?? null)
                : null
            }
            loadBitrixFields={loadBitrixFields}
            onChange={(next) =>
              persist(
                {
                  ...def,
                  steps: def.steps.map((s) => (s.id === step.id ? next : s)),
                },
                def
              )
            }
            onMove={(delta) =>
              persist({ ...def, steps: moved(def.steps, i, delta) }, def)
            }
            onRemove={() => {
              const referenciado = def.steps.some(
                (s) =>
                  s.type === "record.create" &&
                  s.params.linkSourceIdFrom === step.id
              );
              if (
                referenciado &&
                !window.confirm(
                  `Outro passo usa o resultado de "${step.label}". Removê-lo faria o registro nascer sem vínculo com o CRM. Remover mesmo assim?`
                )
              ) {
                return;
              }
              persist(
                {
                  ...def,
                  steps: def.steps
                    .filter((s) => s.id !== step.id)
                    // O vínculo órfão é recusado pelo parse: limpar aqui evita
                    // um save que o servidor devolveria como inválido.
                    .map((s) =>
                      s.type === "record.create" &&
                      s.params.linkSourceIdFrom === step.id
                        ? {
                            ...s,
                            params: { ...s.params, linkSourceIdFrom: undefined },
                          }
                        : s
                    ),
                },
                def
              );
            }}
          />
        ))}
        <NewStepButton
          busy={busy}
          existing={def.steps}
          onAdd={(step) => persist({ ...def, steps: [...def.steps, step] }, def)}
        />
      </div>

      {pendente ? (
        <p className="text-amber-600 text-sm">
          Rascunho não salvo: algum passo ainda está incompleto (base de destino,
          id da entidade a alterar ou nenhum campo escolhido). Complete-o e a
          alteração é gravada sozinha.
        </p>
      ) : null}
      {erro ? (
        <p role="alert" className="text-destructive text-sm">
          {erro}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            save({
              key: schema.id,
              context: "Não foi possível duplicar o fluxo",
              action: () =>
                createWorkflowSchema({
                  label: `${label} (cópia)`,
                  triggerKind: schema.triggerKind,
                  description: description || undefined,
                  copyFrom: schema.id,
                }),
            })
          }
        >
          Duplicar
        </Button>
        {confirmDelete ? (
          <>
            <span className="text-destructive text-sm">
              Excluir “{label}”? As execuções já registradas ficam no histórico.
            </span>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => {
                setGone(true);
                save({
                  key: schema.id,
                  context: "Não foi possível excluir o fluxo",
                  action: () => deleteWorkflowSchema(schema.id),
                  revert: () => setGone(false),
                });
              }}
            >
              Excluir
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(false)}
            >
              Cancelar
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive gap-1"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-4" /> Excluir
          </Button>
        )}
      </div>
    </div>
  );
}


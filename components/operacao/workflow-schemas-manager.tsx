// Versão: 3.1 | Data: 09/09/2026
// v3.1 (09/09/2026): aba EXECUÇÕES — o histórico que a 0125 gravava desde o
//   começo e ninguém via. É lá que a SIMULAÇÃO de um esquema mostra o payload
//   que iria para o destino, e é de lá que sai o "Tentar de novo" que devolve
//   um registro à fila depois de uma falha.
// v3.0 (08/09/2026): aba AUTOMAÇÕES — todas as regras da organização num lugar
//   só (de quadro e de Base, 0127). Até aqui uma regra só era visível de
//   dentro do quadro dela, e as de Base não têm quadro para abrir: "o que este
//   sistema mexe sozinho nos meus registros?" não tinha resposta. É uma VISÃO
//   — ligar/desligar e executar agora chamam `saveAutomation`/
//   `runAutomationsNow`, os MESMOS choke points do painel do quadro, que
//   continua existindo. Duas superfícies, um núcleo.
// v2.0 (08/09/2026): a fábrica passa a dizer ONDE cada esquema foi parar. Um
//   formulário ganha o cabeçalho de destino com a URL COPIÁVEL — é esse link
//   que o gestor manda para o time ("cole e lance o lead"), e sem ele a pessoa
//   teria que navegar pela configuração até achar a própria ferramenta. O
//   toggle "Aparece no hub" separa "tem página" de "polui a aba Operação de
//   todo mundo": formulário de uso pontual existe só pelo link.
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
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Play,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WorkflowRunsList } from "@/components/operacao/workflow-runs-list";
import type { WorkflowRunRow } from "@/lib/workflow/runs";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import { formSchemaHref } from "@/lib/operacao/form-routes";
import {
  runAutomationsNow,
  saveAutomation,
} from "@/lib/kanban/automations/actions";
import {
  automationActionLabel,
  automationSummary,
} from "@/lib/kanban/automations/summary";
import type { OrgAutomationRow } from "@/lib/workflow/automations-overview";
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

type Tab = "esquemas" | "automacoes" | "execucoes" | "sistema";

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
  const [showCard, setShowCard] = useState(schema.showCard);
  const busy = pendingKeys.has(schema.id);
  const isForm = schema.triggerKind === "form";

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

function AutomationRowCard({ row }: { row: OrgAutomationRow }) {
  const { save, pendingKeys } = useBackgroundSave();
  const [enabled, setEnabled] = useState(row.enabled);
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const busy = pendingKeys.has(row.id);

  const runNow = async () => {
    setRunning(true);
    setRunMessage(null);
    const res = await runAutomationsNow(row.owner);
    setRunning(false);
    setRunMessage(res.message ?? (res.ok ? "Executada." : "Falhou."));
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{row.name || "Sem nome"}</span>
            <Badge variant="outline" className="text-xs">
              {row.ownerLabel}
            </Badge>
            {row.rule ? (
              <Badge variant="outline" className="text-xs">
                {automationActionLabel(row.rule)}
              </Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">
            {row.rule
              ? automationSummary(row.rule)
              : "Configuração inválida — esta regra não roda."}
          </p>
        </div>

        <label className="flex shrink-0 items-center gap-2 text-sm">
          <Checkbox
            checked={enabled}
            disabled={busy}
            onCheckedChange={(v) => {
              const next = v === true;
              const prev = enabled;
              if (!row.rule) return;
              setEnabled(next);
              save({
                key: row.id,
                context: "Não foi possível salvar a automação",
                action: () =>
                  saveAutomation(row.owner, {
                    id: row.id,
                    name: row.name,
                    enabled: next,
                    position: row.position,
                    rule: row.rule,
                  }),
                revert: () => setEnabled(prev),
              });
            }}
          />
          Ativa
        </label>
      </div>

      {row.lastError ? (
        <p className="text-destructive flex items-start gap-1.5 text-xs">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {row.lastError}
        </p>
      ) : null}

      <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
        <span>
          {row.lastRunAt
            ? `Última execução: ${new Date(row.lastRunAt).toLocaleString("pt-BR")} · ${row.lastActionCount} ação(ões)`
            : "Ainda não rodou."}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2"
          disabled={running || !row.rule}
          onClick={runNow}
        >
          <Play className="size-3.5" />
          {running ? "Executando…" : "Executar agora"}
        </Button>
        {row.ownerHref ? (
          <Link
            href={row.ownerHref}
            className="text-primary inline-flex items-center gap-1 hover:underline"
          >
            abrir o quadro <ExternalLink className="size-3" />
          </Link>
        ) : null}
        {runMessage ? <span>{runMessage}</span> : null}
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
  automations,
  runs,
}: {
  schemas: ManagedSchema[];
  connections: ConnectionStatus[];
  systemFlows: SystemFlow[];
  /** Todas as regras da org — de quadro e de Base. */
  automations: OrgAutomationRow[];
  runs: WorkflowRunRow[];
}) {
  const [tab, setTab] = useState<Tab>("esquemas");

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="flex gap-2">
        {(
          [
            ["esquemas", "Esquemas"],
            ["automacoes", `Automações (${automations.length})`],
            ["execucoes", "Execuções"],
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

      {tab === "execucoes" ? (
        <WorkflowRunsList
          runs={runs}
          schemaLabels={Object.fromEntries(schemas.map((s) => [s.key, s.label]))}
        />
      ) : tab === "automacoes" ? (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            O que o sistema mexe sozinho nos seus registros. Regras de quadro
            continuam editáveis dentro do quadro; as de base vivem aqui. As com
            erro aparecem primeiro.
          </p>
          {automations.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nenhuma automação nesta organização.
            </p>
          ) : (
            automations.map((a) => <AutomationRowCard key={a.id} row={a} />)
          )}
        </div>
      ) : tab === "esquemas" ? (
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

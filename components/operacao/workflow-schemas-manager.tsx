// Versão: 4.0 | Data: 09/09/2026
// v4.0 (09/09/2026): DUAS abas — Esquemas e Execuções. Automações e fluxos do
//   sistema deixam de ser abas e viram LINHAS da mesma lista, com filtro por
//   tipo: um fluxo é um fluxo, e o que muda entre eles é quem dispara e onde se
//   edita, não em que aba mora. Entram também os botões que faltavam — "Novo
//   fluxo" (a fábrica não fabricava) e "Nova automação", a única porta de
//   entrada para regra de Base. O card do esquema saiu para
//   workflow-schema-card.tsx, que virou o construtor.
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
import { ExternalLink, Play, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkflowRunsList } from "@/components/operacao/workflow-runs-list";
import {
  SchemaCard,
  type ConnectionStatus,
  type ManagedSchema,
} from "@/components/operacao/workflow-schema-card";
import { NewAutomationButton } from "@/components/operacao/workflow-new-automation";
import type { StepSourceOption } from "@/components/operacao/workflow-step-editor";
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import {
  runAutomationsNow,
  saveAutomation,
} from "@/lib/kanban/automations/actions";
import {
  automationActionLabel,
  automationSummary,
} from "@/lib/kanban/automations/summary";
import type { OrgAutomationRow } from "@/lib/workflow/automations-overview";
import {
  buildWorkflowCatalog,
  countByFilter,
  filterWorkflowCatalog,
  WORKFLOW_CATALOG_FILTER_LABELS,
  WORKFLOW_CATALOG_FILTERS,
  type WorkflowCatalogFilter,
} from "@/lib/workflow/catalog";
import type { WorkflowRunRow } from "@/lib/workflow/runs";
import type { WorkflowSchemaRow } from "@/lib/workflow/schemas";
import type { SystemFlow } from "@/lib/workflow/system-schemas";
import { createWorkflowSchema } from "@/app/(app)/operacao/workflow/actions";

export type { ConnectionStatus, ManagedSchema };

type Tab = "esquemas" | "execucoes";

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
  sources,
}: {
  schemas: ManagedSchema[];
  connections: ConnectionStatus[];
  systemFlows: SystemFlow[];
  /** Todas as regras da org — de quadro e de Base. */
  automations: OrgAutomationRow[];
  runs: WorkflowRunRow[];
  /** Bases da org: destino de passo e dono de automação sem quadro. */
  sources: StepSourceOption[];
}) {
  const [tab, setTab] = useState<Tab>("esquemas");
  const [filter, setFilter] = useState<WorkflowCatalogFilter>("todos");
  const { save, pendingKeys } = useBackgroundSave();
  const [novoAberto, setNovoAberto] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoGatilho, setNovoGatilho] =
    useState<ManagedSchema["triggerKind"]>("form");

  const catalog = buildWorkflowCatalog(
    schemas as unknown as WorkflowSchemaRow[],
    automations,
    systemFlows
  );
  const counts = countByFilter(catalog);
  const visible = filterWorkflowCatalog(catalog, filter);
  const criando = pendingKeys.has("novo");

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="flex gap-2">
        {(
          [
            ["esquemas", `Esquemas (${catalog.length})`],
            ["execucoes", "Execuções"],
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
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            Tudo que este sistema faz sozinho ou por um formulário. Os que você
            cria e edita aqui, as automações (que também se editam dentro do
            quadro) e os fluxos que já vêm prontos. O que está com erro aparece
            primeiro.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {WORKFLOW_CATALOG_FILTERS.map((f) => (
              <Button
                key={f}
                type="button"
                variant={filter === f ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(f)}
              >
                {WORKFLOW_CATALOG_FILTER_LABELS[f]} ({counts[f]})
              </Button>
            ))}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <NewAutomationButton sources={sources} />
              <Button
                type="button"
                size="sm"
                className="gap-1"
                disabled={criando}
                onClick={() => setNovoAberto((v) => !v)}
              >
                <Plus className="size-4" /> Novo fluxo
              </Button>
            </div>
          </div>

          {novoAberto ? (
            <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
              <div className="flex min-w-56 flex-1 flex-col gap-1">
                <Label className="text-xs">Nome do fluxo</Label>
                <Input
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  placeholder="Ex.: Criação de lead"
                  aria-label="Nome do fluxo novo"
                />
              </div>
              <div className="flex w-56 flex-col gap-1">
                <Label className="text-xs">O que dispara</Label>
                <Combobox
                  options={[
                    { value: "form", label: "Uma pessoa preenche (formulário)" },
                    { value: "automacao", label: "Uma automação (sem tela)" },
                  ]}
                  value={novoGatilho}
                  onValueChange={(v) =>
                    setNovoGatilho(v as ManagedSchema["triggerKind"])
                  }
                  searchable={false}
                  aria-label="Gatilho do fluxo novo"
                />
              </div>
              <Button
                type="button"
                size="sm"
                disabled={criando || novoNome.trim() === ""}
                onClick={() => {
                  const label = novoNome.trim();
                  setNovoNome("");
                  setNovoAberto(false);
                  save({
                    key: "novo",
                    context: "Não foi possível criar o fluxo",
                    action: () =>
                      createWorkflowSchema({
                        label,
                        triggerKind: novoGatilho,
                      }),
                  });
                }}
              >
                Criar
              </Button>
              <p className="text-muted-foreground w-full text-xs">
                O fluxo nasce DESLIGADO e vazio: monte os campos e os passos, e
                só então ligue. Um formulário ligado já fica acessível pelo link.
              </p>
            </div>
          ) : null}

          {visible.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nada aqui com este filtro.
            </p>
          ) : (
            visible.map((item) =>
              item.kind === "schema" ? (
                <SchemaCard
                  key={item.id}
                  schema={item.schema as unknown as ManagedSchema}
                  connections={connections}
                  sources={sources}
                />
              ) : item.kind === "rule" ? (
                <AutomationRowCard key={item.id} row={item.rule} />
              ) : (
                <SystemFlowCard key={item.id} flow={item.flow} />
              )
            )
          )}

          <div className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
            As credenciais dos sistemas externos continuam nas variáveis de
            ambiente do deploy — o esquema só aponta para elas pelo nome, e o
            valor nunca é exibido nem gravado no banco.
          </div>
        </div>
      )}
    </div>
  );
}

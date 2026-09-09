// Versão: 1.0 | Data: 09/09/2026
// Aba EXECUÇÕES do Workflow: o histórico que a 0125 já gravava e ninguém via.
//
// Duas coisas moram aqui e em nenhum outro lugar: a prévia do que uma
// SIMULAÇÃO faria (o payload por passo, com `#simulado:` onde entraria o id de
// um passo anterior) e o "Tentar de novo", que solta a trava de um registro
// depois que alguém resolveu a causa da falha. Liberar não reexecuta: devolve o
// registro à fila e quem executa continua sendo o tick.
"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, FlaskConical } from "lucide-react";

import { retryWorkflowRun } from "@/app/(app)/operacao/workflow/runs-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import { runCanRetry, type WorkflowRunRow } from "@/lib/workflow/runs";

const STATUS_LABEL: Record<WorkflowRunRow["status"], string> = {
  // 'iniciado' é execução reivindicada sem desfecho gravado — o processo morreu
  // no meio. Dizer "interrompido" é honesto: não se sabe o que chegou lá.
  iniciado: "Interrompido",
  ok: "Concluída",
  partial: "Incompleta",
  error: "Falhou",
};

function StatusIcon({ run }: { run: WorkflowRunRow }) {
  if (run.mode === "simulado") {
    return <FlaskConical className="text-muted-foreground size-4" aria-hidden />;
  }
  if (run.status === "ok") {
    return <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />;
  }
  if (run.status === "iniciado") {
    return <Clock className="size-4 text-amber-600" aria-hidden />;
  }
  return <AlertTriangle className="text-destructive size-4" aria-hidden />;
}

function RunCard({
  run,
  label,
}: {
  run: WorkflowRunRow;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [released, setReleased] = useState(run.releasedAt != null);
  const { save, pendingKeys } = useBackgroundSave();
  const busy = pendingKeys.has(run.id);

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusIcon run={run} />
        <span className="text-sm font-medium">{label}</span>
        {run.mode === "simulado" ? (
          <Badge variant="outline">Simulação</Badge>
        ) : null}
        <Badge variant={run.status === "ok" ? "secondary" : "outline"}>
          {STATUS_LABEL[run.status]}
        </Badge>
        <Badge variant="outline">
          {run.automationRuleId ? "Automação" : "Formulário"}
        </Badge>
        <span className="text-muted-foreground ml-auto text-xs">
          {new Date(run.createdAt).toLocaleString("pt-BR")}
        </span>
      </div>

      {run.error ? (
        <p className="text-destructive mt-2 text-xs">{run.error}</p>
      ) : null}

      {released ? (
        <p className="text-muted-foreground mt-2 text-xs">
          Registro devolvido à fila — a próxima rodada tenta de novo.
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {run.steps.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Ocultar passos" : `Ver passos (${run.steps.length})`}
          </Button>
        ) : null}
        {!released && runCanRetry(run) ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              // Otimista ANTES do await; a falha reverte só este controle.
              setReleased(true);
              save({
                key: run.id,
                revert: () => setReleased(false),
                action: () => retryWorkflowRun(run.id, { revalidate: false }),
                context: "liberar a execução",
              });
            }}
          >
            Tentar de novo
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-2 flex flex-col gap-2">
          {run.steps.map((s) => (
            <div key={s.id} className="bg-muted/40 rounded p-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.label}</span>
                <span className="text-muted-foreground">{s.type}</span>
                {s.skipped ? <Badge variant="outline">Pulado</Badge> : null}
                {s.outputId ? (
                  <span className="text-muted-foreground">id {s.outputId}</span>
                ) : null}
              </div>
              {s.error ? <p className="text-destructive mt-1">{s.error}</p> : null}
              {s.skippedFields.length > 0 ? (
                <p className="text-muted-foreground mt-1">
                  Campos não enviados: {s.skippedFields.join(", ")}
                </p>
              ) : null}
              {s.payload ? (
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(s.payload, null, 2)}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function WorkflowRunsList({
  runs,
  schemaLabels,
}: {
  runs: WorkflowRunRow[];
  /** chave do esquema → rótulo (o histórico sobrevive ao esquema apagado). */
  schemaLabels: Record<string, string>;
}) {
  if (runs.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nenhuma execução registrada ainda.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        O que já rodou — por formulário ou por regra. Uma simulação mostra o
        payload que <em>iria</em> para o destino, sem ter enviado nada. Execução
        que falhou não se repete sozinha: resolva a causa e use “Tentar de novo”
        para devolver aquele registro à fila.
      </p>
      {runs.map((r) => (
        <RunCard
          key={r.id}
          run={r}
          label={schemaLabels[r.schemaKey] ?? r.schemaKey}
        />
      ))}
    </div>
  );
}

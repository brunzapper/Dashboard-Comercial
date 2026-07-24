// Versão: 1.0 | Data: 24/07/2026
// Log de exibição da conversa com IA — bloco presentacional compartilhado entre
// o sheet da Home (ImportDashboardSheet) e o painel "Editar com IA" do
// dashboard (AiEditPanel). Puro: recebe as entradas prontas; quem persiste/
// monta é o chamador (sheet: estado em memória; painel: dashboard_ai_sessions).

import { cn } from "@/lib/utils";

export interface AiChatEntry {
  kind: "user" | "ok" | "error";
  text: string;
  errors?: string[];
  summary?: string[];
}

export function AiChatLog({
  entries,
  busy = false,
  busyLabel = "Gerando com IA…",
  className,
  ref,
}: {
  entries: AiChatEntry[];
  busy?: boolean;
  busyLabel?: string;
  className?: string;
  /** Ref do contêiner rolável (auto-scroll do painel). React 19: ref é prop. */
  ref?: React.Ref<HTMLDivElement>;
}) {
  if (entries.length === 0 && !busy) return null;
  return (
    <div
      ref={ref}
      className={cn(
        "bg-background/60 flex flex-col gap-2 overflow-y-auto rounded-md border p-2",
        className
      )}
    >
      {entries.map((e, i) => (
        <div key={i} className="text-xs">
          {e.kind === "user" ? (
            <p>
              <span className="font-medium">Você:</span> {e.text}
            </p>
          ) : e.kind === "ok" ? (
            <div className="text-muted-foreground">
              <p className="text-green-700 dark:text-green-500">{e.text}</p>
              {e.summary && e.summary.length > 0 ? (
                <ul className="mt-1 list-disc pl-5">
                  {e.summary.map((s, j) => (
                    <li key={j}>{s}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <div className="text-destructive">
              <p>{e.text}</p>
              {e.errors && e.errors.length > 0 ? (
                <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-5">
                  {e.errors.map((err, j) => (
                    <li key={j}>{err}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>
      ))}
      {busy ? <p className="text-muted-foreground text-xs">{busyLabel}</p> : null}
    </div>
  );
}

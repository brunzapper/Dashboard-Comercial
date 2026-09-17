// Versão: 1.2 | Data: 17/09/2026
// v1.2 (17/09/2026): `busyNotice` — aviso do SISTEMA (hoje: o Gemini rebaixou
//   de modelo por sobrecarga), exibido SEM o rótulo "Raciocínio:". Passar esse
//   texto pelo `busyDetail` teria sido mais barato e estaria errado: a linha do
//   raciocínio atribui ao MODELO o que ele disse, e trocar de degrau é decisão
//   do sistema.
// Log de exibição da conversa com IA — bloco presentacional compartilhado entre
// o sheet da Home (ImportDashboardSheet) e o painel "Editar com IA" do
// dashboard (AiEditPanel). Puro: recebe as entradas prontas; quem persiste/
// monta é o chamador (sheet: estado em memória; painel: dashboard_ai_sessions).
// v1.1: `busyDetail` opcional — raciocínio AO VIVO do modelo exibido sob o
// busyLabel enquanto gera (efêmero; o painel o alimenta pelo stream ai-turn).

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
  busyDetail,
  busyNotice,
  className,
  ref,
}: {
  entries: AiChatEntry[];
  busy?: boolean;
  busyLabel?: string;
  /** Raciocínio ao vivo do modelo (só exibido enquanto busy). */
  busyDetail?: string;
  /** Aviso do sistema sobre a chamada em curso (só exibido enquanto busy). */
  busyNotice?: string;
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
      {busy ? (
        <div className="text-muted-foreground text-xs">
          <p>{busyLabel}</p>
          {busyNotice ? (
            <p className="text-amber-700 mt-1 dark:text-amber-500">
              {busyNotice}
            </p>
          ) : null}
          {busyDetail ? (
            <p className="mt-1 border-l-2 pl-2 whitespace-pre-wrap italic opacity-80">
              <span className="font-medium not-italic">Raciocínio:</span>{" "}
              {busyDetail}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

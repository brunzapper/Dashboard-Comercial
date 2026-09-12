// Versão: 1.0 | Data: 12/09/2026
// Painel dos lançamentos recentes, ao lado do formulário do Workflow.
//
// É client, e não RSC, por um motivo só: ele precisa se atualizar quando o
// formulário ao lado lança um registro. O runner já emite `emitDataChanged` no
// sucesso, então assinar o barramento (`useDataChanged`) resolve sem que os dois
// componentes precisem se conhecer — nem prop, nem `router.refresh()` da página
// inteira.
//
// Recarga de origem BARRAMENTO é SILENCIOSA (§4.10 da arquitetura): a lista
// antiga fica na tela até a nova chegar, sem overlay nem "Atualizando…". O sync
// do Bitrix roda a cada minuto e também alimenta o bus — piscar a cada tick
// leria como defeito. Só a PRIMEIRA carga mostra que está carregando.
//
// O que chega da action já é string formatada (`RecentRecordRow`): nenhum
// registro cru atravessa o boundary, então não há valor de campo restrito para
// vazar no payload.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";

import { loadFormRecentRecords } from "@/app/(app)/operacao/workflow/actions";
import { useDataChanged } from "@/lib/tasks/events";
import type { RecentRecordsResult } from "@/lib/workflow/recent-records";

export function WorkflowRecentPanel({ schemaKey }: { schemaKey: string }) {
  const [data, setData] = useState<RecentRecordsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `loading` nasce TRUE e só é desligado ao fim da primeira carga. Nenhuma
  // recarga posterior o liga de novo: ligar seria um setState síncrono dentro do
  // efeito (que a regra do projeto proíbe) e, pior, faria a lista piscar a cada
  // tick do sync — o barramento é alimentado pelo realtime a cada minuto.
  const [loading, setLoading] = useState(true);
  // Só a recarga pedida no BOTÃO tem feedback (origem = usuário, §4.10).
  const [refreshing, setRefreshing] = useState(false);
  // Evita duas buscas em voo quando vários eventos chegam juntos (o realtime
  // coalesce, mas o lançamento local emite na hora).
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const res = await loadFormRecentRecords(schemaKey);
      if (res.ok) {
        setData(res.data ?? null);
        setError(null);
      } else {
        setError(res.message ?? "Falha ao carregar.");
      }
    } catch {
      setError("Falha ao carregar.");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [schemaKey]);

  // A chamada vai dentro de uma função interna de propósito: nada de setState
  // acontece de forma síncrona na montagem (a regra do projeto barra isso, e
  // com razão — renderização não é lugar de efeito colateral).
  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  useDataChanged((d) => {
    if (d.kind === "record") void load();
  });

  // Fora de efeito: aqui o setState é permitido, e o feedback é devido.
  const onRefreshClick = () => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  };

  // Formulário que não grava registro local: sem painel, sem explicação —
  // não há nada de errado a comunicar.
  if (!loading && !error && !data) return null;

  return (
    <aside className="flex min-w-0 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium">
          {data ? `${data.sourceLabel} — últimos ${data.days} dias` : "Lançamentos recentes"}
        </h3>
        {data ? (
          <button
            type="button"
            onClick={onRefreshClick}
            disabled={refreshing}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs disabled:opacity-60"
            title="Atualizar a lista"
          >
            <RefreshCw
              className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
            Atualizar
          </button>
        ) : null}
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Carregando…</p>
      ) : error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : data && data.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nenhum lançamento nos últimos {data.days} dias.
        </p>
      ) : data ? (
        <>
          <ul className="flex flex-col gap-2">
            {data.rows.map((r) => (
              <li
                key={r.id}
                className="bg-card flex flex-col gap-0.5 rounded-md border p-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 break-words text-sm font-medium">
                    {r.title}
                  </span>
                  {r.url ? (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary inline-flex shrink-0 items-center gap-1 text-xs hover:underline"
                      title="Abrir no CRM"
                    >
                      CRM <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </div>
                <span className="text-muted-foreground text-xs">
                  {r.when}
                  {r.responsible ? ` · ${r.responsible}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {data.truncated ? (
            <p className="text-muted-foreground text-xs">
              Mostrando os {data.rows.length} mais recentes.
            </p>
          ) : null}
        </>
      ) : null}
    </aside>
  );
}

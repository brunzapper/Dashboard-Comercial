// Versão: 1.1 | Data: 09/07/2026
// v1.1 (09/07/2026): Fase 8 — mostra a quebra por entidade (leads vs deals) e as
//   amostras de erro do sync, para diagnosticar "só leads importando".
// Painel de sincronização (admin) na página de Registros: botões de
// Reconciliação (com campo de dias) e Backfill inicial, com status do último
// sync. Sem webhook de saída por ora — a atualização é sob demanda.
"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  backfillAction,
  reconcileAction,
  type SyncActionState,
} from "@/app/(app)/registros/actions";

const initial: SyncActionState = {};

const ENTITY_LABELS: Record<string, string> = {
  lead: "Leads",
  negocio: "Deals",
  venda_site: "Estudo de Fechamentos",
};

function ResultLine({ state }: { state: SyncActionState }) {
  if (!state.message) return null;
  const r = state.result;
  const entities = r ? Object.entries(r.byEntity ?? {}) : [];
  return (
    <div className="flex flex-col gap-1" role="status">
      <p className={state.ok ? "text-muted-foreground text-sm" : "text-destructive text-sm"}>
        {state.message}
        {r
          ? ` (novos: ${r.inserted}, atualizados: ${r.updated}, erros: ${r.errors})`
          : ""}
      </p>
      {entities.length > 0 ? (
        <ul className="text-muted-foreground text-xs">
          {entities.map(([entity, c]) => (
            <li key={entity}>
              {ENTITY_LABELS[entity] ?? entity}: {c.inserted} novo(s), {c.updated}{" "}
              atualizado(s)
              {c.errors > 0 ? `, ${c.errors} erro(s)` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {r && r.errorSamples && r.errorSamples.length > 0 ? (
        <details className="text-xs">
          <summary className="text-destructive cursor-pointer">
            Ver erros ({r.errorSamples.length})
          </summary>
          <ul className="text-muted-foreground mt-1 flex flex-col gap-0.5">
            {r.errorSamples.map((msg, i) => (
              <li key={i} className="font-mono break-all">
                {msg}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function SyncPanel({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  const [reconState, reconAction, reconPending] = useActionState(
    reconcileAction,
    initial
  );
  const [backState, backfillFormAction, backPending] = useActionState(
    backfillAction,
    initial
  );

  const lastSync = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleString("pt-BR")
    : "nunca";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sincronização (Bitrix)</CardTitle>
        <CardDescription>
          Último sync: {lastSync}. Sem webhook por ora — atualize sob demanda.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form action={reconAction} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="days">Reconciliar (dias)</Label>
            <Input
              id="days"
              name="days"
              type="number"
              min={1}
              defaultValue={3}
              className="w-28"
            />
          </div>
          <Button type="submit" disabled={reconPending}>
            {reconPending ? "Reconciliando..." : "Reconciliar"}
          </Button>
          <ResultLine state={reconState} />
        </form>

        <form action={backfillFormAction} className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="outline" disabled={backPending}>
            {backPending ? "Importando..." : "Backfill inicial"}
          </Button>
          <span className="text-muted-foreground text-xs">
            Importa deals abertos + fechados do ano (Vendas + Enterprise) e leads.
          </span>
          <ResultLine state={backState} />
        </form>
      </CardContent>
    </Card>
  );
}

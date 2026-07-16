// Versão: 1.0 | Data: 12/07/2026
// Fase 2: conexão MANUAL de um registro com registros de outras fontes
// (record_matches, mode='manual'). Complementa o auto-match. Só admin
// (manage_field_definitions) — as ações reforçam no servidor.
"use client";

import { useEffect, useState, useTransition } from "react";
import { Link2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SOURCE_KEYS,
  sourceLabel,
  toSourceKey,
  type SourceKey,
} from "@/lib/sources";
import {
  connectRecords,
  disconnectRecords,
  listRecordMatches,
  searchRecordsForMatch,
  type MatchListItem,
} from "@/app/(app)/campos/matches-actions";

export function RecordMatchConnect({
  recordId,
  recordType,
}: {
  recordId: string;
  recordType: "lead" | "negocio" | "venda_site";
}) {
  const ownSource = toSourceKey(recordType);
  const otherSources = SOURCE_KEYS.filter((s) => s !== ownSource);

  const [matches, setMatches] = useState<MatchListItem[]>([]);
  const [source, setSource] = useState<SourceKey>(otherSources[0]);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<{ id: string; title: string }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reload = () =>
    start(async () => setMatches(await listRecordMatches(recordId)));

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  const doSearch = () =>
    start(async () => setResults(await searchRecordsForMatch(source, term)));
  const doConnect = (id: string) =>
    start(async () => {
      const r = await connectRecords(recordId, id);
      setMsg(r.message ?? null);
      setResults([]);
      setTerm("");
      reload();
    });
  const doDisconnect = (matchId: string) =>
    start(async () => {
      const r = await disconnectRecords(matchId);
      setMsg(r.message ?? null);
      reload();
    });

  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <Label>Registros conectados (outras fontes)</Label>

      {matches.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {matches.map((m) => (
            <li
              key={m.matchId}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="truncate">
                <span className="text-muted-foreground">
                  {m.source ? sourceLabel(m.source) : "—"}
                  {m.mode === "auto" ? " (auto)" : ""}:{" "}
                </span>
                {m.title}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={pending}
                onClick={() => doDisconnect(m.matchId)}
                aria-label="Remover conexão"
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs">Nenhuma conexão ainda.</p>
      )}

      <div className="flex gap-2">
        <Combobox
          options={otherSources.map((s) => ({ value: s, label: sourceLabel(s) }))}
          value={source}
          onValueChange={(v) => setSource(v as SourceKey)}
          searchable={false}
          aria-label="Fonte para conectar"
          className="w-40 shrink-0"
        />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Buscar por título…"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              doSearch();
            }
          }}
        />
        <Button type="button" variant="outline" disabled={pending} onClick={doSearch}>
          Buscar
        </Button>
      </div>

      {results.length > 0 ? (
        <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border p-1">
          {results.map((r) => (
            <li key={r.id}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                disabled={pending}
                onClick={() => doConnect(r.id)}
              >
                <Link2 className="size-4" />
                {r.title}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {msg ? (
        <p className="text-muted-foreground text-xs" role="status">
          {msg}
        </p>
      ) : null}
    </div>
  );
}

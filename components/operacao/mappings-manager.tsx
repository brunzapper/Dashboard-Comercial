// Versão: 1.2 | Data: 08/08/2026
// Gestor de mapeamentos de valores (0117): abas por domínio (Cargos /
// Segmentos + reclassificações dinâmicas 0119), seção de PENDÊNCIAS com
// classificação inline (vira entrada do de-para + reaplica), tabela de
// mapeamentos com busca/edição/exclusão e botão "Aplicar agora". As actions
// reaplicam o domínio tocado — a resposta já volta com o efeito nos registros.
// v1.1: export CSV (template das pendências, cola de volta no assistente) e
// JSON (dump p/ IA externa); prop opcional `onChanged` p/ superfícies que
// carregam o overview em ESTADO (aba Campos → Reclassificações) — o
// router.refresh() sozinho não as atualiza.
// v1.2: save OTIMISTA em background (§4.10 — useBackgroundSave, sem transition
// global): a linha responde na hora, pending/revert POR CONTROLE, e uma fila
// COALESCEDORA por domínio junta saves em sequência numa única chamada
// saveMappings (UM upsert + UMA reaplicação; flushes do mesmo domínio se
// ENCADEIAM — nunca duas reaplicações em paralelo). Botão "Mapear
// preenchidos (N)" salva todas as pendências com rascunho válido de uma vez
// (mesma fila ⇒ mesma chamada única).
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, ListChecks, Play, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MappingsAiSheet } from "@/components/operacao/mappings-ai-sheet";
import type { DomainOverview, MappingRow } from "@/lib/mappings/overview";
import { domainCsv, domainJson } from "@/lib/mappings/export";
import { csvFilename, downloadCsv } from "@/lib/export/csv";
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import {
  applyAllMappings,
  deleteMapping,
  saveMappings,
  type MappingActionState,
  type MappingEntryInput,
} from "@/app/(app)/operacao/mapeamentos/actions";

const LIST_LIMIT = 100;

interface DraftOutputs {
  [fieldKey: string]: string;
}

// Fila coalescedora por domínio: saves disparados em sequência entram no lote
// ABERTO (buffer) e o flush drena tudo numa chamada saveMappings; `chain`
// serializa flushes/tarefas do mesmo domínio (a reaplicação varre os
// registros — duas em paralelo duplicariam trabalho e o syncUnmappedTasks
// poderia gravar pendência stale). Vive em MÓDULO (não em ref): estado de
// coordenação fora do render (regra react-hooks/refs) e a serialização vale
// mesmo entre instâncias/remounts do gestor.
interface DomainQueue {
  buffer: MappingEntryInput[];
  flush: Promise<MappingActionState | undefined> | null;
  chain: Promise<unknown>;
}

const domainQueues = new Map<string, DomainQueue>();

function queueOf(key: string): DomainQueue {
  let q = domainQueues.get(key);
  if (!q) {
    q = { buffer: [], flush: null, chain: Promise.resolve() };
    domainQueues.set(key, q);
  }
  return q;
}

function downloadJson(filename: string, json: string): void {
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function MappingsManager({
  overview,
  ai,
  onChanged,
}: {
  overview: DomainOverview[];
  ai: { provider: string; model: string; hasKey: boolean } | null;
  /** Notifica a superfície dona do estado (aba Campos) após cada escrita. */
  onChanged?: () => void;
}) {
  const { save, pendingKeys, hasPending } = useBackgroundSave();
  const [domainKey, setDomainKey] = useState(overview[0]?.key ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Rascunhos de classificação: `${escopo}:${chave}` → outputs parciais.
  const [drafts, setDrafts] = useState<Record<string, DraftOutputs>>({});
  const [toDelete, setToDelete] = useState<MappingRow | null>(null);
  // Valor novo digitado à mão (form "adicionar mapeamento").
  const [newRaw, setNewRaw] = useState("");
  // Estado OTIMISTA por linha: pendência mapeada some da lista na hora,
  // exclusão oculta a linha, edição de mapeamento exibe o rascunho como salvo
  // (overlay sobre m.outputs). Revert granular restaura cada um.
  const [hiddenPending, setHiddenPending] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [hiddenMappings, setHiddenMappings] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [overlays, setOverlays] = useState<Record<string, DraftOutputs>>({});

  // Espelho de `hasPending` p/ o guard anti-eco (escrito em efeito, lido em
  // efeito — nunca no render; regra react-hooks/refs).
  const hasPendingRef = useRef(false);
  useEffect(() => {
    hasPendingRef.current = hasPending;
  }, [hasPending]);

  // Adoção do servidor (guard anti-eco do padrão seedKey): overview novo SEM
  // save em voo zera o estado otimista (o dado já traz o efeito gravado); com
  // save em voo o eco é stale e o otimista fica retido até o próximo refresh.
  useEffect(() => {
    if (hasPendingRef.current) return;
    setHiddenPending(new Set());
    setHiddenMappings(new Set());
    setOverlays({});
  }, [overview]);

  const domain = overview.find((d) => d.key === domainKey) ?? overview[0];

  const visibleUnmapped = useMemo(() => {
    if (!domain) return [];
    return domain.unmapped.filter(
      (u) => !hiddenPending.has(u.value.toLowerCase())
    );
  }, [domain, hiddenPending]);

  const filteredMappings = useMemo(() => {
    if (!domain) return [];
    const q = search.trim().toLowerCase();
    const base = domain.mappings.filter((m) => !hiddenMappings.has(m.id));
    const rows = q
      ? base.filter(
          (m) =>
            m.rawNorm.includes(q) ||
            Object.values(m.outputs).some((v) => v.toLowerCase().includes(q))
        )
      : base;
    return rows.slice(0, LIST_LIMIT);
  }, [domain, search, hiddenMappings]);

  // Pendências visíveis com rascunho válido (≥1 classificação preenchida) —
  // alimenta o botão "Mapear preenchidos (N)".
  const fillablePending = useMemo(() => {
    return visibleUnmapped.slice(0, LIST_LIMIT).filter((u) => {
      const d = drafts[`pend:${u.value.toLowerCase()}`];
      return d != null && Object.values(d).some((v) => v.trim() !== "");
    });
  }, [visibleUnmapped, drafts]);

  if (!domain) return null;

  const draftOf = (scope: string): DraftOutputs => drafts[scope] ?? {};
  const setDraft = (scope: string, fieldKey: string, value: string) =>
    setDrafts((d) => ({ ...d, [scope]: { ...d[scope], [fieldKey]: value } }));
  const clearDraft = (scope: string) =>
    setDrafts((d) => {
      const next = { ...d };
      delete next[scope];
      return next;
    });
  // Restaura um rascunho no revert SÓ se o usuário não recomeçou a editar a
  // mesma linha nesse meio-tempo (nunca clobbera digitação nova).
  const restoreDraft = (scope: string, backup: DraftOutputs | undefined) => {
    if (!backup) return;
    setDrafts((d) => (d[scope] ? d : { ...d, [scope]: backup }));
  };

  // Sucesso de um flush/tarefa: mensagem de status + onChanged (1× por lote).
  const report = (res: MappingActionState | undefined) => {
    if (res?.ok) {
      setMessage(res.message ?? null);
      onChanged?.();
    }
    return res;
  };

  /** Junta a entrada ao lote aberto do domínio; o flush drena o buffer todo. */
  const enqueueEntry = (dKey: string, entry: MappingEntryInput) => {
    const q = queueOf(dKey);
    q.buffer.push(entry);
    if (!q.flush) {
      const flush = q.chain.then(async () => {
        const entries = q.buffer;
        q.buffer = [];
        q.flush = null; // submits durante a chamada abrem o PRÓXIMO lote
        return report(await saveMappings(dKey, entries, { revalidate: false }));
      });
      q.flush = flush;
      q.chain = flush.catch(() => {});
    }
    return q.flush;
  };

  /** Tarefa avulsa (excluir/aplicar) encadeada após os flushes em voo. */
  const enqueueTask = (
    dKeys: string[],
    task: () => Promise<MappingActionState>
  ) => {
    const queues = [...new Set(dKeys)].map(queueOf);
    const p = Promise.all(queues.map((q) => q.chain)).then(async () =>
      report(await task())
    );
    const settled = p.catch(() => {});
    for (const q of queues) q.chain = settled;
    return p;
  };

  function submit(rawValue: string, scope: string, current?: DraftOutputs) {
    const merged = { ...(current ?? {}), ...draftOf(scope) };
    const outputs: DraftOutputs = {};
    for (const t of domain.targets) {
      const v = (merged[t.fieldKey] ?? "").trim();
      if (v) outputs[t.fieldKey] = v;
    }
    if (Object.keys(outputs).length === 0) {
      setMessage("Preencha ao menos uma classificação.");
      return;
    }
    const dKey = domain.key;
    const draftBackup = drafts[scope];
    // Otimista ANTES do await (§4.10) + revert granular por tipo de linha.
    let saveKey = scope;
    let revert: () => void;
    if (scope.startsWith("pend:")) {
      const hideKey = scope.slice("pend:".length);
      setHiddenPending((s) => new Set(s).add(hideKey));
      clearDraft(scope);
      revert = () => {
        setHiddenPending((s) => {
          const n = new Set(s);
          n.delete(hideKey);
          return n;
        });
        restoreDraft(scope, draftBackup);
      };
    } else if (scope === "new") {
      // Key própria por valor: adds em sequência não compartilham pending.
      saveKey = `new:${rawValue.trim().toLowerCase()}`;
      clearDraft(scope);
      setNewRaw("");
      revert = () => {
        setNewRaw((cur) => (cur === "" ? rawValue : cur));
        restoreDraft(scope, draftBackup);
      };
    } else {
      // map:<id> — o rascunho vira "salvo" na hora (overlay sobre outputs).
      setOverlays((o) => ({ ...o, [scope]: outputs }));
      clearDraft(scope);
      revert = () => {
        setOverlays((o) => {
          const n = { ...o };
          delete n[scope];
          return n;
        });
        restoreDraft(scope, draftBackup);
      };
    }
    setMessage(null);
    save({
      key: saveKey,
      context: `Não foi possível salvar o mapeamento de "${rawValue}"`,
      action: () => enqueueEntry(dKey, { rawValue, outputs }),
      revert,
    });
  }

  function applyNow() {
    setMessage(null);
    save({
      key: "apply",
      context: "Não foi possível aplicar os mapeamentos",
      // Aplica TODOS os domínios — encadeia após os flushes de todos.
      action: () =>
        enqueueTask([...domainQueues.keys(), domain.key], () =>
          applyAllMappings({ revalidate: false })
        ),
    });
  }

  function confirmDelete() {
    const row = toDelete;
    if (!row) return;
    setToDelete(null);
    setMessage(null);
    const dKey = domain.key;
    setHiddenMappings((s) => new Set(s).add(row.id));
    save({
      key: `del:${row.id}`,
      context: `Não foi possível excluir o mapeamento de "${row.rawValue}"`,
      action: () =>
        enqueueTask([dKey], () => deleteMapping(row.id, { revalidate: false })),
      revert: () =>
        setHiddenMappings((s) => {
          const n = new Set(s);
          n.delete(row.id);
          return n;
        }),
    });
  }

  // Dropdown com valor livre (padrão datalist do repo): sugestões = categorias
  // canônicas do domínio ∪ classificações já usadas — reaproveita a
  // inteligência acumulada sem travar valor novo.
  const optionsListId = (fieldKey: string) => `vm-opts-${domain.key}-${fieldKey}`;

  const outputsRowInputs = (
    scope: string,
    current: DraftOutputs,
    onEnter: () => void
  ) => {
    // Pending POR LINHA (nunca trava a tela): só a própria linha desabilita
    // com o save dela em voo; a linha "novo valor" nunca (adds em sequência).
    const rowPending = scope !== "new" && pendingKeys.has(scope);
    return domain.targets.map((t) => {
      const draft = draftOf(scope);
      const value = draft[t.fieldKey] ?? current[t.fieldKey] ?? "";
      return (
        <TableCell key={t.fieldKey}>
          <Input
            value={value}
            placeholder={t.label}
            list={optionsListId(t.fieldKey)}
            onChange={(e) => setDraft(scope, t.fieldKey, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onEnter();
            }}
            disabled={rowPending}
            className="h-8"
            aria-label={`${t.label} para o valor`}
          />
        </TableCell>
      );
    });
  };

  const ORIGIN_BADGES: Record<string, { label: string; className: string }> = {
    auto: {
      label: "auto",
      className: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    },
    ai: {
      label: "IA",
      className: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    },
    seed: {
      label: "seed",
      className: "bg-muted text-muted-foreground",
    },
  };

  const originBadge = (origin: string) => {
    const b = ORIGIN_BADGES[origin];
    if (!b) return null;
    return (
      <span
        className={`ml-1 rounded-full px-1.5 text-[10px] font-semibold ${b.className}`}
        title={
          origin === "auto"
            ? "Classificado automaticamente (heurística)"
            : origin === "ai"
              ? "Classificado pelo assistente de IA"
              : "Importado do mapeamento legado"
        }
      >
        {b.label}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Sugestões dos dropdowns (datalist nativo — aceita valor livre). */}
      {domain.targets.map((t) => (
        <datalist key={t.fieldKey} id={optionsListId(t.fieldKey)}>
          {(domain.optionsByTarget[t.fieldKey] ?? []).map((opt) => (
            <option key={opt} value={opt} />
          ))}
        </datalist>
      ))}
      {/* Abas de domínio + aplicar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg border p-1">
          {overview.map((d) => {
            const count =
              d.key === domain.key ? visibleUnmapped.length : d.unmapped.length;
            return (
              <Button
                key={d.key}
                type="button"
                size="sm"
                variant={d.key === domain.key ? "default" : "ghost"}
                onClick={() => {
                  setDomainKey(d.key);
                  setSearch("");
                }}
              >
                {d.label}
                {count > 0 ? (
                  <span className="bg-destructive/15 text-destructive ml-1 rounded-full px-1.5 text-[11px] font-semibold">
                    {count}
                  </span>
                ) : null}
              </Button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            title="Baixa as pendências como planilha-modelo (valor + colunas de classificação vazias) — preenchida, ela cola de volta no assistente de IA."
            onClick={() =>
              downloadCsv(
                csvFilename(`reclassificacao-${domain.key}`),
                domainCsv(domain)
              )
            }
          >
            <Download className="size-4" />
            CSV
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            title="Baixa o domínio inteiro em JSON (categorias, mapeados e pendências) para trabalhar numa IA externa."
            onClick={() =>
              downloadJson(
                csvFilename(`reclassificacao-${domain.key}`).replace(
                  /\.csv$/,
                  ".json"
                ),
                domainJson(domain)
              )
            }
          >
            <Download className="size-4" />
            JSON
          </Button>
          <MappingsAiSheet
            key={domain.key}
            ai={ai}
            domainKey={domain.key}
            domainLabel={domain.label}
            rawFieldLabel={domain.rawFieldLabel}
            targets={domain.targets}
            optionsByTarget={domain.optionsByTarget}
            pendingCount={visibleUnmapped.length}
            onApplied={onChanged}
          />
          <Button
            type="button"
            size="sm"
            onClick={applyNow}
            disabled={pendingKeys.has("apply")}
          >
            <Play className="size-4" />
            Aplicar agora
          </Button>
        </div>
      </div>

      <p className="text-muted-foreground text-sm">
        {domain.mappings.length} mapeamento(s) · {visibleUnmapped.length}{" "}
        valor(es) pendente(s) · {domain.recordsWithValue} registro(s) com{" "}
        {domain.rawFieldLabel.toLowerCase()} preenchido.
      </p>

      {/* Pendências */}
      {visibleUnmapped.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              Pendentes de classificação ({visibleUnmapped.length})
            </h3>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={fillablePending.length === 0}
              title="Salva de uma vez todas as pendências com classificação preenchida — uma única reaplicação aos registros."
              onClick={() => {
                for (const u of fillablePending) {
                  submit(u.value, `pend:${u.value.toLowerCase()}`);
                }
              }}
            >
              <ListChecks className="size-4" />
              Mapear preenchidos ({fillablePending.length})
            </Button>
          </div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{domain.rawFieldLabel} (valor cru)</TableHead>
                  <TableHead className="w-24">Registros</TableHead>
                  {domain.targets.map((t) => (
                    <TableHead key={t.fieldKey}>{t.label}</TableHead>
                  ))}
                  <TableHead className="w-28 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleUnmapped.slice(0, LIST_LIMIT).map((u) => {
                  const scope = `pend:${u.value.toLowerCase()}`;
                  return (
                    <TableRow key={u.value}>
                      <TableCell
                        className="max-w-64 truncate font-medium"
                        title={u.value}
                      >
                        {u.value}
                      </TableCell>
                      <TableCell className="tabular-nums">{u.count}</TableCell>
                      {outputsRowInputs(scope, {}, () => submit(u.value, scope))}
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          disabled={pendingKeys.has(scope)}
                          onClick={() => submit(u.value, scope)}
                        >
                          Mapear
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {visibleUnmapped.length > LIST_LIMIT ? (
            <p className="text-muted-foreground text-xs">
              Mostrando os {LIST_LIMIT} valores mais frequentes — mapeie-os para
              ver os demais.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground rounded-lg border p-4 text-sm">
          Nenhum valor pendente — todos os {domain.rawFieldLabel.toLowerCase()}s
          dos registros têm classificação.
        </p>
      )}

      {/* Mapeamentos existentes */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            Mapeamentos ({domain.mappings.length})
          </h3>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar valor ou classificação…"
            className="h-8 w-64"
            aria-label="Buscar mapeamentos"
          />
        </div>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{domain.rawFieldLabel} (valor cru)</TableHead>
                {domain.targets.map((t) => (
                  <TableHead key={t.fieldKey}>{t.label}</TableHead>
                ))}
                <TableHead className="w-36 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Linha de novo mapeamento manual */}
              <TableRow>
                <TableCell>
                  <Input
                    value={newRaw}
                    onChange={(e) => setNewRaw(e.target.value)}
                    placeholder="Novo valor…"
                    className="h-8"
                    aria-label="Novo valor a mapear"
                  />
                </TableCell>
                {outputsRowInputs("new", {}, () => {
                  if (newRaw.trim()) submit(newRaw, "new");
                })}
                <TableCell className="text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!newRaw.trim()}
                    onClick={() => submit(newRaw, "new")}
                  >
                    Adicionar
                  </Button>
                </TableCell>
              </TableRow>
              {filteredMappings.map((m) => {
                const scope = `map:${m.id}`;
                // Overlay otimista: após salvar, exibe o que foi enviado até
                // o refresh reconciliar (draft > overlay > outputs do server).
                const current = overlays[scope] ?? m.outputs;
                return (
                  <TableRow key={m.id}>
                    <TableCell
                      className="max-w-64 truncate font-medium"
                      title={m.rawValue}
                    >
                      {m.rawValue}
                      {originBadge(m.origin)}
                    </TableCell>
                    {outputsRowInputs(scope, current, () =>
                      submit(m.rawValue, scope, current)
                    )}
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {drafts[scope] ? (
                          <Button
                            type="button"
                            size="sm"
                            disabled={pendingKeys.has(scope)}
                            onClick={() => submit(m.rawValue, scope, current)}
                          >
                            Salvar
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={pendingKeys.has(`del:${m.id}`)}
                          onClick={() => setToDelete(m)}
                          aria-label={`Excluir mapeamento de ${m.rawValue}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {domain.mappings.length > filteredMappings.length ? (
          <p className="text-muted-foreground text-xs">
            Mostrando {filteredMappings.length} de {domain.mappings.length} —
            refine a busca para encontrar os demais.
          </p>
        ) : null}
      </div>

      {message ? (
        <p className="text-muted-foreground text-sm" role="status">
          {message}
        </p>
      ) : null}

      <ConfirmDialog
        open={toDelete != null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
        title="Excluir mapeamento?"
        description={
          toDelete
            ? `Os registros com "${toDelete.rawValue}" voltam a "Não Classificado" na reaplicação.`
            : ""
        }
        actionLabel="Excluir"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

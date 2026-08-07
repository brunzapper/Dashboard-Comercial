// Versão: 1.0 | Data: 07/08/2026
// Gestor de mapeamentos de valores (0117): abas por domínio (Cargos /
// Segmentos), seção de PENDÊNCIAS com classificação inline (vira entrada do
// de-para + reaplica), tabela de mapeamentos com busca/edição/exclusão e
// botão "Aplicar agora". As actions reaplicam o domínio tocado — a resposta
// já volta com o efeito nos registros.
"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Trash2 } from "lucide-react";

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
import type { DomainOverview, MappingRow } from "@/lib/mappings/overview";
import {
  applyAllMappings,
  deleteMapping,
  saveMapping,
} from "@/app/(app)/operacao/mapeamentos/actions";

const LIST_LIMIT = 100;

interface DraftOutputs {
  [fieldKey: string]: string;
}

export function MappingsManager({ overview }: { overview: DomainOverview[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [domainKey, setDomainKey] = useState(overview[0]?.key ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Rascunhos de classificação: `${escopo}:${chave}` → outputs parciais.
  const [drafts, setDrafts] = useState<Record<string, DraftOutputs>>({});
  const [toDelete, setToDelete] = useState<MappingRow | null>(null);
  // Valor novo digitado à mão (form "adicionar mapeamento").
  const [newRaw, setNewRaw] = useState("");

  const domain = overview.find((d) => d.key === domainKey) ?? overview[0];

  const filteredMappings = useMemo(() => {
    if (!domain) return [];
    const q = search.trim().toLowerCase();
    const rows = q
      ? domain.mappings.filter(
          (m) =>
            m.rawNorm.includes(q) ||
            Object.values(m.outputs).some((v) => v.toLowerCase().includes(q))
        )
      : domain.mappings;
    return rows.slice(0, LIST_LIMIT);
  }, [domain, search]);

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

  function submit(rawValue: string, scope: string, current?: DraftOutputs) {
    const draft = { ...(current ?? {}), ...draftOf(scope) };
    const fd = new FormData();
    fd.set("domain", domain.key);
    fd.set("raw_value", rawValue);
    for (const t of domain.targets) {
      fd.set(`out_${t.fieldKey}`, draft[t.fieldKey] ?? "");
    }
    setMessage(null);
    startTransition(async () => {
      const res = await saveMapping({}, fd);
      setMessage(res.message ?? null);
      if (res.ok) {
        clearDraft(scope);
        if (scope === "new") setNewRaw("");
        router.refresh();
      }
    });
  }

  function applyNow() {
    setMessage(null);
    startTransition(async () => {
      const res = await applyAllMappings();
      setMessage(res.message ?? null);
      router.refresh();
    });
  }

  function confirmDelete() {
    const row = toDelete;
    if (!row) return;
    setToDelete(null);
    setMessage(null);
    startTransition(async () => {
      const res = await deleteMapping(row.id);
      setMessage(res.message ?? null);
      router.refresh();
    });
  }

  const outputsRowInputs = (
    scope: string,
    current: DraftOutputs,
    onEnter: () => void
  ) =>
    domain.targets.map((t) => {
      const draft = draftOf(scope);
      const value = draft[t.fieldKey] ?? current[t.fieldKey] ?? "";
      return (
        <TableCell key={t.fieldKey}>
          <Input
            value={value}
            placeholder={t.label}
            onChange={(e) => setDraft(scope, t.fieldKey, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onEnter();
            }}
            disabled={pending}
            className="h-8"
            aria-label={`${t.label} para o valor`}
          />
        </TableCell>
      );
    });

  return (
    <div className="flex flex-col gap-5">
      {/* Abas de domínio + aplicar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg border p-1">
          {overview.map((d) => (
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
              {d.unmapped.length > 0 ? (
                <span className="bg-destructive/15 text-destructive ml-1 rounded-full px-1.5 text-[11px] font-semibold">
                  {d.unmapped.length}
                </span>
              ) : null}
            </Button>
          ))}
        </div>
        <Button type="button" size="sm" onClick={applyNow} disabled={pending}>
          <Play className="size-4" />
          Aplicar agora
        </Button>
      </div>

      <p className="text-muted-foreground text-sm">
        {domain.mappings.length} mapeamento(s) · {domain.unmapped.length}{" "}
        valor(es) pendente(s) · {domain.recordsWithValue} registro(s) com{" "}
        {domain.rawFieldLabel.toLowerCase()} preenchido.
      </p>

      {/* Pendências */}
      {domain.unmapped.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            Pendentes de classificação ({domain.unmapped.length})
          </h3>
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
                {domain.unmapped.slice(0, LIST_LIMIT).map((u) => {
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
                          disabled={pending}
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
          {domain.unmapped.length > LIST_LIMIT ? (
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
                    disabled={pending}
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
                    disabled={pending || !newRaw.trim()}
                    onClick={() => submit(newRaw, "new")}
                  >
                    Adicionar
                  </Button>
                </TableCell>
              </TableRow>
              {filteredMappings.map((m) => {
                const scope = `map:${m.id}`;
                return (
                  <TableRow key={m.id}>
                    <TableCell
                      className="max-w-64 truncate font-medium"
                      title={m.rawValue}
                    >
                      {m.rawValue}
                    </TableCell>
                    {outputsRowInputs(scope, m.outputs, () =>
                      submit(m.rawValue, scope, m.outputs)
                    )}
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {drafts[scope] ? (
                          <Button
                            type="button"
                            size="sm"
                            disabled={pending}
                            onClick={() => submit(m.rawValue, scope, m.outputs)}
                          >
                            Salvar
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={pending}
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

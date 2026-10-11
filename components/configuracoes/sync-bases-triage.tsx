// Versão: 1.0 | Data: 11/10/2026
// TRIAGEM de novas Bases de Sync (Registros → Novas bases de Sync, 0155).
//
// Fluxo: os processos inteligentes do portal aparecem pelo NOME; "Avaliar"
// busca uma amostra ao vivo (registros já passados pelo mesmo mapper do sync +
// atividades de alguns deles); "Solicitar como Base" grava o rascunho;
// ajustes (nome, chave, campos, rótulos, período, fuso, espelho, funis) re-
// renderizam a amostra SEM outra ida ao Bitrix (a amostra traz todos os campos
// e a tela só escolhe); "Aprovar e importar" cria a Base e dispara a carga.
//
// Nada daqui escreve em `data_sources` sem a aprovação; o rascunho do
// navegador só vira Base depois de salvo (a aprovação lê o que está gravado).
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  approveSpaRequest,
  listSpaCandidates,
  loadSpaPreview,
  rejectSpaRequest,
  requestSpaSource,
  saveSpaRequest,
} from "@/app/(app)/registros/bases/sync/actions";
import {
  rekeyFields,
  requestConfigError,
  spaFieldKey,
  type SpaRequestConfig,
} from "@/lib/sync/bitrix/spa-config";
import type { SpaPreview } from "@/lib/sync/bitrix/spa-preview";
import type {
  SpaCandidate,
  SpaCandidateStatus,
  SpaRequestRow,
} from "@/lib/sync/bitrix/spa-triage-types";

const STATUS_LABEL: Record<SpaCandidateStatus, string> = {
  none: "Não solicitado",
  pending: "Solicitado",
  approved: "Aprovado",
  rejected: "Recusado",
};

const STATUS_VARIANT: Record<
  SpaCandidateStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  none: "outline",
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
};

const PERIOD_CORE: ComboboxOption[] = [
  { value: "source_created_at", label: "Data de criação" },
  { value: "source_modified_at", label: "Data de modificação" },
  { value: "closed_at", label: "Data de fechamento" },
  { value: "opened_at", label: "Data de início" },
];

const DATE_TYPES = new Set(["date", "datetime"]);

export function SyncBasesTriage() {
  const [listState, setListState] = useState<{
    loading: boolean;
    error: string | null;
    candidates: SpaCandidate[];
    requests: SpaRequestRow[];
  }>({ loading: true, error: null, candidates: [], requests: [] });
  const [reloadKey, setReloadKey] = useState(0);

  const [selected, setSelected] = useState<SpaCandidate | null>(null);
  const [preview, setPreview] = useState<SpaPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [draft, setDraft] = useState<SpaRequestConfig | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  useEffect(() => {
    let alive = true;
    listSpaCandidates().then((r) => {
      if (!alive) return;
      setListState(
        r.ok
          ? { loading: false, error: null, ...r.data }
          : { loading: false, error: r.message, candidates: [], requests: [] }
      );
    });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const reload = () => {
    setListState((s) => ({ ...s, loading: true }));
    setReloadKey((k) => k + 1);
  };

  const request = useMemo(
    () =>
      selected?.requestId
        ? (listState.requests.find((r) => r.id === selected.requestId) ?? null)
        : null,
    [selected, listState.requests]
  );
  const status: SpaCandidateStatus = selected?.status ?? "none";
  const editable = status !== "approved";

  async function openCandidate(c: SpaCandidate, categoryIds: string[] = []) {
    setSelected(c);
    setMessage(null);
    setPreviewError(null);
    setPreviewLoading(true);
    if (categoryIds.length === 0) setPreview(null);
    const r = await loadSpaPreview(c.entityTypeId, categoryIds);
    setPreviewLoading(false);
    if (!r.ok) {
      setPreviewError(r.message);
      return;
    }
    setPreview(r.data.preview);
    // Rascunho: o da solicitação (se houver e não foi recusada) vence o sugerido.
    const req = c.requestId
      ? listState.requests.find((x) => x.id === c.requestId)
      : null;
    if (categoryIds.length === 0) {
      setDraft(req && req.status !== "rejected" ? req.config : r.data.suggested);
    }
  }

  const patch = (p: Partial<SpaRequestConfig>) =>
    setDraft((d) => (d ? { ...d, ...p } : d));

  const fieldsById = useMemo(
    () => new Map((preview?.fields ?? []).map((f) => [f.id, f])),
    [preview]
  );
  const chosenById = useMemo(
    () => new Map((draft?.fields ?? []).map((f) => [f.id, f])),
    [draft]
  );

  function toggleField(id: string, on: boolean) {
    if (!draft) return;
    if (!on) {
      patch({ fields: draft.fields.filter((f) => f.id !== id) });
      return;
    }
    const meta = fieldsById.get(id);
    patch({
      fields: [
        ...draft.fields,
        { id, key: spaFieldKey(draft.key, id), label: meta?.title ?? id },
      ],
    });
  }

  function setFieldProp(id: string, prop: "label" | "key", value: string) {
    if (!draft) return;
    patch({
      fields: draft.fields.map((f) => (f.id === id ? { ...f, [prop]: value } : f)),
    });
  }

  const periodOptions = useMemo<ComboboxOption[]>(() => {
    const extra = (draft?.fields ?? [])
      .filter((f) => DATE_TYPES.has(fieldsById.get(f.id)?.type ?? ""))
      .map((f) => ({ value: `custom:${f.key}`, label: f.label }));
    return [...PERIOD_CORE, ...extra];
  }, [draft, fieldsById]);

  const draftError = draft ? requestConfigError(draft) : null;

  async function run(label: string, fn: () => Promise<{ ok: boolean; text: string }>) {
    setBusy(label);
    setMessage(null);
    try {
      setMessage(await fn());
    } finally {
      setBusy(null);
    }
  }

  const doRequest = () =>
    run("request", async () => {
      if (!selected || !draft) return { ok: false, text: "Nada selecionado." };
      const r = await requestSpaSource(selected.entityTypeId, selected.title, draft);
      if (!r.ok) return { ok: false, text: r.message };
      setSelected({ ...selected, status: "pending", requestId: r.data.id });
      reload();
      return { ok: true, text: "Solicitação aberta. Ajuste e aprove quando estiver certo." };
    });

  const doSave = () =>
    run("save", async () => {
      if (!request || !draft) return { ok: false, text: "Sem solicitação aberta." };
      const r = await saveSpaRequest(request.id, draft);
      if (!r.ok) return { ok: false, text: r.message };
      setDraft(r.data.config);
      reload();
      return { ok: true, text: "Ajustes salvos." };
    });

  const doApprove = () =>
    run("approve", async () => {
      if (!request || !draft) return { ok: false, text: "Sem solicitação aberta." };
      // Aprova o que está GRAVADO: salva o rascunho antes.
      const saved = await saveSpaRequest(request.id, draft);
      if (!saved.ok) return { ok: false, text: saved.message };
      const r = await approveSpaRequest(request.id);
      if (!r.ok) return { ok: false, text: r.message };
      setSelected(
        selected ? { ...selected, status: "approved", sourceKey: r.data.sourceKey } : null
      );
      reload();
      return {
        ok: true,
        text: r.data.jobStarted
          ? `Base "${r.data.sourceKey}" criada — a importação começou.`
          : `Base "${r.data.sourceKey}" criada — a importação entra no próximo ciclo de sync.`,
      };
    });

  const doReject = () =>
    run("reject", async () => {
      if (!request) return { ok: false, text: "Sem solicitação aberta." };
      const r = await rejectSpaRequest(request.id, rejectNote);
      if (!r.ok) return { ok: false, text: r.message };
      setSelected(selected ? { ...selected, status: "rejected" } : null);
      reload();
      return { ok: true, text: "Solicitação recusada." };
    });

  const visibleFields = (preview?.fields ?? []).filter(
    (f) => showTechnical || !f.technical || chosenById.has(f.id)
  );

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Processos do Bitrix</h2>
          <Button variant="outline" size="sm" onClick={reload} disabled={listState.loading}>
            {listState.loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Atualizar
          </Button>
        </div>
        {listState.error ? (
          <p className="text-destructive text-sm">{listState.error}</p>
        ) : null}
        {listState.loading && listState.candidates.length === 0 ? (
          <p className="text-muted-foreground text-sm">Lendo os processos do portal…</p>
        ) : null}
        {!listState.loading && !listState.error && listState.candidates.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nenhum processo inteligente encontrado no portal.
          </p>
        ) : null}
        {listState.candidates.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Processo</TableHead>
                <TableHead className="text-right">Itens</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {listState.candidates.map((c) => (
                <TableRow
                  key={c.entityTypeId}
                  data-state={selected?.entityTypeId === c.entityTypeId ? "selected" : undefined}
                >
                  <TableCell>
                    <div className="font-medium">{c.title}</div>
                    <div className="text-muted-foreground text-xs">#{c.entityTypeId}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.total == null ? "—" : c.total.toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {c.status === "approved" && c.sourceKey ? (
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/registros?fonte=${encodeURIComponent(c.sourceKey)}`}>
                          Ver registros
                        </Link>
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openCandidate(c)}
                      disabled={previewLoading}
                    >
                      Avaliar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </section>

      {selected ? (
        <section className="flex flex-col gap-6 rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{selected.title}</h2>
            <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
            {preview?.total != null ? (
              <span className="text-muted-foreground text-sm">
                {preview.total.toLocaleString("pt-BR")} itens no portal
              </span>
            ) : null}
            {previewLoading ? <Loader2 className="size-4 animate-spin" /> : null}
          </div>
          {request?.status === "rejected" && request.note ? (
            <p className="text-muted-foreground text-sm">Motivo da recusa: {request.note}</p>
          ) : null}
          {previewError ? <p className="text-destructive text-sm">{previewError}</p> : null}

          {preview && draft ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="spa-label">Nome da Base</Label>
                  <Input
                    id="spa-label"
                    value={draft.label}
                    disabled={!editable}
                    onChange={(e) => patch({ label: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="spa-short">Nome curto</Label>
                  <Input
                    id="spa-short"
                    value={draft.shortLabel}
                    disabled={!editable}
                    onChange={(e) => patch({ shortLabel: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="spa-key">Chave</Label>
                  <Input
                    id="spa-key"
                    value={draft.key}
                    disabled={!editable}
                    onChange={(e) => {
                      const key = e.target.value.toLowerCase();
                      patch({ key, fields: rekeyFields(draft.fields, draft.key, key) });
                    }}
                  />
                  <p className="text-muted-foreground text-xs">
                    Identificador interno da Base; não muda depois de aprovada.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Campo de período</Label>
                  <Combobox
                    options={periodOptions}
                    value={draft.periodField}
                    onValueChange={(v) => patch({ periodField: v })}
                    disabled={!editable}
                    searchable={false}
                    aria-label="Campo de período"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="spa-tz">Fuso horário da origem</Label>
                  <Input
                    id="spa-tz"
                    value={draft.timezone ?? ""}
                    placeholder="Ex.: Europe/Moscow"
                    disabled={!editable}
                    onChange={(e) => patch({ timezone: e.target.value.trim() || null })}
                  />
                </div>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <Checkbox
                    checked={draft.mirrorActivities}
                    disabled={!editable}
                    onCheckedChange={(v) => patch({ mirrorActivities: v === true })}
                  />
                  Trazer as atividades e espelhar as tarefas daqui no processo
                </label>
              </div>

              {preview.categories.length > 1 ? (
                <div className="flex flex-col gap-2">
                  <Label>Funis importados</Label>
                  <div className="flex flex-wrap gap-4">
                    {preview.categories.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={
                            draft.categoryIds.length === 0 || draft.categoryIds.includes(c.id)
                          }
                          disabled={!editable}
                          onCheckedChange={(v) => {
                            const all = preview.categories.map((x) => x.id);
                            const cur = draft.categoryIds.length === 0 ? all : draft.categoryIds;
                            const next = v === true
                              ? [...new Set([...cur, c.id])]
                              : cur.filter((x) => x !== c.id);
                            patch({ categoryIds: next.length === all.length ? [] : next });
                          }}
                        />
                        {c.name}
                      </label>
                    ))}
                  </div>
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openCandidate(selected, draft.categoryIds)}
                      disabled={previewLoading}
                    >
                      Atualizar amostra com estes funis
                    </Button>
                  </div>
                </div>
              ) : null}

              {preview.stages.length > 0 ? (
                <p className="text-muted-foreground text-sm">
                  Etapas: {preview.stages.join(" · ")}
                </p>
              ) : null}

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium">
                    Campos ({draft.fields.length} de {preview.fields.length} incluídos)
                  </h3>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={showTechnical}
                      onCheckedChange={(v) => setShowTechnical(v === true)}
                    />
                    Mostrar campos técnicos
                  </label>
                </div>
                <p className="text-muted-foreground text-xs">
                  Título, etapa, funil, valor, responsável e datas entram sempre
                  (colunas padrão). Escolha os demais e, se quiser, renomeie.
                </p>
                <div className="max-h-96 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead>Campo no Bitrix</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Rótulo aqui</TableHead>
                        <TableHead>Chave</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleFields.map((f) => {
                        const chosen = chosenById.get(f.id);
                        return (
                          <TableRow key={f.id}>
                            <TableCell>
                              <Checkbox
                                checked={Boolean(chosen)}
                                disabled={!editable}
                                aria-label={`Incluir ${f.title}`}
                                onCheckedChange={(v) => toggleField(f.id, v === true)}
                              />
                            </TableCell>
                            <TableCell>
                              <div>{f.title}</div>
                              <div className="text-muted-foreground text-xs">
                                {f.id}
                                {f.readOnly ? " · somente leitura" : ""}
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-xs">{f.type}</TableCell>
                            <TableCell>
                              {chosen ? (
                                <Input
                                  value={chosen.label}
                                  disabled={!editable}
                                  aria-label={`Rótulo de ${f.title}`}
                                  onChange={(e) => setFieldProp(f.id, "label", e.target.value)}
                                />
                              ) : null}
                            </TableCell>
                            <TableCell>
                              {chosen ? (
                                <Input
                                  value={chosen.key}
                                  disabled={!editable}
                                  aria-label={`Chave de ${f.title}`}
                                  onChange={(e) =>
                                    setFieldProp(f.id, "key", e.target.value.toLowerCase())
                                  }
                                />
                              ) : null}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="font-medium">
                  Amostra ({preview.rows.length} registros mais recentes)
                </h3>
                {preview.rows.length === 0 ? (
                  <p className="text-muted-foreground text-sm">O processo não tem itens.</p>
                ) : (
                  <div className="max-h-[28rem] overflow-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Título</TableHead>
                          <TableHead>Etapa</TableHead>
                          <TableHead>Funil</TableHead>
                          <TableHead>Responsável</TableHead>
                          <TableHead>Valor</TableHead>
                          <TableHead>Criado em</TableHead>
                          {draft.fields.map((f) => (
                            <TableHead key={f.id}>{f.label}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.rows.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium">{r.title || "(sem título)"}</TableCell>
                            <TableCell>{r.stage}</TableCell>
                            <TableCell>{r.pipeline}</TableCell>
                            <TableCell>{r.responsible}</TableCell>
                            <TableCell className="tabular-nums">{r.value}</TableCell>
                            <TableCell className="tabular-nums">{r.created}</TableCell>
                            {draft.fields.map((f) => (
                              <TableCell key={f.id}>{r.values[f.id] ?? ""}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="font-medium">Atividades vinculadas (amostra)</h3>
                {preview.activities.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Nenhuma atividade nos itens da amostra.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {preview.activities.map((a) => {
                      const owner = preview.rows.find((r) => r.id === a.ownerId);
                      return (
                        <li key={a.id} className="flex flex-wrap gap-2">
                          <Badge variant="outline">{a.kind || "Atividade"}</Badge>
                          <span className={a.completed ? "text-muted-foreground line-through" : ""}>
                            {a.subject || "(sem assunto)"}
                          </span>
                          {a.deadline ? (
                            <span className="text-muted-foreground">até {a.deadline}</span>
                          ) : null}
                          {owner ? (
                            <span className="text-muted-foreground">— {owner.title}</span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {draftError && editable ? (
                <p className="text-destructive text-sm">{draftError}</p>
              ) : null}
              {message ? (
                <p className={message.ok ? "text-sm" : "text-destructive text-sm"}>
                  {message.text}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                {status === "none" || status === "rejected" ? (
                  <Button onClick={doRequest} disabled={busy != null}>
                    {busy === "request" ? <Loader2 className="size-4 animate-spin" /> : null}
                    Solicitar como Base
                  </Button>
                ) : null}
                {status === "pending" ? (
                  <>
                    <Button variant="outline" onClick={doSave} disabled={busy != null}>
                      {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : null}
                      Salvar ajustes
                    </Button>
                    <Button onClick={doApprove} disabled={busy != null || Boolean(draftError)}>
                      {busy === "approve" ? <Loader2 className="size-4 animate-spin" /> : null}
                      Aprovar e importar
                    </Button>
                    <Input
                      className="w-64"
                      placeholder="Motivo (opcional)"
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      aria-label="Motivo da recusa"
                    />
                    <Button variant="ghost" onClick={doReject} disabled={busy != null}>
                      Recusar
                    </Button>
                  </>
                ) : null}
                {status === "approved" && selected.sourceKey ? (
                  <Button asChild variant="outline">
                    <Link href={`/registros?fonte=${encodeURIComponent(selected.sourceKey)}`}>
                      Ver registros da Base
                    </Link>
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

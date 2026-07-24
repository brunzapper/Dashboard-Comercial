// Versão: 2.0 | Data: 23/07/2026
// v2.0 (23/07/2026): painel vira SESSÃO de IA com 3 modos — "Criar novo",
//   "Criar a partir de" (dashboard existente como referência ⇒ cria cópia
//   melhorada) e "Editar" (atualiza in-place; a IA nunca exclui widgets).
//   Conversa multi-turno stateless (o cliente guarda só os textos do usuário;
//   o servidor re-exporta o estado a cada turno); após o 1º apply em
//   new/from a sessão VIRA edit no dashboard criado. Switch "Aplicar
//   automaticamente": desligado, cada turno devolve uma prévia (resumo por
//   widget) e o Aplicar é manual. "Desfazer edição da IA" restaura o snapshot
//   capturado antes do turno (restoreDashboardSnapshot). O fluxo manual
//   (copiar prompt → colar JSON) permanece no modo Criar novo.
// v1.1 (23/07/2026): seleção MULTI-Base; prompt compacto/completo.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Check,
  Copy,
  ExternalLink,
  Send,
  Undo2,
  Upload,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  AiChatLog,
  type AiChatEntry,
} from "@/components/dashboards/ai-chat-log";
import type { SourceDef } from "@/lib/sources";
import type { DashboardSnapshot } from "@/lib/widgets/history";
import {
  buildImportPrompt,
  type ImportPromptVariant,
} from "@/app/(app)/dashboards/import-prompt-actions";
import {
  importDashboardJson,
  restoreDashboardSnapshot,
  type ImportDashboardState,
} from "@/app/(app)/dashboards/actions";
import {
  applyGeneratedDashboard,
  generateDashboardWithAi,
  type AiDashboardMode,
  type GenerateDashboardState,
} from "@/app/(app)/dashboards/ai-generate-actions";

export interface AiBoardOption {
  id: string;
  name: string;
  factoryPreset: boolean;
}

const MODE_LABELS: Record<AiDashboardMode, string> = {
  new: "Criar novo",
  from: "Criar a partir de",
  edit: "Editar",
};

export function ImportDashboardSheet({
  sources,
  ai,
  boards = [],
}: {
  sources: SourceDef[];
  ai?: { provider: string; model: string; hasKey: boolean } | null;
  boards?: AiBoardOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AiDashboardMode>("new");
  const [boardId, setBoardId] = useState<string>("");
  const [bases, setBases] = useState<string[]>([]);
  const [autoApply, setAutoApply] = useState(true);

  // Sessão de conversa (stateless no servidor: só os textos do usuário viajam).
  const [chat, setChat] = useState<AiChatEntry[]>([]);
  const [turns, setTurns] = useState<string[]>([]);
  const [sessionTarget, setSessionTarget] = useState<{ id: string } | null>(
    null
  );
  const [pending, setPending] = useState<{
    json: string;
    summary: string[];
    mode: AiDashboardMode;
    targetDashboardId?: string;
  } | null>(null);
  const [snapshot, setSnapshot] = useState<{
    boardId: string;
    snap: DashboardSnapshot;
  } | null>(null);
  const [description, setDescription] = useState("");

  // Fluxo manual (modo Criar novo).
  const [copied, setCopied] = useState<ImportPromptVariant | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [manualPrompt, setManualPrompt] = useState<string | null>(null);
  const [json, setJson] = useState("");
  const [result, setResult] = useState<ImportDashboardState | null>(null);

  const [copyPending, startCopy] = useTransition();
  const [importPending, startImport] = useTransition();
  const [genPending, startGenerate] = useTransition();

  const aiReady = Boolean(ai?.hasKey);
  const rootSources = sources.filter((s) => !s.parentKey);
  const selectedBoard = boards.find((b) => b.id === boardId) ?? null;
  const sessionActive = chat.length > 0;

  function resetSession() {
    setChat([]);
    setTurns([]);
    setSessionTarget(null);
    setPending(null);
    setSnapshot(null);
    setResult(null);
  }

  function changeMode(next: AiDashboardMode) {
    if (next === mode) return;
    setMode(next);
    setBoardId("");
    resetSession();
  }

  function changeBoard(id: string) {
    setBoardId(id);
    resetSession();
  }

  function toggleBase(key: string, on: boolean) {
    setBases((prev) => (on ? [...prev, key] : prev.filter((k) => k !== key)));
  }

  function copyPrompt(variant: ImportPromptVariant) {
    if (bases.length === 0) return;
    setCopyError(null);
    setManualPrompt(null);
    startCopy(async () => {
      const res = await buildImportPrompt(bases, variant);
      if (!res.ok || !res.prompt) {
        setCopyError(res.message ?? "Não foi possível montar o prompt.");
        return;
      }
      try {
        await navigator.clipboard.writeText(res.prompt);
        setCopied(variant);
        window.setTimeout(() => setCopied(null), 2000);
        if (res.message) setCopyError(res.message); // aviso não-fatal (anexo)
      } catch {
        // Navegador negou a escrita fora do gesto: oferece cópia manual.
        setManualPrompt(res.prompt);
      }
    });
  }

  function runImport() {
    setResult(null);
    startImport(async () => {
      const res = await importDashboardJson(json);
      setResult(res);
      if (res.ok && res.id) {
        setOpen(false);
        router.push(`/dashboards/${res.id}`);
      }
    });
  }

  // Resultado de um apply (automático ou manual): alimenta o log e promove a
  // sessão para EDIT no dashboard alvo (novo ou existente).
  function handleApplied(res: GenerateDashboardState) {
    if (res.ok && res.id) {
      const id = res.id;
      setChat((c) => [
        ...c,
        { kind: "ok", text: res.message ?? "Aplicado.", summary: res.summary },
      ]);
      setSessionTarget({ id });
      if (res.snapshot) setSnapshot({ boardId: id, snap: res.snapshot });
      setDescription("");
      router.refresh();
      return;
    }
    setChat((c) => [
      ...c,
      {
        kind: "error",
        text: res.message ?? "Falha na geração.",
        errors: res.errors,
      },
    ]);
    if (res.draftJson && mode === "new" && !sessionTarget) {
      setJson(res.draftJson);
    }
  }

  function runTurn() {
    const text = description.trim();
    if (!text || genPending) return;
    const effMode: AiDashboardMode = sessionTarget ? "edit" : mode;
    const effTarget = sessionTarget
      ? sessionTarget.id
      : mode === "new"
        ? undefined
        : boardId;
    if (effMode === "new" && bases.length === 0) return;
    if (effMode !== "new" && !effTarget) return;

    setChat((c) => [...c, { kind: "user", text }]);
    setTurns((t) => [...t, text]);
    startGenerate(async () => {
      const res = await generateDashboardWithAi({
        mode: effMode,
        bases: effMode === "new" ? bases : undefined,
        targetDashboardId: effTarget,
        description: text,
        priorTurns: turns,
        autoApply,
        pendingJson: pending?.json,
      });
      if (res.pendingJson) {
        setPending({
          json: res.pendingJson,
          summary: res.summary ?? [],
          mode: effMode,
          targetDashboardId: effTarget,
        });
        setChat((c) => [
          ...c,
          {
            kind: "ok",
            text: res.message ?? "Prévia pronta — revise e clique em Aplicar.",
            summary: res.summary,
          },
        ]);
        setDescription("");
        return;
      }
      handleApplied(res);
    });
  }

  function applyPending() {
    if (!pending || genPending) return;
    const p = pending;
    startGenerate(async () => {
      const res = await applyGeneratedDashboard(p.json, {
        mode: p.mode,
        targetDashboardId: p.targetDashboardId,
      });
      setPending(null);
      handleApplied(res);
    });
  }

  function undoLastEdit() {
    if (!snapshot || genPending) return;
    const s = snapshot;
    startGenerate(async () => {
      const res = await restoreDashboardSnapshot(s.boardId, s.snap);
      setChat((c) => [
        ...c,
        res.ok
          ? { kind: "ok", text: "Edição da IA desfeita — dashboard restaurado." }
          : { kind: "error", text: res.message ?? "Falha ao desfazer." },
      ]);
      if (res.ok) setSnapshot(null);
      router.refresh();
    });
  }

  const canSend =
    !genPending &&
    description.trim().length > 0 &&
    (sessionTarget
      ? true
      : mode === "new"
        ? bases.length > 0
        : Boolean(boardId));

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="size-4" />
        Criar com IA
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Dashboards com IA</SheetTitle>
            <SheetDescription>
              Crie um dashboard do zero, crie a partir de um existente ou edite
              um dashboard conversando com a IA. Você também pode exportar o
              JSON de um dashboard pelo menu ⋮ do card.
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-5 px-4 pb-6">
            {/* -------- Modo -------- */}
            <div className="flex flex-col gap-2">
              <Label>Modo</Label>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(MODE_LABELS) as AiDashboardMode[]).map((m) => (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={mode === m ? "default" : "outline"}
                    onClick={() => changeMode(m)}
                  >
                    {MODE_LABELS[m]}
                  </Button>
                ))}
              </div>
              <p className="text-muted-foreground text-xs">
                {mode === "new"
                  ? "Gera um dashboard novo a partir da sua descrição."
                  : mode === "from"
                    ? "Usa um dashboard existente como referência e cria um NOVO com as mudanças pedidas (o original fica intacto)."
                    : "Atualiza o próprio dashboard: a IA altera/adiciona widgets, mas NUNCA exclui (remoção é manual)."}
              </p>
            </div>

            {/* -------- Alvo/insumos por modo -------- */}
            {mode === "new" ? (
              <div className="flex flex-col gap-2">
                <Label>Bases do dashboard (uma ou várias)</Label>
                <div className="flex flex-col gap-1.5 rounded-md border p-3">
                  {rootSources.map((s) => (
                    <label
                      key={s.key}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={bases.includes(s.key)}
                        onCheckedChange={(v) => toggleBase(s.key, v === true)}
                      />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Label>
                  {mode === "from" ? "Dashboard de referência" : "Dashboard a editar"}
                </Label>
                <Select value={boardId} onValueChange={changeBoard}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha um dashboard…" />
                  </SelectTrigger>
                  <SelectContent>
                    {boards.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                        {b.factoryPreset ? " · preset de fábrica" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {boards.length === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    Você ainda não tem dashboards (próprios) para usar aqui.
                  </p>
                ) : null}
                {mode === "edit" && selectedBoard?.factoryPreset ? (
                  <p className="text-xs text-amber-600">
                    Este dashboard é um preset de fábrica: ao editá-lo por IA,
                    ele deixa de receber atualizações do preset (o preset pode
                    ser recriado à parte em Configurações → Presets).
                  </p>
                ) : null}
              </div>
            )}

            {/* -------- Sessão de conversa com a IA -------- */}
            <div className="border-primary/30 bg-primary/5 flex flex-col gap-2 rounded-md border p-3">
              <Label className="flex items-center gap-2">
                <Wand2 className="size-4" /> Conversa com a IA
              </Label>

              {aiReady ? (
                <>
                  <AiChatLog entries={chat} busy={genPending} className="max-h-72" />

                  {pending ? (
                    <div className="flex flex-col gap-2 rounded-md border border-amber-400/60 bg-amber-50 p-2 text-xs dark:bg-amber-950/30">
                      <p className="font-medium">
                        Prévia pronta — {pending.summary.length} widget(s):
                      </p>
                      <ul className="max-h-32 list-disc overflow-y-auto pl-5">
                        {pending.summary.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={genPending}
                          onClick={applyPending}
                        >
                          Aplicar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={genPending}
                          onClick={() => setPending(null)}
                        >
                          Descartar
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={
                      sessionActive
                        ? "Continue a conversa — ex.: aumente o gráfico de MRR e adicione um funil por etapa."
                        : mode === "edit"
                          ? "O que melhorar neste dashboard? Ex.: adicione comparação com o mês anterior nos cards."
                          : mode === "from"
                            ? "O que mudar em relação à referência? Ex.: mesma estrutura, mas focado em Leads."
                            : "Descreva o dashboard que você quer — ex.: conversão de leads por mês, com meta e comparação."
                    }
                    className="h-20"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      disabled={!canSend}
                      onClick={runTurn}
                    >
                      {genPending ? (
                        "Gerando…"
                      ) : (
                        <>
                          {sessionActive ? (
                            <Send className="size-4" />
                          ) : (
                            <Wand2 className="size-4" />
                          )}
                          {sessionActive ? "Enviar" : "Gerar com IA"}
                        </>
                      )}
                    </Button>
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                      <Checkbox
                        checked={autoApply}
                        onCheckedChange={(v) => setAutoApply(v === true)}
                      />
                      Aplicar automaticamente
                    </label>
                    {sessionTarget ? (
                      <Button asChild size="sm" variant="outline">
                        <Link
                          href={`/dashboards/${sessionTarget.id}`}
                          target="_blank"
                        >
                          <ExternalLink className="size-4" /> Abrir dashboard
                        </Link>
                      </Button>
                    ) : null}
                    {snapshot ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={genPending}
                        onClick={undoLastEdit}
                      >
                        <Undo2 className="size-4" /> Desfazer edição da IA
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {genPending
                      ? "Chamando a IA e validando o resultado — pode levar um minuto em dashboards grandes."
                      : `Usa ${ai?.provider} · ${ai?.model}. ${
                          autoApply
                            ? "Cada mensagem já aplica as mudanças (dá para desfazer a última edição)."
                            : "Cada mensagem gera uma prévia; nada é aplicado sem o seu OK."
                        }`}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground text-xs">
                  Nenhum provedor de IA configurado para esta organização. Um
                  administrador pode conectar Gemini, Claude ou OpenAI em{" "}
                  <Link
                    href="/configuracoes/integracoes"
                    className="underline"
                    onClick={() => setOpen(false)}
                  >
                    Configurações → Integrações
                  </Link>
                  . {mode === "new" ? "Você ainda pode gerar manualmente abaixo." : ""}
                </p>
              )}
            </div>

            {/* -------- Fluxo manual (só Criar novo) -------- */}
            {mode === "new" ? (
              <>
                <div className="flex flex-col gap-2">
                  <Label>Ou gere manualmente (copiar prompt → colar JSON)</Label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={bases.length === 0 || copyPending}
                      onClick={() => copyPrompt("compacto")}
                    >
                      {copied === "compacto" ? (
                        <Check className="size-4" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                      {copied === "compacto" ? "Copiado!" : "Copiar prompt (compacto)"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={bases.length === 0 || copyPending}
                      onClick={() => copyPrompt("completo")}
                    >
                      {copied === "completo" ? (
                        <Check className="size-4" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                      {copied === "completo"
                        ? "Copiado!"
                        : "Copiar prompt (completo, com manual)"}
                    </Button>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Compacto: especificação do JSON + modelo da Base + amostra —
                    para IAs mais capazes. Completo: anexa também o manual de
                    construção inteiro — para IAs menos capazes (prompt bem
                    maior).
                  </p>
                  {copyPending ? (
                    <p className="text-muted-foreground text-sm" role="status">
                      Montando o prompt (modelo das Bases + amostras de dados)…
                    </p>
                  ) : null}
                  {copyError ? (
                    <p className="text-destructive text-sm" role="status">
                      {copyError}
                    </p>
                  ) : null}
                  {manualPrompt ? (
                    <div className="flex flex-col gap-1">
                      <p className="text-muted-foreground text-xs">
                        Seu navegador bloqueou a cópia automática — selecione e
                        copie manualmente:
                      </p>
                      <Textarea
                        readOnly
                        value={manualPrompt}
                        className="h-32 font-mono text-xs"
                        onFocus={(e) => e.currentTarget.select()}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="import-json">JSON devolvido pela IA</Label>
                  <Textarea
                    id="import-json"
                    value={json}
                    onChange={(e) => setJson(e.target.value)}
                    placeholder='{ "formato": "dashboard-import", "versao": 1, ... }'
                    className="h-40 font-mono text-xs"
                  />
                  <Button
                    type="button"
                    disabled={!json.trim() || importPending}
                    onClick={runImport}
                  >
                    {importPending ? "Importando…" : "Importar dashboard"}
                  </Button>
                </div>

                {result && !result.ok ? (
                  <div className="flex flex-col gap-2" role="status">
                    <p className="text-destructive text-sm">{result.message}</p>
                    {result.errors && result.errors.length > 0 ? (
                      <ul className="text-destructive max-h-60 list-disc space-y-1 overflow-y-auto rounded-md border border-destructive/30 p-3 pl-7 text-xs">
                        {result.errors.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
                {result?.warnings && result.warnings.length > 0 ? (
                  <ul className="text-muted-foreground max-h-40 list-disc space-y-1 overflow-y-auto rounded-md border p-3 pl-7 text-xs">
                    {result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

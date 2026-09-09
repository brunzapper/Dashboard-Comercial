// Versão: 1.6 | Data: 09/09/2026
// v1.6 (09/09/2026): o corpo do editor saiu para
//   components/kanban/automation-rule-editor.tsx. O sheet ficou com a LISTA
//   de regras e o estado; o editor é o MESMO componente que a tela de
//   construção do Workflow renderiza — antes ele estava preso aqui dentro, e
//   uma automação de BASE (que não tem quadro para abrir) não tinha porta de
//   edição nenhuma.
// v1.5 (09/09/2026): ação "Série de tarefas" (create_task_series) — a cobrança
//   RECORRENTE. O editor separa as duas datas que o pedido separa: a condição
//   diz QUEM entra (etapa = Nutrição) e a ÂNCORA diz de quando contar (a
//   mudança de etapa). A cadência aqui é o PADRÃO; as exceções por responsável,
//   registro ou campo são dado, editáveis fora do construtor.
// Versão: 1.4 | Data: 09/09/2026
// v1.4 (09/09/2026): o painel aceita dono de BASE (`AutomationOwner`, não
//   `KanbanOwner`) — é ele que o Workflow monta para criar a regra sem quadro
//   que a 0127 tornou possível e nenhuma tela oferecia. Sem colunas, as opções
//   que exigem quadro aparecem DESABILITADAS com motivo, nunca escondidas
//   (precedente do editor de fórmulas).
// Versão: 1.3 | Data: 09/09/2026
// v1.3 (09/09/2026): ação "Executar esquema" (run_schema). Nasce em SIMULAÇÃO —
//   o switch começa marcado e desarmá-lo é um ato do admin, porque esta é a
//   única ação que produz efeito fora do sistema sozinha. O aviso de esquema
//   IRREVERSÍVEL (que cria algo) vem do catálogo, derivado dos passos. Sem
//   esquema disponível a opção aparece DESABILITADA com motivo, nunca oculta
//   (precedente do editor de fórmulas).
// Versão: 1.2 | Data: 08/09/2026
// v1.2 (08/09/2026): ação "Abrir tarefa" (create_task). Idempotente por regra ×
//   registro (índice único da 0129) — reexecutar não duplica; concluída a
//   tarefa, a regra cobra de novo se a condição voltar a valer.
// Painel "Automações" do kanban (modo registros, sem bucket de data): lista de
// regras (ordem = ordem de avaliação; primeira que casa vence), editor de
// condições das 4 famílias — Campo do registro / Registros conectados /
// Tarefas / Tempo — mescláveis em E na MESMA regra, ações "Mover para a
// coluna" e "Definir campo" e "Executar agora" (fora do tick). Status por
// regra (última execução / ações / erro) vem do bookkeeping do engine. Campos
// via getAutomationFieldOptions (buildAvailableFields + toFieldOptions —
// nunca listas paralelas; alvos do "Definir campo" em settableFields, mesma
// régua de setFieldTargetError). Feedback inline (role="status"/"alert").
// v1.2 (31/07/2026): ação set_field — seletor de ação, picker de campo
//   gravável e editor de valor por tipo (seleção usa o picker de rótulos;
//   booleano vira Sim/Não; número vira input numérico).
// v1.1 (31/07/2026): valor de condição AMIGÁVEL — responsável/operação/etapa e
//   campos seleção ganham picker de rótulos (FilterValuePicker). A avaliação
//   compara a coluna CRUA (evaluate.ts, fora do pipeline do engine — sem
//   expansão de grupo canônico, limitação documentada), então relações GRAVAM
//   O ID (storeAs "value") e o picker exibe o rótulo; `in` guarda array.
"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Pencil, Play, Plus, Trash2, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { ComboboxOption } from "@/components/ui/combobox";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ResizableSheetContent } from "@/components/ui/resizable-sheet-content";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { notifyOnError } from "@/lib/feedback/notify";
import type { KanbanColumn } from "@/lib/kanban/types";
import { DEFAULT_SERIES_LOOKAHEAD } from "@/lib/series/types";
import {
  deleteAutomation,
  getAutomationFieldOptions,
  listAutomations,
  reorderAutomations,
  runAutomationsNow,
  saveAutomation,
  type AutomationFieldCatalog,
} from "@/lib/kanban/automations/actions";
import type {
  AutomationOwner,
  AutomationRow,
} from "@/lib/kanban/automations/types";
import {
  ACTION_OPTIONS,
  AutomationRuleEditor,
  emptyCond,
  draftToRule,
  ruleToDraft,
  type RuleDraft,
} from "./automation-rule-editor";


function fmtWhen(iso: string | null): string {
  if (!iso) return "nunca";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

// ---------- componente ----------

export function AutomationsSheet({
  owner,
  source,
  columns,
  isCustomColumns,
}: {
  // AutomationOwner, não KanbanOwner: desde a 0127 a regra pode ter uma BASE
  // como dono, e o painel é o mesmo — quem monta a tela é que muda (o quadro,
  // ou o Workflow). `owner` aqui só é repassado às actions de automação.
  owner: AutomationOwner;
  source?: string;
  columns: KanbanColumn[];
  // Colunas "Personalizar": habilita a base de tempo "Na coluna atual".
  isCustomColumns: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AutomationRow[]>([]);
  const [catalog, setCatalog] = useState<AutomationFieldCatalog | null>(null);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [confirmDelete, setConfirmDelete] = useState<AutomationRow | null>(
    null
  );
  const [pending, startTransition] = useTransition();

  const targetOptions: ComboboxOption[] = columns
    .filter((c) => !c.noDrop)
    .map((c) => ({ value: c.key, label: c.label }));

  const reload = useCallback(() => {
    startTransition(async () => {
      const res = await listAutomations(owner);
      if (res.ok && res.rows) setRows(res.rows);
      else if (res.message) setMessage({ ok: false, text: res.message });
    });
  }, [owner]);

  useEffect(() => {
    if (!open) return;
    reload();
    if (!catalog) {
      // `owner` resolve o allocationFieldKey (filtra o campo espelho do
      // picker de "Definir campo").
      void getAutomationFieldOptions(source, owner).then((res) => {
        if (res.ok && res.catalog) setCatalog(res.catalog);
      });
    }
  }, [open, reload, catalog, source, owner]);

  const fieldOptions = (catalog?.fields ?? []) as ComboboxOption[];
  const relSourceOptions: ComboboxOption[] = (catalog?.sources ?? []).map(
    (s) => ({ value: s.value, label: s.label })
  );

  // Sem quadro (dono de Base) não há posição para medir; com colunas derivadas
  // de campo também não. A opção aparece DESABILITADA com o motivo — esconder
  // faria a pessoa procurar o que não existe (precedente do editor de fórmulas).
  const semQuadro = columns.length === 0;
  const timeBasisOptions: ComboboxOption[] = [
    { value: "created", label: "Desde a criação" },
    { value: "field_changed", label: "Desde a última alteração de um campo" },
    {
      value: "in_column",
      label: "Na coluna atual",
      ...(isCustomColumns
        ? {}
        : {
            disabledReason: semQuadro
              ? "Esta automação é de uma Base: não há quadro, e sem posição não há tempo de coluna para medir."
              : "Só em quadro com colunas “Personalizar” — nas demais, a coluna sai de um campo e não há entrada para cronometrar.",
          }),
    },
  ];

  const actionOptions: ComboboxOption[] = ACTION_OPTIONS.map((o) =>
    o.value === "move_to_column" && semQuadro
      ? {
          ...o,
          disabledReason:
            "Esta automação é de uma Base: não há quadro para onde mover. Use “Definir campo” ou “Abrir tarefa”.",
        }
      : o
  );

  function saveDraft() {
    if (!draft) return;
    const rule = draftToRule(draft);
    if (!rule) {
      setMessage({
        ok: false,
        text: "Regra incompleta: confira as condições e a ação (coluna de destino ou campo + valor).",
      });
      return;
    }
    startTransition(async () => {
      const res = await saveAutomation(owner, {
        id: draft.id,
        name: draft.name,
        enabled: draft.enabled,
        position: draft.id
          ? (rows.find((r) => r.id === draft.id)?.position ?? rows.length)
          : rows.length,
        rule,
      });
      setMessage({
        ok: Boolean(res.ok),
        text: res.message ?? (res.ok ? "Regra salva." : "Falha ao salvar."),
      });
      if (res.ok) {
        setDraft(null);
        reload();
      }
    });
  }

  function toggleEnabled(row: AutomationRow) {
    startTransition(async () => {
      const res = await saveAutomation(owner, {
        id: row.id,
        name: row.name,
        enabled: !row.enabled,
        position: row.position,
        rule: row.rule,
      });
      if (!res.ok && res.message) setMessage({ ok: false, text: res.message });
      reload();
    });
  }

  function remove(row: AutomationRow) {
    setConfirmDelete(row);
  }

  function moveRule(index: number, dir: -1 | 1) {
    const next = [...rows];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setRows(next);
    startTransition(async () => {
      // reload() ressincroniza a ordem do banco; a falha precisa aparecer
      // (antes o resultado era descartado e a lista "voltava" sem explicação).
      await notifyOnError(
        reorderAutomations(
          owner,
          next.map((r) => r.id)
        ),
        "Não foi possível reordenar as regras"
      );
      reload();
    });
  }

  function runNow() {
    startTransition(async () => {
      const res = await runAutomationsNow(owner);
      setMessage({
        ok: Boolean(res.ok),
        text: res.message ?? (res.ok ? "Executado." : "Falha ao executar."),
      });
      reload();
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1">
          <Zap className="size-4" />
          Automações
        </Button>
      </SheetTrigger>
      <ResizableSheetContent
        storageKey="panel-w:kanban-automations"
        defaultWidth={576}
        className="flex flex-col gap-4 overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>Automações do quadro</SheetTitle>
          <SheetDescription>
            Regras são avaliadas em ordem — a primeira que casar vence. Rodam
            automaticamente (a cada minuto e após cada Sync) e movem cards para
            a coluna configurada ou definem um campo do registro.
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 px-4">
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={runNow}
            disabled={pending || rows.length === 0}
          >
            <Play className="size-4" />
            Executar agora
          </Button>
          <Button
            size="sm"
            className="gap-1"
            onClick={() =>
              setDraft({
                id: null,
                name: "",
                enabled: true,
                conds: [emptyCond()],
                actionType: "move_to_column",
                taskTitle: "",
                taskDueDays: "",
                targetKey: "",
                setField: "",
                setValue: "",
                schemaKey: "",
                // Nasce em ensaio: armar é sempre um ato explícito.
                schemaSimulate: true,
                seriesTitle: "",
                seriesKey: "",
                seriesAnchorKind: "field_changed",
                seriesAnchorField: "",
                // Quinzenal: o padrão que o pedido descreve.
                seriesCadenceDays: "14",
                seriesScopes: [],
                seriesFirstAt: "apos_um_ciclo",
                seriesUntilKind: "nunca",
                seriesUntilValue: "",
                seriesGrantAttribute: "tree",
                seriesFromKind: "sempre",
                seriesFromValue: "",
                seriesDescription: "",
                seriesMaxOccurrences: "",
                seriesLookahead: String(DEFAULT_SERIES_LOOKAHEAD),
                seriesAnchorFallback: "nenhum",
                seriesMirrorBitrix: "herdar",
              })
            }
            disabled={pending || draft != null}
          >
            <Plus className="size-4" />
            Nova regra
          </Button>
        </div>

        {message ? (
          <p
            role={message.ok ? "status" : "alert"}
            className={`px-4 text-sm ${message.ok ? "text-muted-foreground" : "text-destructive"}`}
          >
            {message.text}
          </p>
        ) : null}

        {/* ---- lista de regras ---- */}
        {draft == null ? (
          <div className="flex flex-col gap-2 px-4 pb-6">
            {rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nenhuma regra ainda. Crie a primeira — ex.: “se o parceiro
                tiver 5 ou mais leads conectados, mover para Ativo”.
              </p>
            ) : null}
            {rows.map((row, i) => (
              <div key={row.id} className="rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {row.name || "Regra sem nome"}
                  </span>
                  <label className="flex items-center gap-1 text-xs">
                    <Checkbox
                      checked={row.enabled}
                      onCheckedChange={() => toggleEnabled(row)}
                      aria-label={`Regra ${row.name || i + 1} ativa`}
                    />
                    Ativa
                  </label>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title="Subir"
                    onClick={() => moveRule(i, -1)}
                    disabled={i === 0 || pending}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title="Descer"
                    onClick={() => moveRule(i, 1)}
                    disabled={i === rows.length - 1 || pending}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title="Editar"
                    onClick={() => setDraft(ruleToDraft(row, fieldOptions))}
                    disabled={pending}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive size-7"
                    title="Excluir"
                    onClick={() => remove(row)}
                    disabled={pending}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  {row.rule.conditions.length} condição(ões) →{" "}
                  {row.rule.action.type === "move_to_column" ? (
                    <>
                      mover para{" "}
                      <span className="font-medium">
                        {targetOptions.find(
                          (o) =>
                            row.rule.action.type === "move_to_column" &&
                            o.value === row.rule.action.targetKey
                        )?.label ??
                          (row.rule.action.type === "move_to_column"
                            ? row.rule.action.targetKey
                            : "")}
                      </span>
                    </>
                  ) : row.rule.action.type === "create_task" ? (
                    <>
                      abrir a tarefa{" "}
                      <span className="font-medium">
                        {row.rule.action.title}
                      </span>
                      {row.rule.action.dueInDays != null
                        ? ` (prazo ${row.rule.action.dueInDays} dia(s))`
                        : ""}
                    </>
                  ) : row.rule.action.type === "run_schema" ? (
                    <>
                      executar o esquema{" "}
                      <span className="font-medium">
                        {catalog?.schemas.find(
                          (o) =>
                            row.rule.action.type === "run_schema" &&
                            o.key === row.rule.action.schemaKey
                        )?.label ?? row.rule.action.schemaKey}
                      </span>
                      {row.rule.action.simulate ? " (apenas simulação)" : ""}
                    </>
                  ) : row.rule.action.type === "create_task_series" ? (
                    <>
                      abrir a cobrança{" "}
                      <span className="font-medium">
                        {String(row.rule.action.series.title)}
                      </span>{" "}
                      a cada {row.rule.action.series.cadence.defaultDays} dia(s)
                    </>
                  ) : (
                    <>
                      definir{" "}
                      <span className="font-medium">
                        {catalog?.settableFields.find(
                          (o) =>
                            row.rule.action.type === "set_field" &&
                            o.value === row.rule.action.field
                        )?.cleanLabel ?? row.rule.action.field}
                      </span>{" "}
                      = {row.rule.action.value}
                    </>
                  )}
                  {" · "}Última execução: {fmtWhen(row.last_run_at)}
                  {row.last_run_at != null
                    ? ` · ${row.last_moved_count} ação(ões)`
                    : ""}
                </p>
                {row.last_error ? (
                  <p role="alert" className="text-destructive mt-1 text-xs">
                    {row.last_error}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          /* ---- editor ---- */
          /* ---- editor: o MESMO componente que a tela de construção do
                 Workflow renderiza (components/kanban/automation-rule-editor).
                 Duas cópias divergiriam no primeiro campo novo. ---- */
          <AutomationRuleEditor
            draft={draft}
            setDraft={setDraft}
            catalog={catalog}
            source={source}
            targetOptions={targetOptions}
            fieldOptions={fieldOptions}
            relSourceOptions={relSourceOptions}
            timeBasisOptions={timeBasisOptions}
            actionOptions={actionOptions}
            saving={pending}
            onSave={saveDraft}
            onCancel={() => setDraft(null)}
          />
        )}

        <ConfirmDialog
          open={!!confirmDelete}
          onOpenChange={(o) => !o && setConfirmDelete(null)}
          title="Excluir regra?"
          description={
            <>
              A regra <strong>{confirmDelete?.name || "sem nome"}</strong> será
              removida e deixará de mover cards. Esta ação não pode ser
              desfeita.
            </>
          }
          onConfirm={() => {
            const target = confirmDelete;
            setConfirmDelete(null);
            if (!target) return;
            startTransition(async () => {
              const res = await deleteAutomation(owner, target.id);
              if (!res.ok && res.message)
                setMessage({ ok: false, text: res.message });
              reload();
            });
          }}
        />
      </ResizableSheetContent>
    </Sheet>
  );
}

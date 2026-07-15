// Versão: 1.0 | Data: 15/07/2026
// Widget Nota (post-it): texto dinâmico com expressões {=fórmula} (campos,
// campos calculados, totais e condicionais — avaliadas no servidor, ver
// page.tsx noteById) e hyperlinks [rótulo](@destino) para widgets (mesmo
// dashboard, outra aba ou outro dashboard — useFocusWidget centraliza o alvo).
// Edição IN-PLACE: no modo edição, clicar no papel abre um textarea no próprio
// card com autocomplete de [variáveis], botão {=} e inserção de link via
// picker. Salvar tokeniza cada {=…} (refs estáveis; renomear campo não quebra
// notas salvas), grava settings.note {text, exprs} e router.refresh() traz os
// valores novos (agregações SQL não são avaliáveis no cliente); um cache local
// por expressão evita "piscar" os valores já conhecidos.
"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, Link2, Loader2, SquareSigma, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { OperandRef } from "@/lib/records/date-operands";
import type { Formula } from "@/lib/records/formulas";
import { validateFormula } from "@/lib/records/formulas";
import { tokenizeFormulaText } from "@/lib/records/formula-text";
import { validateCondAggRefs } from "@/lib/widgets/calc-metrics";
import { formatMoney } from "@/lib/widgets/currency";
import {
  NOTE_MAX_EXPRS,
  noteLinkMarkup,
  parseNoteTemplate,
} from "@/lib/widgets/note-template";
import type {
  AppearanceSettings,
  CalcWidgetResult,
  Widget,
  WidgetLinkTarget,
} from "@/lib/widgets/types";
import { saveWidgetSettings } from "@/app/(app)/dashboards/actions";
import { useFocusWidget } from "./focus-context";
import { WidgetLinkPicker } from "./widget-link-picker";

const DEFAULT_NOTE_BG = "#fef9c3"; // amarelo post-it

// Formata o resultado de uma expressão como no card "Métrica calculada".
function formatResult(r: CalcWidgetResult | undefined): string {
  if (!r) return "…"; // ainda não computado (aguardando refresh)
  if (r.text != null) return r.text;
  if (r.value == null) return "—";
  return r.currency
    ? formatMoney(r.value, r.currency)
    : r.value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function NoteWidget({
  widget,
  dashboardId,
  values,
  appearance,
  canEdit,
  editMode,
  editorRefs,
}: {
  widget: Widget;
  dashboardId: string;
  // Resultados das expressões salvas (settings.note.exprs), na ordem do texto.
  values?: CalcWidgetResult[];
  appearance?: AppearanceSettings["note"];
  canEdit: boolean;
  editMode: boolean;
  // Catálogo agregado (mesmo do widget calculado) p/ autocomplete e validação.
  editorRefs: OperandRef[];
}) {
  const focus = useFocusWidget();
  const router = useRouter();
  const [saving, startSaving] = useTransition();

  // Texto otimista: após salvar, o texto novo vale até o refresh trazer a prop
  // atualizada (padrão seedKey — reseta quando o servidor muda de fato).
  const serverText = widget.settings?.note?.text ?? "";
  const [seedText, setSeedText] = useState(serverText);
  const [optimistic, setOptimistic] = useState<string | null>(null);
  if (seedText !== serverText) {
    setSeedText(serverText);
    setOptimistic(null);
  }
  const text = optimistic ?? serverText;

  // Resultados por FONTE da expressão (e não por índice): os valores do
  // servidor alinham por índice com as exprs SALVAS; chavear pela fonte faz
  // as expressões inalteradas manterem o valor após uma edição otimista que
  // reordena/insere expressões (as novas mostram "…" até o refresh chegar).
  const valueBySource = useMemo(() => {
    const m = new Map<string, CalcWidgetResult>();
    parseNoteTemplate(serverText).sources.forEach((s, i) => {
      const r = values?.[i];
      if (r) m.set(s, r);
    });
    return m;
  }, [serverText, values]);

  const parsed = useMemo(() => parseNoteTemplate(text), [text]);

  // ----- Edição in-place -----
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState<WidgetLinkTarget | undefined>();
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const startEditing = () => {
    if (!editMode || !canEdit || editing) return;
    setDraft(text);
    setError(null);
    setEditing(true);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  // Autocomplete de [variável]: só dentro de um bloco {=…} aberto (fora dele,
  // '[' é markup de link, inserido inteiro pelo picker).
  const frag = useMemo(() => {
    const upto = draft.slice(0, cursor);
    const exprOpen = upto.lastIndexOf("{=");
    if (exprOpen < 0 || upto.lastIndexOf("}") > exprOpen) return null;
    const open = upto.lastIndexOf("[");
    if (open < 0 || open < exprOpen) return null;
    if (upto.lastIndexOf("]") > open) return null;
    return { start: open, query: upto.slice(open + 1) };
  }, [draft, cursor]);
  const suggestions = useMemo(() => {
    if (!frag) return [];
    const q = frag.query.trim().toLocaleLowerCase("pt-BR");
    return editorRefs
      .filter((r) => r.label.toLocaleLowerCase("pt-BR").includes(q))
      .slice(0, 8);
  }, [frag, editorRefs]);

  const focusDraftAt = (pos: number) => {
    requestAnimationFrame(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(pos, pos);
      setCursor(pos);
    });
  };

  const insertRef = (r: OperandRef) => {
    if (!frag) return;
    const inserted = `[${r.label}]`;
    const next = draft.slice(0, frag.start) + inserted + draft.slice(cursor);
    setDraft(next);
    setSuggestIndex(0);
    focusDraftAt(frag.start + inserted.length);
  };

  const insertAtCursor = (snippet: string, cursorOffset?: number) => {
    const pos = taRef.current?.selectionStart ?? draft.length;
    const next = draft.slice(0, pos) + snippet + draft.slice(pos);
    setDraft(next);
    focusDraftAt(pos + (cursorOffset ?? snippet.length));
  };

  // Insere o link: usa o texto selecionado como rótulo; senão um placeholder.
  const insertLink = (t: WidgetLinkTarget, suggestedLabel?: string) => {
    const ta = taRef.current;
    const selStart = ta?.selectionStart ?? draft.length;
    const selEnd = ta?.selectionEnd ?? selStart;
    const selected = draft.slice(selStart, selEnd).trim();
    const label = selected || suggestedLabel || "link";
    const markup = noteLinkMarkup(label, t);
    const next = draft.slice(0, selStart) + markup + draft.slice(selEnd);
    setDraft(next);
    setLinkOpen(false);
    setLinkTarget(undefined);
    focusDraftAt(selStart + markup.length);
  };

  const save = () => {
    const { sources } = parseNoteTemplate(draft);
    if (sources.length > NOTE_MAX_EXPRS) {
      setError(
        `Máximo de ${NOTE_MAX_EXPRS} cálculos {=…} por nota (há ${sources.length}).`
      );
      return;
    }
    const exprs: Formula[] = [];
    for (let i = 0; i < sources.length; i++) {
      const t = tokenizeFormulaText(sources[i], editorRefs);
      if (!t.ok) {
        setError(`Cálculo ${i + 1}: ${t.error}`);
        return;
      }
      const v = validateFormula(
        t.formula,
        new Set(editorRefs.map((r) => r.ref))
      );
      if (!v.ok) {
        setError(`Cálculo ${i + 1}: ${v.error ?? "fórmula inválida."}`);
        return;
      }
      const p = validateCondAggRefs(t.formula, editorRefs);
      if (!p.ok) {
        setError(`Cálculo ${i + 1}: ${p.error ?? "fórmula inválida."}`);
        return;
      }
      exprs.push(t.formula);
    }
    setError(null);
    startSaving(async () => {
      const res = await saveWidgetSettings(widget.id, dashboardId, {
        ...(widget.settings ?? {}),
        note: { text: draft, exprs },
      });
      if (!res.ok) {
        setError(res.message ?? "Falha ao salvar.");
        return;
      }
      setOptimistic(draft);
      setEditing(false);
      router.refresh(); // valores novos das expressões vêm do servidor
    });
  };

  const style: React.CSSProperties = {
    background: appearance?.bg ?? DEFAULT_NOTE_BG,
    color: appearance?.color ?? "#1f2937",
    fontSize: appearance?.fontSize ?? 14,
  };

  if (editing) {
    return (
      <div className="flex h-full flex-col gap-1 p-2" style={style}>
        <div className="relative min-h-0 flex-1">
          <Textarea
            ref={taRef}
            value={draft}
            spellCheck={false}
            placeholder={'Texto livre… use {= SOMASE([Valor]; [Etapa] = "Ganho") } para cálculos.'}
            onChange={(e) => {
              setDraft(e.target.value);
              setCursor(e.target.selectionStart ?? 0);
              setSuggestIndex(0);
            }}
            onClick={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
            onKeyUp={(e) => {
              if (!["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(e.key))
                setCursor(e.currentTarget.selectionStart ?? 0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setEditing(false);
                return;
              }
              if (suggestions.length === 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSuggestIndex((i) => (i + 1) % suggestions.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSuggestIndex(
                  (i) => (i - 1 + suggestions.length) % suggestions.length
                );
              } else if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                insertRef(suggestions[Math.min(suggestIndex, suggestions.length - 1)]);
              }
            }}
            className="h-full min-h-0 resize-none border-0 bg-transparent font-[inherit] text-[length:inherit] text-inherit shadow-none focus-visible:ring-0"
            aria-label="Texto da nota"
          />
          {suggestions.length > 0 ? (
            <div className="bg-popover text-popover-foreground absolute top-full left-0 z-30 mt-1 w-full rounded-md border p-1 shadow-md">
              {suggestions.map((r, i) => (
                <button
                  key={r.ref}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertRef(r);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1 text-left text-sm",
                    i === suggestIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  )}
                >
                  <span className="truncate">{r.label}</span>
                  {r.group ? (
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {r.group}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {error ? (
          <p className="text-destructive flex items-center gap-1 text-xs">
            <CircleAlert className="size-3.5 shrink-0" /> {error}
          </p>
        ) : null}
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            title="Inserir cálculo {=…}"
            onClick={() => insertAtCursor("{=  }", 3)}
          >
            <SquareSigma className="size-3.5" /> Cálculo
          </Button>
          <Popover open={linkOpen} onOpenChange={setLinkOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                title="Inserir link para widget"
              >
                <Link2 className="size-3.5" /> Link…
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="start">
              <div className="flex flex-col gap-2">
                <WidgetLinkPicker
                  currentDashboardId={dashboardId}
                  value={linkTarget}
                  onChange={(t) => setLinkTarget(t)}
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-7 self-end text-xs"
                  disabled={!linkTarget}
                  onClick={() => linkTarget && insertLink(linkTarget)}
                >
                  Inserir link
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <div className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setEditing(false)}
            disabled={saving}
          >
            <X className="size-3.5" /> Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={save}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            Salvar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "h-full overflow-auto p-3",
        editMode && canEdit && "cursor-text"
      )}
      style={style}
      onClick={startEditing}
      title={editMode && canEdit ? "Clique para editar a nota" : undefined}
    >
      {text.trim() ? (
        <p className="break-words whitespace-pre-wrap">
          {parsed.parts.map((part, i) => {
            if (part.kind === "text") return <span key={i}>{part.text}</span>;
            if (part.kind === "expr") {
              return (
                <span key={i} className="font-semibold tabular-nums">
                  {formatResult(valueBySource.get(part.source))}
                </span>
              );
            }
            return (
              <button
                key={i}
                type="button"
                className="cursor-pointer underline underline-offset-2"
                style={{ color: appearance?.linkColor ?? "#1d4ed8" }}
                onClick={(e) => {
                  if (editMode && canEdit) return; // clique edita, não navega
                  e.stopPropagation();
                  focus(part.target);
                }}
              >
                {part.label}
              </button>
            );
          })}
        </p>
      ) : (
        <p className="text-sm opacity-50">
          {editMode && canEdit
            ? "Clique para escrever a nota…"
            : "Nota vazia."}
        </p>
      )}
    </div>
  );
}

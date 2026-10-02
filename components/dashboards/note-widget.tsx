// Versão: 1.5 | Data: 02/10/2026
// v1.5 (02/10/2026): menu "Formatação" no editor (título, subtítulo, kicker,
//   lista, negrito, itálico, filete, comentário de autor) — a sintaxe do
//   markdown leve só era conhecida por quem lia o preset; o botão aplica o
//   formato na linha/seleção (lib/widgets/note-format.ts) e mostra o atalho.
// v1.4 (02/10/2026): tamanhos de fonte fixos (10px/11px em classe) trocados
//   pela escala nomeada text-2xs/text-micro (globals.css); guarda em
//   tests/no-arbitrary-font-size.test.ts.
// Versão: 1.3 | Data: 02/10/2026
// v1.3 (02/10/2026): BLOCO DE TEXTO de apresentação. (a) MARKDOWN LEVE
//   (lib/widgets/note-blocks.ts): kicker ^^, títulos #/##/###, listas,
//   citação, filete ---, **negrito**, *itálico*, link externo [x](https://…)
//   e o comentário de autor (( … )) que só aparece no modo edição. Texto sem
//   marcação segue no parágrafo único de sempre. (b) appearance.note.variant
//   (postit | texto | comentario | rodape), align, valign e padding. (c) Num
//   board com ESTILO, nota sem cor própria usa a superfície e a tinta do
//   estilo (sem o amarelo), e os títulos saem na fonte de exibição.
// Versão: 1.2 | Data: 07/08/2026
// v1.2 (07/08/2026): save OTIMISTA em background (useBackgroundSave): o editor
// fecha na hora com o texto novo em tela; os {=…} novos mostram "…" até o
// refresh debounced do hook trazer os valores; erro → toast + o editor REABRE
// com o draft intacto. O transition global (useNavPending) saiu deste fluxo.
// Widget Nota (post-it): texto dinâmico com expressões {=fórmula} (campos,
// campos calculados, totais e condicionais — avaliadas no servidor, ver
// page.tsx noteById) e hyperlinks [rótulo](@destino) para widgets (mesmo
// dashboard, outra aba ou outro dashboard — useFocusWidget centraliza o alvo).
// Edição IN-PLACE: no modo edição, clicar no papel abre um textarea no próprio
// card com autocomplete de [variáveis], botão {=} e inserção de link via
// picker. Salvar tokeniza cada {=…} (refs estáveis; renomear campo não quebra
// notas salvas), grava settings.note {text, exprs} e o refresh debounced traz
// os valores novos (agregações SQL não são avaliáveis no cliente); um cache
// local por expressão evita "piscar" os valores já conhecidos.
"use client";

import { useMemo, useRef, useState } from "react";
import { Check, CircleAlert, Heading, Link2, Loader2, SquareSigma, X } from "lucide-react";

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
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import { saveWidgetSettings } from "@/app/(app)/dashboards/actions";
import { useFocusWidget } from "./focus-context";
import { useFontScale } from "./font-scale-context";
import { useDashboardStyle } from "./dashboard-style-context";
import { isClassicStyle, isSerifDisplay } from "@/lib/dashboards/style";
import {
  buildNoteBlocks,
  hasNoteMarkup,
  type NoteBlock,
  type NoteRun,
} from "@/lib/widgets/note-blocks";
import { WidgetLinkPicker } from "./widget-link-picker";
import { applyNoteFormat, NOTE_FORMATS, type NoteFormatKind } from "@/lib/widgets/note-format";

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
  const fontScale = useFontScale();
  const dstyle = useDashboardStyle();
  const styled = !isClassicStyle(dstyle);
  const { save: backgroundSave, hasPending: saving } = useBackgroundSave();

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

  // v1.5: aplica um formato do markdown leve na linha/seleção.
  const [formatOpen, setFormatOpen] = useState(false);
  const applyFormat = (kind: NoteFormatKind) => {
    const ta = taRef.current;
    const r = applyNoteFormat(
      draft,
      ta?.selectionStart ?? draft.length,
      ta?.selectionEnd ?? draft.length,
      kind
    );
    setDraft(r.text);
    setFormatOpen(false);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(r.selStart, r.selEnd);
      setCursor(r.selEnd);
    });
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
    // Otimista: fecha o editor JÁ com o texto novo em tela ({=…} novos mostram
    // "…" até o refresh debounced reconciliar — valueBySource preserva os
    // valores das expressões inalteradas). Erro → toast + o editor REABRE com
    // o draft intacto (setEditing direto, sem startEditing — não reseta draft).
    setOptimistic(draft);
    setEditing(false);
    backgroundSave({
      key: "note",
      context: "Não foi possível salvar a nota",
      action: () =>
        saveWidgetSettings(widget.id, dashboardId, {
          ...(widget.settings ?? {}),
          note: { text: draft, exprs },
        }),
      revert: () => {
        setOptimistic(null);
        setEditing(true);
      },
    });
  };

  // v1.3: papel do bloco. Ausente = post-it (Clássico) — num board com
  // estilo, o post-it sem cor própria vira texto sobre a superfície.
  const variant = appearance?.variant ?? "postit";
  const paperless = variant !== "postit" || (styled && !appearance?.bg);
  const style: React.CSSProperties = {
    background: appearance?.bg ?? (paperless ? undefined : DEFAULT_NOTE_BG),
    color:
      appearance?.color ??
      (variant === "comentario" || variant === "rodape"
        ? "var(--muted-foreground)"
        : paperless
          ? undefined
          : "#1f2937"),
    // Px explícito é absoluto; Auto acompanha a escala de fonte do dashboard.
    fontSize:
      appearance?.fontSize ??
      Math.round(
        (variant === "rodape" ? 12 : 14) *
          fontScale *
          (styled ? dstyle.fontScale.labels : 1)
      ),
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
          <Popover open={formatOpen} onOpenChange={setFormatOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                title="Títulos, listas, negrito, filete e comentário de autor"
              >
                <Heading className="size-3.5" /> Formatação
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-1" align="start">
              {NOTE_FORMATS.map((f) => (
                <button
                  key={f.kind}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyFormat(f.kind)}
                  className="hover:bg-accent flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1 text-left text-sm"
                >
                  <span>{f.label}</span>
                  <code className="text-muted-foreground text-xs">{f.hint}</code>
                </button>
              ))}
            </PopoverContent>
          </Popover>
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
        <p className="text-muted-foreground text-2xs leading-snug">
          Variação vs. período anterior: {"{=VARPCT([MRR])}"} (%, já ×100),
          {" {=VARABS(...)}"} (absoluta) e {"{=ANTERIOR(...)}"} (valor do
          período anterior). 2º argumento opcional: &quot;anterior&quot; ou
          &quot;ano&quot; (mesmo período do ano passado).
        </p>
      </div>
    );
  }

  const markup = hasNoteMarkup(text);
  const showAuthorComments = editMode && canEdit;
  const hasLayout =
    appearance?.variant != null ||
    appearance?.align != null ||
    appearance?.valign != null ||
    appearance?.padding != null;
  const padding = appearance?.padding;
  const renderRun = (run: NoteRun, i: number) => {
    const cls = cn(run.bold && "font-semibold", run.italic && "italic");
    if (run.kind === "text") {
      return (
        <span key={i} className={cls || undefined}>
          {run.text}
        </span>
      );
    }
    if (run.kind === "expr") {
      return (
        <span key={i} className={cn("font-semibold tabular-nums", run.italic && "italic")}>
          {formatResult(valueBySource.get(run.source))}
        </span>
      );
    }
    if (run.kind === "url") {
      return (
        <a
          key={i}
          href={run.href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn("underline underline-offset-2", cls)}
          style={{ color: appearance?.linkColor ?? (styled ? "var(--ds-accent)" : "#1d4ed8") }}
          onClick={(e) => {
            if (editMode && canEdit) e.preventDefault();
            else e.stopPropagation();
          }}
        >
          {run.label}
        </a>
      );
    }
    return (
      <button
        key={i}
        type="button"
        className={cn("cursor-pointer underline underline-offset-2", cls)}
        style={{ color: appearance?.linkColor ?? (styled ? "var(--ds-accent)" : "#1d4ed8") }}
        onClick={(e) => {
          if (editMode && canEdit) return; // clique edita, não navega
          e.stopPropagation();
          focus(run.target);
        }}
      >
        {run.label}
      </button>
    );
  };

  return (
    <div
      className={cn(
        "h-full overflow-auto",
        padding == null && "p-3",
        hasLayout && "flex flex-col",
        variant === "comentario" && "border-l-2",
        variant === "rodape" && "border-t",
        editMode && canEdit && "cursor-text"
      )}
      style={{
        ...style,
        ...(padding != null ? { padding } : {}),
        ...(variant === "comentario" && padding == null
          ? { paddingLeft: "1.6em" }
          : {}),
        justifyContent:
          appearance?.valign === "center"
            ? "center"
            : appearance?.valign === "bottom"
              ? "flex-end"
              : undefined,
        textAlign: appearance?.align,
      }}
      onClick={startEditing}
      title={editMode && canEdit ? "Clique para editar a nota" : undefined}
    >
      {text.trim() && markup ? (
        <NoteBlocks
          blocks={buildNoteBlocks(parsed.parts)}
          renderRun={renderRun}
          showAuthorComments={showAuthorComments}
          displayWeight={
            styled
              ? isSerifDisplay(dstyle)
                ? dstyle.weights.regular
                : dstyle.weights.strong
              : 600
          }
        />
      ) : text.trim() ? (
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

// v1.3 (02/10/2026): render dos blocos do markdown leve. Tamanhos em EM sobre
// o fontSize do bloco — a escala inteira acompanha o tamanho escolhido (e o
// fator do modo Apresentar). Títulos usam .ds-display (a fonte de exibição do
// estilo; no Clássico, a fonte normal em negrito).
const BLOCK_SIZE: Partial<Record<NoteBlock["type"], string>> = {
  h1: "3em",
  h2: "1.85em",
  h3: "1.3em",
};

function NoteBlocks({
  blocks,
  renderRun,
  showAuthorComments,
  displayWeight,
}: {
  blocks: NoteBlock[];
  renderRun: (run: NoteRun, i: number) => React.ReactNode;
  showAuthorComments: boolean;
  displayWeight: number;
}) {
  const out: React.ReactNode[] = [];
  let list: { ordered: boolean; items: NoteBlock[] } | null = null;
  const flushList = () => {
    if (!list) return;
    const items = list.items;
    out.push(
      list.ordered ? (
        <ol key={`l${out.length}`} className="my-[0.35em] list-decimal pl-[1.4em]">
          {items.map((b, i) => (
            <li key={i} className="my-[0.15em] pl-[0.2em]">
              {b.runs.map(renderRun)}
            </li>
          ))}
        </ol>
      ) : (
        <ul key={`l${out.length}`} className="my-[0.35em] list-disc pl-[1.2em]">
          {items.map((b, i) => (
            <li key={i} className="my-[0.15em] pl-[0.2em]">
              {b.runs.map(renderRun)}
            </li>
          ))}
        </ul>
      )
    );
    list = null;
  };
  blocks.forEach((b, i) => {
    if (b.type === "li" || b.type === "oli") {
      const ordered = b.type === "oli";
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(b);
      return;
    }
    flushList();
    const key = `b${i}`;
    switch (b.type) {
      case "blank":
        out.push(<div key={key} className="h-[0.6em]" aria-hidden />);
        break;
      case "rule":
        out.push(<hr key={key} className="my-[0.6em] border-current opacity-20" />);
        break;
      case "comment":
        if (showAuthorComments) {
          out.push(
            <p key={key} className="text-[0.85em] italic opacity-50" title="Comentário do autor — não aparece fora do modo edição">
              (( {b.runs.map(renderRun)} ))
            </p>
          );
        }
        break;
      case "kicker":
        out.push(
          <p
            key={key}
            className="ds-kicker mb-[0.3em] text-[0.72em] font-semibold tracking-[0.12em] uppercase opacity-75"
            // A cor acompanha o TEXTO do bloco (capa escura, comentário…), não
            // o cinza fixo do kicker do estilo — sobre fundo escuro ele sumia.
            style={{ color: "inherit" }}
          >
            {b.runs.map(renderRun)}
          </p>
        );
        break;
      case "h1":
      case "h2":
      case "h3":
        out.push(
          <p
            key={key}
            role="heading"
            aria-level={b.type === "h1" ? 1 : b.type === "h2" ? 2 : 3}
            className="ds-display mt-[0.15em] mb-[0.25em] leading-[1.08] tracking-tight"
            style={{ fontSize: BLOCK_SIZE[b.type], fontWeight: displayWeight }}
          >
            {b.runs.map(renderRun)}
          </p>
        );
        break;
      case "quote":
        out.push(
          <blockquote key={key} className="my-[0.3em] border-l-2 border-current/30 pl-[0.8em] opacity-80">
            {b.runs.map(renderRun)}
          </blockquote>
        );
        break;
      default:
        out.push(
          <p key={key} className="leading-[1.45] break-words">
            {b.runs.map(renderRun)}
          </p>
        );
    }
  });
  flushList();
  return <div className="break-words">{out}</div>;
}

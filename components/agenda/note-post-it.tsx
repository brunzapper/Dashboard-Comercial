// Versão: 1.0 | Data: 28/07/2026
// POST-IT da anotação do dia (agenda_notes, 0111): painel flutuante aberto ao
// clicar no chip — estética de nota adesiva (papel colorido, leve rotação,
// sombra e canto dobrado), com visualização, edição inline, troca de cor e
// exclusão. Renderiza via BodyPortal: position:fixed dentro do widget quebraria
// com o transform do react-grid-layout (mesma ressalva do FloatingPanel).
// Permissão é attempt-and-fail: a RLS dá o veredito (autor ou admin/gestor);
// negação volta como "Sem permissão…". O papel fica CLARO nos dois temas de
// propósito — post-it é papel colorido, não superfície do app.
"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  NOTE_COLORS,
  type AgendaNoteRow,
  type NoteColor,
} from "@/lib/agenda/types";
import {
  deleteAgendaNote,
  updateAgendaNote,
} from "@/lib/agenda/notes-actions";
import { emitDataChanged } from "@/lib/tasks/events";
import { BodyPortal } from "@/components/dashboards/appearance-editing";

// Papel do post-it (painel aberto) — claro nos dois temas.
export const NOTE_PAPER_CLASSES: Record<NoteColor, string> = {
  amarelo: "bg-yellow-200 text-yellow-950",
  rosa: "bg-pink-200 text-pink-950",
  verde: "bg-green-200 text-green-950",
  azul: "bg-sky-200 text-sky-950",
  laranja: "bg-orange-200 text-orange-950",
  roxo: "bg-purple-200 text-purple-950",
};

// Tint do CHIP na célula (segue o tema — o chip é UI, o painel é papel).
export const NOTE_CHIP_CLASSES: Record<NoteColor, string> = {
  amarelo:
    "border-yellow-400/60 bg-yellow-100 text-yellow-950 dark:border-yellow-500/40 dark:bg-yellow-400/15 dark:text-yellow-100",
  rosa: "border-pink-400/60 bg-pink-100 text-pink-950 dark:border-pink-500/40 dark:bg-pink-400/15 dark:text-pink-100",
  verde:
    "border-green-400/60 bg-green-100 text-green-950 dark:border-green-500/40 dark:bg-green-400/15 dark:text-green-100",
  azul: "border-sky-400/60 bg-sky-100 text-sky-950 dark:border-sky-500/40 dark:bg-sky-400/15 dark:text-sky-100",
  laranja:
    "border-orange-400/60 bg-orange-100 text-orange-950 dark:border-orange-500/40 dark:bg-orange-400/15 dark:text-orange-100",
  roxo: "border-purple-400/60 bg-purple-100 text-purple-950 dark:border-purple-500/40 dark:bg-purple-400/15 dark:text-purple-100",
};

// Swatch da paleta (bolinhas de troca de cor).
const NOTE_SWATCH_CLASSES: Record<NoteColor, string> = {
  amarelo: "bg-yellow-300",
  rosa: "bg-pink-300",
  verde: "bg-green-300",
  azul: "bg-sky-300",
  laranja: "bg-orange-300",
  roxo: "bg-purple-300",
};

export function noteColorOf(note: AgendaNoteRow): NoteColor {
  return (NOTE_COLORS as readonly string[]).includes(note.color ?? "")
    ? (note.color as NoteColor)
    : "amarelo";
}

const PANEL_W = 288; // w-72
const PANEL_MAX_H = 360;
const MARGIN = 8;

/** "28/07" a partir de YYYY-MM-DD. */
function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

export function NotePostIt({
  note,
  anchorRect,
  onClose,
  onChanged,
}: {
  note: AgendaNoteRow;
  // Rect do chip clicado (viewport). null = centralizado (fallback).
  anchorRect: DOMRect | null;
  onClose: () => void;
  // Mutação concluída — o chamador recarrega a agenda.
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const color = noteColorOf(note);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Posição: ao lado do chip, clampada ao viewport; viewport estreito (<640px)
  // vira overlay centralizado.
  const pos = useMemo(() => {
    if (typeof window === "undefined") return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!anchorRect || vw < 640) return null;
    let x = anchorRect.right + MARGIN;
    if (x + PANEL_W + MARGIN > vw) x = anchorRect.left - PANEL_W - MARGIN;
    x = Math.max(MARGIN, Math.min(x, vw - PANEL_W - MARGIN));
    const y = Math.max(
      MARGIN,
      Math.min(anchorRect.top, vh - PANEL_MAX_H - MARGIN)
    );
    return { x, y };
  }, [anchorRect]);

  async function run(action: () => Promise<{ ok?: boolean; message?: string }>) {
    setPending(true);
    setError(null);
    const res = await action();
    setPending(false);
    if (!res.ok) {
      setError(res.message ?? "Falha ao salvar.");
      return false;
    }
    emitDataChanged({ kind: "agenda_note" });
    onChanged();
    return true;
  }

  const panel = (
    <div
      role="dialog"
      aria-label="Anotação"
      className={cn(
        "pointer-events-auto relative flex max-h-[360px] w-72 rotate-[-1deg] flex-col gap-2 rounded-sm p-3 pt-2 shadow-lg",
        // Canto dobrado (dog-ear) no canto inferior direito.
        "after:absolute after:right-0 after:bottom-0 after:border-b-[14px] after:border-l-[14px] after:border-b-black/15 after:border-l-transparent after:content-['']",
        NOTE_PAPER_CLASSES[color]
      )}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold opacity-70">
          {shortDate(note.note_date)}
        </span>
        <div className="flex items-center gap-0.5">
          {!editing ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 hover:bg-black/10"
              aria-label="Editar anotação"
              onClick={() => {
                setDraft(note.body);
                setEditing(true);
              }}
            >
              <Pencil className="size-3.5" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-6 hover:bg-black/10"
            aria-label="Excluir anotação"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 hover:bg-black/10"
            aria-label="Fechar"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {editing ? (
        <div className="flex min-h-0 flex-col gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            autoFocus
            className="border-black/20 bg-white/50 text-inherit"
            aria-label="Texto da anotação"
          />
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs hover:bg-black/10"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={pending || !draft.trim()}
              onClick={async () => {
                const ok = await run(() =>
                  updateAgendaNote(note.id, { body: draft })
                );
                if (ok) setEditing(false);
              }}
            >
              <Check className="size-3.5" /> Salvar
            </Button>
          </div>
        </div>
      ) : (
        <p className="min-h-0 overflow-y-auto text-sm break-words whitespace-pre-wrap">
          {note.body}
        </p>
      )}

      <div className="flex items-center gap-1.5 pt-1">
        {NOTE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Cor ${c}`}
            disabled={pending}
            onClick={() => void run(() => updateAgendaNote(note.id, { color: c }))}
            className={cn(
              "size-4 rounded-full border border-black/20 transition-transform hover:scale-110",
              NOTE_SWATCH_CLASSES[c],
              c === color && "ring-2 ring-black/40"
            )}
          />
        ))}
      </div>

      {confirmDelete ? (
        <div className="flex items-center justify-between gap-2 rounded-sm bg-black/10 px-2 py-1 text-xs">
          <span>Excluir a anotação?</span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs hover:bg-black/10"
              onClick={() => setConfirmDelete(false)}
              disabled={pending}
            >
              Não
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={pending}
              onClick={async () => {
                const ok = await run(() => deleteAgendaNote(note.id));
                if (ok) onClose();
              }}
            >
              Excluir
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="text-xs font-medium text-red-900" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );

  return (
    <BodyPortal>
      {/* Backdrop transparente: clique fora fecha (sem escurecer a tela). */}
      <div
        className="fixed inset-0 z-50"
        onMouseDown={onClose}
        data-testid="note-postit-backdrop"
      >
        {pos ? (
          <div
            className="pointer-events-none fixed"
            style={{ left: pos.x, top: pos.y }}
          >
            {panel}
          </div>
        ) : (
          <div className="pointer-events-none flex h-full items-center justify-center">
            {panel}
          </div>
        )}
      </div>
    </BodyPortal>
  );
}

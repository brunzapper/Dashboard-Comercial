// Versão: 1.1 | Data: 26/07/2026
// Dialog "Bases" do board (menu ⋮ do hub e do dashboard aberto): escolhe quais
// bases/sub-bases o dashboard/kanban usa (DashboardSettings.sourceScope). As
// listas de seleção de base DENTRO do board passam a ofertar só o escopo
// (catálogo efetivo — lib/config/source-scope.ts). O estado carrega LAZY no
// open via getBoardSourcesState (catálogo COMPLETO — o provider da page é o
// catálogo efetivo e esconderia as opções removidas); o save faz merge
// server-side só da chave sourceScope (saveBoardSourceScope).
// v1.1 (26/07/2026): PASTAS (0107) — heading por pasta na lista (as pastas
//   vêm da MESMA action, não do provider do layout: catálogo completo).
"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import {
  groupSourcesByFolder,
  IMPLICIT_FOLDER_LABEL,
} from "@/lib/source-folders";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  getBoardSourcesState,
  saveBoardSourceScope,
  type BoardSourcesState,
} from "@/app/(app)/dashboards/actions";

export function BoardSourcesDialog({
  boardId,
  kanban,
  open,
  onOpenChange,
}: {
  boardId: string;
  kanban: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, setState] = useState<BoardSourcesState | null>(null);
  const [restrict, setRestrict] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const noun = kanban ? "kanban" : "dashboard";

  // Recarrega a cada abertura (config pode ter mudado em outra aba/usuário).
  // setState fica DENTRO da transition (regra set-state-in-effect).
  useEffect(() => {
    if (!open) return;
    startTransition(async () => {
      setState(null);
      setError(null);
      const s = await getBoardSourcesState(boardId);
      if (!s.ok) {
        setError(s.message ?? "Falha ao carregar as bases.");
        return;
      }
      setState(s);
      setRestrict(s.scopeKeys.length > 0);
      setSelected(new Set(s.scopeKeys));
    });
  }, [open, boardId]);

  // Pastas (0107) → raízes na ordem do catálogo, subs agrupadas sob a pai (↳).
  const folderGroups = useMemo(() => {
    const cat = state?.catalog ?? [];
    const subsByParent = new Map<string, typeof cat>();
    for (const s of cat) {
      if (!s.parentKey) continue;
      const list = subsByParent.get(s.parentKey) ?? [];
      list.push(s);
      subsByParent.set(s.parentKey, list);
    }
    return groupSourcesByFolder(state?.folders ?? [], cat).map((g) => ({
      folder: g.folder,
      rows: g.roots.map((r) => ({
        root: r,
        subs: subsByParent.get(r.key) ?? [],
      })),
    }));
  }, [state]);
  const showFolders = folderGroups.some((g) => g.folder != null);

  const referenced = useMemo(
    () => new Set(state?.referencedKeys ?? []),
    [state]
  );

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveBoardSourceScope(
        boardId,
        restrict ? [...selected] : []
      );
      if (!res.ok) {
        setError(res.message ?? "Falha ao salvar.");
        return;
      }
      onOpenChange(false);
    });
  }

  const row = (s: { key: string; label: string }, sub: boolean) => (
    <label
      key={s.key}
      className={`flex items-center gap-2 text-sm ${sub ? "pl-6" : ""}`}
    >
      <input
        type="checkbox"
        className="accent-primary size-4"
        checked={selected.has(s.key)}
        onChange={() => toggle(s.key)}
        disabled={!restrict}
      />
      <span className={restrict ? "" : "text-muted-foreground"}>
        {sub ? "↳ " : ""}
        {s.label}
      </span>
      {restrict && !selected.has(s.key) && referenced.has(s.key) ? (
        <span className="text-muted-foreground text-xs">
          (em uso — continua disponível)
        </span>
      ) : null}
    </label>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Bases</SheetTitle>
          <SheetDescription>
            Quais bases este {noun} usa. As listas de seleção de base e
            sub-base dentro dele ofertam só as escolhidas — do tamanho
            necessário, não do máximo.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-8">
          {error ? (
            <p className="bg-destructive/10 text-destructive rounded-md p-2 text-xs">
              {error}
            </p>
          ) : null}
          {!state && !error ? (
            <p className="text-muted-foreground text-sm">Carregando…</p>
          ) : null}
          {state ? (
            <>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="board-sources-mode"
                    className="accent-primary size-4"
                    checked={!restrict}
                    onChange={() => setRestrict(false)}
                  />
                  Todas as bases
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="board-sources-mode"
                    className="accent-primary size-4"
                    checked={restrict}
                    onChange={() => setRestrict(true)}
                  />
                  Somente as selecionadas
                </label>
              </div>
              <div className="flex flex-col gap-2 rounded-md border p-3">
                <Label className="text-xs">Bases e sub-bases</Label>
                {folderGroups.map((g) => (
                  <div
                    key={g.folder?.id ?? "__sem_pasta__"}
                    className="flex flex-col gap-2"
                  >
                    {showFolders ? (
                      <p className="text-muted-foreground text-xs font-medium uppercase">
                        {g.folder?.label ?? IMPLICIT_FOLDER_LABEL}
                      </p>
                    ) : null}
                    {g.rows.map(({ root, subs }) => (
                      <div key={root.key} className="flex flex-col gap-2">
                        {row(root, false)}
                        {subs.map((s) => row(s, true))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground text-xs">
                Bases já usadas por widgets deste {noun} continuam funcionando
                mesmo fora da seleção.
              </p>
              <Button size="sm" onClick={save} disabled={pending}>
                Aplicar
              </Button>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

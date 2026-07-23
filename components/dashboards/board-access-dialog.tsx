// Versão: 1.0 | Data: 23/07/2026
// Dialog "Acesso" do board (menu ⋮ do hub e do dashboard aberto): junta o
// compartilhamento por FUNÇÃO (visible_to_roles, camada existente) e o
// personalizado por PESSOA (board_access, 0088) — Ver / Editar / Bloqueado.
// Override individual vence o papel (blocked revoga; view/edit concede); dono
// e admin nunca são bloqueáveis (anti-lockout na RLS). Estado carrega LAZY no
// open (getBoardAccessState); cada mudança de pessoa grava na hora
// (setBoardAccessEntry), papéis têm botão Aplicar (setBoardRoles).
"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
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
import { ROLE_LABELS, type RoleKey } from "@/lib/auth/roles";
import {
  getBoardAccessState,
  setBoardAccessEntry,
  setBoardRoles,
  type BoardAccessLevel,
  type BoardAccessState,
} from "@/app/(app)/dashboards/access-actions";

const ROLE_KEYS = Object.keys(ROLE_LABELS) as RoleKey[];

const LEVEL_LABELS: Record<BoardAccessLevel, string> = {
  view: "Ver",
  edit: "Editar",
  blocked: "Bloqueado",
};

export function BoardAccessDialog({
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
  const [state, setState] = useState<BoardAccessState | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [entries, setEntries] = useState<BoardAccessState["entries"]>([]);
  const [pickUser, setPickUser] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const noun = kanban ? "kanban" : "dashboard";

  // Recarrega a cada abertura. setState DENTRO da transition
  // (regra set-state-in-effect).
  useEffect(() => {
    if (!open) return;
    startTransition(async () => {
      setState(null);
      setError(null);
      setPickUser("");
      const s = await getBoardAccessState(boardId);
      if (!s.ok) {
        setError(s.message ?? "Falha ao carregar o acesso.");
        return;
      }
      setState(s);
      setRoles(s.roles);
      setEntries(s.entries);
    });
  }, [open, boardId]);

  const toggleRole = (r: string) =>
    setRoles((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]
    );

  function saveRoles() {
    setError(null);
    startTransition(async () => {
      const res = await setBoardRoles(boardId, roles);
      if (!res.ok) setError(res.message ?? "Falha ao salvar.");
    });
  }

  function applyEntry(userId: string, level: BoardAccessLevel | null) {
    setError(null);
    startTransition(async () => {
      const res = await setBoardAccessEntry(boardId, userId, level);
      if (!res.ok) {
        setError(res.message ?? "Falha ao salvar.");
        return;
      }
      const s = await getBoardAccessState(boardId);
      if (s.ok) setEntries(s.entries);
    });
  }

  // Contas ainda sem override (candidatas do picker "Adicionar pessoa").
  const candidates = useMemo(() => {
    const has = new Set(entries.map((e) => e.userId));
    return (state?.users ?? []).filter((u) => !has.has(u.id));
  }, [state, entries]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Acesso</SheetTitle>
          <SheetDescription>
            Quem vê este {noun}: por função e por pessoa. O ajuste individual
            vence a função (Bloqueado revoga; Ver/Editar concede).
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-8">
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
                <Label className="text-xs">Por função</Label>
                {ROLE_KEYS.map((role) => (
                  <label key={role} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-primary size-4"
                      checked={roles.includes(role)}
                      onChange={() => toggleRole(role)}
                    />
                    {ROLE_LABELS[role]}
                  </label>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={saveRoles}
                  disabled={pending}
                >
                  Aplicar funções
                </Button>
              </div>

              <div className="flex flex-col gap-2">
                <Label className="text-xs">Por pessoa</Label>
                {entries.length === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    Nenhum ajuste individual.
                  </p>
                ) : null}
                {entries.map((e) => (
                  <div key={e.userId} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {e.email}
                    </span>
                    <Select
                      value={e.level}
                      onValueChange={(v) =>
                        applyEntry(e.userId, v as BoardAccessLevel)
                      }
                      disabled={pending}
                    >
                      <SelectTrigger className="h-8 w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(
                          Object.keys(LEVEL_LABELS) as BoardAccessLevel[]
                        ).map((l) => (
                          <SelectItem key={l} value={l}>
                            {LEVEL_LABELS[l]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => applyEntry(e.userId, null)}
                      disabled={pending}
                      aria-label={`Remover ajuste de ${e.email}`}
                    >
                      ×
                    </Button>
                  </div>
                ))}

                {candidates.length > 0 ? (
                  <div className="flex items-center gap-2">
                    <Select
                      value={pickUser}
                      onValueChange={setPickUser}
                      disabled={pending}
                    >
                      <SelectTrigger className="h-8 flex-1">
                        <SelectValue placeholder="Adicionar pessoa…" />
                      </SelectTrigger>
                      <SelectContent>
                        {candidates.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending || !pickUser}
                      onClick={() => {
                        applyEntry(pickUser, "view");
                        setPickUser("");
                      }}
                    >
                      Adicionar
                    </Button>
                  </div>
                ) : null}
                <p className="text-muted-foreground text-xs">
                  Dono e Administradores sempre têm acesso (não são
                  bloqueáveis).
                </p>
              </div>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

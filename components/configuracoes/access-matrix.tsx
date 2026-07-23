// Versão: 1.0 | Data: 23/07/2026
// Matriz de acessos customizados (Configurações → Acessos, 0094): escolhe um
// usuário e ajusta, por recurso, o override individual — Áreas de
// Configurações (Padrão/Permitir/Negar), Bases (Padrão/Negar) e boards
// (Padrão/Ver/Editar/Bloqueado — board_access/0088). Cada mudança grava na
// hora (setAccessOverride/setBoardAccessEntry); o estado do usuário carrega
// lazy ao selecioná-lo (getUserAccessState).
"use client";

import { useEffect, useState, useTransition } from "react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OverrideEffect } from "@/lib/auth/access";
import {
  getUserAccessState,
  setAccessOverride,
  type UserAccessState,
} from "@/app/(app)/configuracoes/acessos/actions";
import {
  setBoardAccessEntry,
  type BoardAccessLevel,
} from "@/app/(app)/dashboards/access-actions";

interface UserOpt {
  id: string;
  email: string;
}
interface AreaOpt {
  key: string;
  label: string;
}
interface SourceOpt {
  key: string;
  label: string;
  sub: boolean;
}
interface BoardOpt {
  id: string;
  name: string;
  kanban: boolean;
  owner: string;
}

export function AccessMatrix({
  users,
  currentUserId,
  areas,
  sources,
  boards,
}: {
  users: UserOpt[];
  currentUserId: string;
  areas: AreaOpt[];
  sources: SourceOpt[];
  boards: BoardOpt[];
}) {
  const [userId, setUserId] = useState("");
  const [state, setState] = useState<UserAccessState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Carrega o estado do usuário selecionado (lazy; setState na transition).
  useEffect(() => {
    if (!userId) return;
    startTransition(async () => {
      setState(null);
      setError(null);
      const s = await getUserAccessState(userId);
      if (!s.ok) {
        setError(s.message ?? "Falha ao carregar.");
        return;
      }
      setState(s);
    });
  }, [userId]);

  async function refresh() {
    const s = await getUserAccessState(userId);
    if (s.ok) setState(s);
  }

  function applyOverride(
    type: "settings_area" | "source",
    key: string,
    effect: OverrideEffect | null
  ) {
    setError(null);
    startTransition(async () => {
      const res = await setAccessOverride(userId, type, key, effect);
      if (!res.ok) {
        setError(res.message ?? "Falha ao salvar.");
        return;
      }
      await refresh();
    });
  }

  function applyBoard(boardId: string, level: BoardAccessLevel | null) {
    setError(null);
    startTransition(async () => {
      const res = await setBoardAccessEntry(boardId, userId, level);
      if (!res.ok) {
        setError(res.message ?? "Falha ao salvar.");
        return;
      }
      await refresh();
    });
  }

  const selectCls = "h-8 w-36";
  const rowCls =
    "flex items-center justify-between gap-2 border-b py-1.5 last:border-b-0";

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Usuário</Label>
        <Select value={userId} onValueChange={setUserId}>
          <SelectTrigger className="h-9 max-w-sm">
            <SelectValue placeholder="Escolha um usuário…" />
          </SelectTrigger>
          <SelectContent>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.email}
                {u.id === currentUserId ? " (você)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <p className="bg-destructive/10 text-destructive rounded-md p-2 text-xs">
          {error}
        </p>
      ) : null}
      {userId && !state && !error ? (
        <p className="text-muted-foreground text-sm">Carregando…</p>
      ) : null}

      {state ? (
        <>
          <section className="rounded-md border p-3">
            <h2 className="mb-2 text-sm font-medium">Áreas de Configurações</h2>
            <p className="text-muted-foreground mb-2 text-xs">
              Permitir concede a área além do papel; Negar a esconde mesmo de
              quem o papel daria. (Ações de escrita continuam sujeitas ao
              papel.)
            </p>
            {areas.map((a) => (
              <div key={a.key} className={rowCls}>
                <span className="text-sm">{a.label}</span>
                <Select
                  value={state.areas[a.key] ?? "default"}
                  onValueChange={(v) =>
                    applyOverride(
                      "settings_area",
                      a.key,
                      v === "default" ? null : (v as OverrideEffect)
                    )
                  }
                  disabled={pending}
                >
                  <SelectTrigger className={selectCls}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Padrão (papel)</SelectItem>
                    <SelectItem value="allow">Permitir</SelectItem>
                    <SelectItem value="deny">Negar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </section>

          <section className="rounded-md border p-3">
            <h2 className="mb-2 text-sm font-medium">Bases</h2>
            <p className="text-muted-foreground mb-2 text-xs">
              Negar esconde a base do usuário — some dos seletores E dos dados
              dos widgets. Negar uma base leva as sub-bases junto.
            </p>
            {sources.map((s) => (
              <div key={s.key} className={rowCls}>
                <span className="text-sm">
                  {s.sub ? "↳ " : ""}
                  {s.label}
                </span>
                <Select
                  value={state.sources[s.key] === "deny" ? "deny" : "default"}
                  onValueChange={(v) =>
                    applyOverride("source", s.key, v === "deny" ? "deny" : null)
                  }
                  disabled={pending}
                >
                  <SelectTrigger className={selectCls}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Padrão</SelectItem>
                    <SelectItem value="deny">Negar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </section>

          <section className="rounded-md border p-3">
            <h2 className="mb-2 text-sm font-medium">Dashboards e kanbans</h2>
            <p className="text-muted-foreground mb-2 text-xs">
              Ver/Editar concede além do compartilhamento por função;
              Bloqueado revoga. Dono e Administradores não são bloqueáveis.
            </p>
            {boards.map((b) => (
              <div key={b.id} className={rowCls}>
                <span className="truncate text-sm">
                  {b.name}
                  <span className="text-muted-foreground">
                    {b.kanban ? " (kanban)" : ""}
                  </span>
                </span>
                {b.owner === userId ? (
                  <span className="text-muted-foreground text-xs">dono</span>
                ) : (
                  <Select
                    value={state.boards[b.id] ?? "default"}
                    onValueChange={(v) =>
                      applyBoard(
                        b.id,
                        v === "default" ? null : (v as BoardAccessLevel)
                      )
                    }
                    disabled={pending}
                  >
                    <SelectTrigger className={selectCls}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Padrão (função)</SelectItem>
                      <SelectItem value="view">Ver</SelectItem>
                      <SelectItem value="edit">Editar</SelectItem>
                      <SelectItem value="blocked">Bloqueado</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            ))}
          </section>
        </>
      ) : null}
    </div>
  );
}

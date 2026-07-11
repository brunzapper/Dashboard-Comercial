// Versão: 1.0 | Data: 11/07/2026
// Gestão de Usuários (admin): criar contas, atribuir papéis, resetar senha,
// desativar/excluir e mapear usuários do Bitrix (bitrix_user_map). Os papéis
// e o mapeamento escrevem via RLS; criar/resetar/desativar/excluir passam pela
// service role no servidor (ver actions.ts).
"use client";

import { useState, useTransition } from "react";
import { KeyRound, MoreHorizontal, Plus, Trash2, UserPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createUser,
  deleteUser,
  resetUserPassword,
  setBitrixMapping,
  setUserDisabled,
  setUserRole,
  type ActionResult,
} from "@/app/(app)/configuracoes/usuarios/actions";

export interface UserRow {
  id: string;
  email: string;
  createdAt: string | null;
  lastSignInAt: string | null;
  disabled: boolean;
  roles: string[];
}
export interface RoleOption {
  key: string;
  label: string;
}
export interface BitrixCandidate {
  bitrixId: string;
  name: string;
  mappedUserId: string | null;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function UsersManager({
  users,
  roles,
  bitrixCandidates,
  currentUserId,
}: {
  users: UserRow[];
  roles: RoleOption[];
  bitrixCandidates: BitrixCandidate[];
  currentUserId: string;
}) {
  const [, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<ActionResult | null>(null);

  // Sheet de criação de usuário.
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, startCreate] = useTransition();
  const [createError, setCreateError] = useState<string | null>(null);
  const [newRole, setNewRole] = useState("");

  // Client action do form de criação: dispara o Server Action e trata a UI
  // (fecha o Sheet no sucesso, mostra o erro no lugar).
  function handleCreate(formData: FormData) {
    startCreate(async () => {
      const res = await createUser({}, formData);
      if (res.error) {
        setCreateError(res.error);
      } else {
        setCreateError(null);
        setCreateOpen(false);
        setNewRole("");
        setFeedback(res);
      }
    });
  }

  // Diálogo de reset de senha.
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetPending, setResetPending] = useState(false);

  // Confirmação de exclusão.
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);

  // Aplica o resultado de uma action e exibe o feedback (erro ou sucesso).
  function run(action: () => Promise<ActionResult>) {
    startTransition(async () => {
      const res = await action();
      if (res && (res.error || res.success)) setFeedback(res);
      else setFeedback(null);
    });
  }

  const userOptions = [
    { value: "", label: "— sem vínculo —" },
    ...users.map((u) => ({ value: u.id, label: u.email })),
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Feedback global */}
      {feedback?.error ? (
        <p className="text-destructive text-sm" role="alert">
          {feedback.error}
        </p>
      ) : feedback?.success ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400" role="status">
          {feedback.success}
        </p>
      ) : null}

      {/* ============ Usuários ============ */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Contas de acesso</h2>
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus className="size-4" />
            Criar usuário
          </Button>
        </div>

        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Papéis</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criado</TableHead>
                <TableHead>Último login</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground text-center">
                    Nenhum usuário ainda.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.email}
                      {u.id === currentUserId ? (
                        <span className="text-muted-foreground ml-1 text-xs">(você)</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-7">
                            {u.roles.length === 0 ? (
                              <span className="text-muted-foreground">— nenhum —</span>
                            ) : (
                              <span className="flex flex-wrap gap-1">
                                {u.roles.map((r) => (
                                  <Badge key={r} variant="secondary">
                                    {roles.find((x) => x.key === r)?.label ?? r}
                                  </Badge>
                                ))}
                              </span>
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuLabel>Papéis</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {roles.map((role) => (
                            <DropdownMenuCheckboxItem
                              key={role.key}
                              checked={u.roles.includes(role.key)}
                              onCheckedChange={(checked) =>
                                run(() => setUserRole(u.id, role.key, checked === true))
                              }
                              onSelect={(e) => e.preventDefault()}
                            >
                              {role.label}
                            </DropdownMenuCheckboxItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                    <TableCell>
                      {u.disabled ? (
                        <Badge variant="destructive">Desativado</Badge>
                      ) : (
                        <Badge variant="outline">Ativo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDate(u.createdAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDate(u.lastSignInAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Ações">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => {
                              setResetTarget(u);
                              setNewPassword("");
                            }}
                          >
                            <KeyRound className="size-4" />
                            Resetar senha
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={u.id === currentUserId}
                            onSelect={() =>
                              run(() => setUserDisabled(u.id, !u.disabled))
                            }
                          >
                            {u.disabled ? "Reativar" : "Desativar"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={u.id === currentUserId}
                            onSelect={() => setDeleteTarget(u)}
                          >
                            <Trash2 className="size-4" />
                            Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* ============ Mapeamento Bitrix ============ */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-medium">Mapeamento Bitrix</h2>
          <p className="text-muted-foreground text-sm">
            Vincule cada responsável do Bitrix a um usuário do sistema (define o
            dono dos registros no sync).
          </p>
        </div>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Responsável (Bitrix)</TableHead>
                <TableHead>Bitrix ID</TableHead>
                <TableHead>Usuário do sistema</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bitrixCandidates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground text-center">
                    Nenhum responsável do Bitrix conhecido (são criados pelo sync).
                  </TableCell>
                </TableRow>
              ) : (
                bitrixCandidates.map((c) => (
                  <TableRow key={c.bitrixId}>
                    <TableCell className="font-medium">{c.name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {c.bitrixId}
                    </TableCell>
                    <TableCell>
                      <Combobox
                        options={userOptions}
                        value={c.mappedUserId ?? ""}
                        onValueChange={(value) =>
                          run(() => setBitrixMapping(c.bitrixId, value, c.name))
                        }
                        placeholder="— sem vínculo —"
                        className="w-full max-w-xs"
                        aria-label={`Usuário para ${c.name || c.bitrixId}`}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* ============ Sheet: criar usuário ============ */}
      <Sheet
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (o) setCreateError(null);
        }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Criar usuário</SheetTitle>
          </SheetHeader>
          <form action={handleCreate} className="flex flex-col gap-4 px-4 pb-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-email">Email</Label>
              <Input
                id="new-email"
                name="email"
                type="email"
                autoComplete="off"
                required
                placeholder="pessoa@empresa.com"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-password">Senha inicial</Label>
              <Input
                id="new-password"
                name="password"
                type="text"
                autoComplete="off"
                required
                minLength={6}
                placeholder="mínimo 6 caracteres"
              />
              <p className="text-muted-foreground text-xs">
                O usuário poderá trocar depois; comunique a senha a ele.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Papel inicial (opcional)</Label>
              <Combobox
                name="role"
                options={[
                  { value: "", label: "— nenhum —" },
                  ...roles.map((r) => ({ value: r.key, label: r.label })),
                ]}
                value={newRole}
                onValueChange={setNewRole}
                placeholder="— nenhum —"
                searchable={false}
                className="w-full"
                aria-label="Papel inicial"
              />
            </div>
            {createError ? (
              <p className="text-destructive text-sm" role="alert">
                {createError}
              </p>
            ) : null}
            <Button type="submit" disabled={creating}>
              <Plus className="size-4" />
              {creating ? "Criando..." : "Criar usuário"}
            </Button>
          </form>
        </SheetContent>
      </Sheet>

      {/* ============ Sheet: resetar senha ============ */}
      <Sheet
        open={!!resetTarget}
        onOpenChange={(o) => !o && setResetTarget(null)}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Resetar senha</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-4">
            <p className="text-muted-foreground text-sm">
              Nova senha para <strong>{resetTarget?.email}</strong>.
            </p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reset-password">Nova senha</Label>
              <Input
                id="reset-password"
                type="text"
                autoComplete="off"
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="mínimo 6 caracteres"
              />
            </div>
            <Button
              disabled={resetPending || newPassword.length < 6}
              onClick={() => {
                if (!resetTarget) return;
                setResetPending(true);
                startTransition(async () => {
                  const res = await resetUserPassword(resetTarget.id, newPassword);
                  setResetPending(false);
                  setFeedback(res);
                  if (!res.error) setResetTarget(null);
                });
              }}
            >
              {resetPending ? "Salvando..." : "Salvar nova senha"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* ============ Confirmação de exclusão ============ */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              A conta <strong>{deleteTarget?.email}</strong> será removida
              permanentemente, junto com seus papéis. Esta ação não pode ser
              desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteTarget) return;
                const id = deleteTarget.id;
                setDeleteTarget(null);
                run(() => deleteUser(id));
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

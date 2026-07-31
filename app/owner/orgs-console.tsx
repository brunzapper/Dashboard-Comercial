// Versão: 1.1 | Data: 23/07/2026
// Client do console do Owner: lista de organizações + form de criação (admin
// = o próprio Owner ou conta nova email/senha) + exclusão com confirmação
// digitando o NOME exato (padrão AlertDialog do board-card-menu). As actions
// re-validam o Owner no servidor — este componente é só UI.
// v1.1 (31/07/2026): toggles de RECURSOS SOB DEMANDA por org (org_features,
// 0114). O catálogo chega por props (featureDefs — dados puros; o módulo
// lib/config/org-features usa cache() de RSC e fica fora do bundle client).
"use client";

import { useActionState, useState, useTransition } from "react";
import { Building2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  createOrganizationAction,
  deleteOrganizationAction,
  setOrgFeatureAction,
  type OwnerActionState,
} from "./actions";

export interface OwnerOrgRow {
  id: string;
  name: string;
  appName: string;
  adminEmail: string;
  members: number;
  // Recursos sob demanda (0114): mapa normalizado feature → ligado.
  features: Record<string, boolean>;
}

export interface OwnerFeatureDef {
  key: string;
  label: string;
  description: string;
}

export function OwnerOrgsConsole({
  orgs,
  featureDefs,
}: {
  orgs: OwnerOrgRow[];
  featureDefs: OwnerFeatureDef[];
}) {
  const [createState, createAction, createPending] = useActionState<
    OwnerActionState,
    FormData
  >(createOrganizationAction, {});
  const [adminMode, setAdminMode] = useState<"self" | "new">("self");

  const [deleting, setDeleting] = useState<OwnerOrgRow | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [deletePending, startDelete] = useTransition();

  // Toggle de recurso sob demanda: a action revalida /owner (o estado da
  // lista volta do servidor); falha aparece inline no card da org.
  const [featureMsgByOrg, setFeatureMsgByOrg] = useState<
    Record<string, string>
  >({});
  const [featurePending, startFeature] = useTransition();

  function toggleFeature(orgId: string, key: string, enabled: boolean) {
    setFeatureMsgByOrg((m) => ({ ...m, [orgId]: "" }));
    startFeature(async () => {
      const res = await setOrgFeatureAction(orgId, key, enabled);
      if (!res.ok) {
        setFeatureMsgByOrg((m) => ({
          ...m,
          [orgId]: res.message ?? "Falha ao salvar o recurso.",
        }));
      }
    });
  }

  function runDelete() {
    if (!deleting) return;
    setDeleteMsg(null);
    startDelete(async () => {
      const res = await deleteOrganizationAction(deleting.id, confirmName);
      if (!res.ok) {
        setDeleteMsg(res.message ?? "Falha ao excluir.");
        return;
      }
      setDeleting(null);
      setConfirmName("");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {orgs.map((o) => (
          <Card key={o.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Building2 className="size-4" /> {o.name}
                </CardTitle>
                <CardDescription>
                  {o.appName} — admin: {o.adminEmail} — {o.members} membro(s)
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Excluir ${o.name}`}
                onClick={() => {
                  setDeleting(o);
                  setConfirmName("");
                  setDeleteMsg(null);
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </CardHeader>
            {featureDefs.length > 0 ? (
              <CardContent className="flex flex-col gap-1.5 pt-0">
                <p className="text-muted-foreground text-xs font-medium">
                  Recursos sob demanda
                </p>
                {featureDefs.map((f) => (
                  <label
                    key={f.key}
                    className="flex items-start gap-2 text-sm"
                    title={f.description}
                  >
                    <Checkbox
                      checked={o.features[f.key] === true}
                      disabled={featurePending}
                      onCheckedChange={(c) =>
                        toggleFeature(o.id, f.key, c === true)
                      }
                      aria-label={`${f.label} em ${o.name}`}
                    />
                    <span>{f.label}</span>
                  </label>
                ))}
                {featureMsgByOrg[o.id] ? (
                  <p className="text-destructive text-xs" role="alert">
                    {featureMsgByOrg[o.id]}
                  </p>
                ) : null}
              </CardContent>
            ) : null}
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nova organização</CardTitle>
          <CardDescription>
            Nasce vazia (nenhum dado de outras organizações). Defina quem será
            o Administrador de Organização.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createAction} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="owner-org-name" className="text-xs">
                Nome da organização
              </Label>
              <Input
                id="owner-org-name"
                name="name"
                maxLength={80}
                required
                className="h-9"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label className="text-xs">Administrador de Organização</Label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="admin_mode"
                  value="self"
                  className="accent-primary size-4"
                  checked={adminMode === "self"}
                  onChange={() => setAdminMode("self")}
                />
                Eu mesmo (Owner)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="admin_mode"
                  value="new"
                  className="accent-primary size-4"
                  checked={adminMode === "new"}
                  onChange={() => setAdminMode("new")}
                />
                Criar uma conta nova (email e senha)
              </label>
            </div>

            {adminMode === "new" ? (
              <>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="owner-admin-email" className="text-xs">
                    Email do administrador
                  </Label>
                  <Input
                    id="owner-admin-email"
                    name="admin_email"
                    type="email"
                    className="h-9"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="owner-admin-password" className="text-xs">
                    Senha do administrador
                  </Label>
                  <Input
                    id="owner-admin-password"
                    name="admin_password"
                    type="password"
                    minLength={6}
                    className="h-9"
                  />
                </div>
              </>
            ) : null}

            {createState.message ? (
              <p
                className={`text-xs ${createState.ok ? "text-muted-foreground" : "text-destructive"}`}
              >
                {createState.message}
              </p>
            ) : null}
            <Button
              type="submit"
              size="sm"
              disabled={createPending}
              className="self-start"
            >
              Criar organização
            </Button>
          </form>
        </CardContent>
      </Card>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir “{deleting?.name}” permanentemente?
            </AlertDialogTitle>
            <AlertDialogDescription>
              TODOS os dados da organização (bases, registros, dashboards,
              usuários vinculados a ela) serão excluídos em definitivo. Digite
              o nome exato para confirmar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={deleting?.name}
            className="h-9"
          />
          {deleteMsg ? (
            <p className="text-destructive text-xs">{deleteMsg}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deletePending || confirmName !== deleting?.name}
              onClick={runDelete}
            >
              Excluir organização
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

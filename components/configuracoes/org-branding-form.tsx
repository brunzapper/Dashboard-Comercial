// Versão: 1.0 | Data: 23/07/2026
// Form de branding da organização (Configurações → Organização, multi-org):
// nome do sistema (app_name) e da empresa (name). useActionState, padrão dos
// demais forms de Configurações.
"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  saveOrgBranding,
  type OrgBrandingState,
} from "@/app/(app)/configuracoes/organizacao/actions";

export function OrgBrandingForm({
  appName,
  name,
}: {
  appName: string;
  name: string;
}) {
  const [state, formAction, pending] = useActionState<
    OrgBrandingState,
    FormData
  >(saveOrgBranding, {});

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="org-app-name" className="text-xs">
          Nome do sistema
        </Label>
        <Input
          id="org-app-name"
          name="app_name"
          defaultValue={appName}
          maxLength={80}
          className="h-9"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="org-name" className="text-xs">
          Nome da empresa
        </Label>
        <Input
          id="org-name"
          name="name"
          defaultValue={name}
          maxLength={80}
          className="h-9"
        />
      </div>
      {state.message ? (
        <p
          className={`text-xs ${state.ok ? "text-muted-foreground" : "text-destructive"}`}
        >
          {state.message}
        </p>
      ) : null}
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        Salvar
      </Button>
    </form>
  );
}

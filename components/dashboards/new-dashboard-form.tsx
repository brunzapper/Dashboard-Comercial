// Versão: 1.0 | Data: 05/07/2026
// Formulário de criação de dashboard (nome + visibilidade por papel).
"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABELS, type RoleKey } from "@/lib/auth/roles";
import {
  createDashboard,
  type ActionState,
} from "@/app/(app)/dashboards/actions";

const ROLE_KEYS = Object.keys(ROLE_LABELS) as RoleKey[];
const initial: ActionState = {};

export function NewDashboardForm() {
  const [state, formAction, pending] = useActionState(createDashboard, initial);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Novo dashboard</Label>
        <Input id="name" name="name" placeholder="Ex.: Performance comercial" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Visível para (além de você)</Label>
        <div className="flex flex-wrap gap-3">
          {ROLE_KEYS.map((role) => (
            <label key={role} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="visible_to_roles"
                value={role}
                className="size-4 accent-primary"
              />
              {ROLE_LABELS[role]}
            </label>
          ))}
        </div>
      </div>
      {state.message ? (
        <p
          className={state.ok ? "text-muted-foreground text-sm" : "text-destructive text-sm"}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-fit">
        <Plus className="size-4" />
        {pending ? "Criando..." : "Criar dashboard"}
      </Button>
    </form>
  );
}

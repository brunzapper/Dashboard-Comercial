// Versão: 1.0 | Data: 04/07/2026
// Botão de logout (form + server action).
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/(auth)/login/actions";

export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        className="w-full justify-start"
      >
        <LogOut className="size-4" />
        Sair
      </Button>
    </form>
  );
}

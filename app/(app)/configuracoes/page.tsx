// Versão: 1.0 | Data: 11/07/2026
// Índice de Configurações: redireciona para a primeira sub-aba permitida.
import { redirect } from "next/navigation";

import { getSessionInfo } from "@/lib/auth/session";
import { allowedSettingsTabs } from "./layout";

export default async function ConfiguracoesIndex() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  const tabs = allowedSettingsTabs(session.roles, session.permissions);
  redirect(tabs[0]?.href ?? "/");
}

// Versão: 1.1 | Data: 31/07/2026
// Índice de Configurações: redireciona para a primeira sub-aba permitida.
// v1.1 (31/07/2026): passa org/overrides/disabledAreas ao filtro — o destino
// do redirect agora bate com as abas que o layout realmente exibe (antes o
// filtro rodava sem org e podia apontar p/ aba invisível).
import { redirect } from "next/navigation";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrg } from "@/lib/auth/org";
import { loadOwnSettingsOverrides } from "@/lib/auth/access";
import { allowedSettingsTabs, loadDisabledFeatureAreas } from "./layout";

export default async function ConfiguracoesIndex() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  const [org, overrides] = await Promise.all([
    getActiveOrg(),
    loadOwnSettingsOverrides(),
  ]);
  const tabs = allowedSettingsTabs(
    session.roles,
    session.permissions,
    org?.isOrgAdmin ?? false,
    overrides,
    await loadDisabledFeatureAreas(org)
  );
  redirect(tabs[0]?.href ?? "/");
}

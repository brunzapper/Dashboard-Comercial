// Versão: 2.1 | Data: 12/09/2026
// v2.1 (12/09/2026): volta a REDIRECIONAR para a primeira sub-aba permitida. A
//   v2.0 transformou o índice num painel de cards (molde de /operacao) e isso
//   foi revertido a pedido: com a fileira de sub-abas de volta no layout, um
//   painel de cards seria uma segunda porta para a mesma lista.
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

// Versão: 2.0 | Data: 12/09/2026
// v2.0 (12/09/2026): deixou de redirecionar para a 1ª sub-aba permitida e virou
//   o PAINEL da seção — as áreas viram cards, na mesma disposição configurável
//   do hub. É o destino do "voltar" que as páginas de área passaram a exibir:
//   com o redirect, voltar devolveria o usuário à área de onde ele saiu.
//   A régua de quem vê o quê é a MESMA de antes (allowedSettingsTabs).
// v1.1 (31/07/2026): passa org/overrides/disabledAreas ao filtro — o destino
// do redirect agora bate com as abas que o layout realmente exibe.
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrg } from "@/lib/auth/org";
import { loadOwnSettingsOverrides } from "@/lib/auth/access";
import { loadUserSettings } from "@/lib/config/user-settings";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { CardGrid } from "@/components/ui/card-grid";
import { resolveUiPrefs, userUiPrefs } from "@/lib/config/ui-prefs";
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
  // O layout já redireciona quando não sobra área nenhuma; aqui é cinto de
  // segurança para quem chega direto na rota.
  if (tabs.length === 0) redirect("/");

  const settings = await loadUserSettings(session.user.id);
  // A seção reusa a disposição dos cards de Operação: são as duas telas de
  // "escolha um módulo", e dois controles separados para a mesma decisão
  // visual seriam fricção sem ganho.
  const prefs = resolveUiPrefs(userUiPrefs(settings), org?.uiPrefs);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        Ajustes da sua conta e da organização. Você vê apenas as áreas a que tem
        acesso.
      </p>
      <CardGrid
        layout={prefs.values.operacaoLayout}
        columns={prefs.values.operacaoColumns}
      >
        {tabs.map((t) => (
          <Card key={t.href} className="relative">
            <CardHeader>
              <CardTitle>
                <Link href={t.href} className="hover:underline">
                  {t.label}
                </Link>
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </CardGrid>
    </div>
  );
}

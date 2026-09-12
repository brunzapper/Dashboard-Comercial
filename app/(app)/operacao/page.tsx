// Versão: 2.0 | Data: 12/09/2026
// v2.0 (12/09/2026): deixou de redirecionar para a primeira sub-aba e virou o
//   PAINEL da área — os cards dos módulos e formulários, na mesma disposição
//   configurável do hub (components/ui/card-grid.tsx + hub-cards.tsx). É o
//   destino do botão "voltar" que as páginas de item passaram a exibir: sem um
//   painel real, "voltar" cairia num redirect que devolveria o usuário ao item
//   de onde ele saiu.
// v1.0 (05/08/2026): índice de /operacao redirecionando à 1ª sub-aba visível.
import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrg } from "@/lib/auth/org";
import { loadUserSettings } from "@/lib/config/user-settings";
import { allowedOperacaoCards, applyCardDescriptions } from "@/lib/operacao/cards";
import { CardGrid } from "@/components/ui/card-grid";
import {
  resolveUiPrefs,
  userSidebarPins,
  userUiPrefs,
} from "@/lib/config/ui-prefs";
import {
  OperacaoCardItem,
  type HubCardDisplay,
} from "@/components/home/hub-cards";
import { HubLayoutControls } from "@/components/home/hub-layout-controls";

export const metadata = { title: "Operação" };

export default async function OperacaoIndex() {
  const session = await getSessionInfo();
  const org = await getActiveOrg();
  // checkSettingsArea/allowedOperacaoCards são cache()d por request — o layout
  // já os resolveu e esta chamada não custa consulta nova.
  const cards = applyCardDescriptions(
    await allowedOperacaoCards(),
    org?.uiPrefs.operacaoDescriptions
  );
  const settings = session ? await loadUserSettings(session.user.id) : {};
  const prefs = resolveUiPrefs(userUiPrefs(settings), org?.uiPrefs);
  const pins = userSidebarPins(settings);

  const display: HubCardDisplay = {
    layout: prefs.values.operacaoLayout,
    showDescription: prefs.values.operacaoShowDescription,
    showAccess: prefs.values.operacaoShowAccess,
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        Módulos de operação do dia a dia: agenda, tarefas e os módulos da sua
        organização.
      </p>
      <HubLayoutControls
        keys={{
          layout: "operacaoLayout",
          columns: "operacaoColumns",
          showDescription: "operacaoShowDescription",
          showAccess: "operacaoShowAccess",
        }}
        layout={display.layout}
        columns={prefs.values.operacaoColumns}
        showDescription={display.showDescription}
        showAccess={display.showAccess}
        locked={[...prefs.locked]}
        accessLabel="Quem acessa"
      />
      {cards.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nenhum módulo de operação liberado para a sua organização.
        </p>
      ) : (
        <CardGrid layout={display.layout} columns={prefs.values.operacaoColumns}>
          {cards.map((c) => (
            <OperacaoCardItem
              key={c.key}
              card={c}
              display={display}
              pinned={pins.some((p) => p.kind === "operacao" && p.id === c.key)}
            />
          ))}
        </CardGrid>
      )}
    </div>
  );
}

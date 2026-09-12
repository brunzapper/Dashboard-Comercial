// Versão: 2.1 | Data: 12/09/2026
// v2.1 (12/09/2026): exibição dos cards pelo contexto de cliente
//   (HubDisplayProvider) — os controles passam a valer no mesmo frame, sem
//   recarregar. Controles: cartão↔lista para todo mundo; engrenagem (colunas,
//   altura, descrição, quem acessa) só para admin.
// v2.0 (12/09/2026): deixou de redirecionar para a primeira sub-aba e virou o
//   PAINEL da área — os cards dos módulos e formulários, na mesma disposição
//   configurável do hub. É o destino do botão "voltar" que as páginas de item
//   passaram a exibir: sem um painel real, "voltar" cairia num redirect que
//   devolveria o usuário ao item de onde ele saiu.
// v1.0 (05/08/2026): índice de /operacao redirecionando à 1ª sub-aba visível.
import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrg } from "@/lib/auth/org";
import { areaAccessLabel } from "@/lib/auth/access";
import { loadUserSettings } from "@/lib/config/user-settings";
import { allowedOperacaoCards, applyCardDescriptions } from "@/lib/operacao/cards";
import {
  resolveUiPrefs,
  userSidebarPins,
  userUiPrefs,
} from "@/lib/config/ui-prefs";
import {
  HubGrid,
  OperacaoCardItem,
  type OperacaoCardView,
} from "@/components/home/hub-cards";
import { HubDisplayProvider } from "@/components/home/hub-display-context";
import { HubLayoutControls } from "@/components/home/hub-layout-controls";

export const metadata = { title: "Operação" };

export default async function OperacaoIndex() {
  const session = await getSessionInfo();
  const org = await getActiveOrg();
  const isAdmin = session?.roles.includes("admin") ?? false;
  // checkSettingsArea/allowedOperacaoCards são cache()d por request — o layout
  // já os resolveu e esta chamada não custa consulta nova. O `accessLabel` é
  // derivado aqui porque areaAccessLabel é server-only e o card é client.
  const cards: OperacaoCardView[] = applyCardDescriptions(
    await allowedOperacaoCards(),
    org?.uiPrefs.operacaoDescriptions
  ).map((c) => ({
    key: c.key,
    label: c.label,
    description: c.description,
    href: c.href,
    kind: c.kind,
    accessLabel: areaAccessLabel(c.area),
  }));
  const settings = session ? await loadUserSettings(session.user.id) : {};
  const prefs = resolveUiPrefs(userUiPrefs(settings), org?.uiPrefs);
  const pins = userSidebarPins(settings);

  return (
    <HubDisplayProvider
      keys={{
        layout: "operacaoLayout",
        columns: "operacaoColumns",
        cardHeight: "operacaoCardHeight",
        showDescription: "operacaoShowDescription",
        showAccess: "operacaoShowAccess",
      }}
      initial={{
        layout: prefs.values.operacaoLayout,
        columns: prefs.values.operacaoColumns,
        cardHeight: prefs.values.operacaoCardHeight,
        showDescription: prefs.values.operacaoShowDescription,
        showAccess: prefs.values.operacaoShowAccess,
      }}
      locked={[...prefs.locked]}
    >
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          Módulos de operação do dia a dia: agenda, tarefas e os módulos da sua
          organização.
        </p>
        <HubLayoutControls isAdmin={isAdmin} accessLabel="Quem acessa" />
        {cards.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nenhum módulo de operação liberado para a sua organização.
          </p>
        ) : (
          <HubGrid>
            {cards.map((c) => (
              <OperacaoCardItem
                key={c.key}
                card={c}
                pinned={pins.some(
                  (p) => p.kind === "operacao" && p.id === c.key
                )}
              />
            ))}
          </HubGrid>
        )}
      </div>
    </HubDisplayProvider>
  );
}

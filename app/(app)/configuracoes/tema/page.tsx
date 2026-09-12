// Versão: 1.2 | Data: 12/09/2026
// v1.2 (12/09/2026): a aba virou "Tema e interface" (0141) — além das cores,
//   ela reúne o padrão de INTERFACE da organização (disposição dos cards do
//   hub, descrição, nível de acesso, barra lateral) com trava por chave e o
//   "Aplicar a todos". Mora AQUI, e não numa área nova, porque chave de área é
//   histórica e irreversível (AREA_GATES) — e `tema` já é a área sem gate de
//   papel onde cada um mexe na própria aparência.
// Configurações → Tema: preferências visuais (modo claro/escuro/sistema + cor
// de destaque, default #7431B3, + cor do Ponteiro Laser, default vermelho).
// Qualquer autenticado edita a PRÓPRIA preferência; o Administrador de
// Organização também define o PADRÃO da org (0108) — a escolha individual
// prevalece (resolveTheme, lib/theme.ts). O laser não tem padrão de org.
import { requireSettingsArea } from "@/lib/auth/access";
import { getActiveOrg } from "@/lib/auth/org";
import { loadUserSettings } from "@/lib/config/user-settings";
import {
  EMPTY_THEME_TOKENS,
  normalizeHexColor,
  normalizeThemeMode,
  normalizeThemeTokens,
} from "@/lib/theme";
import { OrgUiPrefsForm } from "@/components/configuracoes/org-ui-prefs-form";
import {
  OrgThemeDefaultForm,
  TemaForm,
} from "@/components/configuracoes/tema-form";

// Título da aba (template do layout completa "— {appName}").
export const metadata = { title: "Tema e interface" };

export default async function TemaPage() {
  const session = await requireSettingsArea("tema");
  const [org, settings] = await Promise.all([
    getActiveOrg(),
    loadUserSettings(session.user.id),
  ]);
  const prefs = settings as {
    theme?: string | null;
    accentColor?: string | null;
    laserColor?: string | null;
    themeTokens?: unknown;
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">Minhas preferências</h2>
          <p className="text-muted-foreground text-sm">
            Valem só para você, em qualquer dispositivo. Sem escolha, vale o
            padrão da organização.
          </p>
        </div>
        <TemaForm
          userTheme={normalizeThemeMode(prefs.theme)}
          userAccent={normalizeHexColor(prefs.accentColor)}
          userLaser={normalizeHexColor(prefs.laserColor)}
          userTokens={normalizeThemeTokens(prefs.themeTokens)}
          orgTheme={org?.theme ?? null}
        />
        <p className="text-muted-foreground text-xs">
          A disposição dos cards do Workspace e da Operação você ajusta na
          própria tela deles — o que ficar escolhido lá vale para você em
          qualquer dispositivo.
        </p>
      </div>

      {org?.isOrgAdmin ? (
        <div className="flex flex-col gap-4 border-t pt-6">
          <div>
            <h2 className="text-lg font-semibold">Padrão da organização</h2>
            <p className="text-muted-foreground text-sm">
              Vale para todos os usuários de {org.name || "sua organização"}{" "}
              que não escolheram uma preferência própria.
            </p>
          </div>
          <OrgThemeDefaultForm
            orgMode={org.theme?.mode ?? null}
            orgAccent={org.theme?.accentColor ?? null}
            orgTokens={org.theme?.tokens ?? EMPTY_THEME_TOKENS}
          />
        </div>
      ) : null}

      {org?.isOrgAdmin ? (
        <div className="flex flex-col gap-4 border-t pt-6">
          <div>
            <h2 className="text-lg font-semibold">
              Interface padrão da organização
            </h2>
            <p className="text-muted-foreground text-sm">
              Como o Workspace, a Operação e a barra lateral aparecem para quem
              não escolheu nada — e, quando travado, para todo mundo.
            </p>
          </div>
          <OrgUiPrefsForm
            initialValues={org.uiPrefs.values}
            initialLocked={[...org.uiPrefs.locked]}
          />
        </div>
      ) : null}
    </div>
  );
}

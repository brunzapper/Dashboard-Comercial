// Versão: 1.0 | Data: 27/07/2026
// Configurações → Tema: preferências visuais (modo claro/escuro/sistema + cor
// de destaque, default #7431B3). Qualquer autenticado edita a PRÓPRIA
// preferência; o Administrador de Organização também define o PADRÃO da org
// (0108) — a escolha individual prevalece (resolveTheme, lib/theme.ts).
import { requireSettingsArea } from "@/lib/auth/access";
import { getActiveOrg } from "@/lib/auth/org";
import { loadUserSettings } from "@/lib/config/user-settings";
import { normalizeHexColor, normalizeThemeMode } from "@/lib/theme";
import {
  OrgThemeDefaultForm,
  TemaForm,
} from "@/components/configuracoes/tema-form";

export default async function TemaPage() {
  const session = await requireSettingsArea("tema");
  const [org, settings] = await Promise.all([
    getActiveOrg(),
    loadUserSettings(session.user.id),
  ]);
  const prefs = settings as {
    theme?: string | null;
    accentColor?: string | null;
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
          orgTheme={org?.theme ?? null}
        />
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
          />
        </div>
      ) : null}
    </div>
  );
}

// Versão: 1.0 | Data: 10/10/2026
// v1.0 (10/10/2026): catálogo das sub-áreas de Configurações, extraído de
//   app/(app)/configuracoes/layout.tsx para um módulo PURO e client-safe. Dois
//   consumidores precisam dos MESMOS rótulos: o menu da seção (layout, server)
//   e as migalhas da barra de local (lib/nav/breadcrumbs.ts, client). Uma
//   segunda lista de rótulos divergiria no primeiro renome.
//   Os GRUPOS existem para o menu vertical (settings-nav.tsx): a ordem aqui é
//   a ordem de exibição, e o grupo só agrupa — o gate de acesso continua em
//   AREA_GATES (lib/auth/access.ts), nunca aqui.

export type SettingsGroup = "organizacao" | "dados" | "aparencia";

export const SETTINGS_GROUP_LABELS: Record<SettingsGroup, string> = {
  organizacao: "Organização",
  dados: "Dados e operação",
  aparencia: "Aparência e conta",
};

export interface SettingsTab {
  href: string;
  label: string;
  group: SettingsGroup;
}

// Tema (preferências visuais) e Conta (senha própria) não têm gating: valem
// para qualquer autenticado. As demais seguem restritas por papel/permissão;
// "Organização" exige org_admin (0089). Bases/Log vivem em /registros/* e
// Moedas em /campos (mesmas chaves de área — ver AREA_GATES).
export const SETTINGS_TABS: SettingsTab[] = [
  { href: "/configuracoes/organizacao", label: "Organização", group: "organizacao" },
  { href: "/configuracoes/usuarios", label: "Usuários", group: "organizacao" },
  { href: "/configuracoes/acessos", label: "Acessos", group: "organizacao" },
  { href: "/configuracoes/responsaveis", label: "Responsáveis", group: "organizacao" },
  { href: "/configuracoes/integracoes", label: "Integrações", group: "dados" },
  { href: "/configuracoes/metas", label: "Metas", group: "dados" },
  { href: "/configuracoes/operacoes", label: "Operações", group: "dados" },
  { href: "/configuracoes/presets", label: "Presets", group: "dados" },
  { href: "/configuracoes/snapshots", label: "Snapshots", group: "dados" },
  { href: "/configuracoes/tema", label: "Tema e interface", group: "aparencia" },
  { href: "/configuracoes/conta", label: "Conta", group: "aparencia" },
];

// Versão: 1.1 | Data: 11/10/2026
// v1.1 (11/10/2026): /registros/bases/sync → Registros › Bases › Novas bases de Sync.
// v1.0 (10/10/2026): migalhas da BARRA DE LOCAL (components/layout/
//   location-bar.tsx). Módulo PURO: pathname → lista de níveis, do mais amplo
//   ao atual. O último nível não tem link (é onde se está); os anteriores
//   SOBEM um nível — semântica diferente do BackLink, que volta à tela
//   ANTERIOR do histórico. As duas coisas convivem.
//
// Rótulos de TOPO são fixos aqui; o nome de um objeto (dashboard, kanban,
// formulário, esquema) só a página conhece e chega por `leaf`, publicado com
// usePublishLocationTitle. Sem `leaf`, o nível mostra um rótulo genérico — a
// barra nunca exibe um id.
import { SETTINGS_TABS } from "./settings-tabs";

export interface Crumb {
  label: string;
  /** null = nível atual (sem link). */
  href: string | null;
}

// Rótulos dos módulos de Operação em código (o catálogo de
// lib/operacao/cards.ts é server-only). Chave nova sem entrada aqui cai no
// `leaf` publicado ou em "Módulo".
const OPERACAO_LABELS: Record<string, string> = {
  agenda: "Agenda",
  tarefas: "Tarefas",
  remuneracao: "Remuneração",
  mapeamentos: "Mapeamentos",
  workflow: "Workflow",
};

const REGISTROS_LABELS: Record<string, string> = {
  bases: "Bases",
  log: "Log",
  importar: "Importar",
  lixeira: "Lixeira",
  "base-manual": "Base manual",
};

const PAINEIS: Crumb = { label: "Painéis", href: "/" };
const OPERACAO: Crumb = { label: "Operação", href: "/operacao" };

/** Fecha a lista: o último nível perde o link. */
function close(list: Crumb[]): Crumb[] {
  if (list.length === 0) return list;
  const last = list[list.length - 1];
  return [...list.slice(0, -1), { label: last.label, href: null }];
}

export function breadcrumbsFor(
  pathname: string,
  leaf?: string | null
): Crumb[] {
  const name = leaf?.trim() || null;
  const parts = pathname.split("?")[0].split("/").filter(Boolean);
  const [top, second, third] = parts;

  if (parts.length === 0) return close([PAINEIS]);

  switch (top) {
    case "dashboards":
      return close([PAINEIS, { label: name ?? "Dashboard", href: null }]);
    case "kanbans":
      return close([PAINEIS, { label: name ?? "Kanban", href: null }]);
    case "operacao": {
      if (!second) return close([OPERACAO]);
      if (second === "f") {
        return close([OPERACAO, { label: name ?? "Formulário", href: null }]);
      }
      const moduleLabel = OPERACAO_LABELS[second] ?? name ?? "Módulo";
      const moduleCrumb: Crumb = {
        label: moduleLabel,
        href: `/operacao/${second}`,
      };
      if (!third) return close([OPERACAO, moduleCrumb]);
      return close([
        OPERACAO,
        moduleCrumb,
        { label: name ?? "Detalhe", href: null },
      ]);
    }
    case "registros": {
      const root: Crumb = { label: "Registros", href: "/registros" };
      if (!second) return close([root]);
      // v1.1: triagem de novas Bases de Sync, abaixo de Bases.
      if (second === "bases" && third === "sync") {
        return close([
          root,
          { label: "Bases", href: "/registros/bases" },
          { label: "Novas bases de Sync", href: null },
        ]);
      }
      return close([
        root,
        { label: REGISTROS_LABELS[second] ?? name ?? "Detalhe", href: null },
      ]);
    }
    case "campos":
      return close([{ label: "Campos", href: "/campos" }]);
    case "configuracoes": {
      const root: Crumb = { label: "Configurações", href: "/configuracoes" };
      if (!second) return close([root]);
      const tab = SETTINGS_TABS.find(
        (t) => t.href === `/configuracoes/${second}`
      );
      return close([root, { label: tab?.label ?? name ?? "Detalhe", href: null }]);
    }
    // Rotas antigas que redirecionam (agenda/tarefas) e telas fora do app
    // principal: sem migalha, a barra mostra só o menu e o sino.
    default:
      return name ? close([{ label: name, href: null }]) : [];
  }
}

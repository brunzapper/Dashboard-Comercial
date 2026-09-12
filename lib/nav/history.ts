// Versão: 1.0 | Data: 12/09/2026
// Rastro de navegação DENTRO do app, para o botão "voltar" levar à tela de
// onde a pessoa veio — e não a um destino fixo que muitas vezes não era onde
// ela estava (entrar num dashboard a partir de /registros e "voltar" cair no
// Workspace).
//
// Guardado em sessionStorage (por aba do navegador, some ao fechar), com a
// forma mais simples que resolve: a rota ANTERIOR e a ATUAL. Uma pilha
// completa convidaria a um "voltar" que anda para trás indefinidamente, e não
// é isso que o botão promete — ele é uma saída de UMA tela.
//
// Módulo PURO sobre o storage: toda leitura/escrita é try/catch (aba anônima,
// storage bloqueado) e o chamador sempre tem um destino de FALLBACK.

const KEY_PREV = "nav:prev";
const KEY_CUR = "nav:cur";

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* storage indisponível — o botão cai no fallback */
  }
}

/**
 * Registra a rota atual. Chamado a cada navegação pelo tracker do layout.
 * Rota repetida (re-render, troca só de query da mesma tela) NÃO empurra o
 * anterior: senão "voltar" devolveria a mesma página.
 */
export function trackRoute(route: string): void {
  const cur = read(KEY_CUR);
  if (cur === route) return;
  if (cur) write(KEY_PREV, cur);
  write(KEY_CUR, route);
}

/**
 * Rota anterior à `current`. Olha PRIMEIRO a "atual" gravada: o botão é
 * renderizado antes de o tracker registrar a tela nova (efeito roda depois do
 * render), então nesse instante `KEY_CUR` ainda guarda justamente a tela de
 * onde a pessoa veio. Quando o tracker já rodou, `KEY_CUR` é a própria tela e
 * a resposta passa a ser `KEY_PREV`. A ordem deixa de importar.
 */
export function previousRoute(current: string): string | null {
  const cur = read(KEY_CUR);
  if (cur && cur !== current) return cur;
  const prev = read(KEY_PREV);
  if (!prev || prev === current) return null;
  return prev;
}

// ---------------------------------------------------------------------------
// Rótulo legível de uma rota — é o texto do botão, então precisa dizer para
// ONDE se está voltando. Prefixos mais específicos primeiro.

const ROUTE_LABELS: [prefix: string, label: string][] = [
  ["/registros/bases", "Bases"],
  ["/registros/importar", "Importar"],
  ["/registros/lixeira", "Lixeira"],
  ["/registros/log", "Log"],
  ["/registros", "Registros"],
  ["/campos", "Campos"],
  ["/configuracoes", "Configurações"],
  ["/operacao/agenda", "Agenda"],
  ["/operacao/tarefas", "Tarefas"],
  ["/operacao/remuneracao", "Remuneração"],
  ["/operacao/mapeamentos", "Mapeamentos"],
  ["/operacao/workflow", "Workflow"],
  ["/operacao", "Operação"],
  ["/dashboards", "Dashboard"],
  ["/kanbans", "Kanban"],
];

/** Rótulo do destino; rota desconhecida cai em "Voltar". */
export function routeLabel(route: string): string {
  const path = route.split("?")[0];
  if (path === "/") return "Workspace";
  for (const [prefix, label] of ROUTE_LABELS) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return label;
  }
  return "Voltar";
}

// Versão: 2.3 | Data: 26/07/2026
// v2.3 (26/07/2026): o CORPO da geração mudou-se para
//   lib/ai/generate-dashboard.ts (generateDashboardCore/
//   applyGeneratedDashboardCore) SEM mudança de comportamento — este arquivo
//   vira wrapper fino ("use server" não aceita função como argumento
//   serializável, e o route handler de streaming ai-turn precisa passar
//   `onThought` ao núcleo). API pública (nomes/tipos) inalterada para
//   ImportDashboardSheet e ai-session-actions.
// v2.2 (25/07/2026): EDIT_RULES deixa de listar à mão as chaves editáveis de
//   dashboard.settings — a lista sai de documentedKeys(DASHBOARD_SETTINGS_DOC)
//   (lib/import/dashboard/settings-docs.ts), o MESMO dicionário que o SPEC
//   renderiza (fim da contradição background/fontScale citados sem definição).
// v2.1 (24/07/2026): a IA passa a LER melhor o estado — `baseWidgets` (merge
//   por widget) também no modo "from"; `copy_of` nas regras dos modos from/edit
//   (cópia por delta, resolvida no servidor em normalizeImportRaw); e a prévia
//   pendente não aplicada (input.pendingJson) entra no system como seção
//   própria (a resposta do turno substitui a prévia inteira).
// v2.0 (23/07/2026): CONVERSA multi-turno + 3 modos — "new" (criar do zero),
//   "from" (criar a partir de um dashboard existente) e "edit" (editar
//   in-place). Desenho:
//   - STATELESS por turno: a cada turno o servidor RE-EXPORTA o estado atual
//     do board (modos from/edit) para o system e envia só os turnos de USUÁRIO
//     anteriores (cap 10) — nada de acumular JSONs de assistant no histórico.
//     Após o 1º apply em new/from, o CLIENTE troca a sessão para mode:'edit' +
//     targetDashboardId (new/from só existem no 1º turno).
//   - IDENTIDADE FORÇADA NO SERVIDOR: normalizeImportRaw sobrescreve a `chave`
//     do JSON da IA pela canônica (edit: derivada do board; new/from: gerada
//     aqui) ANTES da validação — a IA nunca é confiada com identidade (uma
//     chave trocada poderia sobrescrever o board de ORIGEM no modo from).
//   - Aplicação: edit → applyDashboardEditJson (adoção + apply com
//     targetDashboardId, SEM GC — widget omitido permanece; snapshot p/
//     Desfazer); new/from → importDashboardJson (gates por seção intactos).
//   - Toggle "Aplicar automaticamente": OFF ⇒ o turno para após a validação e
//     devolve pendingJson + resumo; o Aplicar chama applyGeneratedDashboard
//     (re-valida/re-gates/re-deriva identidade — nada confiado do cliente).
//   - Truncamento (AiTruncatedError) aborta o laço na hora, com mensagem
//     acionável — JSON cortado nunca valida e queimaria as tentativas.
// v1.0 (23/07/2026): geração one-shot com laço de autocorreção.
"use server";

import {
  applyGeneratedDashboardCore,
  generateDashboardCore,
} from "@/lib/ai/generate-dashboard";
import type {
  AiDashboardMode,
  GenerateDashboardInput,
  GenerateDashboardState,
} from "@/lib/ai/generate-dashboard";

export type { AiDashboardMode, GenerateDashboardInput, GenerateDashboardState };

export async function generateDashboardWithAi(
  input: GenerateDashboardInput
): Promise<GenerateDashboardState> {
  return generateDashboardCore(input);
}

export async function applyGeneratedDashboard(
  raw: string,
  ctx: { mode: AiDashboardMode; targetDashboardId?: string }
): Promise<GenerateDashboardState> {
  return applyGeneratedDashboardCore(raw, ctx);
}

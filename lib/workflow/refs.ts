// Versão: 1.0 | Data: 08/09/2026
// Resolução de REFERÊNCIAS dos templates de um esquema de Workflow (0125).
//
// Um template é texto com marcadores `{{ <escopo>.<caminho> }}`:
//   {{form.empresa}}            resposta do formulário
//   {{steps.criar_empresa.id}}  saída de um passo anterior
//   {{ctx.responsibleBitrixId}} contexto montado pelo SERVIDOR
// Texto fora dos marcadores é literal, e um template sem marcador nenhum é uma
// constante (é assim que o esquema fixa, digamos, um STATUS_ID).
//
// A resolução é PURA e por regex sobre um contexto TIPADO. Nada de `eval`,
// `Function` ou acesso dinâmico a objeto arbitrário — a mesma disciplina do
// avaliador de fórmulas. O escopo é fechado em três raízes conhecidas; um
// marcador com outra raiz é ref desconhecida, não uma janela para o resto do
// processo.
//
// Ref desconhecida (ou que resolve nulo) vira STRING VAZIA e entra em
// `warnings`. Nunca o texto cru do template: "{{form.telefone}}" viajando para
// dentro do campo PHONE de um CRM é pior que um telefone vazio, e cala o erro.

/** Contexto de uma execução. `steps` guarda a saída de cada passo já rodado. */
export interface WorkflowRefContext {
  form: Record<string, string>;
  steps: Record<string, { id: string | null }>;
  ctx: Record<string, string | null>;
}

export interface ResolveResult {
  value: string;
  warnings: string[];
}

// {{ escopo.caminho }} — espaços tolerados dentro das chaves.
const REF_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\.([a-zA-Z0-9_.]+)\s*\}\}/g;

function lookup(
  scope: string,
  path: string,
  context: WorkflowRefContext
): { found: boolean; value: string } {
  if (scope === "form") {
    if (path.includes(".")) return { found: false, value: "" };
    const v = context.form[path];
    return { found: v !== undefined, value: v ?? "" };
  }
  if (scope === "ctx") {
    if (path.includes(".")) return { found: false, value: "" };
    const v = context.ctx[path];
    return { found: v !== undefined, value: v ?? "" };
  }
  if (scope === "steps") {
    // Só `<stepId>.id` existe hoje. Caminho mais fundo é ref desconhecida —
    // não um passeio por propriedade arbitrária da saída do passo.
    const parts = path.split(".");
    if (parts.length !== 2 || parts[1] !== "id") {
      return { found: false, value: "" };
    }
    const out = context.steps[parts[0]];
    // Passo conhecido mas PULADO/sem id resolve vazio SEM aviso: é o
    // comportamento esperado de um passo desligado (o lead sai sem COMPANY_ID).
    if (out) return { found: true, value: out.id ?? "" };
    return { found: false, value: "" };
  }
  return { found: false, value: "" };
}

/** Resolve um template contra o contexto. */
export function resolveTemplate(
  template: string,
  context: WorkflowRefContext
): ResolveResult {
  const warnings: string[] = [];
  const value = template.replace(REF_RE, (_full, scope: string, path: string) => {
    const hit = lookup(scope, path, context);
    if (!hit.found) {
      warnings.push(`Referência desconhecida: {{${scope}.${path}}}`);
      return "";
    }
    return hit.value;
  });
  return { value, warnings };
}

/** Atalho: o template resolve para vazio? (usado por `skipIfEmpty`). */
export function resolvesEmpty(
  template: string,
  context: WorkflowRefContext
): boolean {
  return resolveTemplate(template, context).value.trim() === "";
}

/** Todas as refs `{{form.<key>}}` citadas num template. */
export function formRefsIn(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(REF_RE)) {
    if (m[1] === "form" && !m[2].includes(".")) out.push(m[2]);
  }
  return out;
}

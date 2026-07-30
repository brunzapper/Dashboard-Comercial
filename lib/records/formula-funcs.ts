// Versão: 1.0 | Data: 30/07/2026
// Catálogo ÚNICO de metadados das funções de fórmula: parâmetros, descrição de
// uma linha, exemplo e grupo — por FormulaFuncName. Consumido pela paleta ƒ,
// pela assinatura viva do FormulaEditor e (derivado) pelo SPEC da IA
// (lib/import/dashboard/settings-docs.ts). Função NOVA no union sem entrada
// aqui QUEBRA o typecheck (`satisfies Record<...>`) — mesma garantia que o
// FORMULA_FUNC_GROUPS antigo dava, agora num lugar só. A ARIDADE autoritativa
// segue no parser (parseTokens, lib/records/formulas.ts); o teste
// formula-funcs.test.ts tokeniza+valida cada `example` para travar drift.
import type { FormulaFuncName } from "@/lib/records/formulas";

export type FormulaFuncGroup = "logica" | "cond_agg" | "pura" | "comparacao";

// Rótulos de UI dos grupos (paleta/assinatura viva).
export const FUNC_GROUP_LABELS: Record<FormulaFuncGroup, string> = {
  logica: "Condicionais",
  cond_agg: "Agregações condicionais",
  pura: "Matemáticas",
  comparacao: "Comparação de período",
};

export interface FormulaFuncParam {
  /** Nome exibido; "[Campo]" sinaliza que o argumento DEVE ser uma coluna. */
  name: string;
  optional?: boolean;
  /** Último parâmetro repete (a assinatura ganha "; …"). */
  variadic?: boolean;
}

export interface FormulaFuncSpec {
  name: FormulaFuncName;
  params: FormulaFuncParam[];
  /** Uma linha, exibida na assinatura viva e no tooltip da paleta. */
  description: string;
  /** Fórmula VÁLIDA (formula-funcs.test.ts tokeniza e valida). */
  example: string;
  group: FormulaFuncGroup;
  /** Só no contexto agregado (no por-registro o servidor rejeita). */
  aggOnly?: boolean;
}

// Ordem = a do FORMULA_FUNC_GROUPS histórico (o SPEC da IA renderiza na ordem
// das chaves — mantê-la conserva o prompt byte-idêntico).
export const FORMULA_FUNCS = {
  SE: {
    name: "SE",
    params: [{ name: "condição" }, { name: "então" }, { name: "senão", optional: true }],
    description: "Devolve um valor se a condição for verdadeira e outro se for falsa.",
    example: 'SE([Etapa] = "Ganho"; [Valor]; 0)',
    group: "logica",
  },
  E: {
    name: "E",
    params: [{ name: "cond1" }, { name: "cond2", variadic: true }],
    description: "Verdadeiro só quando todas as condições valem.",
    example: 'E([Valor] > 0; [Etapa] = "Ganho")',
    group: "logica",
  },
  OU: {
    name: "OU",
    params: [{ name: "cond1" }, { name: "cond2", variadic: true }],
    description: "Verdadeiro quando pelo menos uma condição vale.",
    example: 'OU([Etapa] = "Ganho"; [Etapa] = "Perdido")',
    group: "logica",
  },
  SOMASE: {
    name: "SOMASE",
    params: [{ name: "[Campo]" }, { name: "condição", variadic: true }],
    description: "Soma o campo apenas nos registros que atendem à condição.",
    example: 'SOMASE([Valor]; [Etapa] = "Ganho")',
    group: "cond_agg",
    aggOnly: true,
  },
  SOMASES: {
    name: "SOMASES",
    params: [{ name: "[Campo]" }, { name: "cond1" }, { name: "cond2", variadic: true }],
    description: "Soma o campo nos registros que atendem a todas as condições.",
    example: 'SOMASES([Valor]; [Etapa] = "Ganho"; [Valor] > 0)',
    group: "cond_agg",
    aggOnly: true,
  },
  "CONT.SE": {
    name: "CONT.SE",
    params: [{ name: "condição", variadic: true }],
    description: "Conta os registros que atendem à condição.",
    example: 'CONT.SE([Etapa] = "Ganho")',
    group: "cond_agg",
    aggOnly: true,
  },
  "CONT.SES": {
    name: "CONT.SES",
    params: [{ name: "cond1" }, { name: "cond2", variadic: true }],
    description: "Conta os registros que atendem a todas as condições.",
    example: 'CONT.SES([Etapa] = "Ganho"; [Valor] > 0)',
    group: "cond_agg",
    aggOnly: true,
  },
  MÉDIASE: {
    name: "MÉDIASE",
    params: [{ name: "[Campo]" }, { name: "condição", variadic: true }],
    description: "Média do campo nos registros que atendem à condição (soma ÷ contagem).",
    example: 'MÉDIASE([Valor]; [Etapa] = "Ganho")',
    group: "cond_agg",
    aggOnly: true,
  },
  SOMA: {
    name: "SOMA",
    params: [{ name: "a" }, { name: "b", optional: true, variadic: true }],
    description: "Soma dos valores informados.",
    example: "SOMA([Valor]; 10)",
    group: "pura",
  },
  MÉDIA: {
    name: "MÉDIA",
    params: [{ name: "a" }, { name: "b", optional: true, variadic: true }],
    description: "Média dos valores informados.",
    example: "MÉDIA([Valor]; [Meta])",
    group: "pura",
  },
  MÍN: {
    name: "MÍN",
    params: [{ name: "a" }, { name: "b", optional: true, variadic: true }],
    description: "Menor dos valores informados.",
    example: "MÍN([Valor]; 100)",
    group: "pura",
  },
  MÁX: {
    name: "MÁX",
    params: [{ name: "a" }, { name: "b", optional: true, variadic: true }],
    description: "Maior dos valores informados.",
    example: "MÁX([Valor]; 0)",
    group: "pura",
  },
  "CONT.NÚM": {
    name: "CONT.NÚM",
    params: [{ name: "a" }, { name: "b", optional: true, variadic: true }],
    description: "Conta quantos dos valores são números.",
    example: "CONT.NÚM([Valor]; [Meta])",
    group: "pura",
  },
  "CONT.VALORES": {
    name: "CONT.VALORES",
    params: [{ name: "a" }, { name: "b", optional: true, variadic: true }],
    description: "Conta quantos dos valores não são vazios.",
    example: "CONT.VALORES([Etapa]; [Valor])",
    group: "pura",
  },
  ARRED: {
    name: "ARRED",
    params: [{ name: "valor" }, { name: "casas", optional: true }],
    description: "Arredonda o valor para o número de casas decimais (0 se omitido).",
    example: "ARRED([Valor]; 2)",
    group: "pura",
  },
  ABS: {
    name: "ABS",
    params: [{ name: "valor" }],
    description: "Valor absoluto (remove o sinal).",
    example: "ABS([Valor] - [Meta])",
    group: "pura",
  },
  CONCATENAR: {
    name: "CONCATENAR",
    params: [{ name: "a" }, { name: "b", optional: true, variadic: true }],
    description: "Junta os valores como texto.",
    example: 'CONCATENAR([Etapa]; " — "; [Valor])',
    group: "pura",
  },
  ANTERIOR: {
    name: "ANTERIOR",
    params: [{ name: "expr" }, { name: '"anterior"|"ano"', optional: true }],
    description:
      'Valor da expressão no período anterior ("anterior", default) ou no mesmo período do ano passado ("ano").',
    example: '[Σ Valor] - ANTERIOR([Σ Valor]; "anterior")',
    group: "comparacao",
    aggOnly: true,
  },
  VARPCT: {
    name: "VARPCT",
    params: [{ name: "expr" }, { name: '"anterior"|"ano"', optional: true }],
    description: "Variação % da expressão vs o período de comparação (já sai ×100).",
    example: "VARPCT([Σ Valor])",
    group: "comparacao",
    aggOnly: true,
  },
  VARABS: {
    name: "VARABS",
    params: [{ name: "expr" }, { name: '"anterior"|"ano"', optional: true }],
    description: "Variação absoluta da expressão vs o período de comparação.",
    example: 'VARABS([Σ Valor]; "ano")',
    group: "comparacao",
    aggOnly: true,
  },
} satisfies Record<FormulaFuncName, FormulaFuncSpec>;

export const FORMULA_FUNC_LIST: FormulaFuncSpec[] = Object.values(FORMULA_FUNCS);

/** "SE(condição; então; senão)" — assinatura curta exibida na paleta/ajuda. */
export function funcSignature(spec: FormulaFuncSpec): string {
  const names = spec.params.map((p) => p.name);
  const tail = spec.params.some((p) => p.variadic) ? "; …" : "";
  return `${spec.name}(${names.join("; ")}${tail})`;
}

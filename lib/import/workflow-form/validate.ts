// Versão: 1.0 | Data: 12/09/2026
// Validador PURO do contrato "formulario-preencher". Erros em pt-BR e
// ACIONÁVEIS: eles voltam para a IA no laço de autocorreção
// (lib/ai/json-loop.ts), então cada mensagem diz como corrigir.
//
// A régua mais importante é a de SELEÇÃO: campo de seleção do formulário só
// aceita valor do catálogo VIVO (Fonte e Etapa vêm do Bitrix, Responsável dos
// responsáveis ativos). Sem isso a IA inventaria uma Fonte plausível, o
// formulário aceitaria, e o CRM recusaria o lead no fim da fila — erro longe da
// causa. Aqui ela recebe a lista e a mensagem diz exatamente o que existe.
//
// Nada é gravado por este módulo: o resultado vai para as CAIXAS do formulário,
// e quem lança é a pessoa (invariante 25).
import { stripCodeFence } from "@/lib/import/dashboard/validate";

import {
  FORM_FILL_FORMAT,
  FORM_FILL_VERSION,
  type FormFillContext,
  type FormFillFieldSpec,
  type FormFillValues,
} from "./types";

export type FormFillValidation =
  | { ok: true; values: FormFillValues; warnings: string[] }
  | { ok: false; errors: string[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidYmd(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const norm = (s: string) => s.trim().toLocaleLowerCase("pt-BR");

function shortList(items: string[], cap = 25): string {
  return items.length > cap
    ? `${items.slice(0, cap).join(", ")}, … (+${items.length - cap})`
    : items.join(", ");
}

/**
 * Valida UM valor contra o campo. Devolve o texto CANÔNICO (a grafia do
 * catálogo, em seleção) ou undefined — vazio é "não informado", nunca erro: o
 * formulário tem campos opcionais e forçar a IA a inventar seria pior.
 */
function coerceFieldValue(
  spec: FormFillFieldSpec,
  raw: unknown,
  errors: string[]
): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "object") {
    errors.push(
      `O campo "${spec.key}" deve ser um valor simples (texto ou número), não objeto/lista.`
    );
    return undefined;
  }
  const s = String(raw).trim();
  if (s === "") return undefined;

  if (spec.type === "selecao") {
    const options = spec.options ?? [];
    const hit = options.find((o) => norm(o) === norm(s));
    if (!hit) {
      errors.push(
        `O campo "${spec.key}" (${spec.label}) só aceita uma destas opções, exatamente como listadas: ${shortList(options)}. Recebi "${s}".`
      );
      return undefined;
    }
    return hit;
  }

  if (spec.type === "data" && !isValidYmd(s)) {
    errors.push(
      `O campo "${spec.key}" (${spec.label}) deve ser uma data no formato AAAA-MM-DD. Recebi "${s}".`
    );
    return undefined;
  }

  if (spec.type === "numero" && !Number.isFinite(Number(s.replace(",", ".")))) {
    errors.push(
      `O campo "${spec.key}" (${spec.label}) deve ser um número. Recebi "${s}".`
    );
    return undefined;
  }

  return s;
}

/**
 * Valida o JSON cru devolvido pela IA contra o formulário alvo. Sucesso devolve
 * as respostas canônicas + as notas da IA como avisos.
 *
 * Campo obrigatório que a IA não preencheu NÃO é erro aqui: a prévia vai para a
 * tela e a pessoa completa o que faltar — barrar agora esconderia o resto do
 * preenchimento, que estava certo. Quem cobra obrigatório é o envio do
 * formulário, que é onde a decisão de lançar acontece.
 */
export function validateFormFill(
  raw: string,
  ctx: FormFillContext
): FormFillValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  let obj: Record<string, unknown>;
  try {
    const cleaned = stripCodeFence(raw);
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("sem objeto JSON");
    obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      errors: [
        `A resposta não contém um JSON válido. Responda com UM bloco JSON no formato ${FORM_FILL_FORMAT}, sem texto fora dele.`,
      ],
    };
  }

  if (obj.formato !== FORM_FILL_FORMAT) {
    errors.push(`Campo "formato" deve ser "${FORM_FILL_FORMAT}".`);
  }
  if (obj.versao !== FORM_FILL_VERSION) {
    errors.push(`Campo "versao" deve ser ${FORM_FILL_VERSION}.`);
  }

  const raws = obj.respostas;
  if (raws == null || typeof raws !== "object" || Array.isArray(raws)) {
    errors.push(
      'Inclua as respostas em "respostas", como um objeto { chave_do_campo: valor }.'
    );
    return { ok: false, errors };
  }

  const specByKey = new Map(ctx.fields.map((f) => [f.key, f]));
  const values: FormFillValues = {};

  for (const [key, rawVal] of Object.entries(raws as Record<string, unknown>)) {
    const spec = specByKey.get(key);
    if (!spec) {
      errors.push(
        `Chave desconhecida "${key}". Chaves aceitas: ${shortList(
          ctx.fields.map((f) => f.key),
          40
        )}.`
      );
      continue;
    }
    const val = coerceFieldValue(spec, rawVal, errors);
    if (val !== undefined) values[key] = val;
  }

  if (Object.keys(values).length === 0 && errors.length === 0) {
    errors.push(
      "Nenhum campo foi preenchido. Extraia do texto do usuário o que der para alocar nos campos listados e explique em \"notas\" o que faltou."
    );
  }

  if (Array.isArray(obj.notas)) {
    for (const n of obj.notas) {
      const s = String(n ?? "").trim();
      if (s) warnings.push(s);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, values, warnings };
}

/** Serialização CANÔNICA do contrato (prévia reinjetada no turno seguinte). */
export function serializeFormFill(values: FormFillValues): string {
  return JSON.stringify(
    {
      formato: FORM_FILL_FORMAT,
      versao: FORM_FILL_VERSION,
      respostas: values,
    },
    null,
    2
  );
}

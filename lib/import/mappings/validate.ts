// Versão: 1.0 | Data: 07/08/2026
// Validador PURO do contrato "mapeamentos-classify" v1 — fail-closed por
// item, mensagens pt-BR que GUIAM a correção (é a superfície que a IA lê no
// laço de autocorreção): valor fora dos pendentes lista uma amostra; saída
// fora das categorias aceitas lista as aceitas. `serializeMappingsClassify`
// é o round-trip canônico (pendingJson da conversa E payload do Aplicar —
// a prévia editável re-serializa por aqui).
import { normalizeRawValue } from "@/lib/mappings/domains";
import {
  MAPPINGS_CLASSIFY_FORMAT,
  MAPPINGS_CLASSIFY_VERSION,
  MAX_AI_MAPPING_ITEMS,
  type MappingsClassifyContext,
  type MappingsClassifyValidation,
  type ParsedMappingItem,
} from "./types";

const TOP_KEYS = new Set(["formato", "versao", "dominio", "itens", "notas"]);
const ITEM_KEYS = new Set(["valor", "saidas"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Lista curta p/ mensagens (não estoura o prompt no laço de correção). */
function shortList(values: string[], max = 12): string {
  const head = values.slice(0, max).map((v) => `"${v}"`);
  return head.join(", ") + (values.length > max ? ", …" : "");
}

export function validateMappingsClassify(
  raw: string,
  ctx: MappingsClassifyContext
): MappingsClassifyValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const items: ParsedMappingItem[] = [];
  const fail = (): MappingsClassifyValidation => ({
    ok: false,
    errors,
    warnings,
    items: [],
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    errors.push("JSON inválido — devolva um único objeto JSON.");
    return fail();
  }
  if (!isRecord(parsed)) {
    errors.push("JSON inválido — devolva um único objeto JSON.");
    return fail();
  }
  for (const k of Object.keys(parsed)) {
    if (!TOP_KEYS.has(k)) {
      errors.push(
        `Chave desconhecida no topo: "${k}" (aceitas: formato, versao, dominio, itens, notas).`
      );
    }
  }
  if (parsed.formato !== MAPPINGS_CLASSIFY_FORMAT) {
    errors.push(`"formato" deve ser "${MAPPINGS_CLASSIFY_FORMAT}".`);
  }
  if (parsed.versao !== MAPPINGS_CLASSIFY_VERSION) {
    errors.push(`"versao" deve ser ${MAPPINGS_CLASSIFY_VERSION}.`);
  }
  if (parsed.dominio !== ctx.domainKey) {
    errors.push(`"dominio" deve ser "${ctx.domainKey}" (o domínio aberto na tela).`);
  }
  if (Array.isArray(parsed.notas)) {
    for (const n of parsed.notas) {
      if (typeof n === "string" && n.trim()) warnings.push(n.trim());
    }
  } else if (parsed.notas !== undefined) {
    errors.push('"notas" deve ser uma lista de textos.');
  }
  const itensRaw = parsed.itens;
  if (!Array.isArray(itensRaw) || itensRaw.length === 0) {
    errors.push('"itens" deve ser uma lista com ao menos um item.');
    return fail();
  }
  if (itensRaw.length > MAX_AI_MAPPING_ITEMS) {
    errors.push(
      `NO MÁXIMO ${MAX_AI_MAPPING_ITEMS} itens por resposta — mantenha os ` +
        `${MAX_AI_MAPPING_ITEMS} primeiros e explique em "notas".`
    );
    return fail();
  }

  const pendingByNorm = new Map(ctx.pending.map((p) => [p.norm, p]));
  const targetKeys = new Set(ctx.targets.map((t) => t.fieldKey));
  const seenNorms = new Set<string>();

  for (let i = 0; i < itensRaw.length; i++) {
    const label = `Item ${i + 1}`;
    const item = itensRaw[i];
    if (!isRecord(item)) {
      errors.push(`${label}: deve ser um objeto { valor, saidas }.`);
      continue;
    }
    for (const k of Object.keys(item)) {
      if (!ITEM_KEYS.has(k)) {
        errors.push(`${label}: chave desconhecida "${k}" (aceitas: valor, saidas).`);
      }
    }
    const valor = typeof item.valor === "string" ? item.valor.trim() : "";
    if (!valor) {
      errors.push(`${label}: "valor" é obrigatório (um dos valores pendentes).`);
      continue;
    }
    const norm = normalizeRawValue(valor);
    const pending = pendingByNorm.get(norm);
    if (!pending) {
      errors.push(
        `${label}: "${valor}" não está entre os valores PENDENTES do domínio. ` +
          `Pendentes: ${shortList(ctx.pending.map((p) => p.value))}.`
      );
      continue;
    }
    if (seenNorms.has(norm)) {
      errors.push(`${label}: valor "${pending.value}" repetido no lote.`);
      continue;
    }
    if (!isRecord(item.saidas)) {
      errors.push(
        `${label}: "saidas" deve ser um objeto { ${ctx.targets
          .map((t) => `"${t.fieldKey}": "…"`)
          .join(", ")} }.`
      );
      continue;
    }
    const outputs: Record<string, string> = {};
    let itemOk = true;
    for (const [k, v] of Object.entries(item.saidas)) {
      if (!targetKeys.has(k)) {
        errors.push(
          `${label}: campo de saída desconhecido "${k}" (aceitos: ${[...targetKeys].join(", ")}).`
        );
        itemOk = false;
        continue;
      }
      const val = typeof v === "string" ? v.trim() : "";
      if (!val) {
        errors.push(`${label}: "${k}" vazio — omita a chave ou preencha.`);
        itemOk = false;
        continue;
      }
      const accepted = ctx.optionsByTarget[k] ?? [];
      if (!accepted.includes(val)) {
        errors.push(
          `${label}: "${val}" não é uma categoria aceita em "${k}". ` +
            `Aceitas: ${shortList(accepted, 30)}.`
        );
        itemOk = false;
        continue;
      }
      outputs[k] = val;
    }
    if (!itemOk) continue;
    if (Object.keys(outputs).length === 0) {
      errors.push(`${label}: preencha ao menos uma saída em "saidas".`);
      continue;
    }
    seenNorms.add(norm);
    items.push({
      rawValue: pending.value,
      rawNorm: norm,
      outputs,
      count: pending.count,
    });
  }

  if (errors.length > 0) return fail();
  return { ok: true, errors: [], warnings, items };
}

/** Round-trip canônico: prévia (editada) → JSON do contrato. */
export function serializeMappingsClassify(
  domainKey: string,
  items: ParsedMappingItem[]
): string {
  return JSON.stringify(
    {
      formato: MAPPINGS_CLASSIFY_FORMAT,
      versao: MAPPINGS_CLASSIFY_VERSION,
      dominio: domainKey,
      itens: items.map((it) => ({ valor: it.rawValue, saidas: it.outputs })),
    },
    null,
    2
  );
}

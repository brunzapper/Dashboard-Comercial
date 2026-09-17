// Versão: 1.0 | Data: 17/09/2026
// Validador do contrato `base-manual-edit` (§4.17). PURO e FAIL-CLOSED por
// item: chave desconhecida, dado não resolvido, nome de responsável/operação
// inexistente, data malformada ou valor não-numérico são ERRO — o laço de
// autocorreção da IA consegue consertar cada um deles a partir da mensagem.
//
// Recebe o catálogo FRESCO (ManualBaseEditContext). É ele que faz "# Emails
// replied" virar a chave `emails_replied` e "Outbound" virar o id de uma
// operação: nenhum id atravessa o JSON, nos dois sentidos.
//
// Sobre nome desconhecido: em runtime, um filtro por nome inexistente vira o
// uuid-zero `FK_NO_MATCH` e some em silêncio (é o certo lá — o widget não pode
// quebrar). Aqui é ERRO, de propósito: quem acabou de colar a tabela pode
// corrigir a grafia, e um lançamento atribuído ao vazio é pior que uma recusa.
import { normalizeName } from "@/lib/sync/shared";
import { stripCodeFence } from "@/lib/import/dashboard/validate";
import { slugify } from "@/lib/records/slug";
import {
  MANUAL_KEY_RE,
  MANUAL_SPREADS,
  isManualSpread,
} from "@/lib/manual-base/types";

import {
  MANUAL_BASE_FORMAT,
  MANUAL_BASE_VERSION,
  MAX_AI_MANUAL_ENTRIES,
  MAX_AI_MANUAL_SERIES,
  type ManualBaseEditContext,
  type ManualBaseValidation,
  type ParsedManualEntry,
  type ParsedManualSeries,
} from "./types";

const TOP_KEYS = new Set(["formato", "versao", "dados", "lancamentos", "notas"]);
const SERIES_KEYS = new Set(["chave", "rotulo"]);
const ENTRY_KEYS = new Set([
  "dado",
  "valor",
  "inicio",
  "fim",
  "operacao",
  "responsavel",
  "distribuicao",
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v != null && !Array.isArray(v);

const asString = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const shortList = (names: string[]): string => {
  const cut = names.slice(0, 12);
  return cut.join(", ") + (names.length > cut.length ? ", …" : "");
};

/**
 * Serialização CANÔNICA do que já foi resolvido, de volta ao formato de FIO
 * (rótulos e nomes, nunca ids). Alimenta a prévia reinjetada no turno seguinte
 * e precisa ser re-validável — o apply relê DAQUI, com catálogo fresco.
 */
export function serializeManualBaseEdit(parsed: {
  series: ParsedManualSeries[];
  entries: ParsedManualEntry[];
  notes?: string[];
}): string {
  return JSON.stringify(
    {
      formato: MANUAL_BASE_FORMAT,
      versao: MANUAL_BASE_VERSION,
      dados: parsed.series
        .filter((s) => s.criar)
        .map((s) => ({ chave: s.key, rotulo: s.label })),
      lancamentos: parsed.entries.map((e) => ({
        dado: e.seriesLabel,
        valor: e.value,
        inicio: e.periodStart,
        fim: e.periodEnd,
        ...(e.operationName ? { operacao: e.operationName } : {}),
        ...(e.responsibleName ? { responsavel: e.responsibleName } : {}),
        ...(e.spread ? { distribuicao: e.spread } : {}),
      })),
      ...(parsed.notes && parsed.notes.length > 0 ? { notas: parsed.notes } : {}),
    },
    null,
    2
  );
}

export function validateManualBaseEdit(
  raw: string,
  ctx: ManualBaseEditContext
): ManualBaseValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  let obj: Record<string, unknown>;
  try {
    const text = stripCodeFence(raw);
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("sem objeto JSON");
    obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      errors: [
        `Não consegui ler um objeto JSON na resposta. Responda APENAS com o objeto no formato "${MANUAL_BASE_FORMAT}".`,
      ],
    };
  }

  for (const k of Object.keys(obj)) {
    if (!TOP_KEYS.has(k)) errors.push(`Chave desconhecida na raiz: "${k}".`);
  }
  if (asString(obj.formato) !== MANUAL_BASE_FORMAT)
    errors.push(`"formato" deve ser "${MANUAL_BASE_FORMAT}".`);
  if (obj.versao !== MANUAL_BASE_VERSION)
    errors.push(`"versao" deve ser ${MANUAL_BASE_VERSION}.`);
  const rawEntries = Array.isArray(obj.lancamentos) ? obj.lancamentos : null;
  if (!rawEntries || rawEntries.length === 0)
    errors.push('"lancamentos" precisa ser uma lista com ao menos um lançamento.');
  if (errors.length > 0) return { ok: false, errors };

  if (rawEntries!.length > MAX_AI_MANUAL_ENTRIES) {
    return {
      ok: false,
      errors: [
        `A resposta tem ${rawEntries!.length} lançamentos — o máximo é ${MAX_AI_MANUAL_ENTRIES}. Mantenha os mais importantes e explique o resto em "notas".`,
      ],
    };
  }

  for (const n of Array.isArray(obj.notas) ? obj.notas : []) {
    const nota = asString(n);
    if (nota) warnings.push(nota);
  }

  // ---- Índices de resolução (por nome normalizado).
  const seriesByLabel = new Map<string, (typeof ctx.series)[number]>();
  const seriesByKey = new Map<string, (typeof ctx.series)[number]>();
  for (const s of ctx.series) {
    seriesByLabel.set(normalizeName(s.label), s);
    seriesByKey.set(s.key, s);
  }
  const respByName = new Map<string, { id: string; name: string }>();
  for (const r of ctx.responsibles) respByName.set(normalizeName(r.name), r);
  const opByName = new Map<string, { id: string; name: string }>();
  for (const o of ctx.operations) opByName.set(normalizeName(o.name), o);

  // ---- Dados NOVOS declarados na resposta.
  const created = new Map<string, ParsedManualSeries>(); // rótulo normalizado → dado
  const rawSeries = Array.isArray(obj.dados) ? obj.dados : [];
  if (rawSeries.length > MAX_AI_MANUAL_SERIES) {
    return {
      ok: false,
      errors: [
        `A resposta declara ${rawSeries.length} dados — o máximo é ${MAX_AI_MANUAL_SERIES}.`,
      ],
    };
  }
  rawSeries.forEach((item, i) => {
    const where = `dado ${i + 1}`;
    if (!isRecord(item)) {
      errors.push(`${where}: deve ser um objeto.`);
      return;
    }
    for (const k of Object.keys(item)) {
      if (!SERIES_KEYS.has(k)) errors.push(`${where}: chave desconhecida "${k}".`);
    }
    const label = asString(item.rotulo);
    if (label.length < 2) {
      errors.push(`${where}: "rotulo" é obrigatório (ex.: "# Emails replied").`);
      return;
    }
    const norm = normalizeName(label);
    const existing = seriesByLabel.get(norm);
    if (existing) {
      // Dado que já existe NÃO é recriado nem renomeado (precedente de
      // operações): a resposta pode citá-lo, e ele simplesmente é reusado.
      warnings.push(`O dado "${label}" já existe — os lançamentos vão para ele.`);
      return;
    }
    const wanted = asString(item.chave);
    const key = (wanted || slugify(label).slice(0, 40))
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/^_+/, "");
    if (!MANUAL_KEY_RE.test(key)) {
      errors.push(
        `${where}: não consegui gerar uma chave a partir de "${label}". Informe "chave" com letras minúsculas, números e "_", começando por letra.`
      );
      return;
    }
    if (seriesByKey.has(key)) {
      errors.push(
        `${where}: a chave "${key}" já pertence a outro dado ("${seriesByKey.get(key)!.label}"). Use outro rótulo ou informe uma "chave" diferente.`
      );
      return;
    }
    if ([...created.values()].some((c) => c.key === key)) {
      errors.push(`${where}: a chave "${key}" aparece duas vezes na resposta.`);
      return;
    }
    created.set(norm, { key, label, criar: true });
  });

  // ---- Lançamentos.
  const entries: ParsedManualEntry[] = [];
  const usedSlots = new Set<string>();
  rawEntries!.forEach((item, i) => {
    const where = `lançamento ${i + 1}`;
    if (!isRecord(item)) {
      errors.push(`${where}: deve ser um objeto.`);
      return;
    }
    for (const k of Object.keys(item)) {
      if (!ENTRY_KEYS.has(k)) errors.push(`${where}: chave desconhecida "${k}".`);
    }

    // Dado: casa por rótulo (ou chave) contra o catálogo + os declarados.
    const dado = asString(item.dado);
    if (!dado) {
      errors.push(`${where}: "dado" é obrigatório.`);
      return;
    }
    const norm = normalizeName(dado);
    const existing = seriesByLabel.get(norm) ?? seriesByKey.get(dado);
    const novo = created.get(norm);
    if (!existing && !novo) {
      const nomes = [
        ...ctx.series.map((s) => s.label),
        ...[...created.values()].map((s) => s.label),
      ];
      errors.push(
        nomes.length > 0
          ? `${where}: não existe o dado "${dado}". Os dados são: ${shortList(nomes)}. Para criar um novo, declare-o em "dados".`
          : `${where}: não existe o dado "${dado}", e a Base manual está vazia. Declare-o em "dados" primeiro.`
      );
      return;
    }
    const seriesKey = existing ? existing.key : novo!.key;
    const seriesLabel = existing ? existing.label : novo!.label;

    // Valor.
    const valorRaw = item.valor;
    const value =
      typeof valorRaw === "number"
        ? valorRaw
        : Number(String(valorRaw ?? "").replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(value)) {
      errors.push(`${where}: "valor" precisa ser um número (ex.: 5261).`);
      return;
    }

    // Período: datas ABSOLUTAS, sempre.
    const start = asString(item.inicio);
    const end = asString(item.fim) || start;
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
      errors.push(
        `${where}: "inicio" e "fim" precisam estar em AAAA-MM-DD (hoje é ${ctx.today}). Nada de "mês passado" ou "últimos 30 dias".`
      );
      return;
    }
    if (end < start) {
      errors.push(`${where}: "fim" (${end}) é anterior a "inicio" (${start}).`);
      return;
    }

    // Atribuição: por NOME. Desconhecido é ERRO amigável — ver o cabeçalho.
    let responsibleId: string | null = null;
    let responsibleName: string | null = null;
    const resp = asString(item.responsavel);
    if (resp && item.responsavel !== null) {
      const hit = respByName.get(normalizeName(resp));
      if (!hit) {
        errors.push(
          `${where}: não existe o responsável "${resp}". Os responsáveis ativos são: ${shortList(ctx.responsibles.map((r) => r.name))}.`
        );
        return;
      }
      responsibleId = hit.id;
      responsibleName = hit.name;
    }
    let operationId: string | null = null;
    let operationName: string | null = null;
    const op = asString(item.operacao);
    if (op && item.operacao !== null) {
      const hit = opByName.get(normalizeName(op));
      if (!hit) {
        errors.push(
          `${where}: não existe a operação "${op}". As operações ativas são: ${shortList(ctx.operations.map((o) => o.name))}.`
        );
        return;
      }
      operationId = hit.id;
      operationName = hit.name;
    }

    // Distribuição: ausente herda o padrão do DADO (resolvido no choke point).
    let spread: ParsedManualEntry["spread"];
    if (item.distribuicao !== undefined && item.distribuicao !== null) {
      if (!isManualSpread(item.distribuicao)) {
        errors.push(
          `${where}: "distribuicao" deve ser um de ${MANUAL_SPREADS.join(", ")}.`
        );
        return;
      }
      spread = item.distribuicao;
    }

    // Duas linhas para o MESMO dado × período × atribuição colidiriam no
    // upsert: a segunda sobrescreveria a primeira em silêncio.
    const slot = JSON.stringify([seriesKey, start, end, responsibleId, operationId]);
    if (usedSlots.has(slot)) {
      errors.push(
        `${where}: "${seriesLabel}" já tem um lançamento para esse mesmo período e atribuição nesta resposta. Some os valores num lançamento só.`
      );
      return;
    }
    usedSlots.add(slot);

    entries.push({
      seriesKey,
      periodStart: start,
      periodEnd: end,
      value,
      responsibleId,
      operationId,
      spread,
      seriesLabel,
      responsibleName,
      operationName,
    });
  });

  if (errors.length > 0) return { ok: false, errors };
  if (entries.length === 0) {
    return { ok: false, errors: ["Nenhum lançamento válido na resposta."] };
  }

  // Só os dados NOVOS que algum lançamento realmente usa — declarar um dado
  // sem lançamento criaria uma coluna vazia na grade.
  const usedKeys = new Set(entries.map((e) => e.seriesKey));
  const series = [...created.values()].filter((s) => usedKeys.has(s.key));
  for (const s of created.values()) {
    if (!usedKeys.has(s.key)) {
      warnings.push(`O dado "${s.label}" foi declarado sem nenhum lançamento — ignorado.`);
    }
  }

  return { ok: true, parsed: { series, entries, notes: warnings }, warnings };
}

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
  MAX_AI_MANUAL_FAMILIES,
  MAX_AI_MANUAL_FAMILY_MEMBERS,
  MAX_AI_MANUAL_SERIES,
  type ManualBaseEditContext,
  isManualEntryMode,
  type ManualBaseValidation,
  type ParsedManualEntry,
  type ParsedManualFamily,
  type ParsedManualSeries,
} from "./types";

const TOP_KEYS = new Set([
  "formato",
  "versao",
  "dados",
  "familias",
  "lancamentos",
  "notas",
]);
const SERIES_KEYS = new Set(["chave", "rotulo"]);
const FAMILY_KEYS = new Set(["chave", "rotulo", "membros"]);
const ENTRY_KEYS = new Set([
  "dado",
  "valor",
  "inicio",
  "fim",
  "operacao",
  "responsavel",
  "distribuicao",
  // 0143
  "coordenadas",
  "modo",
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * As coordenadas de volta ao FIO. Por CHAVE, não por rótulo: a chave de família
 * e de membro é imutável e não é um id (a regra do contrato é "ids nunca no
 * JSON"), e o validador aceita chave OU rótulo nos dois lados. Serializar por
 * rótulo exigiria o catálogo aqui, e o round-trip passaria a depender de um
 * rótulo que alguém pode renomear entre dois turnos.
 *
 * `null` é o RESIDUAL ("Sem Canal") e atravessa como null — o mesmo valor que
 * o jsonb guarda.
 */
function wireCoords(
  coords: Record<string, string | null>
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const key of Object.keys(coords).sort()) out[key] = coords[key] ?? null;
  return out;
}

/** A MESMA derivação de chave do choke point (`deriveKey` em actions.ts). */
const slugKey = (label: string): string =>
  slugify(label)
    .slice(0, 40)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+/, "");

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
  families?: ParsedManualFamily[];
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
      ...((parsed.families ?? []).some((f) => f.criar || f.members.some((m) => m.criar))
        ? {
            familias: (parsed.families ?? [])
              .filter((f) => f.criar || f.members.some((m) => m.criar))
              .map((f) => ({
                chave: f.key,
                rotulo: f.label,
                membros: f.members.map((m) => ({ chave: m.key, rotulo: m.label })),
              })),
          }
        : {}),
      lancamentos: parsed.entries.map((e) => ({
        dado: e.seriesLabel,
        valor: e.value,
        inicio: e.periodStart,
        fim: e.periodEnd,
        ...(e.operationName ? { operacao: e.operationName } : {}),
        ...(e.responsibleName ? { responsavel: e.responsibleName } : {}),
        ...(e.spread ? { distribuicao: e.spread } : {}),
        // As COORDENADAS voltam ao fio SEMPRE que existem: é o que faz a prévia
        // reinjetada no turno seguinte continuar endereçando a mesma célula.
        ...(Object.keys(e.coords).length > 0
          ? { coordenadas: wireCoords(e.coords) }
          : {}),
        // `modo` só sai quando não é o padrão — payload mais limpo, e o parse
        // trata ausência como "substituir".
        ...(e.mode !== "substituir" ? { modo: e.mode } : {}),
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
  // FAMÍLIAS (0143): por CHAVE e por RÓTULO, como os dados.
  type CtxFamily = (typeof ctx.families)[number];
  const famByKey = new Map<string, CtxFamily>();
  const famByLabel = new Map<string, CtxFamily>();
  for (const f of ctx.families) {
    famByKey.set(f.key, f);
    famByLabel.set(normalizeName(f.label), f);
  }
  // O valor ATUAL de cada célula, para a prévia dizer o que muda. A chave é a
  // MESMA tripla do índice único (dado × período × atribuição × coordenadas).
  const slotOf = (
    seriesKey: string,
    start: string,
    end: string,
    responsibleId: string | null,
    operationId: string | null,
    coords: Record<string, string | null>
  ): string =>
    JSON.stringify([
      seriesKey,
      start,
      end,
      responsibleId,
      operationId,
      Object.keys(coords)
        .sort()
        .map((k) => `${k}=${coords[k] ?? ""}`)
        .join("|"),
    ]);
  const currentBySlot = new Map<string, number>();
  for (const e of ctx.existing) {
    currentBySlot.set(
      slotOf(
        e.seriesKey,
        e.periodStart,
        e.periodEnd,
        e.responsibleId,
        e.operationId,
        e.coords
      ),
      e.value
    );
  }

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
    const key = wanted ? slugKey(wanted) : slugKey(label);
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

  // ---- Famílias NOVAS declaradas na resposta (0143).
  // Create-only, no molde de `dados`: família ou membro EXISTENTE nunca é
  // renomeado pela IA (precedente de operações), e não há exclusão.
  const familiesOut: ParsedManualFamily[] = [];
  const rawFamilies = Array.isArray(obj.familias) ? obj.familias : [];
  if (rawFamilies.length > MAX_AI_MANUAL_FAMILIES) {
    return {
      ok: false,
      errors: [
        `A resposta declara ${rawFamilies.length} famílias — o máximo é ${MAX_AI_MANUAL_FAMILIES}.`,
      ],
    };
  }
  rawFamilies.forEach((item, i) => {
    const where = `família ${i + 1}`;
    if (!isRecord(item)) {
      errors.push(`${where}: deve ser um objeto.`);
      return;
    }
    for (const k of Object.keys(item)) {
      if (!FAMILY_KEYS.has(k)) errors.push(`${where}: chave desconhecida "${k}".`);
    }
    const label = asString(item.rotulo);
    if (label.length < 2) {
      errors.push(`${where}: "rotulo" é obrigatório (ex.: "Canal").`);
      return;
    }
    const norm = normalizeName(label);
    const key = asString(item.chave) || slugKey(label);
    if (!MANUAL_KEY_RE.test(key)) {
      errors.push(
        `${where}: não consigo derivar uma chave de "${label}". Informe "chave" (letras minúsculas, números e _, começando com letra).`
      );
      return;
    }
    const existing = famByLabel.get(norm) ?? famByKey.get(key);
    const rawMembers = Array.isArray(item.membros) ? item.membros : [];
    if (rawMembers.length > MAX_AI_MANUAL_FAMILY_MEMBERS) {
      errors.push(
        `${where}: ${rawMembers.length} membros — o máximo é ${MAX_AI_MANUAL_FAMILY_MEMBERS}.`
      );
      return;
    }
    if (existing?.builtin) {
      // Responsável e Operação são famílias do SISTEMA: os membros delas são as
      // pessoas e operações de verdade, e criar membro ali não faria sentido.
      warnings.push(
        `"${existing.label}" é uma família do sistema — os membros dela são os responsáveis/operações cadastrados. Ignorei a declaração.`
      );
      return;
    }
    const known = new Set((existing?.members ?? []).map((m) => m.key));
    const knownByLabel = new Map(
      (existing?.members ?? []).map((m) => [normalizeName(m.label), m.key])
    );
    const members: ParsedManualFamily["members"] = [];
    for (const [j, m] of rawMembers.entries()) {
      const mWhere = `${where}, membro ${j + 1}`;
      if (!isRecord(m)) {
        errors.push(`${mWhere}: deve ser um objeto.`);
        continue;
      }
      const mLabel = asString(m.rotulo);
      if (!mLabel) {
        errors.push(`${mWhere}: "rotulo" é obrigatório.`);
        continue;
      }
      const mNorm = normalizeName(mLabel);
      const hitKey = knownByLabel.get(mNorm);
      const mKey = asString(m.chave) || hitKey || slugKey(mLabel);
      if (!MANUAL_KEY_RE.test(mKey)) {
        errors.push(`${mWhere}: não consigo derivar uma chave de "${mLabel}".`);
        continue;
      }
      if (members.some((x) => x.key === mKey)) {
        errors.push(`${mWhere}: a chave "${mKey}" aparece duas vezes.`);
        continue;
      }
      members.push({ key: mKey, label: mLabel, criar: !known.has(mKey) });
    }
    familiesOut.push({
      ...(existing ? {} : {}),
      key: existing?.key ?? key,
      label: existing?.label ?? label,
      criar: existing == null,
      members,
    });
    // Entra nos índices para os lançamentos deste MESMO payload poderem citá-la.
    const merged = {
      key: existing?.key ?? key,
      label: existing?.label ?? label,
      builtin: false,
      members: [
        ...(existing?.members ?? []),
        ...members
          .filter((m) => m.criar)
          .map((m) => ({ key: m.key, label: m.label })),
      ],
    };
    famByKey.set(merged.key, merged);
    famByLabel.set(normalizeName(merged.label), merged);
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

    // COORDENADAS (0143): a família e o membro por CHAVE ou RÓTULO — ids nunca
    // vêm do JSON. `null` é o RESIDUAL declarado ("Sem Canal"), que é um grupo
    // de verdade; a chave AUSENTE é "não reparte por essa família".
    const coords: Record<string, string | null> = {};
    const coordParts: string[] = [];
    const rawCoords = item.coordenadas;
    if (rawCoords !== undefined && rawCoords !== null) {
      if (!isRecord(rawCoords)) {
        errors.push(
          `${where}: "coordenadas" deve ser um objeto (ex.: { "canal": "ligacao" }).`
        );
        return;
      }
      for (const [famRaw, memberRaw] of Object.entries(rawCoords)) {
        const fam =
          famByKey.get(famRaw) ?? famByLabel.get(normalizeName(famRaw));
        if (!fam) {
          errors.push(
            `${where}: não existe a família "${famRaw}". As famílias são: ${shortList(ctx.families.map((f) => f.label))}. Para criar uma nova, declare-a em "familias".`
          );
          return;
        }
        // Família que o DADO não declara: recortar por um eixo que ele não tem
        // faria o número degradar para "—" no dashboard, em silêncio. Erro aqui
        // é melhor — quem colou pode marcar a família na tela.
        const declared = ctx.declarations[seriesKey] ?? [];
        if (declared.length > 0 && !declared.includes(fam.key)) {
          errors.push(
            `${where}: "${seriesLabel}" não se reparte por "${fam.label}". Marque essa família para o dado na tela, ou use uma das declaradas: ${shortList(declared.map((k) => famByKey.get(k)?.label ?? k))}.`
          );
          return;
        }
        if (memberRaw === null) {
          coords[fam.key] = null;
          coordParts.push(`${fam.label}: sem ${fam.label.toLowerCase()}`);
          continue;
        }
        const memberStr = asString(memberRaw);
        if (!memberStr) {
          errors.push(
            `${where}: o membro de "${fam.label}" precisa ser um texto, ou null para o residual.`
          );
          return;
        }
        const hit =
          fam.members.find((m) => m.key === memberStr) ??
          fam.members.find(
            (m) => normalizeName(m.label) === normalizeName(memberStr)
          );
        if (!hit) {
          errors.push(
            `${where}: "${memberStr}" não é um membro de "${fam.label}". Os membros são: ${shortList(fam.members.map((m) => m.label))}${fam.builtin ? "" : '. Para criar um novo, declare-o em "familias"'}.`
          );
          return;
        }
        coords[fam.key] = hit.key;
        coordParts.push(`${fam.label}: ${hit.label}`);
      }
    }

    // `modo`: ausente = substituir, que é o que "atualizar" quer dizer e o que o
    // UPSERT do choke point já fazia. `somar` é resolvido no SERVIDOR sobre o
    // valor atual — a IA nunca faz a conta, porque erraria calada se o número
    // tivesse mudado entre a prévia e o Aplicar.
    let mode: ParsedManualEntry["mode"] = "substituir";
    if (item.modo !== undefined && item.modo !== null) {
      if (!isManualEntryMode(item.modo)) {
        errors.push(`${where}: "modo" deve ser "substituir" ou "somar".`);
        return;
      }
      mode = item.modo;
    }

    // Duas linhas para o MESMO dado × período × atribuição × COORDENADAS
    // colidiriam no upsert: a segunda sobrescreveria a primeira em silêncio.
    // As coordenadas ENTRAM na chave — sem elas, as células legítimas de um
    // cruzamento (mesmo dado, mesmo mês, membros diferentes) seriam recusadas
    // como duplicata.
    const slot = slotOf(seriesKey, start, end, responsibleId, operationId, coords);
    if (usedSlots.has(slot)) {
      errors.push(
        `${where}: "${seriesLabel}" já tem um lançamento para esse mesmo período, atribuição e repartição nesta resposta. Some os valores num lançamento só.`
      );
      return;
    }
    usedSlots.add(slot);

    const currentValue = currentBySlot.get(slot);
    if (mode === "somar" && currentValue === undefined) {
      warnings.push(
        `${where}: não havia valor anterior para somar em "${seriesLabel}" — o lançamento entra com ${value}.`
      );
    }

    entries.push({
      seriesKey,
      periodStart: start,
      periodEnd: end,
      value,
      responsibleId,
      operationId,
      spread,
      coords,
      mode,
      currentValue: currentValue ?? null,
      seriesLabel,
      responsibleName,
      operationName,
      coordLabel: coordParts.length > 0 ? coordParts.join(" · ") : null,
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

  // Família declarada que nenhum lançamento usa é DESCARTADA com aviso, pela
  // mesma régua do dado: criar um eixo vazio na base de alguém, sem ninguém
  // pedir, é ruído.
  const usedFamilyKeys = new Set(entries.flatMap((e) => Object.keys(e.coords)));
  const families = familiesOut.filter(
    (f) => usedFamilyKeys.has(f.key) && (f.criar || f.members.some((m) => m.criar))
  );
  for (const f of familiesOut) {
    if (!usedFamilyKeys.has(f.key) && f.criar) {
      warnings.push(
        `A família "${f.label}" foi declarada sem nenhum lançamento que a use — ignorada.`
      );
    }
  }

  return {
    ok: true,
    parsed: { series, families, entries, notes: warnings },
    warnings,
  };
}

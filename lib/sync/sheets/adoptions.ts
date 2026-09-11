// Versão: 1.0 | Data: 11/09/2026
// ADOÇÃO de registro da planilha "Estudo de Fechamentos" por IMPRESSÃO DIGITAL.
//
// Por que existe: a chave natural da linha é `sha256(normalizeName(nome)|data)`
// (sourceIdFor, adapter.ts) — identidade derivada de conteúdo MUTÁVEL. Editar o
// "Name" na aba Site minta um source_id novo: o adapter não achava existente,
// INSERIA, e o registro antigo ficava órfão somando nos dashboards ao lado do
// substituto (3 casos em agosto/2026, todos por sufixo entre parênteses —
// "GRUPO SAFEROC" → "GRUPO SAFEROC (KTS)"). Pior: o órfão levava junto a
// curadoria manual (responsible_id, related_lead_id, field_modified_at) e o
// substituto nascia do zero.
//
// A saída NÃO foi mudar a chave (re-chavear a base inteira faria todo registro
// parecer novo) nem carimbar um id na planilha: o payload JÁ carrega uma
// impressão digital estável que sobrevive à renomeação — o E-MAIL. Quando o
// hash não encontra existente, procuramos a linha por `(e-mail, dia)` e
// ADOTAMOS o registro, re-chaveando o source_id dele para o hash novo. Com
// isso, renomear virou UPDATE: título, histórico, vínculos e edições manuais
// seguem no MESMO registro, e nada precisou ser migrado.
//
// Por que `(e-mail, dia)` e não só o e-mail: o dia é o que impede a 2ª venda de
// um cliente recorrente (mesmo e-mail, data nova) ser adotada pelo registro da
// 1ª — isso FUNDIRIA duas vendas reais, perdendo receita, que é um estrago bem
// pior do que a duplicata que estamos consertando. O preço é que correção de
// DATA na planilha não é adotada: ela segue criando registro novo, e quem
// aposenta o antigo é a varredura do push (lib/sync/sheets/sweep.ts). Correto
// pelos dois lados, sem heurística que possa fundir venda.
//
// Fail-closed em toda dúvida: sem e-mail não adota; 2+ candidatos não adota
// (conta como ambíguo e o chamador reporta); candidato já casado pelo hash com
// outra linha do push não é adotável; cada candidato é adotado no máximo uma
// vez.
import type { SupabaseClient } from "@supabase/supabase-js";

import { BRASILIA_TZ, zonedParts } from "@/lib/date/normalize";
import {
  escapeLikePattern,
  normalizeEmail,
  type ExistingRecord,
} from "@/lib/sync/shared";

/** Linha do push que o hash legado NÃO encontrou — candidata a adotar. */
export interface AdoptionRequest {
  /** Hash NOVO (o que a linha vale hoje); vira o source_id do adotado. */
  sourceId: string;
  /** E-mail já normalizado; null nunca adota. */
  email: string | null;
  /** Dia da venda, "YYYY-MM-DD" cru da planilha (já é dia de Brasília). */
  day: string;
}

/** Registro vivo da base que pode ser o mesmo da linha, sob outro nome. */
export interface AdoptionCandidate {
  id: string;
  /** source_id ATUAL do registro — vai para a auditoria do re-chaveamento. */
  sourceId: string;
  email: string;
  /** Dia de Brasília de `source_created_at`. */
  day: string;
  record: ExistingRecord;
}

export interface AdoptionOutcome {
  /** Chave: sourceId novo. Valor: o registro a adotar. */
  picks: Map<string, AdoptionCandidate>;
  /** sourceIds que tinham 2+ candidatos livres — inseridos, não adotados. */
  ambiguous: string[];
}

function fingerprint(email: string, day: string): string {
  return `${email}|${day}`;
}

/** Dia de Brasília de um `source_created_at` (timestamptz) da base. */
export function brasiliaDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(String(value));
  if (Number.isNaN(ms)) return null;
  const p = zonedParts(ms, BRASILIA_TZ);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/**
 * Decide, de forma PURA, quais linhas adotam qual registro.
 *
 * `claimedRecordIds` são os registros já casados pelo hash legado com alguma
 * linha DESTE push: adotar um deles daria dois donos ao mesmo registro.
 */
export function pickAdoptions(
  requests: AdoptionRequest[],
  candidates: AdoptionCandidate[],
  claimedRecordIds: ReadonlySet<string>
): AdoptionOutcome {
  const byFingerprint = new Map<string, AdoptionCandidate[]>();
  for (const c of candidates) {
    if (claimedRecordIds.has(c.id)) continue;
    const key = fingerprint(c.email, c.day);
    const list = byFingerprint.get(key);
    if (list) list.push(c);
    else byFingerprint.set(key, [c]);
  }

  const picks = new Map<string, AdoptionCandidate>();
  const ambiguous: string[] = [];
  const taken = new Set<string>();

  for (const req of requests) {
    if (!req.email) continue;
    const list = byFingerprint.get(fingerprint(req.email, req.day));
    if (!list || list.length === 0) continue;
    if (list.length > 1) {
      ambiguous.push(req.sourceId);
      continue;
    }
    const [only] = list;
    // Um candidato serve a uma linha só: duas linhas com a MESMA impressão
    // digital (dedup do payload já as colapsa, mas a garantia é barata)
    // adotariam o mesmo registro e a segunda sobrescreveria a primeira.
    if (taken.has(only.id)) continue;
    taken.add(only.id);
    picks.set(req.sourceId, only);
  }

  return { picks, ambiguous };
}

/**
 * Busca os candidatos vivos com os e-mails dados.
 *
 * Só roda para as linhas que o hash não encontrou — em regime estável, nenhuma.
 * Usa `ilikeAnyOf` + pós-filtro de igualdade exata pelo mesmo motivo do lookup
 * de lead por e-mail (adapter.ts): o índice `lower()` da 0013 não é expressável
 * no PostgREST, e ILIKE trata %/_ como curinga mesmo escapados.
 *
 * Filtra `deleted_at is null` — ao contrário da busca PRIMÁRIA por chave
 * natural, que segue sem o filtro de propósito (invariante 30: a linha na
 * lixeira é atualizada in-place e NÃO ressuscita). Aqui é o oposto: adoção é
 * heurística, e ressuscitar um registro que um admin mandou para a Lixeira —
 * os órfãos de agosto/2026, por exemplo — seria desfazer a decisão dele.
 */
export async function loadAdoptionCandidates(
  db: SupabaseClient,
  opts: {
    recordType: string;
    sourceSystem: string;
    columns: string;
    emails: (string | null)[];
    batchSize: number;
  }
): Promise<AdoptionCandidate[]> {
  const unique = [
    ...new Set(
      opts.emails.map(normalizeEmail).filter((e): e is string => e !== null)
    ),
  ];
  if (unique.length === 0) return [];
  const wanted = new Set(unique);

  const out: AdoptionCandidate[] = [];
  for (let i = 0; i < unique.length; i += opts.batchSize) {
    const slice = unique.slice(i, i + opts.batchSize);
    const { data, error } = await db
      .from("records")
      .select(`${opts.columns}, source_created_at, email:custom_fields->>email`)
      .eq("record_type", opts.recordType)
      .eq("source_system", opts.sourceSystem)
      .is("deleted_at", null)
      .ilikeAnyOf("custom_fields->>email", slice.map(escapeLikePattern));
    if (error) throw new Error(`candidatos de adoção: ${error.message}`);
    for (const r of data ?? []) {
      const rec = r as unknown as ExistingRecord & {
        source_id: string | null;
        source_created_at: string | null;
        email: string | null;
      };
      const email = normalizeEmail(rec.email);
      if (!email || !wanted.has(email)) continue;
      const day = brasiliaDay(rec.source_created_at);
      if (!day || !rec.source_id) continue;
      out.push({ id: rec.id, sourceId: rec.source_id, email, day, record: rec });
    }
  }
  return out;
}

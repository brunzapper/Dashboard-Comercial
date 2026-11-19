// Versão: 1.0 | Data: 19/11/2026
// Opções do filtro de ETAPA/FASE (esquema por Base, fase 3) — módulo PURO.
//
// A coluna `stage` é UMA para lead e negócio. Antes, o seletor listava só os
// valores que existiam nos registros das Bases marcadas, sem dizer de qual
// Base nem de qual pipeline: "Fase do negócio" e "Etapa do lead" se misturavam
// e fase sem registro ainda não aparecia. Agora cada Base contribui com as
// fases DECLARADAS na origem (source_fields.options do `core:stage`, gravadas
// pelo sync do catálogo) agrupadas pelo pipeline, mais os valores que só
// existem nos registros (fase renomeada/apagada no Bitrix) num grupo à parte.
// O valor gravado no filtro segue sendo o NOME da fase (semântica atual).

export interface StageOption {
  value: string;
  label: string;
  group?: string;
}

export interface StageBase {
  key: string;
  label: string;
  recordType: string;
  /** Fases declaradas (null = Base sem lista declarada). */
  declared: { value: string; group?: string | null }[] | null;
}

export const ONLY_IN_RECORDS_GROUP = "Só nos registros";

export function mergeStageOptions(
  bases: readonly StageBase[],
  dataValues: ReadonlyMap<string, ReadonlySet<string>>
): StageOption[] {
  const multi = bases.length > 1;
  const out: StageOption[] = [];
  const seen = new Set<string>();
  const push = (value: string, group: string | undefined) => {
    const v = value.trim();
    if (!v) return;
    const k = `${group ?? ""}\u0000${v}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(group ? { value: v, label: v, group } : { value: v, label: v });
  };
  const join = (base: StageBase, sub: string | null | undefined) =>
    multi ? (sub ? `${base.label} · ${sub}` : base.label) : sub ?? undefined;

  for (const base of bases) {
    const declared = base.declared ?? [];
    const declaredValues = new Set(declared.map((o) => o.value.trim()));
    for (const o of declared) push(o.value, join(base, o.group ?? null));
    const data = [...(dataValues.get(base.recordType) ?? [])]
      .filter((v) => !declaredValues.has(v.trim()))
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
    const group =
      declared.length > 0 ? join(base, ONLY_IN_RECORDS_GROUP) : join(base, null);
    for (const v of data) push(v, group);
  }
  return out;
}

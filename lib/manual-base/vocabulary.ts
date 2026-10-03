// Versão: 1.0 | Data: 03/10/2026
// v1.0 (03/10/2026): o VOCABULÁRIO de tela da Base manual, num lugar só.
//
// A tela falava em "dado", "família" e "membro" — termos do modelo, não de quem
// lança — e expunha as referências internas (`manual:…`, `manualdim:…`). A
// escolha do usuário foi **Métrica manual / Divisão / Opção**. Só o TEXTO
// exibido muda: chaves, tabelas (`manual_series`, `manual_families`,
// `manual_family_members`), refs e o contrato da IA (`base-manual-edit`) ficam
// intocados — renomear o modelo orfanaria fórmulas gravadas.
//
// Regra do projeto "vocabulário de domínio é DADO": toda tela da Base manual lê
// daqui, nunca um literal solto — a palavra errada no fonte se espalha a cada
// tela nova.
//
// Módulo PURO e client-safe.

export const MANUAL_TERMS = {
  /** O número nomeado (`manual_series`). */
  metric: "Métrica manual",
  metricShort: "Métrica",
  metricPlural: "Métricas",
  /** Uma maneira de repartir o mesmo número (`manual_families`). */
  division: "Divisão",
  divisionPlural: "Divisões",
  /** Um valor da divisão (`manual_family_members`). */
  option: "Opção",
  optionPlural: "Opções",
  /** O lançamento (`manual_entries`). */
  entryPlural: "Lançamentos",
  /** A linha da grade que não reparte nada (o nível ∅). */
  total: "Total",
} as const;

/** "1 lançamento" / "3 lançamentos" — contagem com o substantivo certo. */
export function countLabel(n: number, singular: string, plural: string): string {
  return `${new Intl.NumberFormat("pt-BR").format(n)} ${n === 1 ? singular : plural}`;
}

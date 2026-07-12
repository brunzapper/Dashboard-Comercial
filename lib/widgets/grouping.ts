// Versão: 1.0 | Data: 12/07/2026
// Algoritmo de agrupamento COMPARTILHADO pelas tabelas de lista (registros e
// entidades). Puro (sem JSX): monta a árvore de grupos recolhíveis e, para a
// orientação transposta, o eixo de coluna + a árvore de métricas. Cada tabela
// injeta seus acessores (`keyOf`/`labelOf`/`sortKeyOf`) porque o modelo de linha
// difere (RecordRow vs EntityListRow); assim o algoritmo fica num só lugar e o
// JSX (subtotais, células editáveis) permanece por componente.
//
// `keyOf` = chave que FUNDE as linhas (valor bruto, ou o display de data já
// formatado). `labelOf` = texto exibido no cabeçalho (default = keyOf). `sortKeyOf`
// (opcional) ordena as chaves cronologicamente — usado nos níveis de data para
// recuperar a ordem por `bucketRecordDate(...).sort`.

export type GroupNode<T> =
  | { kind: "group"; level: number; key: string; label: string; rows: T[] }
  | { kind: "data"; row: T };

export interface GroupOpts<T> {
  keyOf: (row: T, field: string) => string;
  labelOf?: (row: T, field: string) => string;
  sortKeyOf?: (row: T, field: string) => number;
  isExpanded: (key: string) => boolean;
}

// Agrupa `rows` pela hierarquia `levels`, achatando em nós (grupo/dado) conforme os
// grupos expandidos. A chave do nó inclui o caminho (prefixo) p/ não confundir
// grupos homônimos em ramos diferentes.
export function buildGroupItems<T>(
  rows: T[],
  levels: string[],
  opts: GroupOpts<T>,
  depth = 0,
  prefix = ""
): GroupNode<T>[] {
  if (levels.length === 0) return rows.map((row) => ({ kind: "data", row }));
  const [field, ...rest] = levels;
  const byKey = new Map<string, { label: string; sort: number; rows: T[] }>();
  const order: string[] = [];
  for (const row of rows) {
    const k = opts.keyOf(row, field);
    let g = byKey.get(k);
    if (!g) {
      g = {
        label: opts.labelOf ? opts.labelOf(row, field) : k,
        sort: opts.sortKeyOf ? opts.sortKeyOf(row, field) : 0,
        rows: [],
      };
      byKey.set(k, g);
      order.push(k);
    }
    g.rows.push(row);
  }
  // Ordena por `sort` quando fornecido (níveis de data → cronológico). Ordenação
  // estável (V8): níveis não-data (sort=0) mantêm a ordem de inserção.
  if (opts.sortKeyOf) order.sort((a, b) => byKey.get(a)!.sort - byKey.get(b)!.sort);
  const items: GroupNode<T>[] = [];
  for (const k of order) {
    const g = byKey.get(k)!;
    const nodeKey = `${prefix}›${k}`;
    items.push({ kind: "group", level: depth, key: nodeKey, label: g.label, rows: g.rows });
    if (opts.isExpanded(nodeKey))
      items.push(...buildGroupItems(g.rows, rest, opts, depth + 1, nodeKey));
  }
  return items;
}

// Remove campos repetidos preservando a ordem — usado ao unir níveis de "Agrupar
// período" (colunas de data promovidas) com o "Agrupar por" explícito.
export function dedupeFields(fields: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of fields) {
    if (!seen.has(f)) {
      seen.add(f);
      out.push(f);
    }
  }
  return out;
}

// --- Orientação transposta ---

// Eixo de coluna: valores distintos de `colField` na ordem em que aparecem, com
// deduplicação pela chave que funde (`keyOf`) — datas do mesmo formato viram uma
// coluna só. `colVals` guarda uma linha representativa (o cabeçalho a formata).
export function columnAxis<T>(
  rows: T[],
  colField: string,
  keyOf: (row: T, field: string) => string
): {
  colVals: T[];
  colGroupKey: (row: T) => string;
  rowsForCol: (rs: T[], rep: T) => T[];
} {
  const colGroupKey = (row: T) => keyOf(row, colField);
  const colVals: T[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const gk = colGroupKey(row);
    if (!seen.has(gk)) {
      seen.add(gk);
      colVals.push(row);
    }
  }
  const rowsForCol = (rs: T[], rep: T) => {
    const rk = colGroupKey(rep);
    return rs.filter((r) => colGroupKey(r) === rk);
  };
  return { colVals, colGroupKey, rowsForCol };
}

export interface TItem<T> {
  metricKey: string;
  level: number;
  label: string;
  key: string;
  rows: T[];
  collapsible: boolean;
}

// Árvore do eixo esquerdo (transposta) para UMA métrica: cada nível de grupo vira
// uma linha recolhível aninhada. O chamador cria a linha de nível 0 da métrica e
// chama isto para os níveis abaixo.
export function buildTransposedItems<T>(
  rows: T[],
  levels: string[],
  opts: GroupOpts<T> & { metricKey: string },
  depth = 1,
  prefix = ""
): TItem<T>[] {
  if (levels.length === 0) return [];
  const [field, ...rest] = levels;
  const byKey = new Map<string, { label: string; sort: number; rows: T[] }>();
  const order: string[] = [];
  for (const row of rows) {
    const k = opts.keyOf(row, field);
    let g = byKey.get(k);
    if (!g) {
      g = {
        label: opts.labelOf ? opts.labelOf(row, field) : k,
        sort: opts.sortKeyOf ? opts.sortKeyOf(row, field) : 0,
        rows: [],
      };
      byKey.set(k, g);
      order.push(k);
    }
    g.rows.push(row);
  }
  if (opts.sortKeyOf) order.sort((a, b) => byKey.get(a)!.sort - byKey.get(b)!.sort);
  const items: TItem<T>[] = [];
  for (const k of order) {
    const g = byKey.get(k)!;
    const nodeKey = `${prefix}›${k}`;
    const isLeaf = rest.length === 0;
    items.push({
      metricKey: opts.metricKey,
      level: depth,
      label: g.label,
      key: nodeKey,
      rows: g.rows,
      collapsible: !isLeaf,
    });
    if (!isLeaf && opts.isExpanded(nodeKey))
      items.push(...buildTransposedItems(g.rows, rest, opts, depth + 1, nodeKey));
  }
  return items;
}

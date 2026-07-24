// Versão: 1.0 | Data: 24/07/2026
// GUARDA DE PARIDADE das RPCs de widget — espelho executável da invariante 1
// do AGENTS.md: toda mudança em `run_widget_query` DEVE ser espelhada em
// `run_widget_query_snapshot` NA MESMA migração (inclusive o par helper
// `_widget_match_expr` ↔ `_widget_match_expr_snap`).
//
// Como funciona (100% estático — lê o SQL de supabase/migrations/, sem banco):
//   1. localiza a ÚLTIMA migração que define cada função (create or replace);
//   2. extrai o corpo (da linha do create até a linha `$$;`);
//   3. normaliza (remove comentários `--`, aplica as substituições mecânicas
//      snapshot→base) e compara:
//      - par principal: diff por linha (LCS); toda linha exclusiva de um lado
//        precisa casar com a ALLOWLIST do bloco snapshot-only (0056/0057);
//      - par helper: normalização forte (uma linha, literais fundidos) menos
//        os predicados de correlação por snapshot_id → igualdade byte a byte.
//
// Quando este teste falhar após uma migração nova: espelhe a mudança na
// função irmã NA MESMA migração. Só estenda as allowlists se a divergência
// for snapshot-only INTENCIONAL (documente o porquê no comentário da regex).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.join(__dirname, "..", "supabase", "migrations");

interface FnDefinition {
  /** Nome do arquivo de migração (ex.: 0085_widget_rpc_brasilia_day.sql). */
  file: string;
  /** Linhas cruas, da linha do `create or replace` até a linha `$$;`. */
  lines: string[];
}

/** Arquivos de migração em ordem numérica (nomes são zero-padded). */
function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Última definição de `public.<name>` nas migrações. O `\s*\(` é obrigatório:
 * sem ele, `run_widget_query(` casaria também com `run_widget_query_snapshot`.
 */
function lastDefinition(name: string): FnDefinition {
  const startRe = new RegExp(
    `^\\s*create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`,
    "i"
  );
  let found: FnDefinition | null = null;
  for (const file of migrationFiles()) {
    const lines = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8").split(
      "\n"
    );
    for (let i = 0; i < lines.length; i++) {
      if (!startRe.test(lines[i])) continue;
      const end = lines.findIndex((l, j) => j > i && l.trim() === "$$;");
      if (end === -1) {
        throw new Error(
          `Extração falhou: definição de ${name} em ${file} não termina em "$$;" — ` +
            `ajuste a extração em tests/rpc-parity.test.ts.`
        );
      }
      found = { file, lines: lines.slice(i, end + 1) };
    }
  }
  if (!found) {
    throw new Error(`Nenhuma migração define public.${name}.`);
  }
  return found;
}

/** Remove comentários `--` de fim de linha, trim à direita, descarta vazias. */
function stripComments(lines: string[]): string[] {
  return lines
    .map((l) => l.replace(/--.*$/, "").trimEnd())
    .filter((l) => l.trim() !== "");
}

/** Substituições mecânicas snapshot→base do par PRINCIPAL (invariante 1). */
function snapToBase(line: string): string {
  return line
    .replaceAll("run_widget_query_snapshot", "run_widget_query")
    .replaceAll("_widget_match_expr_snap", "_widget_match_expr")
    .replaceAll("snapshot_records", "records");
}

/** Linhas exclusivas de cada lado, via LCS clássico (arrays pequenos). */
function diffExclusive(
  a: string[],
  b: string[]
): { onlyA: string[]; onlyB: string[] } {
  const n = a.length;
  const m = b.length;
  // dp[(i)*(m+1)+j] = LCS de a[i..] × b[j..]
  const dp = new Int32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * (m + 1) + j] =
        a[i] === b[j]
          ? dp[(i + 1) * (m + 1) + j + 1] + 1
          : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
    }
  }
  const onlyA: string[] = [];
  const onlyB: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) {
      onlyA.push(a[i++]);
    } else {
      onlyB.push(b[j++]);
    }
  }
  onlyA.push(...a.slice(i));
  onlyB.push(...b.slice(j));
  return { onlyA, onlyB };
}

// ---------------------------------------------------------------------------
// ALLOWLISTS do par principal — as ÚNICAS divergências aceitas entre
// run_widget_query_snapshot (normalizado) e run_widget_query. Cada entrada
// aponta a migração que a introduziu. Linha fora daqui = quebra da invariante.
// ---------------------------------------------------------------------------

/** Linhas que SÓ existem na versão snapshot (escopo 0056 + restrições 0057). */
const SNAPSHOT_ONLY: RegExp[] = [
  // 0056 — parâmetro e escopo do snapshot (garantia no banco).
  /^\s*p_snapshot_id uuid,$/,
  /^\s*if p_snapshot_id is null then$/,
  /^\s*raise exception 'Snapshot (obrigatório|inexistente)/,
  /\|\| format\('records\.snapshot_id = %L', p_snapshot_id\)$/,
  /\|\| 'not records\.partner_only'::text;$/,
  // 0057 — restrições do snapshot, mock-aware (mocks entram sempre).
  /^\s*v_snap public\.snapshots%rowtype;$/,
  /^\s*v_restr text\[\] := array\[\]::text\[\];$/,
  /^\s*select \* into v_snap from public\.snapshots where id = p_snapshot_id;$/,
  /^\s*if not found then$/,
  /^\s*if v_snap\.allowed_(sources|responsible_ids|operation_ids) is not null then$/,
  /^\s*v_restr := v_restr$/,
  /\|\| format\('records\.(record_type|responsible_id|operation_id) = any \(%L::(text|uuid)\[\]\)', v_snap\.allowed_\w+\);$/,
  /^\s*if array_length\(v_restr, 1\) is not null then$/,
  /\|\| \('\(records\.is_mock or \('/,
  /^\s*v_where_parts := v_where_parts$/,
  /^\s*end if;$/,
  // 0056 — FROM com alias `records` (snapshot_records records) e WHERE
  // incondicional (o escopo garante v_where_parts não vazio).
  /\|\| ' from public\.records records';$/,
  /^\s*v_sql := v_sql \|\| ' where ' \|\| array_to_string\(v_where_parts, ' and '\);$/,
];

/** Linhas que SÓ existem na versão base (WHERE condicional; FROM sem alias). */
const BASE_ONLY: RegExp[] = [
  /\|\| ' from public\.records';$/,
  /^\s*if array_length\(v_where_parts, 1\) is not null then$/,
  /^\s*v_sql := v_sql \|\| ' where ' \|\| array_to_string\(v_where_parts, ' and '\);$/,
  /^\s*end if;$/,
];

function unexpected(lines: string[], allow: RegExp[]): string[] {
  return lines.filter((l) => !allow.some((re) => re.test(l)));
}

const MIRROR_MSG =
  "Espelhe a mudança na função irmã NA MESMA migração (invariante 1 do " +
  "AGENTS.md). Se a divergência for snapshot-only INTENCIONAL, adicione-a à " +
  "allowlist de tests/rpc-parity.test.ts com comentário justificando.";

describe("paridade run_widget_query × run_widget_query_snapshot", () => {
  const base = lastDefinition("run_widget_query");
  const snap = lastDefinition("run_widget_query_snapshot");
  const baseNorm = stripComments(base.lines);
  const snapNorm = stripComments(snap.lines).map(snapToBase);

  it("extração sã (corpos completos, não vazios)", () => {
    expect(baseNorm.length).toBeGreaterThan(100);
    expect(snapNorm.length).toBeGreaterThan(100);
  });

  it("as duas funções foram recriadas pela ÚLTIMA vez na MESMA migração", () => {
    // A regra "espelhar na mesma migração" vira assert literal: recriar só
    // uma das duas numa migração nova falha aqui imediatamente.
    expect(snap.file, MIRROR_MSG).toBe(base.file);
  });

  it("corpos idênticos fora do bloco snapshot-only allowlistado", () => {
    const { onlyA: snapOnly, onlyB: baseOnly } = diffExclusive(
      snapNorm,
      baseNorm
    );
    expect(
      unexpected(snapOnly, SNAPSHOT_ONLY),
      `Linhas SÓ na versão snapshot fora da allowlist. ${MIRROR_MSG}`
    ).toEqual([]);
    expect(
      unexpected(baseOnly, BASE_ONLY),
      `Linhas SÓ na versão base fora da allowlist. ${MIRROR_MSG}`
    ).toEqual([]);
  });

  it("a versão snapshot mantém escopo + restrições mock-aware (0056/0057)", () => {
    // A allowlist aceita AUSÊNCIA de linhas; este assert garante PRESENÇA do
    // que protege o acesso público (snapshot_id, partner_only, is_mock or).
    const body = snapNorm.join("\n");
    expect(body).toContain("records.snapshot_id = %L");
    expect(body).toContain("not records.partner_only");
    expect(body).toContain("records.is_mock or");
  });

  it("a versão base não menciona snapshot (contaminação acidental)", () => {
    expect(baseNorm.join("\n").toLowerCase()).not.toContain("snapshot");
  });

  it("funções de snapshot seguem sem EXECUTE para anon/authenticated", () => {
    // AGENTS.md: snapshots são acesso público SÓ via app/s/[token] + service
    // role — nunca grant a anon/authenticated.
    const sql = readFileSync(path.join(MIGRATIONS_DIR, snap.file), "utf8");
    expect(sql).toMatch(
      /revoke execute on function public\.run_widget_query_snapshot[^;]*from[^;]*(anon|public)/
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.run_widget_query_snapshot[^;]*to[^;]*(anon|authenticated)/
    );
  });
});

describe("paridade _widget_match_expr × _widget_match_expr_snap", () => {
  // Os corpos foram re-quebrados em linhas diferentes (0042 × 0056), então o
  // diff por linha não serve: normalização FORTE — comentários fora, tudo numa
  // linha, literais SQL adjacentes fundidos ('a' || 'b' → 'ab'), whitespace
  // colapsado — e então remoção dos predicados de correlação snapshot-only.
  function strongNormalize(lines: string[]): string {
    return stripComments(lines)
      .join(" ")
      .replace(/'\s*\|\|\s*'/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  it("idênticas após remover a correlação por snapshot_id", () => {
    const base = lastDefinition("_widget_match_expr");
    const snap = lastDefinition("_widget_match_expr_snap");
    expect(base.lines.length).toBeGreaterThan(20);
    expect(snap.lines.length).toBeGreaterThan(20);

    const baseNorm = strongNormalize(base.lines);
    const snapNorm = snapToBase(strongNormalize(snap.lines))
      .replaceAll("snapshot_record_matches", "record_matches")
      // Predicados de correlação por snapshot (mm/p/rm) — as únicas
      // divergências intencionais do par helper (0056).
      .replace(/(mm|p|rm)\.snapshot_id = records\.snapshot_id and /g, "");

    expect(snapNorm, MIRROR_MSG).toBe(baseNorm);
  });
});

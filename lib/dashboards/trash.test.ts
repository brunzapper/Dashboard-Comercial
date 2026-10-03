// Versão: 1.0 | Data: 03/10/2026
// Helpers puros da Lixeira de boards (0087) + a guarda que impede a regressão
// que derrubou o Workspace: um Server Component chamando função exportada de
// módulo "use client" (lá ela é só uma referência de cliente e lança erro).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BOARDS_TRASH_TTL_DAYS,
  BOARDS_TRASH_TTL_MS,
  boardsTrashExpiryLabel,
  withinBoardsTrashTtl,
} from "@/lib/dashboards/trash";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("withinBoardsTrashTtl", () => {
  it("dentro da janela de 14 dias", () => {
    expect(withinBoardsTrashTtl(daysAgo(0), NOW)).toBe(true);
    expect(withinBoardsTrashTtl(daysAgo(13), NOW)).toBe(true);
  });

  it("fora da janela (>= 14 dias) e null (epoch) ficam de fora", () => {
    expect(withinBoardsTrashTtl(daysAgo(14), NOW)).toBe(false);
    expect(withinBoardsTrashTtl(daysAgo(20), NOW)).toBe(false);
    expect(withinBoardsTrashTtl(null, NOW)).toBe(false);
  });

  it("TTL exportado é 14 dias", () => {
    expect(BOARDS_TRASH_TTL_DAYS).toBe(14);
    expect(BOARDS_TRASH_TTL_MS).toBe(14 * 86_400_000);
  });
});

describe("boardsTrashExpiryLabel", () => {
  it("recém-excluído = 14 dias; null conta como agora", () => {
    expect(boardsTrashExpiryLabel(daysAgo(0), NOW)).toBe("Expira em 14 dias");
    expect(boardsTrashExpiryLabel(null, NOW)).toBe("Expira em 14 dias");
  });

  it("singular e vencido", () => {
    expect(boardsTrashExpiryLabel(daysAgo(13), NOW)).toBe("Expira em 1 dia");
    expect(boardsTrashExpiryLabel(daysAgo(14), NOW)).toBe("Expira hoje");
    expect(boardsTrashExpiryLabel(daysAgo(30), NOW)).toBe("Expira hoje");
  });
});

// ---------------------------------------------------------------------------
// Guarda estática: page.tsx/layout.tsx sem "use client" (Server Components) só
// importam COMPONENTES (PascalCase) e TIPOS de um módulo "use client". Uma
// função ou constante (camelCase/SCREAMING_CASE) chega ao servidor como
// referência de cliente; chamá-la lança erro em runtime, e só no ramo que a
// usa. Foi assim que o Workspace caiu com um board na Lixeira (03/10/2026).

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/^(page|layout)\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

const isClientModule = (src: string) =>
  /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*\s*["']use client["']/.test(src);

function resolveAlias(spec: string): string | null {
  if (!spec.startsWith("@/")) return null;
  const base = join(ROOT, spec.slice(2));
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    if (existsSync(base + ext)) return base + ext;
  }
  return null;
}

describe("Server Components não chamam valores de módulos client", () => {
  it("só componentes e tipos atravessam a fronteira", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "app"))) {
      const src = readFileSync(file, "utf8");
      if (isClientModule(src)) continue;
      const imports = src.matchAll(
        /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g
      );
      for (const [, typeOnly, names, spec] of imports) {
        if (typeOnly) continue;
        const target = resolveAlias(spec);
        if (!target || !isClientModule(readFileSync(target, "utf8"))) continue;
        for (const raw of names.split(",")) {
          const name = raw.trim();
          if (!name || name.startsWith("type ")) continue;
          const local = name.split(/\s+as\s+/).pop()!.trim();
          if (!/^[A-Z][a-z]/.test(local)) {
            offenders.push(`${file.replace(ROOT + "/", "")}: ${name} (${spec})`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("o Workspace usa o helper puro da Lixeira", () => {
    const page = readFileSync(join(ROOT, "app/(app)/page.tsx"), "utf8");
    expect(page).toMatch(/from "@\/lib\/dashboards\/trash"/);
  });
});

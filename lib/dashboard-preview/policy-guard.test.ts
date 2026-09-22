// v1.0 | 22/09/2026 — guarda estática da policy de INSERT dos binários.
// Na 0145 o `name` do `exists (select 1 from public.dashboards d ...)` resolvia
// para `dashboards.name` (a tabela interna SOMBREIA storage.objects) e a RLS
// rejeitava TODO upload em silêncio. A última definição da policy tem de
// qualificar a coluna externa; bare `foldername(name)` dentro dela volta a
// comparar o caminho do arquivo com o NOME do dashboard.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(import.meta.dirname, "../../supabase/migrations");

function lastPolicyDefinition() {
  const files = readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
  let sql: string | undefined;
  for (const file of files) {
    const text = readFileSync(join(dir, file), "utf8");
    const match = [...text.matchAll(/create policy preview_object_insert[\s\S]*?;/g)].pop();
    if (match) sql = match[0];
  }
  return sql;
}

describe("policy de upload das prévias", () => {
  it("qualifica a coluna de storage.objects dentro do subselect de dashboards", () => {
    const sql = lastPolicyDefinition();
    expect(sql).toBeDefined();
    expect(sql).toContain("storage.foldername(objects.name)");
    expect(sql).not.toMatch(/storage\.foldername\(\s*name\s*\)/);
  });
});

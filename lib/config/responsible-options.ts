// Versão: 1.0 | Data: 31/07/2026
// Dropdown VIVO de responsáveis (0113): reescreve as `options` de todo campo
// 'selecao' com options_source='responsibles' usando os display_names dos
// responsáveis ATIVOS PRINCIPAIS (canonical_id null — apelidos colapsam,
// invariante 20), ordenados pt-BR. SÓ as options são tocadas (rótulo/olho/
// ordem do admin intactos) — mesmo contrato do refresh do `pipeline` no
// syncFieldCatalog; options desses campos NÃO devem ser editadas à mão.
// Multi-org: cada campo recebe as options da PRÓPRIA org (service role vê
// todas — sem o pareamento por org, nomes vazariam entre orgs).
// Best-effort em todos os call sites (sync/actions/preset): falha loga e
// nunca derruba o fluxo chamador.
import type { SupabaseClient } from "@supabase/supabase-js";

export async function refreshResponsibleOptionFields(
  db: SupabaseClient,
  orgId?: string | null
): Promise<void> {
  try {
    let fieldsQuery = db
      .from("field_definitions")
      .select("id, field_key, options, organization_id")
      .eq("options_source", "responsibles");
    if (orgId) fieldsQuery = fieldsQuery.eq("organization_id", orgId);
    const { data: fieldsData, error: fieldsError } = await fieldsQuery;
    if (fieldsError) {
      console.error(
        `refreshResponsibleOptionFields: leitura dos campos falhou: ${fieldsError.message}`
      );
      return;
    }
    const fields = (fieldsData ?? []) as {
      id: string;
      field_key: string;
      options: unknown;
      organization_id: string;
    }[];
    if (fields.length === 0) return;

    const orgIds = Array.from(new Set(fields.map((f) => f.organization_id)));
    const { data: respData, error: respError } = await db
      .from("responsibles")
      .select("display_name, organization_id")
      .eq("active", true)
      .is("canonical_id", null)
      .in("organization_id", orgIds);
    if (respError) {
      console.error(
        `refreshResponsibleOptionFields: leitura dos responsáveis falhou: ${respError.message}`
      );
      return;
    }
    const namesByOrg = new Map<string, string[]>();
    for (const r of (respData ?? []) as {
      display_name: string | null;
      organization_id: string;
    }[]) {
      const name = (r.display_name ?? "").trim();
      if (!name) continue;
      const list = namesByOrg.get(r.organization_id) ?? [];
      if (!list.includes(name)) list.push(name);
      namesByOrg.set(r.organization_id, list);
    }

    for (const field of fields) {
      const options = (namesByOrg.get(field.organization_id) ?? [])
        .slice()
        .sort((a, b) => a.localeCompare(b, "pt-BR"));
      const current = Array.isArray(field.options) ? field.options : [];
      if (
        current.length === options.length &&
        current.every((v, i) => v === options[i])
      )
        continue; // nada mudou — evita churn de updated_at
      const { error } = await db
        .from("field_definitions")
        .update({ options })
        .eq("id", field.id);
      if (error) {
        console.error(
          `refreshResponsibleOptionFields: update de ${field.field_key} falhou: ${error.message}`
        );
      }
    }
  } catch (e) {
    console.error(
      `refreshResponsibleOptionFields: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

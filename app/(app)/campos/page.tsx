// Versão: 1.1 | Data: 05/07/2026
// Campos personalizados (field_definitions). Só admin (manage_field_definitions).
// v1.1 (05/07/2026): implementado o CRUD (Fase 4) — antes era placeholder.
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { FieldDefinition } from "@/lib/records/types";
import { FieldsManager } from "@/components/campos/fields-manager";

export default async function CamposPage() {
  await requirePermission("manage_field_definitions");

  const supabase = await createClient();
  const { data } = await supabase
    .from("field_definitions")
    .select(
      "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, sort_order"
    )
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });

  const fields = (data ?? []) as FieldDefinition[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Campos</h1>
        <p className="text-muted-foreground text-sm">
          Crie colunas personalizadas (texto, número, moeda, data, seleção) e
          defina quem vê e quem edita cada uma.
        </p>
      </div>
      <FieldsManager fields={fields} />
    </div>
  );
}

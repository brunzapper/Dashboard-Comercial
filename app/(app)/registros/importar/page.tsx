// Versão: 1.0 | Data: 16/07/2026
// Registros → Importar CSV (admin): wizard de import em massa — cria fontes e
// campos a partir do arquivo e insere/atualiza registros de forma idempotente
// (source_system='csv'). Parsing no browser; dados sobem em chunks JSON para
// as Server Actions de app/(app)/registros/importar/actions.ts.
import Link from "next/link";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import { Button } from "@/components/ui/button";
import {
  ImportWizard,
  type ImportFieldOption,
} from "@/components/importacao/import-wizard";

// Rede de segurança p/ as Server Actions de import (chunks pequenos; no plano
// gratuito o teto real é ~60s) — mesmo padrão da página de Registros.
export const maxDuration = 60;

export default async function ImportarPage() {
  await requireRole("admin");
  const supabase = await createClient();
  const sources = await loadSources(supabase);

  // Campos que podem RECEBER valores (calculados são materializados, não
  // importados) — oferecidos como destino de reuso no mapeamento.
  const { data } = await supabase
    .from("field_definitions")
    .select("field_key, label, data_type, applies_to")
    .not("data_type", "in", "(calculado,calculado_agg)")
    .order("label");
  const fields: ImportFieldOption[] = (data ?? []).map((f) => ({
    key: f.field_key as string,
    label: (f.label as string) ?? (f.field_key as string),
    dataType: (f.data_type as string) ?? "texto",
    appliesTo: (f.applies_to as string[] | null) ?? [],
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Importar CSV</h1>
          <p className="text-muted-foreground text-sm">
            Importe dados em massa para uma fonte existente ou crie uma fonte
            nova a partir do arquivo. Re-importar o mesmo arquivo atualiza em
            vez de duplicar, e edições feitas no app são preservadas.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/registros">Voltar a Registros</Link>
        </Button>
      </div>
      <ImportWizard sources={sources} fields={fields} />
    </div>
  );
}

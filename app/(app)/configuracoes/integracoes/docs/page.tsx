// Versão: 1.0 | Data: 17/07/2026
// Configurações → Integrações → Documentação da API (admin).
// Referência VIVA da superfície de integração externa: a API de entrada
// (POST /api/ingest/<fonte>) e o contrato dos webhooks de saída. Os exemplos
// usam dados REAIS do ambiente — fontes cadastradas, alvos de mapeamento por
// fonte (colunas core + campos personalizados + responsável) e o catálogo de
// eventos — para gerar curl/JSON prontos para copiar. Rotas internas
// (SYNC_SECRET) ficam de fora: isto documenta só o que sistemas externos usam.
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import { CORE_IMPORT_TARGETS } from "@/lib/import/csv";
import { WEBHOOK_EVENT_TYPES } from "@/lib/webhooks/events";
import { ApiDocs, type ApiDocsSource } from "@/components/admin/api-docs";
import { Button } from "@/components/ui/button";

export default async function ApiDocsPage() {
  await requireRole("admin");
  const supabase = await createClient();

  const [sources, defsRes] = await Promise.all([
    loadSources(supabase),
    supabase
      .from("field_definitions")
      .select("field_key, label, data_type, applies_to")
      .order("label", { ascending: true }),
  ]);
  const defs = defsRes.data ?? [];

  // Alvos de mapeamento por fonte: responsável + colunas core (catálogo do
  // import) + campos personalizados aplicáveis (applies_to nulo = todas as
  // fontes). Calculados ficam de fora — não são alvos de escrita.
  const docsSources: ApiDocsSource[] = sources.map((s) => ({
    key: s.key,
    label: s.label,
    recordType: s.recordType,
    targets: [
      {
        value: "responsible",
        label: "Responsável (por nome)",
        kind: "responsible" as const,
      },
      ...CORE_IMPORT_TARGETS.map((t) => ({
        value: t.value,
        label: t.label,
        kind: "core" as const,
        dataType: t.kind,
      })),
      ...defs
        .filter((d) => {
          const dt = d.data_type as string;
          if (dt === "calculado" || dt === "calculado_agg") return false;
          const applies = d.applies_to as string[] | null;
          return !applies || applies.length === 0 || applies.includes(s.key);
        })
        .map((d) => ({
          value: `custom:${d.field_key as string}`,
          label: (d.label as string) || (d.field_key as string),
          kind: "custom" as const,
          dataType: d.data_type as string,
        })),
    ],
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Documentação da API</h1>
          <p className="text-muted-foreground text-sm">
            Como conectar sistemas externos: enviar dados para o dashboard
            (entrada) e receber notificações assinadas (saída). Os exemplos
            abaixo já usam as fontes e campos do seu ambiente.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/configuracoes/integracoes">
            <ArrowLeft className="mr-1 size-4" /> Integrações
          </Link>
        </Button>
      </div>
      <ApiDocs sources={docsSources} eventTypes={[...WEBHOOK_EVENT_TYPES]} />
    </div>
  );
}

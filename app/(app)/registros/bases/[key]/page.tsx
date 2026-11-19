// Versão: 1.0 | Data: 19/11/2026
// PÁGINA DA BASE (esquema por Base, fase 4): tudo de UMA Base num lugar —
// Visão geral, Campos (o esquema dela, com rótulo/olho por Base, origem,
// % preenchido e selos Novo/Removido), Qualidade (o que está fora do lugar),
// Sub-bases e Origem. Antes isso vivia em quatro telas (Bases, /campos,
// Integrações e Importar).
//
// Server Component: monta o modelo (lib/records/base-page.ts) e entrega
// strings/números ao cliente. Sem a 0156 aplicada a página mostra o aviso e
// os atalhos — nada quebra.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireSettingsArea } from "@/lib/auth/access";
import { getSessionInfo } from "@/lib/auth/session";
import { loadSources } from "@/lib/config/sources";
import { isCoreDef } from "@/lib/records/core-defs";
import { SOURCE_FIELDS_SELECT, type BaseSchemaRow } from "@/lib/records/base-schema";
import {
  buildBaseFieldRows,
  buildBaseQuality,
  type BaseFieldDef,
  type FillRow,
} from "@/lib/records/base-page";
import { createClient } from "@/lib/supabase/server";
import { BackLink } from "@/components/ui/back-link";
import { PublishLocationTitle } from "@/components/layout/location-title-context";
import { BasePage, type BaseOverview } from "@/components/bases/base-page";

export const metadata = { title: "Base" };

export default async function BaseDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  await requireSettingsArea("fontes");
  const { key } = await params;
  const supabase = await createClient();
  const sources = await loadSources(supabase);
  const src = sources.find((s) => s.key === key);
  if (!src) notFound();
  // Sub-base usa o esquema da pai: a página dela É a da pai.
  if (src.parentKey) redirect(`/registros/bases/${src.parentKey}`);
  const session = await getSessionInfo();
  const canWrite = Boolean(session?.roles.includes("admin"));

  const [schemaRes, defsRes, fillRes, lastSyncRes] = await Promise.all([
    supabase.from("source_fields").select(SOURCE_FIELDS_SELECT).eq("source_key", key),
    supabase
      .from("field_definitions")
      .select("field_key, label, data_type, source_system, source_field_id"),
    supabase.rpc("source_field_fill", { p_record_type: src.recordType }),
    supabase
      .from("records")
      .select("last_synced_at")
      .eq("record_type", src.recordType)
      .not("last_synced_at", "is", null)
      .order("last_synced_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const schemaReady = !schemaRes.error;
  const schemaRows = (schemaRes.data ?? []) as BaseSchemaRow[];
  const allDefs = (defsRes.data ?? []) as (BaseFieldDef & { field_key: string })[];
  const coreLabels = new Map(
    allDefs
      .filter((d) => isCoreDef(d as { source_system?: string | null }))
      .map((d) => [d.field_key, d.label])
  );
  const defs = allDefs.filter(
    (d) => !isCoreDef(d as { source_system?: string | null })
  );
  const fill = ((fillRes.data ?? []) as FillRow[]).map((f) => ({
    field_ref: f.field_ref,
    filled: Number(f.filled),
    total: Number(f.total),
  }));
  const rows = buildBaseFieldRows({ schemaRows, defs, coreLabels, fill });
  const quality = buildBaseQuality({
    rows,
    schemaRefs: new Set(schemaRows.map((r) => r.field_ref)),
    defs,
    fill,
  });

  const isBitrix =
    (src.builtin && (src.recordType === "negocio" || src.recordType === "lead")) ||
    src.bitrixEntityTypeId != null;
  const overview: BaseOverview = {
    key: src.key,
    label: src.label,
    shortLabel: src.shortLabel,
    recordType: src.recordType,
    total: fill[0]?.total ?? 0,
    lastSyncedAt: (lastSyncRes.data?.last_synced_at as string | undefined) ?? null,
    origin: isBitrix
      ? src.bitrixEntityTypeId != null
        ? `Bitrix — Processo Inteligente #${src.bitrixEntityTypeId}`
        : src.recordType === "negocio"
          ? "Bitrix — Negócios (crm.deal)"
          : "Bitrix — Leads (crm.lead)"
      : src.builtin
        ? "Planilha (push do Apps Script)"
        : src.manualEntry
          ? "Manual, CSV ou API"
          : "CSV ou API",
    isBitrix,
    manualEntry: src.manualEntry,
    subBases: sources
      .filter((s) => s.parentKey === src.key)
      .map((s) => ({ key: s.key, label: s.label })),
  };

  return (
    <div className="flex flex-col gap-6">
      <PublishLocationTitle title={src.label} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{src.label}</h1>
          <p className="text-muted-foreground text-sm">
            {overview.origin} · {overview.total.toLocaleString("pt-BR")} registros
          </p>
        </div>
        <BackLink fallback="/registros/bases" fallbackLabel="Bases" />
      </div>
      {!schemaReady ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          O esquema por Base ainda não foi ativado neste banco (migração 0156).
          Os registros seguem a regra antiga de campos.{" "}
          <Link className="underline" href={`/registros?fonte=${src.key}`}>
            Ver registros
          </Link>
        </p>
      ) : null}
      <BasePage
        overview={overview}
        rows={rows}
        quality={quality}
        canWrite={canWrite && schemaReady}
      />
    </div>
  );
}

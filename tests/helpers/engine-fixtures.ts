// Versão: 1.0 | Data: 24/07/2026
// Fixtures compartilhadas dos testes do engine (fake SupabaseClient): catálogo
// com sub-fonte, correspondência unificada com membro da PAI e da SUB (o caso
// que pega vazamento de membro entre pernas) e campos disponíveis mínimos.
import type { Correspondence } from "@/lib/correspondences";
import { BUILTIN_SOURCES, type SourceDef } from "@/lib/sources";
import type { AvailableField } from "@/lib/widgets/fields";

export const CATALOG: SourceDef[] = [
  ...BUILTIN_SOURCES,
  {
    key: "leads_lite",
    recordType: "lead",
    label: "Leads / Clientes Lite",
    shortLabel: "Lite",
    defaultPeriodField: "custom:data_lite",
    builtin: false,
    manualEntry: false,
    parentKey: "leads",
    filter: [{ field: "pipeline", op: "eq", value: "Lite" }],
  },
  // 2ª sub da MESMA pai (predicado disjunto): dispara o branch multi-perna do
  // engine quando as duas subs entram juntas nas fontes do widget.
  {
    key: "leads_sql",
    recordType: "lead",
    label: "Leads / SQLs",
    shortLabel: "SQLs",
    defaultPeriodField: "custom:data_sql",
    builtin: false,
    manualEntry: false,
    parentKey: "leads",
    filter: [{ field: "stage", op: "eq", value: "SQL" }],
  },
];

// Correspondência com membro na PAI e na SUB (mesmo record_type "lead") — o
// coalesce de cada perna deve usar SÓ o membro da fonte efetiva DELA.
export const CORRS: Correspondence[] = [
  {
    id: "1",
    key: "data_venda",
    label: "Data da venda",
    data_type: "data",
    members: [
      { record_type: "lead", source_key: "leads", field_ref: "custom:pai_data" },
      {
        record_type: "lead",
        source_key: "leads_lite",
        field_ref: "custom:sub_data",
      },
    ],
  },
];

export const AVAILABLE: AvailableField[] = [
  { field: "pipeline", label: "Pipeline", isNumeric: false, isDate: false },
  { field: "closed_at", label: "Fechamento", isNumeric: false, isDate: true },
  {
    field: "value",
    label: "Valor",
    isNumeric: true,
    isDate: false,
    isMoney: true,
  },
  {
    field: "responsible_id",
    label: "Responsável",
    isNumeric: false,
    isDate: false,
    fk: "responsible",
  },
];

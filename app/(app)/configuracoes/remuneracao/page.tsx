// Versão: 1.0 | Data: 30/07/2026
// Tela de Remuneração variável (0112). A área NÃO tem gate de papel
// (AREA_GATES.remuneracao = {}): a page ramifica — admin vê o gestor completo
// (planos + grade mensal); demais papéis veem "Minha remuneração" (read-only;
// a RLS de comp_entries entrega só o próprio grupo canônico). Overrides
// allow/deny da área seguem valendo (deny esconde tudo).
import { requireSettingsArea } from "@/lib/auth/access";
import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import { loadCorrespondences } from "@/lib/correspondences";
import { loadGoalMetrics } from "@/lib/config/goal-metrics";
import {
  canonicalOf,
  loadResponsibleCanon,
} from "@/lib/config/responsible-canon";
import { todayBrasiliaIso } from "@/lib/date/today";
import type { FieldDefinition } from "@/lib/records/types";
import { buildAvailableFields } from "@/lib/widgets/fields";
import { loadTargetsByMember } from "@/lib/comp/engine";
import { parseCompPlanConfig } from "@/lib/comp/model";
import {
  RemuneracaoManager,
  type CompEntryClientRow,
  type CompPlanClientRow,
} from "@/components/configuracoes/remuneracao/remuneracao-manager";
import { MyCompView } from "@/components/configuracoes/remuneracao/my-comp-view";

// Título da aba (template do layout completa "— {appName}").
export const metadata = { title: "Remuneração" };

const str = (v: string | string[] | undefined): string =>
  typeof v === "string" ? v : "";

export default async function RemuneracaoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSettingsArea("remuneracao");
  const sp = await searchParams;
  const session = await getSessionInfo();
  const isAdmin = session?.roles.includes("admin") ?? false;
  const supabase = await createClient();

  const today = todayBrasiliaIso(); // YYYY-MM-DD (dia de Brasília)
  const year =
    Math.min(2100, Math.max(2000, Number(str(sp.ano)))) || Number(today.slice(0, 4));
  const monthRaw = Number(str(sp.mes));
  const month =
    Number.isInteger(monthRaw) && monthRaw >= 1 && monthRaw <= 12
      ? monthRaw
      : Number(today.slice(5, 7));

  const header = (
    <div>
      <h1 className="text-2xl font-semibold">Remuneração</h1>
      <p className="text-muted-foreground text-sm">
        {isAdmin
          ? "Planos de remuneração variável: fatores com peso e atingimento, exceções manuais, bônus e publicação numa base de dados para dashboards."
          : "Sua remuneração variável no mês — calculada pelo plano definido pela gestão."}
      </p>
    </div>
  );

  if (!isAdmin) {
    // ===== Vendedor: "Minha remuneração" (read-only, RLS filtra) =====
    const [{ data: own }, canon, { data: plansData }, { data: entriesData }] =
      await Promise.all([
        supabase
          .from("responsibles")
          .select("id")
          .eq("user_id", session?.user.id ?? "")
          .eq("active", true),
        loadResponsibleCanon(supabase),
        supabase
          .from("comp_plans")
          .select("id, name, active, base_amount_default, config, updated_at")
          .eq("active", true)
          .order("name"),
        supabase
          .from("comp_entries")
          .select(
            "id, plan_id, responsible_id, base_amount, inputs, computed, total, mirror_record_id, published_at, updated_at"
          )
          .eq("period_year", year)
          .eq("period_month", month),
      ]);
    const ownIds = ((own ?? []) as { id: string }[]).map((r) => r.id);
    const canonId = ownIds.length > 0 ? canonicalOf(ownIds[0], canon) : null;
    const plans = (plansData ?? []) as CompPlanClientRow[];

    // Alvos do mês por plano (goals é org-wide legível; só o próprio canônico).
    const targetsByPlan: Record<string, Record<string, number | null>> = {};
    if (canonId) {
      for (const plan of plans) {
        const config = parseCompPlanConfig(plan.config);
        if (!config) continue;
        const targets = await loadTargetsByMember(supabase, {
          year,
          month,
          config,
          memberIds: [canonId],
          canon,
        });
        targetsByPlan[plan.id] = targets.get(canonId) ?? {};
      }
    }

    return (
      <div className="flex flex-col gap-6">
        {header}
        <MyCompView
          plans={plans}
          entries={
            (entriesData ?? []) as (CompEntryClientRow & { plan_id: string })[]
          }
          targetsByPlan={targetsByPlan}
          year={year}
          month={month}
          linked={canonId != null}
        />
      </div>
    );
  }

  // ===== Admin: gestor completo =====
  const orgId = await getActiveOrgId();
  const [
    { data: plansData },
    { data: respData },
    canon,
    sources,
    correspondences,
    { data: fieldsData },
    metrics,
  ] = await Promise.all([
    supabase
      .from("comp_plans")
      .select("id, name, active, base_amount_default, config, updated_at")
      .order("name"),
    supabase
      .from("responsibles")
      .select("id, display_name")
      .eq("active", true)
      .order("display_name"),
    loadResponsibleCanon(supabase),
    loadSources(supabase, orgId),
    loadCorrespondences(supabase, orgId),
    supabase
      .from("field_definitions")
      .select(
        "field_key, label, data_type, formula, applies_to, currency_code, currency_mode, allow_negative, show_as_percent"
      ),
    loadGoalMetrics(supabase),
  ]);
  const plans = (plansData ?? []) as CompPlanClientRow[];
  const selectedPlanId =
    plans.find((p) => p.id === str(sp.plano))?.id ?? plans[0]?.id ?? null;

  // Linhas da grade: ativos CANÔNICOS (apelido nunca vira linha — mesma regra
  // do engine; a consulta expande o grupo no choke point).
  const responsibles = ((respData ?? []) as {
    id: string;
    display_name: string | null;
  }[])
    .filter((r) => !canon.canonicalById.has(r.id))
    .map((r) => ({ id: r.id, label: r.display_name ?? "—" }));

  const [{ data: entriesData }, targets] = await Promise.all([
    selectedPlanId
      ? supabase
          .from("comp_entries")
          .select(
            "id, responsible_id, base_amount, inputs, computed, total, mirror_record_id, published_at, updated_at"
          )
          .eq("plan_id", selectedPlanId)
          .eq("period_year", year)
          .eq("period_month", month)
      : Promise.resolve({ data: [] as unknown[] }),
    (async () => {
      const plan = plans.find((p) => p.id === selectedPlanId);
      const config = plan ? parseCompPlanConfig(plan.config) : null;
      if (!config) return {};
      const map = await loadTargetsByMember(supabase, {
        year,
        month,
        config,
        memberIds: responsibles.map((r) => r.id),
        canon,
      });
      return Object.fromEntries(map);
    })(),
  ]);

  const allFields = (fieldsData ?? []) as FieldDefinition[];
  const available = buildAvailableFields(allFields, correspondences, sources);

  return (
    <div className="flex flex-col gap-6">
      {header}
      <RemuneracaoManager
        plans={plans}
        selectedPlanId={selectedPlanId}
        year={year}
        month={month}
        entries={(entriesData ?? []) as CompEntryClientRow[]}
        responsibles={responsibles}
        targets={targets}
        metrics={metrics}
        available={available}
        allFields={allFields}
        sources={sources}
      />
    </div>
  );
}

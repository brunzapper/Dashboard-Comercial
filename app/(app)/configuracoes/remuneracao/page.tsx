// Versão: 1.5 | Data: 01/08/2026 (v1.5: select de field_definitions do
// catálogo do editor inclui `options` — picker estático de valor dos campos
// seleção nas condições do recorte do fator.)
// v1.4: ano da URL < 2020 cai no mês/ano
// correntes — URLs velhas presas em 2000 (pré-v1.3) escapavam do fix e as
// setas nunca saíam de lá (chegou a recriar entry órfã em produção); as
// actions seguem aceitando 2000-2100. Aba vira query `?aba=plano` decidida no
// SERVER: o catálogo do editor (sources/correspondences/field_definitions/
// metrics/currencies → prop única `editorCatalog`) só carrega nessa aba — a
// troca de mês na grade deixa de pagar ~7 queries + payload RSC do editor.
// Ondas: gate → básicos (plans/responsibles/canon/operations) → resto num
// único Promise.all (opScopes ∥ entries ∥ targets ∥ rates ∥ catálogo). Ramo
// vendedor: alvos/taxas por plano em paralelo, não mais em série.)
// v1.3: fix do ano padrão — sem ?ano o clamp
// Math.max(2000, Number("")) virava 2000 (truthy) e o fallback do ano ATUAL
// nunca rodava: a página sempre abria em "Julho/2000". Ano agora valida como
// o mês: range ok usa, senão cai no ano corrente.
// v1.2: alvos em moeda estrangeira — os dois
// ramos resolvem targetRates no server via loadTargetRatesForConfig e o ramo
// admin carrega as moedas habilitadas p/ o editor de planos.
// v1.1: membros por operação — ramo admin carrega operations +
// loadOperationScopes do catálogo inteiro e passa operationMembersById ao
// manager; editor mostra membros efetivos ao vivo.
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
import { loadOperationScopes } from "@/lib/config/operation-scope";
import {
  loadTargetRatesForConfig,
  loadTargetsByMember,
  operationMembersFromScopes,
} from "@/lib/comp/engine";
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
  // Piso 2020 (não 2000, o range das actions): URL velha presa em ?ano=2000
  // passa a cair no ano corrente em vez de reabrir a armadilha.
  const yearRaw = Number(str(sp.ano));
  const year =
    Number.isInteger(yearRaw) && yearRaw >= 2020 && yearRaw <= 2100
      ? yearRaw
      : Number(today.slice(0, 4));
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

    // Alvos do mês por plano (goals é org-wide legível; só o próprio canônico)
    // + taxas de moeda de alvo por plano (fast path {} p/ plano só-BRL).
    // Todos os planos em PARALELO (o laço em série pagava 2 RTT por plano).
    const targetsByPlan: Record<string, Record<string, number | null>> = {};
    const targetRatesByPlan: Record<string, Record<string, number | null>> = {};
    if (canonId) {
      await Promise.all(
        plans.map(async (plan) => {
          const config = parseCompPlanConfig(plan.config);
          if (!config) return;
          const [targets, rates] = await Promise.all([
            loadTargetsByMember(supabase, {
              year,
              month,
              config,
              memberIds: [canonId],
              canon,
            }),
            loadTargetRatesForConfig(supabase, config, year, month),
          ]);
          targetsByPlan[plan.id] = targets.get(canonId) ?? {};
          targetRatesByPlan[plan.id] = rates;
        })
      );
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
          targetRatesByPlan={targetRatesByPlan}
          year={year}
          month={month}
          linked={canonId != null}
        />
      </div>
    );
  }

  // ===== Admin: gestor completo =====
  const orgId = await getActiveOrgId();
  // Onda 1 — básicos, invariantes à aba (pills/grade/membros precisam).
  const [{ data: plansData }, { data: respData }, canon, { data: opsData }] =
    await Promise.all([
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
      supabase.from("operations").select("id, name, active").order("name"),
    ]);
  const operations = (opsData ?? []) as {
    id: string;
    name: string;
    active: boolean;
  }[];
  const plans = (plansData ?? []) as CompPlanClientRow[];
  const selectedPlanId =
    plans.find((p) => p.id === str(sp.plano))?.id ?? plans[0]?.id ?? null;
  // Aba decidida no SERVER (sem planos força o editor — mesma regra da UI).
  const aba: "grade" | "plano" =
    str(sp.aba) === "plano" || plans.length === 0 ? "plano" : "grade";

  // Linhas da grade: ativos CANÔNICOS (apelido nunca vira linha — mesma regra
  // do engine; a consulta expande o grupo no choke point).
  const responsibles = ((respData ?? []) as {
    id: string;
    display_name: string | null;
  }[])
    .filter((r) => !canon.canonicalById.has(r.id))
    .map((r) => ({ id: r.id, label: r.display_name ?? "—" }));

  const selectedConfig = (() => {
    const plan = plans.find((p) => p.id === selectedPlanId);
    return plan ? parseCompPlanConfig(plan.config) : null;
  })();

  // Onda 2 — tudo em paralelo: escopos de operação (catálogo INTEIRO — o
  // editor mostra membros efetivos ao vivo; loadOperationScopes já é batelado,
  // 2 queries), dados do mês e — SÓ na aba Plano — o catálogo do editor.
  const wantsEditor = aba === "plano";
  const [
    opScopes,
    { data: entriesData },
    targets,
    targetRates,
    sources,
    correspondences,
    fieldsRes,
    metrics,
    curRes,
  ] = await Promise.all([
    loadOperationScopes(
      supabase,
      operations.map((o) => o.id)
    ),
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
      if (!selectedConfig) return {};
      const map = await loadTargetsByMember(supabase, {
        year,
        month,
        config: selectedConfig,
        memberIds: responsibles.map((r) => r.id),
        canon,
      });
      return Object.fromEntries(map);
    })(),
    selectedConfig
      ? loadTargetRatesForConfig(supabase, selectedConfig, year, month)
      : Promise.resolve({} as Record<string, number | null>),
    wantsEditor ? loadSources(supabase, orgId) : Promise.resolve(null),
    wantsEditor ? loadCorrespondences(supabase, orgId) : Promise.resolve(null),
    wantsEditor
      ? supabase
          .from("field_definitions")
          .select(
            // `options` alimenta o picker estático de valor dos campos seleção
            // nas condições do recorte do fator (plan-editor v1.5).
            "field_key, label, data_type, formula, applies_to, currency_code, currency_mode, allow_negative, show_as_percent, options"
          )
      : Promise.resolve({ data: null }),
    wantsEditor ? loadGoalMetrics(supabase) : Promise.resolve(null),
    wantsEditor
      ? supabase
          .from("currencies")
          .select("code, label")
          .eq("enabled", true)
          .order("sort_order")
      : Promise.resolve({ data: null }),
  ]);
  const operationMembersById = operationMembersFromScopes(opScopes, canon);

  // Catálogo do editor de planos (prop única anulável — a aba Lançamentos não
  // paga o payload; o manager exibe placeholder até a navegação de aba chegar).
  const editorCatalog = (() => {
    if (!wantsEditor || !sources || !correspondences || !metrics) return null;
    const allFields = (fieldsRes.data ?? []) as FieldDefinition[];
    return {
      metrics,
      allFields,
      sources,
      available: buildAvailableFields(allFields, correspondences, sources),
      currencies: (
        (curRes.data ?? []) as { code: string; label: string }[]
      ).map((c) => ({ value: c.code, label: `${c.label} (${c.code})` })),
    };
  })();

  return (
    <div className="flex flex-col gap-6">
      {header}
      <RemuneracaoManager
        plans={plans}
        selectedPlanId={selectedPlanId}
        aba={aba}
        year={year}
        month={month}
        entries={(entriesData ?? []) as CompEntryClientRow[]}
        responsibles={responsibles}
        targets={targets}
        targetRates={targetRates}
        editorCatalog={editorCatalog}
        operations={operations}
        operationMembersById={operationMembersById}
      />
    </div>
  );
}

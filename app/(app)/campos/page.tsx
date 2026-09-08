// Versão: 1.6 | Data: 07/08/2026
// Campos personalizados (field_definitions). Só admin (manage_field_definitions).
// v1.6 (07/08/2026): aba Reclassificações (domínios dinâmicos de mapeamento,
//   0119) — cria de-para de valores pela UI; slot opcional escondido quando a
//   área/feature "mapeamentos" está negada (padrão da aba Moedas). O conteúdo
//   pesado (overview por domínio) carrega LAZY dentro da aba.
// v1.5 (30/07/2026): botão "Criar com IA" (FieldsAiCreateSheet, org com IA
//   configurada 0096) — até 10 campos por leva, inclusive calculados, com
//   prévia obrigatória; maxDuration 300 (turno da IA tem orçamento de 240s).
// v1.4 (27/07/2026): aba Moedas (movida de /configuracoes/moedas) — moedas e
//   taxas de conversão do sistema. Estreitamento aceito: antes qualquer
//   autenticado via as taxas read-only; agora só quem chega a /campos
//   (manage_field_definitions). O deny do override de área "moedas" esconde a
//   aba (slot null) e segue barrando a escrita nas actions.
// v1.3 (16/07/2026): blocos empilhados viraram abas de página (CamposTabs:
//   Campos | Correspondências | Conexões); o parágrafo descritivo (fala só de
//   campos) desceu para dentro da aba Campos. Dados/queries inalterados.
// v1.2 (09/07/2026): Fase 8 — seção de Correspondências de colunas (globais).
// v1.1 (05/07/2026): implementado o CRUD (Fase 4) — antes era placeholder.
import { requirePermission } from "@/lib/auth/session";
import { isSettingsAreaDenied } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { loadOrgAiConfigPublic } from "@/lib/ai/config";
import { createClient } from "@/lib/supabase/server";
import type { FieldDefinition } from "@/lib/records/types";
import { isCoreDef, splitCoreDefs } from "@/lib/records/core-defs";
import { loadCorrespondences } from "@/lib/correspondences";
import { loadMatchRules } from "@/lib/matching";
import {
  currencyOptionsFrom,
  loadAllCurrencies,
  loadEnabledCurrencies,
  type SystemCurrency,
} from "@/lib/widgets/currency";
import { fieldAppliesToSource, rootSources, type SourceKey } from "@/lib/sources";
import { loadSources } from "@/lib/config/sources";
import { CORE_FIELDS } from "@/lib/widgets/fields";
import { CamposTabs } from "@/components/campos/campos-tabs";
import { FieldsManager } from "@/components/campos/fields-manager";
import {
  ReclassDomainsTab,
  type ReclassBaseOption,
  type ReclassFieldOption,
} from "@/components/campos/reclass-domains-tab";
import {
  CorrespondencesManager,
  type RefOption,
} from "@/components/campos/correspondences-manager";
import { MatchesManager } from "@/components/campos/matches-manager";
import {
  CurrenciesManager,
  type CurrencyRateRow,
} from "@/components/configuracoes/currencies-manager";

// Título da aba (template do layout completa "— {appName}").
export const metadata = { title: "Campos" };

// Rede de segurança p/ as Server Actions desta página. 300 cobre o turno da
// criação de campos por IA (laço com orçamento de 240s); no plano gratuito o
// teto real segue ~60s.
export const maxDuration = 300;

export default async function CamposPage() {
  await requirePermission("manage_field_definitions");

  const supabase = await createClient();
  const sources = await loadSources(supabase);
  // IA por org (0096): habilita o botão "Criar com IA" (só config pública).
  const orgId = await getActiveOrgId();
  const ai = orgId ? await loadOrgAiConfigPublic(orgId) : null;
  const [{ data }, correspondences, matchRules, currencies, moedasDenied, allCurrencies, { data: ratesData }, reclassDenied] =
    await Promise.all([
      supabase
        .from("field_definitions")
        .select(
          "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, source_system, source_field_id, show_in_builder, formula, allow_negative, currency_code, currency_mode, show_as_percent, sort_order, applies_to, write_back"
        )
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true }),
      loadCorrespondences(supabase),
      loadMatchRules(supabase),
      loadEnabledCurrencies(supabase),
      isSettingsAreaDenied("moedas"),
      loadAllCurrencies(supabase),
      supabase
        .from("currency_rates")
        .select("code, year, quarter, rate, source")
        .order("year", { ascending: false }),
      isSettingsAreaDenied("mapeamentos"),
    ]);

  const fields = (data ?? []) as FieldDefinition[];
  const currencyOptions = currencyOptionsFrom(currencies);

  const rates = (ratesData ?? []).map((r) => ({
    code: r.code as string,
    year: r.year as number,
    quarter: r.quarter as number,
    rate: Number(r.rate),
    source: (r.source as string | null) ?? null,
  })) as CurrencyRateRow[];

  // Candidatos por fonte p/ correspondências: colunas do núcleo + campos
  // personalizados que se aplicam àquela fonte (applies_to). Linhas core (0086)
  // entram pelo lado do núcleo (ref cru, com o rótulo do override) — nunca
  // como `custom:<key>`.
  const { core: coreDefs } = splitCoreDefs(fields);
  const coreOptions: RefOption[] = CORE_FIELDS.map((f) => ({
    ref: f.field,
    label: coreDefs.get(f.field)?.label ?? f.label,
  }));
  const candidatesBySource = Object.fromEntries(
    sources.map((s) => [
      s.key,
      [
        ...coreOptions,
        ...fields
          .filter(
            (f) =>
              !isCoreDef(f) && fieldAppliesToSource(f.applies_to, s.key, sources)
          )
          .map((f) => ({ ref: `custom:${f.field_key}`, label: f.label })),
      ],
    ])
  ) as Record<SourceKey, RefOption[]>;

  // Aba Reclassificações (0119): bases RAIZ + campos custom de texto/seleção
  // como candidatos a campo de ORIGEM do de-para.
  const reclassBases: ReclassBaseOption[] = rootSources(sources).map((s) => ({
    recordType: s.recordType,
    label: s.label,
  }));
  const reclassFields: ReclassFieldOption[] = fields
    .filter(
      (f) => !isCoreDef(f) && (f.data_type === "texto" || f.data_type === "selecao")
    )
    .map((f) => ({
      fieldKey: f.field_key,
      label: f.label,
      appliesTo: f.applies_to ?? null,
    }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Campos</h1>
      <CamposTabs
        campos={
          <div className="flex flex-col gap-6">
            <p className="text-muted-foreground text-sm">
              Crie colunas personalizadas (texto, número, moeda, data, seleção,
              booleano ou calculado) e defina quem vê e quem edita cada uma. As
              colunas descobertas no Bitrix aparecem aqui automaticamente; use o
              botão &quot;Exibir&quot; para escolher quais vão para os seletores.
            </p>
            <FieldsManager
              fields={fields}
              currencyOptions={currencyOptions}
              ai={ai}
            />
          </div>
        }
        correspondencias={
          <CorrespondencesManager
            correspondences={correspondences}
            candidatesBySource={candidatesBySource}
          />
        }
        conexoes={
          <MatchesManager
            rules={matchRules}
            candidatesBySource={candidatesBySource}
          />
        }
        moedas={
          moedasDenied ? null : (
            <div className="flex flex-col gap-6">
              <p className="text-muted-foreground text-sm">
                Habilite as moedas do sistema e informe a taxa média (R$ por 1
                unidade) por ano e por trimestre. Use &quot;Atualizar
                agora&quot; para preencher pela média do PTAX (Banco Central) —
                a taxa do trimestre tem prioridade sobre a anual; o Real é a
                base (taxa 1).
              </p>
              <CurrenciesManager
                currencies={allCurrencies as SystemCurrency[]}
                rates={rates}
                readOnly={false}
              />
            </div>
          )
        }
        reclassificacoes={
          reclassDenied ? null : (
            <ReclassDomainsTab
              bases={reclassBases}
              fieldOptions={reclassFields}
              ai={ai}
            />
          )
        }
      />
    </div>
  );
}

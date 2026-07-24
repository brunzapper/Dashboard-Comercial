// Versão: 1.0 | Data: 24/07/2026
// Seed IDEMPOTENTE do stack Supabase LOCAL para E2E + paridade viva (rodar com
// `npm run db:seed`; exige SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — pegue de
// `supabase status -o env`). NUNCA aponte para produção: o script recusa hosts
// fora de localhost/127.0.0.1 salvo E2E_SEED_ALLOW_REMOTE=1 (guarda de dedo).
//
// O que semeia (constantes em tests/helpers/e2e-fixtures.ts):
//  1. usuário de teste (auth admin) + membership na org Zapper (1 org, não
//     owner → login cai direto em /) + papel admin;
//  2. field_definitions: "Data Reunião (Lead)" (chave da regra 0052);
//  3. registros determinísticos (4 negócios, 3 leads, 1 lead MOCK com Data
//     Reunião preenchida);
//  4. dashboard "Board E2E" + 3 widgets (KPI Σ valor Deals; tabela pipeline ×
//     contagem; KPI contagem de Data Reunião — exercita o gate dos mocks);
//  5. snapshot com token FIXO + refreshSnapshot (congela dataset e bundle).
import { createClient } from "@supabase/supabase-js";

import { refreshSnapshot } from "@/lib/snapshots/refresh";
import { hashToken, isTokenShaped } from "@/lib/snapshots/token";
import {
  DASHBOARD_ID,
  DASHBOARD_NAME,
  E2E_USER,
  RECORD_IDS,
  REUNIAO_KEY,
  SNAPSHOT_ID,
  SNAPSHOT_NAME,
  SNAPSHOT_TOKEN,
  WIDGET_KPI_ID,
  WIDGET_KPI_TITLE,
  WIDGET_REUNIAO_ID,
  WIDGET_TABLE_ID,
  WIDGET_TABLE_TITLE,
  ZAPPER_ORG_ID,
} from "@/tests/helpers/e2e-fixtures";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(
      `Variável obrigatória ausente: ${name} (use \`supabase status -o env\`).`
    );
  }
  return v.trim();
}

async function main() {
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const host = new URL(url).hostname;
  if (
    !["localhost", "127.0.0.1", "0.0.0.0"].includes(host) &&
    process.env.E2E_SEED_ALLOW_REMOTE !== "1"
  ) {
    throw new Error(
      `SUPABASE_URL aponta para ${host} — o seed E2E só roda contra stack local ` +
        `(defina E2E_SEED_ALLOW_REMOTE=1 conscientemente para um projeto de teste).`
    );
  }
  const db = createClient(url, key, { auth: { persistSession: false } });
  const fail = (step: string, error: { message: string } | null) => {
    if (error) throw new Error(`${step}: ${error.message}`);
  };

  // ---- 1. usuário + membership + papel --------------------------------------
  let userId: string;
  const created = await db.auth.admin.createUser({
    email: E2E_USER.email,
    password: E2E_USER.password,
    email_confirm: true,
  });
  if (created.data.user) {
    userId = created.data.user.id;
  } else {
    // Já existe (seed re-rodado): recupera pelo email.
    const { data, error } = await db.auth.admin.listUsers({ perPage: 200 });
    fail("listUsers", error);
    const found = data.users.find((u) => u.email === E2E_USER.email);
    if (!found) {
      throw new Error(
        `createUser falhou (${created.error?.message}) e o email não existe.`
      );
    }
    userId = found.id;
  }
  fail(
    "organization_members",
    (
      await db.from("organization_members").upsert(
        { organization_id: ZAPPER_ORG_ID, user_id: userId, is_org_admin: false },
        { onConflict: "organization_id,user_id" }
      )
    ).error
  );
  fail(
    "user_roles",
    (
      await db
        .from("user_roles")
        .upsert({ user_id: userId, role_key: "admin" }, { onConflict: "user_id,role_key" })
    ).error
  );

  // ---- 2. campo Data Reunião (Lead) ------------------------------------------
  const { data: reuniaoDef, error: defErr } = await db
    .from("field_definitions")
    .select("id")
    .eq("field_key", REUNIAO_KEY)
    .maybeSingle();
  fail("field_definitions select", defErr);
  if (!reuniaoDef) {
    fail(
      "field_definitions insert",
      (
        await db.from("field_definitions").insert({
          field_key: REUNIAO_KEY,
          label: "Data Reunião (Lead)",
          data_type: "data",
          applies_to: ["lead"],
          show_in_builder: true,
        })
      ).error
    );
  }

  // ---- 3. registros determinísticos ------------------------------------------
  const [d1, d2, d3, d4, l1, l2, l3, mock] = RECORD_IDS;
  // TODAS as linhas carregam o MESMO conjunto de chaves: o insert em lote do
  // PostgREST unifica as colunas do payload e preenche as ausentes com NULL
  // explícito (não o default) — uma linha sem custom_fields ao lado do mock
  // violaria o NOT NULL de custom_fields/is_mock/closed.
  const base = (id: string) => ({
    id,
    source_system: "manual",
    source_id: `e2e-${id.slice(-2)}`,
    custom_fields: {} as Record<string, unknown>,
    is_mock: false,
    closed: false,
    closed_at: null as string | null,
    value: null as number | null,
    currency: null as string | null,
  });
  const deal = (
    id: string,
    pipeline: string,
    value: number,
    closedAt: string
  ) => ({
    ...base(id),
    record_type: "negocio",
    title: `Negócio E2E ${id.slice(-2)}`,
    pipeline,
    value,
    currency: "BRL",
    closed: true,
    closed_at: closedAt,
    source_created_at: closedAt,
  });
  const lead = (id: string, createdAt: string, extra?: object) => ({
    ...base(id),
    record_type: "lead",
    title: `Lead E2E ${id.slice(-2)}`,
    pipeline: "Inbound",
    source_created_at: createdAt,
    ...extra,
  });
  const rows = [
    deal(d1, "Inbound", 1000, "2026-07-06T10:00:00-03:00"),
    deal(d2, "Inbound", 2000, "2026-07-08T15:00:00-03:00"),
    deal(d3, "Outbound", 3000, "2026-07-13T11:00:00-03:00"),
    deal(d4, "Outbound", 500, "2026-07-15T09:00:00-03:00"),
    lead(l1, "2026-07-02T09:00:00-03:00"),
    lead(l2, "2026-07-07T14:00:00-03:00"),
    lead(l3, "2026-07-14T16:00:00-03:00"),
    // Mock de Data Reunião (0051): só conta quando a consulta referencia a
    // chave — o gate 0052 vale idêntico no vivo e no snapshot (paridade).
    lead(mock, "2026-07-10T10:00:00-03:00", {
      is_mock: true,
      custom_fields: { [REUNIAO_KEY]: "2026-07-20T10:00:00-03:00" },
    }),
  ];
  fail("records delete", (await db.from("records").delete().in("id", RECORD_IDS)).error);
  fail("records insert", (await db.from("records").insert(rows)).error);

  // ---- 4. dashboard + widgets -------------------------------------------------
  fail(
    "dashboards",
    (
      await db.from("dashboards").upsert(
        {
          id: DASHBOARD_ID,
          name: DASHBOARD_NAME,
          owner_user_id: userId,
          visible_to_roles: ["admin"],
          is_shared: true,
        },
        { onConflict: "id" }
      )
    ).error
  );
  const widgets = [
    {
      id: WIDGET_KPI_ID,
      dashboard_id: DASHBOARD_ID,
      title: WIDGET_KPI_TITLE,
      visual_type: "kpi",
      source: "records",
      sources: ["deals"],
      dimensions: [],
      metrics: [{ field: "value", agg: "sum" }],
      filters: [],
      grid_position: { x: 0, y: 0, w: 3, h: 3 },
      sort_order: 0,
    },
    {
      id: WIDGET_TABLE_ID,
      dashboard_id: DASHBOARD_ID,
      title: WIDGET_TABLE_TITLE,
      visual_type: "tabela",
      source: "records",
      sources: ["deals"],
      dimensions: [{ field: "pipeline" }],
      metrics: [{ field: "*", agg: "count" }],
      filters: [],
      grid_position: { x: 3, y: 0, w: 5, h: 4 },
      sort_order: 1,
    },
    {
      id: WIDGET_REUNIAO_ID,
      dashboard_id: DASHBOARD_ID,
      title: "Reuniões E2E",
      visual_type: "kpi",
      source: "records",
      sources: ["leads"],
      dimensions: [],
      metrics: [{ field: `custom:${REUNIAO_KEY}`, agg: "count" }],
      filters: [],
      grid_position: { x: 8, y: 0, w: 3, h: 3 },
      sort_order: 2,
    },
  ];
  fail("widgets", (await db.from("widgets").upsert(widgets, { onConflict: "id" })).error);

  // ---- 5. snapshot com token fixo + congelamento ------------------------------
  if (!isTokenShaped(SNAPSHOT_TOKEN)) {
    throw new Error("SNAPSHOT_TOKEN fora do shape de token (43 chars base64url).");
  }
  fail(
    "snapshots",
    (
      await db.from("snapshots").upsert(
        {
          id: SNAPSHOT_ID,
          dashboard_id: DASHBOARD_ID,
          tab_id: "",
          name: SNAPSHOT_NAME,
          token_hash: hashToken(SNAPSHOT_TOKEN),
          status: "active",
          refresh_mode: "manual",
          // Período CONGELADO fixo (0059): estável independente da data do run.
          default_period: { de: "2026-07-01", ate: "2026-07-31" },
        },
        { onConflict: "id" }
      )
    ).error
  );
  const refreshed = await refreshSnapshot(db, SNAPSHOT_ID);
  if (!refreshed.ok) {
    throw new Error(`refreshSnapshot: ${refreshed.error}`);
  }

  console.log("Seed E2E concluído:", {
    userId,
    dashboard: DASHBOARD_ID,
    snapshot: SNAPSHOT_ID,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

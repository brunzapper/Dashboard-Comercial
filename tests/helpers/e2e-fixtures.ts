// Versão: 1.0 | Data: 24/07/2026
// Constantes DETERMINÍSTICAS compartilhadas entre o seed (scripts/e2e-seed.ts),
// os specs do Playwright (e2e/*) e a paridade viva (tests/live/) — uuids
// fixos, credenciais do usuário de teste e os agregados esperados. Alterou o
// seed? Atualize os esperados AQUI (um lugar só).

export const E2E_USER = {
  email: "e2e@dashboard.test",
  password: "e2e-Segredo-123",
};

// Org Zapper semeada pela 0089 (uuid fixo; 0090 a torna default de
// organization_id em todas as tabelas — o seed pode omitir a coluna).
export const ZAPPER_ORG_ID = "00000000-0000-4000-a000-000000000001";

export const DASHBOARD_ID = "00000000-0000-4000-b000-000000000d01";
export const WIDGET_KPI_ID = "00000000-0000-4000-b000-000000000a01";
export const WIDGET_TABLE_ID = "00000000-0000-4000-b000-000000000a02";
export const WIDGET_REUNIAO_ID = "00000000-0000-4000-b000-000000000a03";

export const DASHBOARD_NAME = "Board E2E";
export const WIDGET_KPI_TITLE = "KPI E2E";
export const WIDGET_TABLE_TITLE = "Tabela E2E";

// Snapshot do fluxo E2E (viewer público) e o da paridade viva (recongelado a
// cada run da suíte) — ids distintos para não interferirem entre si.
export const SNAPSHOT_ID = "00000000-0000-4000-b000-0000000000e1";
export const PARITY_SNAPSHOT_ID = "00000000-0000-4000-b000-0000000000e2";
export const SNAPSHOT_NAME = "Snapshot E2E";
// 43 chars [A-Za-z0-9_-] (mesmo shape de generateToken; ver isTokenShaped).
export const SNAPSHOT_TOKEN = "E2E_token_fixo_para_testes_0123456789_ABCDE";

// Chave jsonb de "Data Reunião" (Lead) — gatilho da regra dos mocks (0052).
export const REUNIAO_KEY = "bitrix_uf_crm_1743441331";

// Registros semeados (uuids fixos → o seed apaga e reinsere, idempotente).
export const RECORD_IDS = Array.from(
  { length: 8 },
  (_, i) => `00000000-0000-4000-b000-0000000000${String(i + 10)}`
);

// Agregados esperados (specs + paridade conferem contra estes números):
// 4 negócios (Inbound 1000+2000, Outbound 3000+500) e 3 leads reais + 1 mock
// com Data Reunião preenchida.
export const EXPECTED = {
  dealsCount: 4,
  dealsSumValue: 6500,
  leadsCount: 3, // sem Data Reunião referenciada, o mock fica FORA
  reuniaoCount: 1, // só o mock carrega a chave — e ela liga o gate 0052
  pipelines: ["Inbound", "Outbound"],
};

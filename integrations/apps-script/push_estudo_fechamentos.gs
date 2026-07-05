// Versão: 1.0 | Data: 05/07/2026
// Apps Script — Fonte B (planilha "Estudo de Fechamentos", aba "Site").
// Fluxo: Planilha "Estudo de Fechamentos" + "Inbound Zapper" (Leads Base, só
// para Lead Time) → Apps Script (trigger horário) → POST /api/sync/sheets.
//
// SETUP (uma vez):
// 1) Na planilha "Estudo de Fechamentos": Extensões → Apps Script, cole este arquivo.
// 2) Configurações do projeto → Propriedades do script, crie:
//      ENDPOINT_URL = https://SEU-APP.vercel.app/api/sync/sheets
//      SYNC_SECRET  = (mesmo valor da env SYNC_SECRET na Vercel)
// 3) Rode installHourlyTrigger() uma vez (autorize os escopos quando pedir —
//    ele precisa ler também a planilha "Inbound Zapper", que é um arquivo separado).

const CONFIG = {
  salesSheet: 'Site',
  // Cabeçalhos reais da aba Site (confirmados em 05/07/2026):
  salesCols: {
    name: 'Name',
    email: 'Email',
    seats: 'Seats',
    plan: 'Plan',
    products: 'Products',
    createdAt: 'Created At',
    contract: 'Contract',
    mrr: 'MRR',
    consultor: 'Consultor',
    etapaCrm: 'Etapa no CRM',
    canal: 'Canal',
    campanha: 'Campanha'
  },

  // Planilha "Inbound Zapper" (arquivo separado) — usada só para o fallback
  // de Lead Time (o app tenta primeiro casar por e-mail contra os leads já
  // sincronizados do Bitrix; isto aqui cobre leads históricos fora do backfill).
  inboundSpreadsheetId: '16ZNV-O8wC06mcjtxeENrm0ipyOCA1gKyb8ZB8JQW3sU',
  leadsSheet: 'Leads Base',
  leadsNameCol: 'Nome do Lead',
  leadsCreatedCol: 'Criado'
};

function pushEstudoFechamentos() {
  const props = PropertiesService.getScriptProperties();
  const endpoint = props.getProperty('ENDPOINT_URL');
  const secret = props.getProperty('SYNC_SECRET');
  if (!endpoint || !secret) {
    throw new Error('Defina ENDPOINT_URL e SYNC_SECRET nas Propriedades do script.');
  }

  const salesSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.salesSheet);
  if (!salesSheet) throw new Error('Aba "' + CONFIG.salesSheet + '" não encontrada.');

  const inbound = SpreadsheetApp.openById(CONFIG.inboundSpreadsheetId);
  const leadsSheet = inbound.getSheetByName(CONFIG.leadsSheet);
  if (!leadsSheet) throw new Error('Aba "' + CONFIG.leadsSheet + '" não encontrada na Inbound Zapper.');

  // Lookup de data de criação do lead (mantém a mais antiga por nome).
  const leadCreated = {};
  readObjects(leadsSheet).forEach(function (r) {
    const nn = normalizeName(r[CONFIG.leadsNameCol]);
    if (!nn) return;
    const d = asDate(r[CONFIG.leadsCreatedCol]);
    if (!d) return;
    if (!leadCreated[nn] || d < leadCreated[nn]) leadCreated[nn] = d;
  });

  const rows = [];
  readObjects(salesSheet).forEach(function (r) {
    const c = CONFIG.salesCols;
    const name = str(r[c.name]);
    const createdRaw = r[c.createdAt];
    if (!name || createdRaw === '' || createdRaw === null || createdRaw === undefined) return;

    const nn = normalizeName(name);
    const saleDate = asDate(createdRaw);
    const lcreated = leadCreated[nn] || null;
    const leadTimeDays = (lcreated && saleDate)
      ? Math.round((saleDate.getTime() - lcreated.getTime()) / 86400000)
      : null;

    rows.push({
      name: name,
      email: str(r[c.email]),
      created_at: toIso(createdRaw),
      consultor: str(r[c.consultor]),
      products: str(r[c.products]),
      mrr: num(r[c.mrr]),
      plan: str(r[c.plan]),
      seats: num(r[c.seats]),
      contract: num(r[c.contract]),
      etapa_crm: str(r[c.etapaCrm]),
      canal: str(r[c.canal]),
      campanha: str(r[c.campanha]),
      lead_created_at: lcreated ? toIso(lcreated) : null,
      lead_time_days: leadTimeDays
    });
  });

  const payload = { source: 'estudo_fechamentos_site', rows: rows };
  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-sync-secret': secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  Logger.log('POST %s -> %s: %s', endpoint, code, response.getContentText());
  if (code < 200 || code >= 300) {
    throw new Error('Falha no sync (HTTP ' + code + '): ' + response.getContentText());
  }
}

// Lê uma aba como array de objetos keyados pelo cabeçalho (linha 1).
function readObjects(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(function (h) { return String(h).trim(); });
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const raw = values[i];
    if (raw.every(function (c) { return c === '' || c === null; })) continue;
    const obj = {};
    headers.forEach(function (h, idx) { obj[h] = raw[idx]; });
    out.push(obj);
  }
  return out;
}

function normalizeName(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/\s+/g, ' ');
}

function str(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }

function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/[^\d.,-]/g, '');
  if (s.indexOf(',') > -1) s = s.replace(/\./g, '').replace(',', '.'); // formato BR
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function asDate(v) {
  if (v instanceof Date) return v;
  if (v === '' || v === null || v === undefined) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // dd/mm/yyyy
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function toIso(v) {
  const d = asDate(v);
  if (!d) return String(v).trim();
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function installHourlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pushEstudoFechamentos') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pushEstudoFechamentos').timeBased().everyHours(1).create();
  Logger.log('Gatilho horário criado.');
}

// Versão: 1.0 | Data: 02/08/2026
// Apps Script — Export da Remuneração p/ Google Planilhas (Web App).
// Fluxo: o dashboard cria um TICKET single-use e abre <esta URL>?token=...
// numa aba nova → este doGet (rodando como o USUÁRIO que acessa) busca o
// payload em <APP_BASE_URL>/api/sheets-export/<token>, cria/atualiza a
// planilha NO DRIVE DO PRÓPRIO USUÁRIO (uma aba por mês) e devolve id/url ao
// dashboard (POST na mesma rota) p/ os próximos exports reusarem a MESMA
// planilha. Nenhum segredo aqui: o token é single-use e expira em 15 min.
//
// SETUP (uma vez por organização):
// 1) script.google.com → Novo projeto (standalone), cole este arquivo.
// 2) Configurações do projeto → Propriedades do script, crie:
//      APP_BASE_URL = https://SEU-APP.vercel.app     (sem barra no final)
// 3) Implantar → Nova implantação → tipo "App da Web":
//      Executar como:      "Usuário que acessa o app da web"
//      Quem pode acessar:  "Qualquer pessoa com Conta do Google"
//    Copie a URL /exec.
// 4) No dashboard: Configurações → Remuneração → Visão geral → botão
//    "Google Planilhas — Configurar…" → cole a URL /exec.
// 5) Primeiro uso de CADA usuário: o Google pede consentimento (app "não
//    verificado": Avançado → Acessar <projeto> (não seguro) em conta pessoal;
//    em Workspace o admin pode precisar liberar o app interno).

var TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function doGet(e) {
  var token = e && e.parameter ? String(e.parameter.token || '') : '';
  if (!TOKEN_RE.test(token)) {
    return paginaErro_('Link inválido. Gere um novo export no dashboard.');
  }
  var base = PropertiesService.getScriptProperties().getProperty('APP_BASE_URL');
  if (!base) {
    return paginaErro_('Configuração incompleta: defina APP_BASE_URL nas Propriedades do script.');
  }
  base = String(base).replace(/\/+$/, '');
  var api = base + '/api/sheets-export/' + token;

  // 1) Busca o payload (o GET CONSOME o ticket — single-use).
  var res = UrlFetchApp.fetch(api, { muteHttpExceptions: true });
  var code = res.getResponseCode();
  if (code === 404) {
    return paginaErro_('Token expirado ou já utilizado — gere um novo link no dashboard.');
  }
  if (code < 200 || code >= 300) {
    return paginaErro_('Falha ao buscar os dados (HTTP ' + code + '). Tente novamente pelo dashboard.');
  }
  var data;
  try { data = JSON.parse(res.getContentText()); } catch (err) {
    return paginaErro_('Resposta inesperada do dashboard.');
  }
  if (!data || !data.tabName || !data.headers || !data.rows) {
    return paginaErro_('Payload incompleto — gere um novo export no dashboard.');
  }

  // 2) Abre a planilha conhecida ou cria uma nova no Drive do usuário.
  var ss = abrirOuCriar_(data.knownSpreadsheetId, String(data.spreadsheetTitle || 'Remuneração'));

  // 3) Upsert da aba do mês (clear + setValues; cabeçalho bold + congelado).
  gravarAba_(ss, String(data.tabName), data.headers, data.rows);

  // 4) Devolve id/url ao dashboard (grava o vínculo p/ os próximos exports).
  var postOk = true;
  try {
    var post = UrlFetchApp.fetch(api, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ spreadsheetId: ss.getId(), spreadsheetUrl: ss.getUrl() }),
      muteHttpExceptions: true
    });
    postOk = post.getResponseCode() >= 200 && post.getResponseCode() < 300;
  } catch (err) { postOk = false; }

  return paginaOk_(ss.getUrl(), postOk);
}

// Planilha conhecida se existir, acessível e fora da lixeira; senão cria.
function abrirOuCriar_(knownId, title) {
  if (knownId) {
    try {
      var ss = SpreadsheetApp.openById(String(knownId));
      if (!DriveApp.getFileById(ss.getId()).isTrashed()) return ss;
    } catch (err) { /* sem acesso/apagada: cai no create abaixo */ }
  }
  return SpreadsheetApp.create(title);
}

function gravarAba_(ss, tabName, headers, rows) {
  var sh = ss.getSheetByName(tabName);
  if (sh) {
    // clear() (conteúdo + formatos): a aba re-exportada nasce determinística —
    // clearContents deixaria bolds/larguras órfãos de exports antigos.
    sh.clear();
  } else if (ss.getSheets().length === 1 && ss.getSheets()[0].getLastRow() === 0) {
    sh = ss.getSheets()[0].setName(tabName); // planilha nova: renomeia a aba default
  } else {
    sh = ss.insertSheet(tabName);
  }
  var ncols = headers.length;
  var values = [headers];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i].slice(0, ncols);
    while (row.length < ncols) row.push('');
    values.push(row);
  }
  sh.getRange(1, 1, values.length, ncols).setValues(values);
  sh.getRange(1, 1, 1, ncols).setFontWeight('bold');
  sh.setFrozenRows(1);
  try { sh.autoResizeColumns(1, Math.min(ncols, 12)); } catch (err) { /* best-effort */ }
}

// ---- Páginas HTML (pt-BR). Apps Script serve num iframe sandbox: a
// navegação automática só funciona com gesto do usuário — o LINK é o caminho
// garantido (target="_top"); o script de auto-nav é best-effort.
function paginaOk_(url, postOk) {
  var safe = String(url).replace(/"/g, '&quot;');
  var aviso = postOk ? '' :
    '<p style="color:#92400e">A planilha foi gerada, mas o dashboard não registrou o vínculo — o próximo export pode criar uma planilha nova.</p>';
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<title>Planilha atualizada</title></head>' +
    '<body style="font-family:system-ui,sans-serif;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:center;min-height:80vh;gap:16px">' +
    '<h1 style="font-size:20px;margin:0">Planilha atualizada ✅</h1>' + aviso +
    '<a href="' + safe + '" target="_top" style="background:#188038;color:#fff;' +
    'padding:12px 28px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:600">' +
    'Abrir planilha</a>' +
    '<p style="color:#5f6368;font-size:13px">Você pode fechar esta aba depois de abrir a planilha.</p>' +
    '<script>try{window.top.location.href="' + safe + '";}catch(e){}</script>' +
    '</body></html>'
  ).setTitle('Planilha atualizada');
}

function paginaErro_(msg) {
  var safe = String(msg).replace(/</g, '&lt;');
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<title>Não foi possível exportar</title></head>' +
    '<body style="font-family:system-ui,sans-serif;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:center;min-height:80vh;gap:12px">' +
    '<h1 style="font-size:20px;margin:0">Não foi possível exportar</h1>' +
    '<p style="color:#b3261e;max-width:480px;text-align:center">' + safe + '</p>' +
    '<p style="color:#5f6368;font-size:13px">Volte ao dashboard e clique em "Google Planilhas" novamente.</p>' +
    '</body></html>'
  ).setTitle('Não foi possível exportar');
}

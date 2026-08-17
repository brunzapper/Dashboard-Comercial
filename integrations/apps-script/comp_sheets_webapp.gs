// Versão: 3.1 | Data: 17/08/2026
// v3.1: MEMÓRIA DE CÁLCULO no detalhamento — kinds novos `detailMemory` (linha
// explicativa) e `detailTier`/`detailTierApplied` (escada de faixas, com a
// aplicada em negrito). O valor do degrau vem como TEXTO já formatado (a
// unidade muda por tipo de bloco), então essas linhas NÃO levam formato de
// moeda; o subtotal passa a trazer realizado e somado lado a lado (colunas E e
// F). Script 3.0 renderiza os kinds novos como texto puro — republique p/ ver
// os estilos.
// Versão: 3.0 | Data: 16/08/2026
// Apps Script — Export da Remuneração p/ Google Planilhas (Web App).
// v3.0: ABAS DE DETALHAMENTO + navegação + bloco da pessoa destacado.
//   - o payload traz `details` (uma aba "Det-<Nome>" por colaborador, com os
//     registros que compõem cada fator) e `links` (por linha: nome da aba alvo
//     do hiperlink da coluna A);
//   - o rendering roda em DUAS PASSADAS porque o hiperlink precisa do `gid`:
//     passada 1 cria/limpa todas as abas e coleta os ids, passada 2 escreve
//     valores e formatos já com as fórmulas =HYPERLINK("#gid=…");
//   - abas "Det-*" que não vieram no payload são APAGADAS (o detalhamento é
//     sempre regerado só com o período pedido);
//   - início e fim do bloco de cada pessoa ganham fundo, negrito e borda
//     (`section` abre, `memberTotal` fecha), com 2 linhas de respiro entre
//     colaboradores.
// Ticket v2 (sem `details`/`links`) segue rendendo só a aba do mês; payload
// sem `kinds` cai no rendering simples de sempre.
// Fluxo: o dashboard cria um TICKET single-use e abre <esta URL>?token=...
// numa aba nova → este doGet (rodando como o USUÁRIO que acessa) busca o
// payload em <APP_BASE_URL>/api/sheets-export/<token>, cria/atualiza a
// planilha NO DRIVE DO PRÓPRIO USUÁRIO e devolve id/url ao dashboard (POST na
// mesma rota) p/ os próximos exports reusarem a MESMA planilha. Nenhum segredo
// aqui: o token é single-use e expira em 15 min.
//
// SETUP (uma vez por organização):
// 1) script.google.com → Novo projeto (standalone), cole este arquivo.
// 2) Configurações do projeto → Propriedades do script, crie:
//      APP_BASE_URL = https://SEU-APP.vercel.app     (sem barra no final)
// 3) Implantar → Nova implantação → tipo "App da Web":
//      Executar como:      "Usuário que acessa o app da web"
//      Quem pode acessar:  "Qualquer pessoa com Conta do Google"
//    Copie a URL /exec.
// 4) No dashboard: Workspace → aba Operação → Remuneração → Visão geral →
//    botão "Google Planilhas — Configurar…" → cole a URL /exec.
// 5) Primeiro uso de CADA usuário: o Google pede consentimento (app "não
//    verificado": Avançado → Acessar <projeto> (não seguro) em conta pessoal;
//    em Workspace o admin pode precisar liberar o app interno).
//
// ATUALIZAÇÃO deste script (nova versão do código):
// 1) Cole o código novo por cima no editor e salve.
// 2) Implantar → GERENCIAR implantações → ✏️ na implantação ativa →
//    Versão: "Nova versão" → Implantar.
//    A URL /exec NÃO muda — não é preciso reconfigurar o dashboard.
//    ("Nova implantação" geraria uma URL nova e exigiria recolar no app.)

var TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
var PREFIXO_DET_ = 'Det-';

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

  // 3) Upsert das abas (mês + detalhamento) em duas passadas.
  gravarPlanilha_(ss, data);

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

function ehLista_(v) {
  return v && Object.prototype.toString.call(v) === '[object Array]';
}

// Aba pronta p/ escrita: existente é LIMPA (clear() = conteúdo + formatos, p/
// a aba re-exportada nascer determinística — clearContents deixaria bolds e
// larguras órfãos), ausente é criada.
// `podeReusarDefault` só vale para a PRIMEIRA aba da rodada: as abas nascem
// todas vazias na passada 1 (os valores só entram na passada 2), então sem
// esse trava a heurística "planilha nova com uma aba vazia" casaria de novo a
// cada aba e ficaria renomeando a MESMA aba em vez de criar as seguintes.
function garantirAba_(ss, tabName, podeReusarDefault) {
  var sh = ss.getSheetByName(tabName);
  if (sh) { sh.clear(); return sh; }
  var todas = ss.getSheets();
  if (podeReusarDefault && todas.length === 1 && todas[0].getLastRow() === 0) {
    return todas[0].setName(tabName);
  }
  return ss.insertSheet(tabName);
}

/**
 * Escreve a aba do mês e as abas de detalhamento. DUAS PASSADAS: o hiperlink
 * de uma aba p/ outra é "#gid=<id>", e o id só existe depois da aba criada —
 * então primeiro todas nascem (e são limpas), depois todas são preenchidas.
 */
function gravarPlanilha_(ss, data) {
  var v2 = ehLista_(data.kinds) && data.kinds.length === data.rows.length;
  if (!v2) {
    // Payload v1 (ticket antigo em trânsito): grid cru, sem detalhamento.
    gravarSimples_(
      garantirAba_(ss, String(data.tabName), true), data.headers, data.rows);
    return;
  }

  var abas = [{
    tabName: String(data.tabName),
    headers: data.headers,
    rows: data.rows,
    kinds: data.kinds,
    links: data.links,
    detalhe: false
  }];
  var temDetalhe = ehLista_(data.details);
  if (temDetalhe) {
    for (var i = 0; i < data.details.length; i++) {
      var d = data.details[i];
      if (!d || !d.tabName || !ehLista_(d.rows) || !ehLista_(d.kinds)) continue;
      if (d.kinds.length !== d.rows.length) continue;
      abas.push({
        tabName: String(d.tabName),
        headers: d.headers,
        rows: d.rows,
        kinds: d.kinds,
        links: d.links,
        detalhe: true
      });
    }
  }

  // Passada 1: cria/limpa e coleta os gids.
  var gidPorNome = {};
  for (var a = 0; a < abas.length; a++) {
    abas[a].sh = garantirAba_(ss, abas[a].tabName, a === 0);
    gidPorNome[abas[a].tabName] = abas[a].sh.getSheetId();
  }

  // Locale pt-BR (best-effort): garante "R$ 1.234,56" no formato de número.
  try {
    if (String(ss.getSpreadsheetLocale()).indexOf('pt') !== 0) ss.setSpreadsheetLocale('pt_BR');
  } catch (err) { /* best-effort */ }

  // Passada 2: valores + formatos, já com os hiperlinks resolvidos.
  for (var b = 0; b < abas.length; b++) {
    gravarDemonstrativo_(abas[b], gidPorNome);
  }

  // Abas de detalhamento órfãs (pessoa fora do export atual) somem — o
  // detalhamento é sempre regerado só com o período pedido. Só com payload v3:
  // um ticket v2 em trânsito não deve varrer o que ele nem conhece.
  if (temDetalhe) {
    var manter = {};
    for (var c = 0; c < abas.length; c++) manter[abas[c].tabName] = true;
    limparAbasOrfas_(ss, manter);
  }
}

function limparAbasOrfas_(ss, manter) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var nome = sheets[i].getName();
    if (nome.indexOf(PREFIXO_DET_) !== 0 || manter[nome]) continue;
    if (ss.getSheets().length <= 1) return; // nunca deixar a planilha sem aba
    try { ss.deleteSheet(sheets[i]); } catch (err) { /* best-effort */ }
  }
}

// Rendering v1: grid cru com a 1ª linha em bold (compat com payload sem kinds).
function gravarSimples_(sh, headers, rows) {
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

// ---- Rendering v2/v3: demonstrativo por kind ----
// headers = linha-TÍTULO da aba; rows/kinds = grid (kinds[i] descreve rows[i]);
// links[i] = nome da aba p/ onde a coluna A deve apontar. Estilos aplicados em
// LOTE via getRangeList (nunca célula a célula).
var LARGURAS_ = [220, 110, 110, 100, 80, 130, 420];
var LARGURAS_DET_ = [100, 300, 140, 160, 130, 130, 300];
var FMT_MOEDA_ = 'R$ #,##0.00';
// Aspas no % = literal (o valor já vem 0–100; "%" nu multiplicaria por 100).
var FMT_PCT_ = '0.00"%"';
var BG_CABECALHO_ = '#eef1f5';
var BG_PESSOA_ = '#cfe2f3';
var BG_TOTAL_GERAL_ = '#a4c2f4';
var COR_BORDA_ = '#5b8fd6';
var ALTURA_SECAO_ = 30;
// Segmentos CONTÍGUOS de colunas (1-based, [de, até]) formatados por kind.
// summary/summaryHeader não são mais emitidos pelo builder — as entradas
// cobrem tickets antigos em trânsito (moeda em célula vazia é inócua).
var MOEDA_POR_KIND_ = {
  summary: [[3, 7]],
  summaryTotal: [[4, 7]],
  section: [[6, 6]],
  factor: [[6, 6]],
  factorMoney: [[2, 3], [6, 6]],
  commission: [[6, 6]],
  bonus: [[6, 6]],
  info: [[6, 6]],
  blockTotal: [[6, 6]],
  memberTotal: [[6, 6]],
  // Detalhamento: só as variantes "Money" levam R$ — fator de contagem/número
  // puro mostra o valor cru.
  detailFactorMoney: [[6, 6]],
  detailRowMoney: [[6, 6]],
  // Subtotal: E = realizado do fator, F = soma dos registros listados.
  detailSubtotalMoney: [[5, 6]]
};
var PCT_POR_KIND_ = { factor: [[4, 5]], factorMoney: [[4, 5]] };
var BOLD_KINDS_ = {
  summaryHeader: 1, summaryTotal: 1, section: 1, planHeader: 1,
  detailHeader: 1, blockTotal: 1, memberTotal: 1,
  detailFactor: 1, detailFactorMoney: 1, detailSubtotal: 1, detailSubtotalMoney: 1,
  // A faixa APLICADA é a que explica o valor pago — destacada entre os degraus.
  detailTierApplied: 1
};
var HEADER_BG_KINDS_ = {
  summaryHeader: 1, planHeader: 1, detailHeader: 1,
  detailFactor: 1, detailFactorMoney: 1
};
var NOTA_KINDS_ = { info: 1, note: 1, detailBack: 1, detailMemory: 1 };
var COL_LETRAS_ = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

// Fórmula de link interno. A API do Apps Script usa SEMPRE vírgula como
// separador de argumentos, independente do locale pt-BR da planilha.
function formulaLink_(gid, rotulo) {
  return '=HYPERLINK("#gid=' + gid + '","' + String(rotulo).replace(/"/g, '""') + '")';
}

function gravarDemonstrativo_(aba, gidPorNome) {
  var sh = aba.sh;
  var rows = aba.rows;
  var kinds = aba.kinds;
  var links = ehLista_(aba.links) && aba.links.length === rows.length ? aba.links : null;
  var larguras = aba.detalhe ? LARGURAS_DET_ : LARGURAS_;
  var ncols = larguras.length;

  var pad = function (src) {
    var row = (src || []).slice(0, ncols);
    while (row.length < ncols) row.push('');
    return row;
  };
  var values = [pad(aba.headers)];
  for (var i = 0; i < rows.length; i++) {
    var linha = pad(rows[i]);
    // Hiperlink na coluna A: o rótulo continua sendo o texto da célula.
    if (links && links[i] && gidPorNome[links[i]] != null) {
      linha[0] = formulaLink_(gidPorNome[links[i]], linha[0]);
    }
    values.push(linha);
  }
  sh.getRange(1, 1, values.length, ncols).setValues(values);

  // Acumula notações A1 por estilo e aplica em lote.
  var bold = ['A1:' + COL_LETRAS_[ncols - 1] + '1'];
  var headerBg = [];
  var pessoaBg = [];
  var geralBg = [];
  var nota = [];
  var moeda = [];
  var pct = [];
  var abre = [];
  var fecha = [];
  var alturas = [];
  var ultima = COL_LETRAS_[ncols - 1];
  var segsA1 = function (rowA1, segs, out) {
    for (var s = 0; s < segs.length; s++) {
      if (segs[s][1] > ncols) continue;
      out.push(COL_LETRAS_[segs[s][0] - 1] + rowA1 + ':' + COL_LETRAS_[segs[s][1] - 1] + rowA1);
    }
  };
  for (var r = 0; r < kinds.length; r++) {
    var kind = String(kinds[r]);
    var rowA1 = r + 2; // +1 do título, +1 do 1-based
    var faixa = 'A' + rowA1 + ':' + ultima + rowA1;
    if (BOLD_KINDS_[kind]) bold.push(faixa);
    if (HEADER_BG_KINDS_[kind]) headerBg.push(faixa);
    // O bloco da pessoa ABRE em `section` e FECHA em `memberTotal`: mesmo
    // fundo nos dois + borda grossa no topo e na base p/ delimitar.
    if (kind === 'section') {
      pessoaBg.push(faixa);
      abre.push(faixa);
      alturas.push(rowA1);
    }
    if (kind === 'memberTotal') {
      pessoaBg.push(faixa);
      fecha.push(faixa);
    }
    if (kind === 'summaryTotal') geralBg.push(faixa);
    if (NOTA_KINDS_[kind]) nota.push(faixa);
    if (MOEDA_POR_KIND_[kind]) segsA1(rowA1, MOEDA_POR_KIND_[kind], moeda);
    if (PCT_POR_KIND_[kind]) segsA1(rowA1, PCT_POR_KIND_[kind], pct);
  }
  if (bold.length) sh.getRangeList(bold).setFontWeight('bold');
  if (headerBg.length) sh.getRangeList(headerBg).setBackground(BG_CABECALHO_);
  if (pessoaBg.length) sh.getRangeList(pessoaBg).setBackground(BG_PESSOA_);
  if (geralBg.length) sh.getRangeList(geralBg).setBackground(BG_TOTAL_GERAL_);
  if (nota.length) sh.getRangeList(nota).setFontStyle('italic').setFontColor('#5f6368');
  if (moeda.length) sh.getRangeList(moeda).setNumberFormat(FMT_MOEDA_);
  if (pct.length) sh.getRangeList(pct).setNumberFormat(FMT_PCT_);
  if (abre.length) {
    sh.getRangeList(abre).setBorder(
      true, null, null, null, null, null, COR_BORDA_, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  }
  if (fecha.length) {
    sh.getRangeList(fecha).setBorder(
      null, null, true, null, null, null, COR_BORDA_, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  }

  sh.getRange(1, 1).setFontSize(12);
  for (var c = 0; c < ncols; c++) sh.setColumnWidth(c + 1, larguras[c]);
  // Wrap SÓ na coluna de memória/observações (números não são afetados).
  sh.getRange(1, ncols, values.length, 1).setWrap(true);
  sh.setFrozenRows(1);
  // Alturas: autoResize primeiro (zera resíduo de exports anteriores — clear()
  // não mexe em altura de linha), depois a folga do cabeçalho da pessoa.
  try { sh.autoResizeRows(1, values.length); } catch (err) { /* best-effort */ }
  for (var h = 0; h < alturas.length; h++) {
    try { sh.setRowHeight(alturas[h], ALTURA_SECAO_); } catch (err) { /* best-effort */ }
  }
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

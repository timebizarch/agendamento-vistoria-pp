// ============================================================
// GOOGLE APPS SCRIPT — Agendamento de Vistoria Yuca
// Cole este código em script.google.com (substitui a versão anterior)
// e publique uma NOVA VERSÃO do Web App (Implantar → Gerenciar implantações).
//
// Configuração obrigatória (Configurações do projeto → Propriedades do script):
//   MAKE_WEBHOOK_URL = URL do Custom Webhook do cenário no Make
// Fuso horário do projeto: America/Sao_Paulo
// ============================================================

const CALENDAR_ID = 'c_2adaf9b416417c6a87b4cfc9f9c98f4902997aae2fddaa86c8cbd26fc90ec0f4@group.calendar.google.com';
const SHEET_ID    = '1C_SABiqlkBaOZPlrZDmGVLuaCt6XnBgPbD37MtHLNks';
const SHEET_NAME  = 'Agendamento de vistoria';
const SCRIPT_URL  = 'https://script.google.com/macros/s/AKfycbwlC-Lqw4EZ8ekGuqdI7awLJzg2-qJbSLjinZM29vrvrCf7lNkz30aYqo0y_M7KFQGn/exec';
const ADMIN_EMAIL = 'maiara.pereira@yuca.live';
const TZ          = 'America/Sao_Paulo';

const VISIT_MS  = 60 * 60 * 1000; // duração da vistoria: 1h
const BUFFER_MS = 60 * 60 * 1000; // deslocamento: 1h antes e 1h depois

// Colunas da planilha (a ordem só importa na criação; a gravação é feita pelo nome do cabeçalho)
const HEADERS = [
  'Data do envio', 'Proprietário', 'Telefone', 'E-mail do proprietário',
  'Edifício', 'Unidade', 'Endereço', 'Acesso à unidade',
  'Tipo de vistoria', 'Data da vistoria', 'Horário',
  'Vistoriador/a', 'E-mail do vistoriador', 'Observações',
  'Status', 'Confirmada em', 'ID',
  'HubSpot Ticket ID', 'Presença do proprietário', 'Sync HubSpot'
];

// ============================================================
// doGet — horários ocupados OU página de confirmação
// ============================================================
function doGet(e) {
  const p = (e && e.parameter) || {};

  if (p.action === 'confirmar') {
    return confirmarVistoria(p.id);
  }

  // ?date=2026-07-31 → { busy: [{start, end}] }
  try {
    if (!p.date) return json({ busy: [] });
    const parts = p.date.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const tMin = new Date(d); tMin.setHours(8, 0, 0, 0);
    const tMax = new Date(d); tMax.setHours(19, 0, 0, 0);
    const busy = getCalendar().getEvents(tMin, tMax).map(function (ev) {
      return { start: ev.getStartTime().toISOString(), end: ev.getEndTime().toISOString() };
    });
    return json({ busy: busy });
  } catch (err) {
    return json({ busy: [], error: err.toString() });
  }
}

// ============================================================
// doPost — verifica conflito, cria evento, grava planilha, avisa o Make
// ============================================================
function doPost(e) {
  const data = normalizar((e && e.parameter) || {});
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // evita duas reservas simultâneas no mesmo horário

    if (!data.hubspotTicketId) {
      return json({ status: 'error', message: 'Link sem identificação do HubSpot.' });
    }

    const inicio = inicioDaVistoria(data);
    const fim    = new Date(inicio.getTime() + VISIT_MS);
    const conflitos = getCalendar().getEvents(new Date(inicio.getTime() - BUFFER_MS), new Date(fim.getTime() + BUFFER_MS));
    if (conflitos.length > 0) {
      registrarTentativa(data, 'Conflito de horário');
      return json({
        status: 'conflict',
        message: 'Este horário acabou de ser reservado por outra pessoa. Por favor, escolha outro horário.'
      });
    }

    const confirmId = Utilities.getUuid();
    const eventId   = criarEvento(data, confirmId);
    const linha     = registrarNaPlanilha(data, confirmId);
    const sync      = notificarMake('vistoria_agendada', payloadAgendamento(data, inicio, confirmId, eventId));
    marcarSync(linha, sync);

    return json({ status: 'ok' });
  } catch (err) {
    console.error('Erro:', err);
    alertarAdmin('⚠️ Erro no agendamento de vistoria',
      'Houve um erro ao processar um agendamento.\n\n'
      + 'Proprietário: ' + (data.ownerName || '?') + '\n'
      + 'Unidade: ' + (data.unitName || '?') + '\n'
      + 'HubSpot Ticket ID: ' + (data.hubspotTicketId || '?') + '\n'
      + 'Data/horário tentado: ' + (data.visitDate || data.dateISO || '?') + ' às ' + (data.timeStr || '?') + '\n\n'
      + 'Erro: ' + err.toString() + '\n\n'
      + 'Verifique se o evento foi criado no calendário, se foi registrado na planilha e se o ticket foi atualizado no HubSpot.');
    return json({ status: 'error', message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

// Aceita o formato novo (unitName) e o antigo (buildingName + unitNumber)
function normalizar(p) {
  const d = {};
  Object.keys(p).forEach(function (k) { d[k] = String(p[k] || '').trim(); });
  d.hubspotTicketId = (d.hubspotTicketId || '').replace(/\D/g, '');
  if (!d.unitName) d.unitName = [d.buildingName, d.unitNumber].filter(Boolean).join(' — ');
  if (!d.timeStr) d.timeStr = d.visitTime || '';
  return d;
}

function inicioDaVistoria(data) {
  const t = data.timeStr.split(':').map(Number);
  const d = data.dateISO.split('-').map(Number);
  return new Date(d[0], d[1] - 1, d[2], t[0], t[1], 0);
}

// ============================================================
// MAKE → HUBSPOT
// O Make recebe o JSON abaixo e atualiza o ticket pelo hubspot_ticket_id.
// As chaves dentro de "hubspot" já são os nomes internos das propriedades do ticket.
// ============================================================
function payloadAgendamento(data, inicio, confirmId, eventId) {
  return {
    evento: 'vistoria_agendada',
    hubspot_ticket_id: data.hubspotTicketId,
    hubspot: {
      // data + hora (datetime): epoch em ms, formato aceito pela API do HubSpot
      data_da_vistoria_de_recebimento: inicio.getTime(),
      vistoriador_responsavel_onb: data.inspectorHubspot || data.inspector,  // enumeração
      email_vistoriador: data.inspectorEmail                                 // texto
    },
    contexto: {
      presenca: data.presenceLabel,
      recado: data.notes,
      nome: data.ownerName,
      telefone: data.ownerPhone,
      email: data.ownerEmail,
      unidade: data.unitName,
      data_extenso: data.visitDate,
      data_hora_iso: Utilities.formatDate(inicio, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      data_hora_epoch_ms: inicio.getTime(),
      tipo_vistoria: data.visitType,
      vistoriador: data.inspector,
      calendar_event_id: eventId,
      confirm_id: confirmId,
      link_confirmacao: SCRIPT_URL + '?action=confirmar&id=' + confirmId
    }
  };
}

function notificarMake(evento, payload) {
  const url = PropertiesService.getScriptProperties().getProperty('MAKE_WEBHOOK_URL');
  if (!url) {
    console.warn('MAKE_WEBHOOK_URL não configurada — HubSpot não foi atualizado.');
    return 'Sem webhook';
  }
  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) return 'OK';
    throw new Error('HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
  } catch (err) {
    console.error('Falha ao avisar o Make:', err);
    alertarAdmin('⚠️ Agendamento não refletiu no HubSpot',
      'O agendamento foi criado na agenda e na planilha, mas o Make não recebeu o evento "' + evento + '".\n\n'
      + 'HubSpot Ticket ID: ' + payload.hubspot_ticket_id + '\n'
      + 'Erro: ' + err.toString() + '\n\n'
      + 'Atualize o ticket manualmente ou reprocesse no Make.\n\nPayload:\n' + JSON.stringify(payload, null, 2));
    return 'Falhou';
  }
}

// ============================================================
// CONFIRMAÇÃO — a vistoriadora acessa o link e confirma a vistoria
// ============================================================
function confirmarVistoria(confirmId) {
  if (!confirmId) return HtmlService.createHtmlOutput('<p>Link inválido.</p>');

  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return HtmlService.createHtmlOutput('<p>Planilha não encontrada.</p>');

  const col = mapaColunas(sheet);
  if (!col['ID'] || !col['Status'] || !col['Confirmada em']) {
    return HtmlService.createHtmlOutput('<p>Estrutura da planilha desatualizada. Entre em contato com o suporte.</p>');
  }

  const ids = sheet.getRange(2, col['ID'], sheet.getLastRow() - 1, 1).getValues();
  let foundRow = -1;
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === confirmId) { foundRow = i + 2; break; }
  }
  if (foundRow === -1) return HtmlService.createHtmlOutput('<p>Agendamento não encontrado.</p>');

  const row = sheet.getRange(foundRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  const cell = function (h) { return col[h] ? row[col[h] - 1] : ''; };
  const jaConfirmada = cell('Status') === 'Confirmada ✓';

  if (!jaConfirmada) {
    const agora = new Date();
    sheet.getRange(foundRow, col['Status']).setValue('Confirmada ✓');
    sheet.getRange(foundRow, col['Confirmada em']).setValue(Utilities.formatDate(agora, TZ, 'dd/MM/yyyy HH:mm'));
    const ticketId = String(cell('HubSpot Ticket ID') || '');
    if (ticketId) {
      notificarMake('vistoria_realizada', {
        evento: 'vistoria_realizada',
        hubspot_ticket_id: ticketId,
        hubspot: {},
        contexto: {
          unidade: cell('Unidade'),
          data_realizacao: Utilities.formatDate(agora, TZ, 'yyyy-MM-dd'),
          confirm_id: confirmId
        }
      });
    }
  }

  const unidade = [cell('Edifício'), cell('Unidade')].filter(Boolean).join(' — ');
  const msg = jaConfirmada ? 'Vistoria já estava confirmada ✓' : 'Vistoria confirmada com sucesso!';

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirmação de Vistoria — Yuca</title>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Montserrat:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Montserrat', system-ui, sans-serif; background: #EEF3F0; color: #133E39;
           display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
    .card { background: #fff; border-radius: 20px; max-width: 400px; width: 100%; overflow: hidden;
            box-shadow: 0 20px 60px rgba(6,40,64,.12); }
    .top { background: #005956; padding: 18px 24px; color: #12C68B; font-size: 11px; font-weight: 700;
           letter-spacing: .18em; text-transform: uppercase; }
    .body { padding: 32px 26px; text-align: center; }
    .icon { width: 72px; height: 72px; background: #12C68B; border-radius: 50%; display: flex;
            align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 34px; color: #04352A; font-weight: 700; }
    h1 { font-family: 'Fraunces', serif; font-size: 22px; font-weight: 600; color: #005956; margin-bottom: 8px; }
    .sub { color: #6A8481; font-size: 14px; line-height: 1.6; margin-bottom: 22px; }
    .detail { background: #EEF6F1; border-radius: 14px; padding: 16px 18px; text-align: left; font-size: 14px; line-height: 2; }
    .detail strong { color: #005956; }
  </style>
</head>
<body>
  <div class="card">
    <div class="top">Yuca · Vistoria de recebimento</div>
    <div class="body">
      <div class="icon">✓</div>
      <h1>${esc(msg)}</h1>
      <p class="sub">Obrigada! O status foi atualizado na planilha e no HubSpot automaticamente.</p>
      <div class="detail">
        <div><strong>Proprietário:</strong> ${esc(cell('Proprietário'))}</div>
        <div><strong>Unidade:</strong> ${esc(unidade)}</div>
        <div><strong>Data:</strong> ${esc(cell('Data da vistoria'))}</div>
        <div><strong>Horário:</strong> ${esc(cell('Horário'))}</div>
      </div>
    </div>
  </div>
</body>
</html>`;

  return HtmlService.createHtmlOutput(html).setTitle('Confirmação de Vistoria — Yuca');
}

// ============================================================
// PLANILHA — grava na aba "Agendamento de vistoria"
// ============================================================
function registrarNaPlanilha(data, confirmId) {
  const ss  = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  garantirCabecalhos(sheet);

  const valores = {
    'Data do envio': Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm'),
    'Proprietário': data.ownerName,
    'Telefone': data.ownerPhone,
    'E-mail do proprietário': data.ownerEmail,
    'Edifício': data.buildingName || '',
    'Unidade': data.buildingName ? data.unitNumber : data.unitName,
    'Endereço': data.address,
    'Acesso à unidade': data.accessInfo,
    'Tipo de vistoria': data.visitType,
    'Data da vistoria': data.visitDate || data.dateISO,
    'Horário': data.timeStr,
    'Vistoriador/a': data.inspector,
    'E-mail do vistoriador': data.inspectorEmail,
    'Observações': data.notes,
    'Status': 'Agendada',
    'Confirmada em': '',
    'ID': confirmId,
    'HubSpot Ticket ID': data.hubspotTicketId,
    'Presença do proprietário': data.presenceLabel || '',
    'Sync HubSpot': ''
  };

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(headers.map(function (h) { return valores[h] !== undefined ? valores[h] : ''; }));
  return { sheet: sheet, row: sheet.getLastRow() };
}

function marcarSync(linha, status) {
  try {
    const col = mapaColunas(linha.sheet)['Sync HubSpot'];
    if (col) linha.sheet.getRange(linha.row, col).setValue(status);
  } catch (err) { console.error('Erro ao marcar sync:', err); }
}

// Adiciona ao final as colunas que ainda não existem (planilhas de versões anteriores)
function garantirCabecalhos(sheet) {
  const existentes = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  const faltando = HEADERS.filter(function (h) { return existentes.indexOf(h) === -1; });
  if (faltando.length) {
    sheet.getRange(1, sheet.getLastColumn() + 1, 1, faltando.length).setValues([faltando]);
  }
  sheet.getRange(1, 1, 1, sheet.getLastColumn())
       .setFontWeight('bold').setBackground('#005956').setFontColor('white');
}

function mapaColunas(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach(function (h, i) { if (h) map[h] = i + 1; });
  return map;
}

// ============================================================
// EVENTO no Google Calendar
// ============================================================
function criarEvento(data, confirmId) {
  const inicio = inicioDaVistoria(data);
  const fim    = new Date(inicio.getTime() + VISIT_MS);
  const presente = data.presence === 'yes';
  const titulo = 'Vistoria - ' + data.unitName + (presente ? ' · PP presente' : '');
  const confirmLink = SCRIPT_URL + '?action=confirmar&id=' + confirmId;

  // Presença e recado do PP ficam só aqui (não vão para o ticket do HubSpot)
  const linhas = [
    (presente ? '👤 O PROPRIETÁRIO ESTARÁ PRESENTE' : '🏠 Proprietário não estará presente'),
    data.notes ? '📝 Recado do proprietário: ' + data.notes : null,
    '',
    'Proprietário: ' + data.ownerName,
    'Tel: ' + data.ownerPhone,
    'E-mail: ' + data.ownerEmail,
    'Unidade: ' + data.unitName,
    data.address ? 'Endereço: ' + data.address : null,
    data.accessInfo ? 'Acesso: ' + data.accessInfo : null,
    'Vistoriador: ' + data.inspector,
    'Tipo: ' + (data.visitType || ''),
    'HubSpot: https://app.hubspot.com/contacts/50709614/record/0-5/' + data.hubspotTicketId,
    '',
    '✅ Confirmar vistoria realizada:',
    confirmLink
  ];
  const desc = linhas.filter(function (l) { return l !== null; }).join('\n');

  const guests = [data.inspectorEmail, data.ownerEmail].filter(Boolean);

  const cal = getCalendar();
  const evento = cal.createEvent(titulo, inicio, fim, {
    description: desc,
    guests: guests.join(','),
    sendInvites: true
  });

  const localDesc = 'Deslocamento para: ' + titulo;
  cal.createEvent('🚗 Deslocamento — pré-vistoria', new Date(inicio.getTime() - BUFFER_MS), inicio, { description: localDesc });
  cal.createEvent('🚗 Deslocamento — pós-vistoria', fim, new Date(fim.getTime() + BUFFER_MS), { description: localDesc });

  return evento.getId();
}

// ============================================================
// TENTATIVAS BLOQUEADAS — loga conflitos numa aba separada
// ============================================================
function registrarTentativa(data, motivo) {
  try {
    const ss  = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName('Tentativas bloqueadas');
    if (!sheet) {
      sheet = ss.insertSheet('Tentativas bloqueadas');
      const headers = [
        'Data da tentativa', 'Proprietário', 'Telefone', 'E-mail',
        'Edifício', 'Unidade', 'Data tentada', 'Horário tentado',
        'Vistoriador/a', 'Motivo', 'HubSpot Ticket ID'
      ];
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#CE6363').setFontColor('white');
    }
    sheet.appendRow([
      Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm'),
      data.ownerName, data.ownerPhone, data.ownerEmail,
      '', data.unitName,
      data.visitDate || data.dateISO, data.timeStr,
      data.inspector, motivo || 'Conflito de horário', data.hubspotTicketId
    ]);
  } catch (err) {
    console.error('Erro ao registrar tentativa:', err);
  }
}

// ============================================================
// UTILITÁRIOS
// ============================================================
function getCalendar() {
  return CalendarApp.getCalendarById(CALENDAR_ID) || CalendarApp.getDefaultCalendar();
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function alertarAdmin(assunto, corpo) {
  try { MailApp.sendEmail({ to: ADMIN_EMAIL, subject: assunto, body: corpo }); }
  catch (mailErr) { console.error('Falha ao enviar e-mail de alerta:', mailErr); }
}

// Rode no editor para testar o fluxo completo (cria evento real na agenda!)
function testar() {
  const data = normalizar({
    hubspotTicketId: '49623137077',
    ownerName: 'Proprietário Teste',
    ownerPhone: '(11) 99999-9999',
    ownerEmail: 'maiara.pereira@yuca.live',
    unitName: 'Edifício Teste — Apto 42',
    visitType: 'Unidade pronta para Gestão Yuca',
    dateISO: '2026-12-01',
    visitDate: 'Terça-feira, 1 de dezembro de 2026',
    timeStr: '09:00',
    inspector: 'Ariene Saldanha Rosa',
    inspectorHubspot: 'Ariene Saldanha',
    inspectorEmail: 'asaldanharosa@gmail.com',
    presence: 'no',
    presenceLabel: 'Não estarei presente',
    notes: 'Teste'
  });
  const confirmId = Utilities.getUuid();
  const eventId = criarEvento(data, confirmId);
  const linha = registrarNaPlanilha(data, confirmId);
  marcarSync(linha, notificarMake('vistoria_agendada', payloadAgendamento(data, inicioDaVistoria(data), confirmId, eventId)));
}

// Rode no editor para mandar só o JSON de exemplo ao Make (útil para o "Redetermine data structure")
function testarSomenteMake() {
  const data = normalizar({
    hubspotTicketId: '49623137077', ownerName: 'Proprietário Teste', ownerPhone: '(11) 99999-9999',
    ownerEmail: 'teste@yuca.live', unitName: 'Edifício Teste — Apto 42', visitType: 'Unidade pronta para Gestão Yuca', dateISO: '2026-12-01',
    visitDate: 'Terça-feira, 1 de dezembro de 2026', timeStr: '09:00', inspector: 'Ariene Saldanha Rosa',
    inspectorHubspot: 'Ariene Saldanha', inspectorEmail: 'asaldanharosa@gmail.com', presence: 'yes',
    presenceLabel: 'Estarei presente', notes: 'Teste'
  });
  console.log(notificarMake('vistoria_agendada', payloadAgendamento(data, inicioDaVistoria(data), 'teste', 'teste')));
}

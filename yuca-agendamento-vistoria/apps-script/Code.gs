// ============================================================
// GOOGLE APPS SCRIPT — Agendamento de Vistoria PP (fluxo HubSpot)
// Projeto NOVO e independente: não substitui o Apps Script do formulário antigo.
//
// Como instalar (passo a passo no README):
//   1. script.google.com → Novo projeto → cole este código
//   2. Configurações do projeto → Fuso horário: (GMT-03:00) São Paulo
//   3. Rode a função setup() uma vez e autorize (cria a planilha e checa a agenda)
//   4. Implantar → Nova implantação → App da Web
//        Executar como: Eu · Quem pode acessar: Qualquer pessoa
//   5. Cole a URL /exec em assets/js/config.js (appsScriptUrl)
//
// Propriedades do script (Configurações do projeto → Propriedades do script):
//   MAKE_WEBHOOK_URL  URL do Custom Webhook do Make          (obrigatória para o HubSpot)
//   CALENDAR_ID       agenda de vistorias                     (padrão: a mesma do fluxo antigo)
//   SHEET_ID          planilha de registros                   (criada pelo setup())
//   ADMIN_EMAIL       quem recebe alertas de erro             (padrão: maiara.pereira@yuca.live)
// ============================================================

// Mesma agenda do fluxo antigo: os dois formulários enxergam os mesmos horários ocupados
const DEFAULT_CALENDAR_ID = 'c_2adaf9b416417c6a87b4cfc9f9c98f4902997aae2fddaa86c8cbd26fc90ec0f4@group.calendar.google.com';
const DEFAULT_ADMIN_EMAIL = 'maiara.pereira@yuca.live';
const SHEET_NAME = 'Agendamentos';
const TZ = 'America/Sao_Paulo';
const HUBSPOT_TICKET_URL = 'https://app.hubspot.com/contacts/50709614/record/0-5/';

const VISIT_MS  = 60 * 60 * 1000; // duração da vistoria: 1h
const BUFFER_MS = 60 * 60 * 1000; // deslocamento: 1h antes e 1h depois

const HEADERS = [
  'Data do envio', 'HubSpot Ticket ID', 'Proprietário', 'Telefone', 'E-mail do proprietário',
  'Unidade', 'Data da vistoria', 'Horário', 'Vistoriador/a', 'E-mail do vistoriador',
  'Presença do proprietário', 'Recado', 'Status', 'Confirmada em', 'ID', 'Sync HubSpot'
];

// ============================================================
// SETUP — rode uma vez no editor
// ============================================================
function setup() {
  const props = PropertiesService.getScriptProperties();

  let sheetId = props.getProperty('SHEET_ID');
  if (!sheetId) {
    const ss = SpreadsheetApp.create('Agendamento de Vistoria PP — HubSpot');
    ss.getSheets()[0].setName(SHEET_NAME);
    sheetId = ss.getId();
    props.setProperty('SHEET_ID', sheetId);
  }
  const sheet = getSheet();
  console.log('Planilha: https://docs.google.com/spreadsheets/d/' + sheetId + ' (aba "' + sheet.getName() + '")');

  const cal = getCalendar(); // lança erro se não houver acesso
  console.log('Agenda OK: ' + cal.getName());

  if (!props.getProperty('MAKE_WEBHOOK_URL')) {
    console.warn('Falta a propriedade MAKE_WEBHOOK_URL — sem ela o agendamento funciona, mas o HubSpot não é atualizado.');
  }
  console.log('URL do Web App (depois de implantar): ' + (ScriptApp.getService().getUrl() || 'ainda não implantado'));
}

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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.dateISO) || !/^\d{2}:\d{2}$/.test(data.timeStr)) {
      return json({ status: 'error', message: 'Data ou horário inválido.' });
    }

    const inicio = inicioDaVistoria(data);
    const fim    = new Date(inicio.getTime() + VISIT_MS);
    const conflitos = getCalendar().getEvents(new Date(inicio.getTime() - BUFFER_MS), new Date(fim.getTime() + BUFFER_MS));
    if (conflitos.length > 0) {
      return json({
        status: 'conflict',
        message: 'Este horário acabou de ser reservado por outra pessoa. Por favor, escolha outro horário.'
      });
    }

    const confirmId = Utilities.getUuid();
    const eventId   = criarEvento(data, inicio, fim, confirmId);
    const linha     = registrarNaPlanilha(data, confirmId);
    marcarSync(linha, notificarMake('vistoria_agendada', payloadAgendamento(data, inicio, confirmId, eventId)));

    return json({ status: 'ok' });
  } catch (err) {
    console.error('Erro:', err);
    alertarAdmin('⚠️ Erro no agendamento de vistoria (fluxo HubSpot)',
      'Houve um erro ao processar um agendamento.\n\n'
      + 'Proprietário: ' + (data.ownerName || '?') + '\n'
      + 'Unidade: ' + (data.unitName || '?') + '\n'
      + 'HubSpot Ticket ID: ' + (data.hubspotTicketId || '?') + '\n'
      + 'Data/horário tentado: ' + (data.visitDate || data.dateISO || '?') + ' às ' + (data.timeStr || '?') + '\n\n'
      + 'Erro: ' + err.toString() + '\n\n'
      + 'Verifique se o evento foi criado na agenda, se foi registrado na planilha e se o ticket foi atualizado no HubSpot.');
    return json({ status: 'error', message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function normalizar(p) {
  const d = {};
  Object.keys(p).forEach(function (k) { d[k] = String(p[k] || '').trim(); });
  d.hubspotTicketId = (d.hubspotTicketId || '').replace(/\D/g, '');
  d.dateISO = d.dateISO || '';
  d.timeStr = d.timeStr || d.visitTime || '';
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
      link_confirmacao: linkConfirmacao(confirmId)
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

  const sheet = getSheet();
  if (sheet.getLastRow() < 2) return HtmlService.createHtmlOutput('<p>Agendamento não encontrado.</p>');

  const col = mapaColunas(sheet);
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
        <div><strong>Unidade:</strong> ${esc(cell('Unidade'))}</div>
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
// PLANILHA
// ============================================================
function registrarNaPlanilha(data, confirmId) {
  const sheet = getSheet();
  const valores = {
    'Data do envio': Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm'),
    'HubSpot Ticket ID': data.hubspotTicketId,
    'Proprietário': data.ownerName,
    'Telefone': data.ownerPhone,
    'E-mail do proprietário': data.ownerEmail,
    'Unidade': data.unitName,
    'Data da vistoria': data.visitDate || data.dateISO,
    'Horário': data.timeStr,
    'Vistoriador/a': data.inspector,
    'E-mail do vistoriador': data.inspectorEmail,
    'Presença do proprietário': data.presenceLabel,
    'Recado': data.notes,
    'Status': 'Agendada',
    'Confirmada em': '',
    'ID': confirmId,
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

// Abre a aba de registros, criando a aba e os cabeçalhos que faltarem
function getSheet() {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) throw new Error('Rode setup() no editor antes de usar (falta SHEET_ID).');
  const ss = SpreadsheetApp.openById(sheetId);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  const existentes = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : [];
  const faltando = HEADERS.filter(function (h) { return existentes.indexOf(h) === -1; });
  if (faltando.length) {
    sheet.getRange(1, existentes.filter(String).length + 1, 1, faltando.length).setValues([faltando]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold').setBackground('#005956').setFontColor('white');
  }
  return sheet;
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
function criarEvento(data, inicio, fim, confirmId) {
  const presente = data.presence === 'yes';
  const titulo = 'Vistoria - ' + (data.unitName || 'unidade') + (presente ? ' · PP presente' : '');

  // Presença e recado do PP ficam só aqui (não vão para o ticket do HubSpot)
  const linhas = [
    presente ? '👤 O PROPRIETÁRIO ESTARÁ PRESENTE' : '🏠 Proprietário não estará presente',
    data.notes ? '📝 Recado do proprietário: ' + data.notes : null,
    '',
    'Proprietário: ' + data.ownerName,
    'Tel: ' + data.ownerPhone,
    'E-mail: ' + data.ownerEmail,
    'Unidade: ' + data.unitName,
    data.address ? 'Endereço: ' + data.address : null,
    'Vistoriador: ' + data.inspector,
    'Tipo: ' + (data.visitType || ''),
    'HubSpot: ' + HUBSPOT_TICKET_URL + data.hubspotTicketId,
    '',
    '✅ Confirmar vistoria realizada:',
    linkConfirmacao(confirmId)
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
// UTILITÁRIOS
// ============================================================
// Falha de propósito se a conta não tiver acesso à agenda: cair na agenda pessoal
// faria o formulário mostrar horários livres que na verdade estão ocupados.
function getCalendar() {
  const id = PropertiesService.getScriptProperties().getProperty('CALENDAR_ID') || DEFAULT_CALENDAR_ID;
  const cal = CalendarApp.getCalendarById(id);
  if (!cal) throw new Error('Sem acesso à agenda ' + id + '. Peça para compartilharem com permissão "Fazer alterações nos eventos".');
  return cal;
}

function linkConfirmacao(confirmId) {
  return ScriptApp.getService().getUrl() + '?action=confirmar&id=' + confirmId;
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
  const to = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL') || DEFAULT_ADMIN_EMAIL;
  try { MailApp.sendEmail({ to: to, subject: assunto, body: corpo }); }
  catch (mailErr) { console.error('Falha ao enviar e-mail de alerta:', mailErr); }
}

// Rode no editor para mandar só o JSON de exemplo ao Make (útil para o "Redetermine data structure").
// Não cria evento nem linha na planilha.
function testarSomenteMake() {
  const data = normalizar({
    hubspotTicketId: '49623137077', ownerName: 'Proprietário Teste', ownerPhone: '(11) 99999-9999',
    ownerEmail: 'teste@yuca.live', unitName: 'Edifício Teste — Apto 42', visitType: 'Unidade pronta para Gestão Yuca',
    dateISO: '2026-12-01', visitDate: 'Terça-feira, 1 de dezembro de 2026', timeStr: '09:00',
    inspector: 'Ariene Saldanha Rosa', inspectorHubspot: 'Ariene Saldanha', inspectorEmail: 'asaldanharosa@gmail.com',
    presence: 'yes', presenceLabel: 'Estarei presente', notes: 'Teste'
  });
  console.log(notificarMake('vistoria_agendada', payloadAgendamento(data, inicioDaVistoria(data), 'teste', 'teste')));
}

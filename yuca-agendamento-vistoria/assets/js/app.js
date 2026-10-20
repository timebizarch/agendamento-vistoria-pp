/* ============================================================
   Agendamento de Vistoria — Yuca
   Os dados do proprietário e da unidade chegam pelo link (Make → HubSpot)
   e não aparecem para edição. O PP vê o vistoriador e escolhe
   presença, data e horário.
   ============================================================ */
const CONFIG = window.CONFIG;

/* ── STATE ───────────────────────────────────────────────── */
const TOTAL_STEPS = 4; // a etapa 5 é a tela de concluído
const STEP_DATE = 2, STEP_TIME = 3, STEP_REVIEW = 4, STEP_DONE = 5;
const S = {
    step: 1,
    hubspotTicketId: '',
    ownerName: '', ownerPhone: '', ownerEmail: '', unitName: '', address: '',
    presence: '', notes: '',
    selectedInspector: CONFIG.inspectors[0],
    selectedDate: null, selectedTime: null,
    monthOffset: 0, busyTimes: [],
    submitting: false,
};

const BTN = ['Escolher data', 'Próximo', 'Revisar agendamento', '', ''];
const MO  = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MOL = MO.map(m => m.toLowerCase());
const MOS = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const DNL = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];

const ICONS = {
    user:  '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
    cal:   '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    home:  '<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>',
    eye:   '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    note:  '<svg viewBox="0 0 24 24"><path d="M5 3h10l4 4v14H5z"/><path d="M9 12h6M9 16h6"/></svg>',
};

/* ── HELPERS ─────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const v = id => ($(id)?.value || '').trim();

// Tudo que vem da URL é escapado antes de ir para o HTML
function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function formatPhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
    if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
    return String(raw || '').trim();
}

function whatsappUrl(text) {
    return `https://wa.me/${CONFIG.support.whatsapp}?text=${encodeURIComponent(text)}`;
}

function dateISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function dateLong(d) { return `${DNL[d.getDay()]}, ${d.getDate()} de ${MOL[d.getMonth()]} de ${d.getFullYear()}`; }

/* ── INIT ────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    const p = new URLSearchParams(window.location.search);
    const get = key => (p.get(CONFIG.urlParams[key]) || '').trim();

    S.hubspotTicketId = get('hubspotId').replace(/\D/g, '');
    S.ownerName  = get('name');
    S.ownerPhone = formatPhone(get('phone'));
    S.ownerEmail = get('email');
    S.unitName   = get('unit');
    S.address    = get('address');

    $('supportName').textContent = CONFIG.support.name;
    $('supportLink').textContent = CONFIG.support.phoneLabel;
    $('supportLink').href = whatsappUrl('Olá! Tenho uma dúvida sobre o agendamento da vistoria da minha unidade.');

    if (!S.hubspotTicketId) { showInvalid(); return; }

    const firstName = S.ownerName.split(/\s+/)[0];
    if (firstName) $('greeting').textContent = `Olá, ${firstName}! Vamos agendar sua vistoria`;
    if (S.unitName) $('unitLead').textContent = `Unidade ${S.unitName}. Seus dados e os da unidade já estão com a gente — falta só escolher o melhor dia e horário.`;

    renderInspectorInfoCard();
    goTo(1);
});

function showInvalid() {
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    $('step-invalid').classList.add('active');
    $('nav').style.display = 'none';
    $('progressBar').style.display = 'none';
    $('bottomBar').style.display = 'none';
    $('invalidContact').href = whatsappUrl('Olá! Recebi um link de agendamento de vistoria que não está funcionando.');
}

/* ── VISTORIADOR / PRESENÇA ──────────────────────────────── */
function renderInspectorInfoCard() {
    const insp = S.selectedInspector;
    const card = $('inspectorInfoCard');
    if (!insp) { card.style.display = 'none'; return; }
    card.innerHTML = `
        <div class="inspector-label">Seu vistoriador(a)</div>
        <div class="inspector-row">
            <div class="inspector-avatar">${esc(insp.initials)}</div>
            <div>
                <div class="inspector-name">${esc(insp.name)}</div>
                <div class="inspector-role">${esc(insp.role)}</div>
            </div>
        </div>
        <p class="inspector-msg">Os dados para liberação na portaria aparecem ao final do agendamento.</p>
    `;
    card.style.display = 'block';
}

function selectPresence(val) {
    S.presence = val;
    [['pres-yes', 'yes'], ['pres-no', 'no']].forEach(([id, key]) => {
        const on = key === val;
        $(id).classList.toggle('is-selected', on);
        $(id).setAttribute('aria-checked', on);
    });
}

/* ── NAVIGATION ──────────────────────────────────────────── */
async function goNext() {
    if (!validate(S.step)) return;
    const next = S.step + 1;
    if (next === STEP_DATE) { renderSum('summaryCard'); renderMonth(); }
    if (next === STEP_TIME) { await openTimeStep(); return; }
    if (next === STEP_REVIEW) renderReview();
    goTo(next);
}

function goBack() { if (S.step > 1 && S.step <= TOTAL_STEPS) goTo(S.step - 1); }

function goTo(n) {
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    S.step = n;
    $('step-' + n).classList.add('active');
    renderProgress();
    updateBtn();
    window.scrollTo(0, 0);
    $('bottomBar').style.display = n >= STEP_REVIEW ? 'none' : '';
}

async function openTimeStep() {
    renderSum('summaryCard3');
    updateDateLabel();
    $('conflictBanner').innerHTML = '';
    goTo(STEP_TIME);
    await loadSlots();
}

function openEdit()  { $('editOverlay').classList.add('open'); }
function closeEdit() { $('editOverlay').classList.remove('open'); }
async function goToEdit(step) {
    closeEdit();
    if (step === STEP_TIME) { await openTimeStep(); return; }
    if (step === STEP_DATE) { renderSum('summaryCard'); renderMonth(); }
    goTo(step);
}

/* ── VALIDATION ──────────────────────────────────────────── */
function validate(step) {
    if (step === 1) {
        if (!S.presence) { toast('Conte se você vai estar presente.'); return false; }
        S.notes = v('notes');
    }
    if (step === STEP_DATE && !S.selectedDate) { toast('Selecione uma data.'); return false; }
    if (step === STEP_TIME && !S.selectedTime) { toast('Selecione um horário.'); return false; }
    return true;
}

function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2400);
}

/* ── PROGRESS ────────────────────────────────────────────── */
function renderProgress() {
    $('progressBar').innerHTML = Array.from({ length: TOTAL_STEPS },
        (_, i) => `<div class="progress-step ${i < S.step ? 'done' : ''}"></div>`).join('');
    $('btnBack').style.visibility = S.step === 1 || S.step > TOTAL_STEPS ? 'hidden' : 'visible';
    $('navStep').textContent = S.step <= TOTAL_STEPS ? `${S.step} de ${TOTAL_STEPS}` : '';
}

function updateBtn() {
    const btn = $('btnNext');
    btn.textContent = BTN[S.step - 1] || 'Próximo';
    btn.disabled = (S.step === STEP_DATE && !S.selectedDate) || (S.step === STEP_TIME && !S.selectedTime);
}

/* ── MONTH CALENDAR ──────────────────────────────────────── */
function changeMonth(dir) {
    const next = S.monthOffset + dir;
    if (next < 0 || next > CONFIG.maxMonthsAhead) return;
    S.monthOffset = next;
    renderMonth();
}

function renderMonth() {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth() + S.monthOffset, 1);
    const year = target.getFullYear(), month = target.getMonth();

    $('monthLabel').textContent = MO[month] + ' ' + year;
    $('btnPrevMonth').disabled = S.monthOffset <= 0;
    $('btnNextMonth').disabled = S.monthOffset >= CONFIG.maxMonthsAhead;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const minDate = new Date(today); minDate.setDate(today.getDate() + CONFIG.minAdvanceDays);
    const lastDay = new Date(year, month + 1, 0).getDate();
    const offset = (new Date(year, month, 1).getDay() + 6) % 7; // semana começa na segunda

    const grid = $('calGrid');
    grid.innerHTML = '';
    for (let i = 0; i < offset; i++) {
        const e = document.createElement('div');
        e.className = 'cal-day empty';
        grid.appendChild(e);
    }
    for (let day = 1; day <= lastDay; day++) {
        const date = new Date(year, month, day);
        const available = CONFIG.workingDays.includes(date.getDay()) && date >= minDate;
        const isSelected = S.selectedDate && date.toDateString() === S.selectedDate.toDateString();

        const cell = document.createElement('div');
        cell.className = 'cal-day'
            + (isSelected ? ' selected' : '')
            + (date.toDateString() === today.toDateString() ? ' today' : '')
            + (available ? '' : ' disabled');
        cell.textContent = day;
        if (available) cell.onclick = () => selectDate(date);
        grid.appendChild(cell);
    }
}

function selectDate(date) {
    S.selectedDate = date;
    S.selectedTime = null;
    renderMonth();
    updateBtn();
}

/* ── TIME SLOTS ──────────────────────────────────────────── */
function updateDateLabel() {
    const d = S.selectedDate;
    if (d) $('selectedDateLabel').textContent = `${DNL[d.getDay()]}, ${d.getDate()} de ${MOS[d.getMonth()]}`;
}

async function loadSlots() {
    $('timesContainer').innerHTML = '<div class="loading"><div class="spinner"></div>Verificando disponibilidade...</div>';
    S.busyTimes = [];
    try {
        const res = await fetch(`${CONFIG.appsScriptUrl}?date=${dateISO(S.selectedDate)}`);
        const data = await res.json();
        S.busyTimes = data.busy || [];
    } catch (e) { console.warn('Erro ao buscar horários ocupados:', e); }
    renderSlots();
}

function isBusy(h, m) {
    const s = new Date(S.selectedDate); s.setHours(h, m, 0, 0);
    const e = new Date(s); e.setMinutes(s.getMinutes() + CONFIG.slotDuration);
    return S.busyTimes.some(b => s < new Date(b.end) && e > new Date(b.start));
}

function renderSlots() {
    const c = $('timesContainer');
    const { start, end } = CONFIG.workingHours;
    const slots = [];
    for (let h = start; h < end; h++) for (let m = 0; m < 60; m += CONFIG.slotDuration) slots.push({ h, m });
    if (S.selectedTime && isBusy(...S.selectedTime.split(':').map(Number))) S.selectedTime = null;
    if (!slots.some(({ h, m }) => !isBusy(h, m))) {
        c.innerHTML = '<div class="no-slots">Todos os horários deste dia estão ocupados.<br>Por favor, volte e escolha outra data.</div>';
        updateBtn();
        return;
    }
    c.innerHTML = '<div class="times-grid">' + slots.map(({ h, m }) => {
        const t = pad(h) + ':' + pad(m);
        const busy = isBusy(h, m), sel = S.selectedTime === t;
        return `<div class="time-chip${busy ? ' busy' : ''}${sel ? ' selected' : ''}"${busy ? '' : ` onclick="selectTime('${t}')"`}>${t}</div>`;
    }).join('') + '</div>';
    updateBtn();
}

function selectTime(t) { S.selectedTime = t; renderSlots(); }

/* ── SUMMARY / REVIEW ────────────────────────────────────── */
function renderSum(id) {
    $(id).innerHTML = `
        ${S.unitName ? `<div class="summary-row"><span class="summary-label">Unidade:</span> ${esc(S.unitName)}</div>` : ''}
        <div class="summary-row"><span class="summary-label">Vistoriador(a):</span> ${esc(S.selectedInspector.name)}</div>
    `;
}

function presenceText() {
    return S.presence === 'yes' ? 'Estarei presente' : S.presence === 'no' ? 'Não estarei presente' : 'Não informado';
}

function reviewRow(icon, label, value) {
    return `<div class="review-row"><div class="review-icon">${ICONS[icon]}</div><div><div class="review-label">${label}</div><div class="review-value">${esc(value)}</div></div></div>`;
}

function renderReview() {
    const d = S.selectedDate;
    $('reviewDetails').innerHTML = [
        S.unitName ? reviewRow('home', 'Unidade', S.unitName) : '',
        reviewRow('cal',   'Data', dateLong(d)),
        reviewRow('clock', 'Horário', S.selectedTime + 'h'),
        reviewRow('user',  'Vistoriador(a)', S.selectedInspector.name),
        reviewRow('eye',   'Presença', presenceText()),
        S.notes ? reviewRow('note', 'Recado para o vistoriador', S.notes) : '',
    ].join('');
}

/* ── SUBMIT ──────────────────────────────────────────────── */
function buildPayload() {
    const d = S.selectedDate;
    const insp = S.selectedInspector;
    return {
        hubspotTicketId: S.hubspotTicketId,
        ownerName: S.ownerName, ownerPhone: S.ownerPhone, ownerEmail: S.ownerEmail,
        unitName: S.unitName, address: S.address,
        visitType: CONFIG.visitType,
        dateISO: dateISO(d), timeStr: S.selectedTime,
        visitDate: dateLong(d), visitTime: S.selectedTime,
        inspector: insp.name, inspectorHubspot: insp.hubspotValue || insp.name, inspectorEmail: insp.email,
        presence: S.presence, presenceLabel: presenceText(),
        notes: S.notes,
    };
}

async function confirmAgendamento() {
    if (S.submitting) return;
    S.submitting = true;
    const btn = $('btnConfirm');
    btn.disabled = true;
    btn.textContent = 'Enviando...';

    const payload = buildPayload();
    let result;

    // 1. Apps Script: checa conflito, cria evento, grava planilha e repassa ao Make → HubSpot
    try {
        const res = await fetch(CONFIG.appsScriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(payload).toString(),
        });
        result = await res.json();
    } catch (e) {
        console.warn('Apps Script error:', e);
        result = { status: 'error' };
    }

    S.submitting = false;
    btn.disabled = false;
    btn.textContent = 'Confirmar agendamento';

    if (result.status === 'conflict') { showConflictError(result.message); return; }
    if (result.status === 'error') { toast('Não conseguimos concluir o agendamento. Tente novamente em instantes.'); return; }

    // 2. Netlify Forms (backup das respostas)
    try {
        await fetch('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ 'form-name': 'agendamento-vistoria', 'bot-field': '', ...payload }).toString(),
        });
    } catch (e) { console.warn('Netlify form error:', e); }

    renderDone();
    goTo(STEP_DONE);
}

function showConflictError(msg) {
    S.selectedTime = null;
    goTo(STEP_TIME);
    $('conflictBanner').innerHTML = `<div class="callout callout--error"><strong>Horário indisponível:</strong> ${esc(msg)}</div>`;
    loadSlots();
}

function renderDone() {
    const d = S.selectedDate;
    const insp = S.selectedInspector;
    $('doneSubtitle').textContent = `Sua vistoria está marcada para ${dateLong(d).toLowerCase()}, às ${S.selectedTime}h. Libere a entrada da vistoriadora com os dados abaixo:`;
    const rows = [
        ['RG', insp.rg], ['CPF', insp.cpf], ['Data de nascimento', insp.dob], ['Telefone', insp.phone],
    ].filter(([, val]) => val).map(([k, val]) => `<div class="liberation-row"><strong>${k}:</strong> ${esc(val)}</div>`).join('');
    $('liberationCard').innerHTML = `
        <div class="liberation-kicker">Dados da vistoriadora</div>
        <div class="liberation-name">${esc(insp.name)}</div>
        ${rows}
    `;
}

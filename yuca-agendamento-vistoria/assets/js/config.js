/* ============================================================
   CONFIGURAÇÃO — edite aqui sem mexer na lógica (app.js)
   ============================================================ */
window.CONFIG = {
    // Web App do Google Apps Script (agenda + planilha + repasse ao Make/HubSpot)
    appsScriptUrl: 'https://script.google.com/macros/s/AKfycbwlC-Lqw4EZ8ekGuqdI7awLJzg2-qJbSLjinZM29vrvrCf7lNkz30aYqo0y_M7KFQGn/exec',

    // Nomes dos parâmetros que o Make coloca no link enviado ao proprietário.
    // Ex.: https://SEU-SITE.netlify.app/?hs_id=123&nome=Ana%20Silva&telefone=11999999999&email=ana%40x.com&unidade=Ed.%20Solar%20-%2042
    urlParams: {
        hubspotId: 'hs_id',
        name: 'nome',
        phone: 'telefone',
        email: 'email',
        unit: 'unidade',
        address: 'endereco', // opcional — não aparece na tela, só vai para a descrição do evento na agenda
    },

    inspectors: [
        {
            name: 'Ariene Saldanha Rosa',
            hubspotValue: 'Ariene Saldanha', // valor interno da opção em "Vistoriador Responsável" (vistoriador_responsavel_onb)
            initials: 'AS',
            role: 'Vistoriadora / Fotógrafa',
            email: 'asaldanharosa@gmail.com',
            phone: '(11) 91325-1682',
            rg: '39.757.431-9',
            cpf: '480.999.318-31',
            dob: '22/04/1997',
        },
    ],

    support: {
        name: 'Mai',
        phoneLabel: '(11) 98933-0167',
        whatsapp: '5511989330167',
    },

    visitType: 'Unidade pronta para Gestão Yuca',
    workingDays: [1, 2, 3, 4, 5],          // seg a sex
    workingHours: { start: 9, end: 17 },   // 1º horário 09:00 · último 16:00 (fim do expediente 17h)
    slotDuration: 60,                      // minutos
    minAdvanceDays: 1,                     // a partir de amanhã
    maxMonthsAhead: 3,
};

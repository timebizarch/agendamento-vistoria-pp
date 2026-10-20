# Levantamento — o que o formulário preenche e onde isso vai no HubSpot

## 1. Como o formulário funcionava antes

Hoje (versão antiga no Netlify) **não existe nenhuma integração com o HubSpot** — nem nas fórmulas, nem no código. Cada envio vai para dois lugares:

| Destino | O que faz |
|---|---|
| **Google Apps Script** (`doPost`) | Checa conflito na agenda (com 1h de deslocamento antes/depois), cria o evento no Google Calendar com convite para vistoriadora + proprietário, cria os 2 eventos de deslocamento e grava uma linha na planilha `Agendamento de vistoria`. Conflitos vão para a aba `Tentativas bloqueadas`. |
| **Apps Script** (`doGet ?date=`) | Devolve os horários ocupados do dia para o calendário do formulário. |
| **Apps Script** (`?action=confirmar`) | Link no evento para a vistoriadora marcar "Confirmada ✓" na planilha. |
| **Netlify Forms** | Cópia de backup de todas as respostas. |

Campos coletados na versão antiga: nome, telefone, e-mail, edifício, unidade, endereço, senha/liberação, tipo de vistoria (fixo), presença + observações (juntos num texto só), data, horário e vistoriador (fixo: Ariene).

Também havia 3 bugs, corrigidos nesta versão:
1. Quando dava **conflito de horário**, a tela pulava para "Agendamento concluído" mesmo assim (o `goTo(7)` rodava depois do `return`), e a função `goToStep` chamada no aviso nem existia.
2. No `doPost` do Apps Script, `data` era declarado dentro do `try`, então o e-mail de alerta do `catch` quebrava.
3. Duas pessoas confirmando o mesmo horário ao mesmo tempo podiam passar as duas (agora há `LockService`).

## 2. Nova dinâmica

```
HubSpot (ticket em [CS] Onboarding Unidades › "Agendamento vistoria")
   │  Make monta o link com as variáveis do ticket
   ▼
https://SEU-SITE/?hs_id={{ticket id}}&nome=…&telefone=…&email=…&unidade=…
   │  PP vê quem é o vistoriador e escolhe presença, data e horário
   ▼
Apps Script ── agenda (com presença + recado na descrição) + planilha
   │  POST JSON  (só depois que o horário foi reservado com sucesso)
   ▼
Make (Custom Webhook) ── HubSpot › Update a ticket {{hubspot_ticket_id}}
                         data+hora, vistoriador e fase "Vistoria agendada"
```

Telas do formulário: **1.** vistoriador + presença (obrigatória) + recado opcional → **2.** data → **3.** horário → **4.** revisão → concluído (dados da vistoriadora para liberar a portaria).

Nome, telefone, e-mail, unidade, endereço e acesso **não aparecem nem são pedidos** — já estão no ticket. Os que chegam pelo link servem só para a saudação ("Olá, Ana!"), para o convite do Google Agenda e para a descrição do evento.

Por que o Apps Script avisa o Make (e não o navegador direto): o HubSpot só é atualizado quando o horário foi **de fato** reservado, a URL do webhook não fica exposta no código público e, se o Make falhar, a Maiara recebe um e-mail com o JSON para reprocessar (coluna `Sync HubSpot` da planilha mostra `OK` / `Falhou`).

## 3. Variáveis do link (Make → formulário)

| Parâmetro | Origem no HubSpot | Obrigatório | Uso |
|---|---|---|---|
| `hs_id` | ID do ticket (`hs_object_id`) | **Sim** — sem ele o link mostra "Link incompleto" | identifica o ticket a atualizar |
| `nome` | `nome_proprietario` | sim | saudação + evento na agenda |
| `telefone` | `telefone_proprietario` (aceita `+5511…`) | sim | evento na agenda |
| `email` | `email_proprietario` | sim | convite do Google Agenda para o PP |
| `unidade` | `unidade` | sim | título do evento + resumo na tela |
| `endereco` | `endereco` | opcional | só na descrição do evento (para o vistoriador) |

No Make, monte cada valor com `encodeURL()`:

```
https://SEU-SITE.netlify.app/?hs_id={{1.hs_object_id}}&nome={{encodeURL(1.nome_proprietario)}}&telefone={{encodeURL(1.telefone_proprietario)}}&email={{encodeURL(1.email_proprietario)}}&unidade={{encodeURL(1.unidade)}}&endereco={{encodeURL(1.endereco)}}
```

> Senha/forma de acesso **não** deve ir no link (fica no histórico do navegador). Se o vistoriador precisar dela na agenda, o Make pode completar o evento depois: o JSON traz `contexto.calendar_event_id` → módulo *Google Calendar › Update an event* com `infos_de_acesso_ao_predio_e_a_s_unidade_s` lido do ticket.

## 4. Respostas → ticket

Pipeline: **[CS] Onboarding Unidades** (`917642392`). As chaves do objeto `hubspot` no JSON já são os nomes internos — mapeie 1 para 1 no *Update a Ticket*.

| Dado | Propriedade do ticket | Valor enviado |
|---|---|---|
| Data **e horário** escolhidos | `data_da_vistoria_de_recebimento` | epoch em ms (ex.: `1796126400000` = 01/12/2026 09:00 BRT) — **exige a propriedade como "Data e hora"** |
| Vistoriador(a) | `vistoriador_responsavel_onb` | `Ariene Saldanha` (enumeração) |
| E-mail do vistoriador | `email_vistoriador` | texto |
| (fase do card) | `hs_pipeline_stage` | `1398907464` "Vistoria agendada" — definir no Make |

**Presença e recado não vão para o ticket** — ficam no topo da descrição do evento no Google Agenda (e o título ganha "· PP presente" quando ele vai estar lá), além da planilha. Se um dia quiserem no card, estão em `contexto.presenca` e `contexto.recado` no JSON.

Outros extras no `contexto`: `data_hora_iso` (`2026-12-01T09:00:00-03:00`), `data_extenso`, `calendar_event_id`, `link_confirmacao`.

### Pontos de atenção
- **Converter a propriedade para data+hora antes de ligar o Make.** Enquanto ela for só "Data", o HubSpot recusa um valor com horário (date só aceita meia-noite UTC). Se precisar ligar antes, use no Make `{{formatDate(contexto.data_hora_iso; "YYYY-MM-DD")}}`.
- **`data_da_vistoria_de_recebimento` dispara notificação ao PP.** A descrição da propriedade diz: *"Ao preencher esse campo, o PP será notificado sobre a data agendada."* Como agora quem preenche é o próprio PP (e ele ainda recebe o convite da agenda), vale decidir se esse workflow continua ou ganha um filtro. Ao trocar o tipo para data+hora, revise também os filtros/ações desse workflow.
- `vistoriador_responsavel_onb` é enumeração: o valor enviado tem que bater exatamente com a opção (`Ariene Saldanha`). Para um novo vistoriador, crie a opção no HubSpot e preencha `hubspotValue` em `assets/js/config.js`.

## 5. Evento extra: vistoria realizada

Quando a vistoriadora clica em "Confirmar vistoria realizada" (link do evento na agenda), o Apps Script envia ao mesmo webhook:

```json
{ "evento": "vistoria_realizada", "hubspot_ticket_id": "…", "hubspot": {}, "contexto": { "data_realizacao": "2026-12-01", "unidade": "…" } }
```

Sugestão no Make: uma 2ª rota (filtro `evento = vistoria_realizada`) que move o ticket para **"Vistoria recebimento"** (`1398907465`) e grava a data em `data_da_realizacao_da_vistoria`.

## 6. Cenário Make sugerido

1. **Webhooks › Custom webhook** — copie a URL para a propriedade de script `MAKE_WEBHOOK_URL` e rode `testarSomenteMake()` no Apps Script para o Make aprender a estrutura.
2. **Router**
   - Rota A — filtro `evento = vistoria_agendada`
     - (recomendado) **HubSpot › Get a ticket** `{{hubspot_ticket_id}}` + filtro "pipeline = 917642392" — impede que um link adulterado atualize um ticket de outro pipeline.
     - **HubSpot › Update a ticket**: propriedades da tabela da seção 4 + `hs_pipeline_stage = 1398907464`.
   - Rota B — filtro `evento = vistoria_realizada` → Update a ticket (fase `1398907465`).
3. Resposta padrão do webhook (200) — o Apps Script só considera `OK` com status 2xx.

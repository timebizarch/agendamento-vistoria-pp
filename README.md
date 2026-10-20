# Yuca · Agendamento de Vistoria (PP)

Formulário para o proprietário (PP) agendar a **vistoria de recebimento** da unidade que entra na Gestão Yuca.
O link chega pronto pelo Make, com os dados do ticket do HubSpot — o PP só vê quem é o vistoriador e escolhe presença, data e horário.

- **Fonte:** este repositório (GitHub)
- **Hospedagem:** Netlify (deploy automático a cada push na `main`)
- **Espelho:** Webflow, via iframe (`webflow/embed.html`)
- **Integrações:** Google Apps Script (agenda + planilha) → Make → HubSpot

## Estrutura

```
index.html                 página (HTML) + formulário oculto do Netlify Forms
assets/css/styles.css      identidade visual Yuca (verdes, creme, Fraunces + Montserrat)
assets/js/config.js        ← configurações: Apps Script, vistoriadora, suporte, horários, nomes dos parâmetros
assets/js/app.js           lógica do formulário
assets/img/                logos Yuca (verde, branca, preta — SVG e PNG)
apps-script/Code.gs        código do Google Apps Script (cole em script.google.com)
webflow/embed.html         bloco para colar no Webflow
docs/HUBSPOT-MAPEAMENTO.md levantamento: campos, propriedades do HubSpot e cenário do Make
netlify.toml               config do Netlify (sem build; headers de privacidade)
```

## Link enviado ao proprietário

```
https://SEU-SITE.netlify.app/?hs_id=49623137077&nome=Ana%20Silva&telefone=%2B5511999999999&email=ana%40email.com&unidade=Ed.%20Solar%20-%20Apto%2042
```

`hs_id` é obrigatório. Detalhes e fórmula do Make em [`docs/HUBSPOT-MAPEAMENTO.md`](docs/HUBSPOT-MAPEAMENTO.md).

## Publicar

### 1. GitHub + Netlify
1. Crie um repositório **privado** no GitHub (o `config.js` tem RG/CPF da vistoriadora, exibidos na tela final para liberação na portaria) e suba esta pasta.
2. No Netlify: *Add new site → Import from Git* → escolha o repositório. Build command: vazio. Publish directory: `.`
3. Em *Forms*, confirme que o formulário `agendamento-vistoria` foi detectado (backup das respostas).
4. Se quiser manter a URL do site antigo, troque o repositório de origem no site existente (*Site configuration → Build & deploy → Link repository*).

### 2. Apps Script
1. Abra o projeto atual em script.google.com e substitua o código por `apps-script/Code.gs`.
2. *Configurações do projeto → Propriedades do script* → adicione `MAKE_WEBHOOK_URL` com a URL do webhook do Make.
3. *Implantar → Gerenciar implantações → editar → Nova versão* (mantém a mesma URL `/exec`).
4. Rode `testarSomenteMake()` uma vez para o Make aprender a estrutura do JSON.

### 3. HubSpot + Make
1. Troque o tipo de `data_da_vistoria_de_recebimento` para **Data e hora** (nenhuma propriedade nova é necessária).
2. Monte o cenário do Make conforme as seções 4 e 6 de [`docs/HUBSPOT-MAPEAMENTO.md`](docs/HUBSPOT-MAPEAMENTO.md).

### 4. Webflow
Cole `webflow/embed.html` num *Code Embed*, troque `SEU-SITE` pela URL do Netlify e marque a página como fora da busca. O Make pode mandar o link do Webflow em vez do Netlify — os parâmetros são repassados.

## Testar localmente

Abra `index.html` com os parâmetros, por exemplo:
`index.html?hs_id=123&nome=Teste%20PP&telefone=11999999999&email=teste%40yuca.live&unidade=Ed.%20Teste%20-%2042`

> Envios de teste criam eventos reais na agenda de vistorias. Use um `hs_id` de ticket de teste.

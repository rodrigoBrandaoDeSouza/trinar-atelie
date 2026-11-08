# Trinar Ateliê Criativo

Site do ateliê com inscrição online e um painel para a dona gerenciar **cursos**, **alunas**, **inscrições** e **mensalidades**.

- **Stack:** Node.js 22 + Express, PostgreSQL. O front é HTML, CSS e JavaScript puro, sem build.
- **Dependências:** apenas `express` e `pg`. O login usa `crypto` nativo (scrypt + cookie assinado com HMAC).

## O que tem

| Página | O que faz |
|---|---|
| `/` | Site público: cursos com vagas em tempo real, como funciona, sobre e contato |
| `/inscricao` | Inscrição em 3 passos (curso → dados → forma de pagamento). Se a turma estiver cheia, entra na lista de espera |
| `/admin` | Painel com login: visão geral, cursos, alunas, mensalidades e inscrições |

**Fluxo:**

1. A aluna se inscreve pelo site e a inscrição fica *pendente*.
2. No painel, a dona clica em **Confirmar vaga**. Isso cria a aluna e a matrícula, gera a primeira mensalidade e abre o WhatsApp com uma mensagem de boas-vindas.
3. Todo mês, as mensalidades das matrículas ativas são geradas automaticamente quando o painel é aberto.
4. A dona marca cada mensalidade como paga e cobra as atrasadas com um botão que abre o WhatsApp com a mensagem pronta.
5. A planilha do mês sai em CSV, que abre direto no Excel.

## Rodar localmente

Requisitos: Node 22 e um PostgreSQL local.

```bash
cp .env.example .env          # ajuste DATABASE_URL, ADMIN_EMAIL e ADMIN_PASSWORD
npm install
npm run migrate               # cria tabelas, cursos de exemplo e a conta da admin
npm run dev                   # http://localhost:3000  e  http://localhost:3000/admin
```

## Subir no Heroku

```bash
git init
git add .
git commit -m "Site e plataforma do Trinar Ateliê Criativo"

heroku login
heroku create trinar-atelie                   # ou outro nome disponível
heroku addons:create heroku-postgresql:essential-0
heroku config:set NODE_ENV=production \
  SESSION_SECRET=$(openssl rand -hex 32) \
  ADMIN_EMAIL=dona@exemplo.com \
  ADMIN_PASSWORD='uma-senha-forte' \
  ADMIN_NAME='Nome da Professora' \
  ATELIE_WHATSAPP=45999990000 \
  ATELIE_ENDERECO='Rua Exemplo, 123 — Centro' \
  ATELIE_HORARIO='Seg a Sex, 9h às 18h'

git push heroku main                          # ou: git push heroku master
heroku open
```

A cada deploy, o `Procfile` roda `scripts/migrate.js` na fase *release*. O script é idempotente: cria as tabelas que faltam, insere os cursos de exemplo só se a tabela estiver vazia e cria a admin só se o e-mail ainda não existir.

**Trocar a senha da admin** (ou criar outra conta):

```bash
heroku run node scripts/criar-admin.js dona@exemplo.com 'nova-senha' 'Nome'
```

Quer manter o projeto no GitHub? Crie o repositório no GitHub e rode `git remote add origin <url>` e `git push -u origin main`. Depois, em *Deploy* no painel do Heroku, você pode ligar o deploy automático a partir do GitHub.

## WhatsApp do ateliê

O site usa a **[Evolution API](https://github.com/evolution-foundation/evolution-api)**, que é open source. Ela liga um número comum de WhatsApp (ou WhatsApp Business) ao sistema pelo QR code, do mesmo jeito que o WhatsApp Web.

| | |
|---|---|
| **Custo** | O software é gratuito e não há cobrança por mensagem. Você paga só a hospedagem da Evolution: um dyno Basic no Heroku (~US$ 7/mês) ou uma alternativa como a Railway. |
| **Número** | Use um chip exclusivo do ateliê. O celular desse número pode continuar com o WhatsApp instalado normalmente. |
| **Risco** | Não é a API oficial da Meta. O WhatsApp pode bloquear números que mandam muita mensagem para quem não tem o número salvo. O sistema manda só mensagens individuais e espaçadas para as próprias alunas, o que reduz bastante esse risco. |

**O que a integração faz:**

- **Painel › WhatsApp:** conecta o número escaneando o QR code e liga ou desliga cada mensagem automática. Também é onde a dona edita os textos e cadastra a chave Pix.
- **Painel › Conversas:** caixa de entrada com todas as mensagens que chegam no número do ateliê. A dona responde por ali, e o nome da aluna é reconhecido pelo telefone.
- **Mensagens automáticas:**
  - inscrição recebida (ou lista de espera);
  - aviso de nova inscrição para o celular pessoal da dona;
  - boas-vindas ao confirmar a vaga;
  - lembrete X dias antes do vencimento;
  - cobrança no dia seguinte ao vencimento.
- **Botões de envio:** "Cobrar/Lembrar no WhatsApp" e "Avisar turma" (por exemplo, uma aula remarcada) mandam a mensagem pelo número do ateliê.
- **Rotina diária:** lembretes e cobranças rodam sozinhos uma vez por dia, entre 9h e 19h. Cada mensagem é enviada uma única vez.

Se o WhatsApp não estiver configurado ou conectado, tudo continua funcionando como antes: os botões abrem o `wa.me` no celular da dona.

**Como configurar:**

1. Suba a Evolution API seguindo [`evolution-heroku/README.md`](evolution-heroku/README.md).
2. No app do site, rode `heroku config:set EVOLUTION_API_URL=... EVOLUTION_API_KEY=... APP_URL=https://<seu-app>.herokuapp.com`.
3. Abra **Painel › WhatsApp › Conectar WhatsApp** e escaneie o QR code com o celular do ateliê.

As mensagens recebidas chegam por webhook em `/webhooks/whatsapp/<token>`. O token é gerado a partir do `SESSION_SECRET` e o próprio painel o configura na Evolution ao conectar.

## Variáveis de ambiente

| Variável | Obrigatória | Para quê |
|---|---|---|
| `DATABASE_URL` | sim | O Heroku define sozinho ao criar o Postgres |
| `SESSION_SECRET` | sim em produção | Assina o cookie de login |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | no 1º deploy | Conta inicial do painel |
| `ATELIE_WHATSAPP` | não | Número com DDD, só dígitos. Usado no botão "Chamar no WhatsApp" |
| `ATELIE_ENDERECO`, `ATELIE_HORARIO` | não | Exibidos em "Contato" |
| `ATELIE_INSTAGRAM` | não | Padrão: `trinarateliecriativo` |
| `ATELIE_MAPA_URL` | não | Link de incorporação do Google Maps (`https://www.google.com/maps/embed?...`) |
| `SEED_CURSOS_EXEMPLO` | não | `false` para não criar os 6 cursos de exemplo |
| `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` | para o WhatsApp | Endereço e chave da Evolution API |
| `EVOLUTION_INSTANCE` | não | Nome da instância (padrão `trinar`) |
| `APP_URL` | para o WhatsApp | URL pública do site, usada no webhook e no link do aviso para a dona |
| `ATELIE_WHATSAPP_DONA` | não | Celular pessoal da dona para avisos (também dá para definir no painel) |
| `WHATSAPP_AGENDADOR` | não | `false` desliga a rotina diária dentro do servidor (use `node scripts/rotina-whatsapp.js` no Heroku Scheduler) |

## Personalizar

- **Fotos:** coloque as imagens em `public/img/` e use-as como fundo nas classes `.foto-grande`, `.foto-a`, `.foto-b` e `.sobre .foto` em `public/css/style.css`, por exemplo `background-image: url(/img/atelie.jpg)`.
- **Texto "O ateliê":** edite em `public/index.html`. O trecho está marcado com `EDITAR`.
- **Cores e fontes:** ficam nas variáveis no topo de `public/css/style.css`.
- **Cursos:** cadastre e edite pelo painel. Os 6 cursos iniciais são apenas exemplos.

## Estrutura

```
db/schema.sql          tabelas (usuarios, cursos, alunas, matriculas, mensalidades, inscricoes)
db/seed.sql            cursos de exemplo
scripts/migrate.js     aplica schema + seed + admin (roda no release do Heroku)
scripts/criar-admin.js cria admin / troca senha
src/server.js          Express, segurança, rotas de página
src/rotas/publico.js   /api/config, /api/cursos, /api/inscricoes
src/rotas/admin.js     /api/admin/* (login, resumo, cursos, alunas, inscrições, mensalidades, CSV)
src/servicos.js        regras de matrícula e geração de mensalidades
src/whatsapp/          cliente da Evolution API, mensagens automáticas, rotina diária e webhook
src/rotas/whatsapp.js  /webhooks/whatsapp/:token e /api/admin/whatsapp/*
evolution-heroku/      Dockerfile para subir a Evolution API como segundo app no Heroku
public/                site, inscrição, CSS e JS do front
views/                 login.html e admin.html (servidos pelo Express)
```

## Próximos passos sugeridos

- Cobrança automática: integrar Mercado Pago ou Asaas para gerar Pix, boleto e cartão recorrente e dar baixa sozinho via webhook.
- Lista de chamada e controle de faltas e reposições.

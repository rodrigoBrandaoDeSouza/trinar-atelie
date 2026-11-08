# Evolution API no Heroku

Este diretório sobe a [Evolution API](https://github.com/evolution-foundation/evolution-api) como um **segundo app** no Heroku. É ela que mantém o número do ateliê conectado ao WhatsApp, como se fosse o WhatsApp Web. O site conversa com ela pela API.

Os comandos abaixo rodam na **raiz do repositório do site**. Esta pasta é enviada sozinha com `git subtree`:

```bash
heroku create trinar-whatsapp --remote heroku-whatsapp
heroku stack:set container -a trinar-whatsapp

# Reaproveita o Postgres do site (tabelas ficam no schema "evolution", separadas)
heroku addons:attach <nome-do-addon-postgres-do-site> -a trinar-whatsapp --as DATABASE
#   o nome do add-on aparece em: heroku addons -a trinar-atelie  (ex.: postgresql-curly-12345)

heroku config:set -a trinar-whatsapp \
  AUTHENTICATION_API_KEY=$(openssl rand -hex 24) \
  SERVER_URL=https://trinar-whatsapp-xxxx.herokuapp.com \
  DATABASE_PROVIDER=postgresql \
  DATABASE_CONNECTION_CLIENT_NAME=trinar \
  DATABASE_SAVE_DATA_INSTANCE=true \
  DATABASE_SAVE_DATA_NEW_MESSAGE=false \
  DATABASE_SAVE_MESSAGE_UPDATE=false \
  DATABASE_SAVE_DATA_CONTACTS=false \
  DATABASE_SAVE_DATA_CHATS=false \
  DATABASE_SAVE_DATA_LABELS=false \
  DATABASE_SAVE_DATA_HISTORIC=false \
  CACHE_REDIS_ENABLED=false \
  CACHE_LOCAL_ENABLED=true \
  DEL_INSTANCE=false \
  CONFIG_SESSION_PHONE_CLIENT="Trinar Atelie"

git subtree push --prefix evolution-heroku heroku-whatsapp main
heroku logs --tail -a trinar-whatsapp       # espere aparecer "HTTP - ON"
```

`SERVER_URL` é a URL que o `heroku create` mostrou. Depois, no app do **site**:

```bash
heroku config:set -a trinar-atelie \
  EVOLUTION_API_URL=https://trinar-whatsapp-xxxx.herokuapp.com \
  EVOLUTION_API_KEY=<o mesmo AUTHENTICATION_API_KEY> \
  APP_URL=https://trinar-atelie-xxxx.herokuapp.com
```

Com isso feito, entre em **Painel › WhatsApp › Conectar WhatsApp** e escaneie o QR code com o celular do ateliê.

## Observações

- **Dyno:** use pelo menos o *Basic*. O *Eco* dorme quando fica sem uso, e aí o WhatsApp desconecta. Se aparecer o erro `R14 (Memory quota exceeded)` nos logs, passe para o *Standard-1X*.
- **Sessão:** com `DATABASE_SAVE_DATA_INSTANCE=true`, a sessão do WhatsApp fica no Postgres. Assim, quando o Heroku reinicia o dyno (isso acontece uma vez por dia), o número continua conectado.
- **Alternativa sem Heroku:** a Railway tem um template pronto da Evolution API com um clique. Nesse caso, basta configurar `EVOLUTION_API_URL` e `EVOLUTION_API_KEY` no site.

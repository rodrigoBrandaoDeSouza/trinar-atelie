# Evolution API (WhatsApp open source) para rodar como um segundo app no Heroku.
# Fixe a versão para não ser surpreendida por atualizações. Versões: https://hub.docker.com/r/evoapicloud/evolution-api/tags
FROM evoapicloud/evolution-api:v2.3.7

# O Heroku escolhe a porta em $PORT e entrega o banco em $DATABASE_URL (sem SSL e sem schema na string).
# Usa o schema "evolution" para poder dividir o mesmo Postgres com o site, sem misturar tabelas.
ENTRYPOINT ["/bin/bash", "-c", "export SERVER_PORT=\"${PORT:-8080}\"; if [ -z \"$DATABASE_CONNECTION_URI\" ] && [ -n \"$DATABASE_URL\" ]; then export DATABASE_CONNECTION_URI=\"${DATABASE_URL}?sslmode=require&sslaccept=accept_invalid_certs&schema=evolution\"; fi; . ./Docker/scripts/deploy_database.sh && npm run start:prod"]

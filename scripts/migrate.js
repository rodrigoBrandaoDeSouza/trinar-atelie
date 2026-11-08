// Cria/atualiza as tabelas, insere cursos de exemplo (se vazio) e a conta da administradora.
// Roda automaticamente no Heroku (fase "release" do Procfile) e localmente com `npm run migrate`.
try { process.loadEnvFile(); } catch { /* sem .env, tudo bem */ }

const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');
const { hashPassword } = require('../src/auth');

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('Esquema aplicado.');

  if (process.env.SEED_CURSOS_EXEMPLO !== 'false') {
    const seed = fs.readFileSync(path.join(__dirname, '..', 'db', 'seed.sql'), 'utf8');
    const r = await pool.query(seed);
    if (r.rowCount) console.log(`${r.rowCount} cursos de exemplo inseridos.`);
  }

  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const senha = process.env.ADMIN_PASSWORD || '';
  if (email && senha) {
    const r = await pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING`,
      [process.env.ADMIN_NAME || 'Administradora', email, hashPassword(senha)]
    );
    if (r.rowCount) console.log(`Conta de administradora criada: ${email}`);
  } else {
    const { rows } = await pool.query('SELECT count(*) AS n FROM usuarios');
    if (!rows[0].n) console.warn('Nenhuma administradora cadastrada. Defina ADMIN_EMAIL e ADMIN_PASSWORD ou rode scripts/criar-admin.js.');
  }
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end().finally(() => process.exit(1));
  });

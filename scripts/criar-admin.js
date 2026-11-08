// Cria uma administradora ou troca a senha de uma existente.
// Uso: node scripts/criar-admin.js email@exemplo.com "senha-forte" ["Nome"]
// No Heroku: heroku run node scripts/criar-admin.js email@exemplo.com "senha-forte"
try { process.loadEnvFile(); } catch { /* sem .env */ }

const { pool } = require('../src/db');
const { hashPassword } = require('../src/auth');

const [email, senha, nome] = process.argv.slice(2);
if (!email || !senha || senha.length < 8) {
  console.error('Uso: node scripts/criar-admin.js email "senha com 8+ caracteres" ["Nome"]');
  process.exit(1);
}

pool
  .query(
    `INSERT INTO usuarios (nome, email, senha_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash, nome = EXCLUDED.nome`,
    [nome || 'Administradora', email.trim().toLowerCase(), hashPassword(senha)]
  )
  .then(() => console.log(`Administradora ${email} pronta.`))
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => pool.end());

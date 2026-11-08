// Envia lembretes de vencimento e cobranças de atraso pelo WhatsApp.
// O próprio servidor já roda isso 1x por dia (entre 9h e 19h). Este script serve para
// rodar manualmente ou pelo Heroku Scheduler: `node scripts/rotina-whatsapp.js`
// (nesse caso, defina WHATSAPP_AGENDADOR=false no app para não rodar duas vezes).
try { process.loadEnvFile(); } catch { /* sem .env */ }

const { pool } = require('../src/db');
const wa = require('../src/whatsapp');

wa.rotinaDiaria()
  .then((r) => console.log(r))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());

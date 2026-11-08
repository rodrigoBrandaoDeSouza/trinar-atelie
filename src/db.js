const { Pool, types } = require('pg');

// DATE (1082) como string 'YYYY-MM-DD' para evitar deslocamento de fuso.
types.setTypeParser(1082, (v) => v);
// NUMERIC (1700) como número.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
// COUNT/SUM bigint (20) como número.
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL não definida. Veja o README.');
  process.exit(1);
}

// No Heroku o Postgres exige SSL com certificado próprio.
const isLocal = /localhost|127\.0\.0\.1|host=\/|@\/|%2F/.test(connectionString);
const pool = new Pool({
  connectionString,
  ssl: process.env.PGSSL === 'disable' || isLocal ? false : { rejectUnauthorized: false },
  max: parseInt(process.env.PG_POOL_MAX || '5', 10),
});

// "Hoje" sempre no horário de Brasília.
pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'America/Sao_Paulo'").catch(() => {});
});

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("SET TIME ZONE 'America/Sao_Paulo'");
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query: (text, params) => pool.query(text, params), tx };

try { process.loadEnvFile(); } catch { /* sem .env: usa as variáveis do ambiente (Heroku) */ }

const path = require('path');
const express = require('express');
const auth = require('./auth');
const db = require('./db');

const app = express();
const PUBLIC = path.join(__dirname, '..', 'public');
const VIEWS = path.join(__dirname, '..', 'views');

app.set('trust proxy', 1); // Heroku fica atrás de um proxy (HTTPS, IP real)
app.disable('x-powered-by');

// Força HTTPS em produção.
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] === 'http') {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  next();
});

// Cabeçalhos de segurança básicos.
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' https://fonts.googleapis.com; " +
      "font-src https://fonts.gstatic.com; frame-src https://www.google.com https://maps.google.com; " +
      "script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'",
  });
  next();
});

// Webhook do WhatsApp (antes do parser global, aceita payloads maiores).
const rotasWhats = require('./rotas/whatsapp');
app.use('/webhooks/whatsapp', rotasWhats.webhook);

app.use(express.json({ limit: '50kb' }));

app.get('/health', async (req, res) => {
  try { await db.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

app.use('/api/admin/whatsapp', rotasWhats.admin);
app.use('/api/admin', require('./rotas/admin'));
app.use('/api', require('./rotas/publico'));
app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

// Painel (HTML só aparece com login; os dados são protegidos pela API de qualquer forma).
app.get('/admin/login', (req, res) => res.sendFile(path.join(VIEWS, 'login.html')));
app.get(['/admin', '/admin/'], (req, res) => {
  if (!auth.currentUser(req)) return res.redirect('/admin/login');
  res.set('Cache-Control', 'no-store').sendFile(path.join(VIEWS, 'admin.html'));
});

app.use(express.static(PUBLIC, { extensions: ['html'], maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, '404.html')));

// Erros
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ erro: status >= 500 ? 'Erro interno. Tente novamente.' : err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Trinar rodando em http://localhost:${PORT}`);
  require('./whatsapp').iniciarAgendador(); // lembretes e cobranças diárias
});

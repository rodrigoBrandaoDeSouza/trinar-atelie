const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const wa = require('../whatsapp');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Webhook público (chamado pela Evolution API) ----------
const webhook = express.Router();
webhook.post('/:token', express.json({ limit: '5mb' }), wrap(async (req, res) => {
  const esperado = Buffer.from(wa.tokenWebhook());
  const recebido = Buffer.from(String(req.params.token || ''));
  if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) {
    return res.status(403).json({ erro: 'token inválido' });
  }
  res.json({ ok: true }); // responde rápido; processa em seguida
  wa.processarWebhook(req.body).catch((e) => console.error('[whatsapp] webhook:', e.message));
}));

// ---------- Painel (exige login) ----------
const admin = express.Router();
admin.use(auth.requireAuth);

function urlWebhook(req) {
  const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  return `${base}/webhooks/whatsapp/${wa.tokenWebhook()}`;
}

admin.get('/status', wrap(async (req, res) => {
  const estado = await wa.estado(req.query.forcar === '1');
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM whatsapp_mensagens WHERE direcao = 'entrada' AND NOT lida`);
  res.json({ configurado: wa.configurado(), estado, conectado: estado === 'open', nao_lidas: rows[0].n, instancia: wa.evo.INSTANCIA });
}));

admin.post('/conectar', wrap(async (req, res) => {
  if (!wa.configurado()) return res.status(400).json({ erro: 'Defina EVOLUTION_API_URL e EVOLUTION_API_KEY nas variáveis de ambiente.' });
  try {
    const r = await wa.evo.conectar(urlWebhook(req));
    wa.definirEstado(r.estado);
    res.json(r);
  } catch (e) {
    res.status(502).json({ erro: `Evolution API: ${e.message}` });
  }
}));

admin.post('/desconectar', wrap(async (req, res) => {
  try { await wa.evo.desconectar(); } catch (e) { return res.status(502).json({ erro: `Evolution API: ${e.message}` }); }
  wa.definirEstado('close');
  res.json({ ok: true });
}));

admin.get('/config', wrap(async (req, res) => {
  res.json({ ...(await wa.lerConfig()), padrao: wa.PADRAO.textos });
}));

admin.put('/config', wrap(async (req, res) => {
  res.json(await wa.salvarConfig(req.body || {}));
}));

admin.post('/rotina', wrap(async (req, res) => {
  const r = await wa.rotinaDiaria();
  res.json(r);
}));

// Lista de conversas (uma por contato), com nome da aluna quando o número bate.
admin.get('/conversas', wrap(async (req, res) => {
  const { rows } = await db.query(
    `WITH ult AS (
       SELECT DISTINCT ON (chave) chave, telefone, texto, direcao, criado_em
         FROM whatsapp_mensagens ORDER BY chave, criado_em DESC, id DESC)
     SELECT u.*,
            (SELECT count(*)::int FROM whatsapp_mensagens w WHERE w.chave = u.chave AND w.direcao = 'entrada' AND NOT w.lida) AS nao_lidas,
            (SELECT a.nome FROM alunas a WHERE chave_tel(a.whatsapp) = u.chave ORDER BY a.id DESC LIMIT 1) AS aluna,
            (SELECT i.nome FROM inscricoes i WHERE chave_tel(i.whatsapp) = u.chave ORDER BY i.id DESC LIMIT 1) AS inscrita,
            (SELECT w.nome_contato FROM whatsapp_mensagens w WHERE w.chave = u.chave AND w.nome_contato IS NOT NULL
              ORDER BY w.criado_em DESC LIMIT 1) AS contato
       FROM ult u ORDER BY u.criado_em DESC LIMIT 200`);
  res.json(rows);
}));

admin.get('/conversas/:chave', wrap(async (req, res) => {
  const chave = String(req.params.chave).replace(/\D/g, '');
  const { rows } = await db.query(
    `SELECT id, telefone, direcao, texto, tipo, status, erro, criado_em
       FROM (SELECT * FROM whatsapp_mensagens WHERE chave = $1 ORDER BY criado_em DESC, id DESC LIMIT 300) x
      ORDER BY criado_em, id`, [chave]);
  await db.query(`UPDATE whatsapp_mensagens SET lida = TRUE WHERE chave = $1 AND NOT lida`, [chave]);
  res.json(rows);
}));

// Envia mensagem livre para um número (conversa ou aluna).
admin.post('/enviar', wrap(async (req, res) => {
  const texto = String(req.body?.texto || '').trim().slice(0, 4000);
  let telefone = String(req.body?.telefone || '');
  if (!telefone && req.body?.chave) {
    const { rows } = await db.query(
      `SELECT telefone FROM whatsapp_mensagens WHERE chave = $1 ORDER BY (direcao = 'entrada') DESC, criado_em DESC LIMIT 1`,
      [String(req.body.chave).replace(/\D/g, '')]);
    telefone = rows[0]?.telefone || '';
  }
  const r = await wa.enviar({ telefone, texto, tipo: 'manual' });
  if (!r.ok) return res.status(400).json({ erro: r.erro });
  res.json({ ok: true });
}));

// Lembrete / cobrança de uma mensalidade pelo número do ateliê.
admin.post('/mensalidades/:id/cobrar', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT vencimento < CURRENT_DATE AS vencida FROM mensalidades WHERE id = $1`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ erro: 'Mensalidade não encontrada.' });
  const tipo = rows[0].vencida ? 'cobranca' : 'lembrete';
  const msg = await wa.textoMensalidade(req.params.id, tipo);
  const r = await wa.enviar(msg);
  if (!r.ok) return res.status(400).json({ erro: r.erro });
  await db.query(`UPDATE mensalidades SET ${tipo === 'cobranca' ? 'cobranca_enviada_em' : 'lembrete_enviado_em'} = now() WHERE id = $1`, [req.params.id]);
  res.json({ ok: true, tipo });
}));

// Aviso para todas as alunas ativas de um curso (ex.: aula cancelada). Envia em segundo plano.
admin.post('/avisar-turma', wrap(async (req, res) => {
  const cursoId = parseInt(req.body?.curso_id, 10);
  const texto = String(req.body?.texto || '').trim().slice(0, 2000);
  if (!cursoId || texto.length < 3) return res.status(400).json({ erro: 'Escreva a mensagem.' });
  if ((await wa.estado(true)) !== 'open') return res.status(400).json({ erro: 'O WhatsApp do ateliê não está conectado.' });
  const { rows } = await db.query(
    `SELECT DISTINCT ON (chave_tel(a.whatsapp)) a.nome, a.whatsapp
       FROM matriculas m JOIN alunas a ON a.id = m.aluna_id WHERE m.ativa AND m.curso_id = $1`, [cursoId]);
  const itens = rows.map((a) => ({ telefone: a.whatsapp, tipo: 'aviso_turma',
    texto: wa.preencher(texto, { nome: a.nome.split(' ')[0] }) }));
  wa.enviarEmLote(itens).catch((e) => console.error('[whatsapp] aviso turma:', e.message));
  res.json({ ok: true, total: itens.length });
}));

module.exports = { webhook, admin };

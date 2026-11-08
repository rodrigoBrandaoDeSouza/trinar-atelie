const express = require('express');
const db = require('../db');
const auth = require('../auth');
const wa = require('../whatsapp');
const { FORMAS, competencia, gerarMensalidades, matricular, httpErro, validarPessoa, SITUACAO_SQL } = require('../servicos');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Login ----------
const falhas = new Map();
router.post('/login', wrap(async (req, res) => {
  const chave = req.ip;
  const f = falhas.get(chave) || { n: 0, ate: 0 };
  if (f.ate > Date.now()) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });

  const email = String(req.body?.email || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '');
  const { rows } = await db.query('SELECT id, nome, email, senha_hash FROM usuarios WHERE email = $1', [email]);
  if (!rows.length || !auth.verifyPassword(senha, rows[0].senha_hash)) {
    f.n += 1;
    if (f.n >= 5) { f.ate = Date.now() + 10 * 60 * 1000; f.n = 0; }
    falhas.set(chave, f);
    return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
  }
  falhas.delete(chave);
  auth.startSession(res, rows[0]);
  res.json({ ok: true, nome: rows[0].nome });
}));

router.post('/logout', (req, res) => { auth.endSession(res); res.json({ ok: true }); });

// Tudo abaixo exige login.
router.use(auth.requireAuth);

router.get('/eu', (req, res) => res.json({ nome: req.user.nome, email: req.user.email }));

// ---------- Visão geral ----------
router.get('/resumo', wrap(async (req, res) => {
  const comp = competencia(req.query.mes);
  await gerarMensalidades(comp);

  const [totais, alunas, cursos, atrasados, inscricoes] = await Promise.all([
    db.query(
      `SELECT COALESCE(sum(valor),0) AS previsto,
              COALESCE(sum(valor) FILTER (WHERE pago_em IS NOT NULL),0) AS recebido,
              COALESCE(sum(valor) FILTER (WHERE pago_em IS NULL AND vencimento >= CURRENT_DATE),0) AS a_vencer,
              -- atraso considera todos os meses, não só o selecionado
              (SELECT COALESCE(sum(valor),0) FROM mensalidades WHERE pago_em IS NULL AND vencimento < CURRENT_DATE) AS atrasado
         FROM mensalidades WHERE competencia = $1`, [comp]),
    db.query(`SELECT count(DISTINCT aluna_id) AS alunas, count(*) AS matriculas FROM matriculas WHERE ativa`),
    db.query(`SELECT count(*) FILTER (WHERE ativo) AS ativos, count(*) AS total FROM cursos`),
    db.query(
      `SELECT ms.id, ms.vencimento, ms.valor, a.nome, a.whatsapp, c.nome AS curso
         FROM mensalidades ms
         JOIN matriculas m ON m.id = ms.matricula_id
         JOIN alunas a ON a.id = m.aluna_id
         JOIN cursos c ON c.id = m.curso_id
        WHERE ms.pago_em IS NULL AND ms.vencimento < CURRENT_DATE
        ORDER BY ms.vencimento, a.nome LIMIT 50`),
    db.query(
      `SELECT i.id, i.nome, i.whatsapp, i.forma_pagamento, i.lista_espera, i.criado_em, c.nome AS curso
         FROM inscricoes i JOIN cursos c ON c.id = i.curso_id
        WHERE i.status = 'pendente' ORDER BY i.criado_em DESC LIMIT 50`),
  ]);

  res.json({
    competencia: comp,
    ...totais.rows[0],
    alunas: alunas.rows[0].alunas,
    matriculas: alunas.rows[0].matriculas,
    cursos_ativos: cursos.rows[0].ativos,
    cursos_total: cursos.rows[0].total,
    atrasados: atrasados.rows,
    inscricoes: inscricoes.rows,
  });
}));

// ---------- Cursos ----------
function lerCurso(b) {
  const c = {
    nome: String(b.nome || '').trim().slice(0, 120),
    nivel: String(b.nivel || '').trim().slice(0, 60),
    descricao: String(b.descricao || '').trim().slice(0, 600),
    horario: String(b.horario || '').trim().slice(0, 120),
    vagas: parseInt(b.vagas, 10),
    valor_mensal: Number(String(b.valor_mensal ?? '').replace(',', '.')),
    cor: /^#[0-9a-fA-F]{6}$/.test(b.cor || '') ? b.cor : '#D9C9B4',
    ordem: parseInt(b.ordem, 10) || 0,
    ativo: b.ativo === undefined ? true : !!b.ativo,
  };
  if (c.nome.length < 2) throw httpErro(400, 'Informe o nome do curso.');
  if (!(c.vagas > 0)) throw httpErro(400, 'Informe o número de vagas.');
  if (!(c.valor_mensal >= 0)) throw httpErro(400, 'Informe o valor da mensalidade.');
  return c;
}

router.get('/cursos', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.*, count(m.id)::int AS alunos
       FROM cursos c LEFT JOIN matriculas m ON m.curso_id = c.id AND m.ativa
      GROUP BY c.id ORDER BY c.ordem, c.nome`);
  res.json(rows);
}));

router.post('/cursos', wrap(async (req, res) => {
  const c = lerCurso(req.body || {});
  const { rows } = await db.query(
    `INSERT INTO cursos (nome, nivel, descricao, horario, vagas, valor_mensal, cor, ordem, ativo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [c.nome, c.nivel, c.descricao, c.horario, c.vagas, c.valor_mensal, c.cor, c.ordem, c.ativo]);
  res.status(201).json(rows[0]);
}));

router.put('/cursos/:id', wrap(async (req, res) => {
  const c = lerCurso(req.body || {});
  const { rows } = await db.query(
    `UPDATE cursos SET nome=$1, nivel=$2, descricao=$3, horario=$4, vagas=$5, valor_mensal=$6, cor=$7, ordem=$8, ativo=$9
      WHERE id=$10 RETURNING *`,
    [c.nome, c.nivel, c.descricao, c.horario, c.vagas, c.valor_mensal, c.cor, c.ordem, c.ativo, req.params.id]);
  if (!rows.length) throw httpErro(404, 'Curso não encontrado.');
  res.json(rows[0]);
}));

router.patch('/cursos/:id/ativo', wrap(async (req, res) => {
  const { rows } = await db.query('UPDATE cursos SET ativo = $1 WHERE id = $2 RETURNING id, ativo', [!!req.body?.ativo, req.params.id]);
  if (!rows.length) throw httpErro(404, 'Curso não encontrado.');
  res.json(rows[0]);
}));

// ---------- Alunas / matrículas ----------
router.get('/alunas', wrap(async (req, res) => {
  const comp = competencia(req.query.mes);
  await gerarMensalidades(comp);
  const params = [comp];
  const filtros = ['m.ativa'];
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim()}%`);
    params.push(`%${String(req.query.q).replace(/\D/g, '') || '§'}%`);
    filtros.push(`(a.nome ILIKE $${params.length - 1} OR a.whatsapp LIKE $${params.length})`);
  }
  if (parseInt(req.query.curso_id, 10)) {
    params.push(parseInt(req.query.curso_id, 10));
    filtros.push(`m.curso_id = $${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT m.id AS matricula_id, a.id AS aluna_id, a.nome, a.whatsapp, a.email, m.inicio,
            m.forma_pagamento, m.dia_vencimento, c.nome AS curso, c.id AS curso_id,
            ms.id AS mensalidade_id, ${SITUACAO_SQL} AS situacao
       FROM matriculas m
       JOIN alunas a ON a.id = m.aluna_id
       JOIN cursos c ON c.id = m.curso_id
       LEFT JOIN mensalidades ms ON ms.matricula_id = m.id AND ms.competencia = $1
      WHERE ${filtros.join(' AND ')}
      ORDER BY a.nome`, params);
  res.json(rows);
}));

function lerMatricula(b) {
  const { erros, dados } = validarPessoa(b);
  const curso_id = parseInt(b.curso_id, 10);
  const forma_pagamento = FORMAS.includes(b.forma_pagamento) ? b.forma_pagamento : 'pix';
  const dia = parseInt(b.dia_vencimento, 10) || 10;
  if (!curso_id) erros.push('Escolha o curso.');
  if (dia < 1 || dia > 28) erros.push('Dia de vencimento deve ser entre 1 e 28.');
  if (erros.length) throw httpErro(400, erros.join(' '));
  return { ...dados, curso_id, forma_pagamento, dia_vencimento: dia };
}

router.post('/alunas', wrap(async (req, res) => {
  const d = lerMatricula(req.body || {});
  const out = await db.tx((client) => matricular(client, d));
  res.status(201).json(out);
}));

router.post('/matriculas/:id/encerrar', wrap(async (req, res) => {
  const { rowCount } = await db.query(
    'UPDATE matriculas SET ativa = FALSE, encerrada_em = CURRENT_DATE WHERE id = $1 AND ativa', [req.params.id]);
  if (!rowCount) throw httpErro(404, 'Matrícula não encontrada.');
  res.json({ ok: true });
}));

// ---------- Inscrições do site ----------
router.get('/inscricoes', wrap(async (req, res) => {
  const status = ['pendente', 'confirmada', 'recusada'].includes(req.query.status) ? req.query.status : 'pendente';
  const { rows } = await db.query(
    `SELECT i.*, c.nome AS curso FROM inscricoes i JOIN cursos c ON c.id = i.curso_id
      WHERE i.status = $1 ORDER BY i.criado_em DESC LIMIT 200`, [status]);
  res.json(rows);
}));

router.post('/inscricoes/:id/confirmar', wrap(async (req, res) => {
  const out = await db.tx(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM inscricoes WHERE id = $1 AND status = 'pendente' FOR UPDATE`, [req.params.id]);
    if (!rows.length) throw httpErro(404, 'Inscrição não encontrada ou já decidida.');
    const i = rows[0];
    const mat = await matricular(client, {
      nome: i.nome, whatsapp: i.whatsapp, email: i.email, nascimento: i.nascimento,
      observacoes: i.observacoes, curso_id: i.curso_id, forma_pagamento: i.forma_pagamento, dia_vencimento: 10,
    });
    await client.query(
      `UPDATE inscricoes SET status = 'confirmada', matricula_id = $1, decidido_em = now() WHERE id = $2`,
      [mat.matricula_id, i.id]);
    return { ...mat, nome: i.nome, whatsapp: i.whatsapp };
  });
  // Boas-vindas pelo número do ateliê (se conectado). Se falhar, o painel oferece o link do WhatsApp.
  const envio = wa.configurado() ? await wa.aoConfirmarMatricula(out.matricula_id) : { ok: false };
  res.json({ ...out, whatsapp_enviado: envio.ok });
}));

router.post('/inscricoes/:id/recusar', wrap(async (req, res) => {
  const { rowCount } = await db.query(
    `UPDATE inscricoes SET status = 'recusada', decidido_em = now() WHERE id = $1 AND status = 'pendente'`, [req.params.id]);
  if (!rowCount) throw httpErro(404, 'Inscrição não encontrada ou já decidida.');
  res.json({ ok: true });
}));

// ---------- Mensalidades ----------
async function listarMensalidades(comp, situacao) {
  const params = [comp];
  let filtro = '';
  if (['pago', 'atrasado', 'a_vencer'].includes(situacao)) {
    params.push(situacao);
    filtro = `AND ${SITUACAO_SQL} = $2`;
  }
  const { rows } = await db.query(
    `SELECT ms.id, ms.competencia, ms.vencimento, ms.valor, ms.pago_em, ms.forma_pagamento,
            a.nome, a.whatsapp, c.nome AS curso, m.forma_pagamento AS forma_matricula,
            ${SITUACAO_SQL} AS situacao
       FROM mensalidades ms
       JOIN matriculas m ON m.id = ms.matricula_id
       JOIN alunas a ON a.id = m.aluna_id
       JOIN cursos c ON c.id = m.curso_id
      WHERE ms.competencia = $1 ${filtro}
      ORDER BY CASE ${SITUACAO_SQL} WHEN 'atrasado' THEN 0 WHEN 'a_vencer' THEN 1 ELSE 2 END, ms.vencimento, a.nome`,
    params);
  return rows;
}

router.get('/mensalidades', wrap(async (req, res) => {
  const comp = competencia(req.query.mes);
  await gerarMensalidades(comp);
  res.json(await listarMensalidades(comp, req.query.situacao));
}));

router.get('/mensalidades.csv', wrap(async (req, res) => {
  const comp = competencia(req.query.mes);
  await gerarMensalidades(comp);
  const rows = await listarMensalidades(comp);
  const nomes = { pago: 'Pago', atrasado: 'Em atraso', a_vencer: 'A vencer' };
  const cel = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const br = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
  const linhas = [['Aluna', 'WhatsApp', 'Curso', 'Vencimento', 'Valor', 'Situação', 'Pago em'].map(cel).join(';')];
  for (const r of rows) {
    linhas.push([r.nome, r.whatsapp, r.curso, br(r.vencimento), r.valor.toFixed(2).replace('.', ','),
      nomes[r.situacao], r.pago_em ? new Date(r.pago_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : ''].map(cel).join(';'));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="mensalidades-${comp.slice(0, 7)}.csv"`);
  res.send('﻿' + linhas.join('\r\n'));
}));

router.post('/mensalidades/:id/pagar', wrap(async (req, res) => {
  const forma = FORMAS.includes(req.body?.forma_pagamento) ? req.body.forma_pagamento : null;
  const { rows } = await db.query(
    `UPDATE mensalidades ms SET pago_em = now(),
            forma_pagamento = COALESCE($2, (SELECT forma_pagamento FROM matriculas WHERE id = ms.matricula_id))
      WHERE id = $1 AND pago_em IS NULL RETURNING id, pago_em`, [req.params.id, forma]);
  if (!rows.length) throw httpErro(404, 'Mensalidade não encontrada ou já paga.');
  res.json(rows[0]);
}));

router.post('/mensalidades/:id/desfazer', wrap(async (req, res) => {
  const { rowCount } = await db.query('UPDATE mensalidades SET pago_em = NULL WHERE id = $1', [req.params.id]);
  if (!rowCount) throw httpErro(404, 'Mensalidade não encontrada.');
  res.json({ ok: true });
}));

module.exports = router;

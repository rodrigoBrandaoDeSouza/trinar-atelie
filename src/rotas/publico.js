const express = require('express');
const db = require('../db');
const { validarPessoa } = require('../servicos');
const wa = require('../whatsapp');

const router = express.Router();

// Limite simples de inscrições por IP (em memória: suficiente para 1 dyno).
const tentativas = new Map();
function limitar(req, res, next) {
  const agora = Date.now();
  const janela = 60 * 60 * 1000;
  const lista = (tentativas.get(req.ip) || []).filter((t) => agora - t < janela);
  if (lista.length >= 10) {
    return res.status(429).json({ erro: 'Muitas inscrições em pouco tempo. Tente mais tarde ou chame no WhatsApp.' });
  }
  lista.push(agora);
  tentativas.set(req.ip, lista);
  next();
}

// Informações do ateliê exibidas no site (vêm das variáveis de ambiente).
router.get('/config', (req, res) => {
  res.json({
    nome: process.env.ATELIE_NOME || 'Trinar Ateliê Criativo',
    whatsapp: (process.env.ATELIE_WHATSAPP || '').replace(/\D/g, ''),
    endereco: process.env.ATELIE_ENDERECO || '',
    horario: process.env.ATELIE_HORARIO || '',
    instagram: process.env.ATELIE_INSTAGRAM || 'trinarateliecriativo',
    mapa: process.env.ATELIE_MAPA_URL || '',
  });
});

// Cursos ativos com vagas livres.
router.get('/cursos', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.nome, c.nivel, c.descricao, c.horario, c.vagas, c.valor_mensal, c.cor,
              GREATEST(c.vagas - count(m.id), 0)::int AS vagas_livres
         FROM cursos c
         LEFT JOIN matriculas m ON m.curso_id = c.id AND m.ativa
        WHERE c.ativo
        GROUP BY c.id
        ORDER BY c.ordem, c.nome`
    );
    res.set('Cache-Control', 'no-store').json(rows);
  } catch (e) { next(e); }
});

// Nova inscrição pelo site. Fica "pendente" até a dona confirmar no painel.
router.post('/inscricoes', limitar, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.site) return res.status(201).json({ ok: true }); // honeypot anti-robô

    const { erros, dados } = validarPessoa(b);
    const forma = String(b.forma_pagamento || '');
    if (!['pix', 'cartao', 'boleto'].includes(forma)) erros.push('Escolha a forma de pagamento.');
    if (!b.aceite) erros.push('É preciso aceitar as regras do ateliê.');
    const cursoId = parseInt(b.curso_id, 10);
    if (!cursoId) erros.push('Escolha um curso.');
    if (erros.length) return res.status(400).json({ erro: erros.join(' ') });

    const curso = await db.query(
      `SELECT c.id, c.nome, c.vagas - count(m.id) AS livres
         FROM cursos c LEFT JOIN matriculas m ON m.curso_id = c.id AND m.ativa
        WHERE c.id = $1 AND c.ativo GROUP BY c.id`,
      [cursoId]
    );
    if (!curso.rowCount) return res.status(400).json({ erro: 'Curso indisponível.' });
    const listaEspera = curso.rows[0].livres <= 0;

    const limpa = (v, n) => String(v || '').trim().slice(0, n) || null;
    await db.query(
      `INSERT INTO inscricoes (curso_id, nome, whatsapp, email, nascimento, como_conheceu, experiencia,
                               observacoes, forma_pagamento, lista_espera)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [cursoId, dados.nome, dados.whatsapp, dados.email, dados.nascimento,
       limpa(b.como_conheceu, 60), limpa(b.experiencia, 60), dados.observacoes, forma, listaEspera]
    );
    res.status(201).json({ ok: true, curso: curso.rows[0].nome, lista_espera: listaEspera });

    // Mensagens automáticas (não bloqueiam a resposta).
    if (wa.configurado()) {
      wa.aoReceberInscricao({ nome: dados.nome, whatsapp: dados.whatsapp, curso: curso.rows[0].nome, lista_espera: listaEspera })
        .catch((e) => console.error('[whatsapp] inscrição:', e.message));
    }
  } catch (e) { next(e); }
});

module.exports = router;

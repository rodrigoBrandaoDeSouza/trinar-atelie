// Regras de negócio compartilhadas pelas rotas.
const db = require('./db');

const FORMAS = ['pix', 'cartao', 'boleto', 'dinheiro'];

// 'YYYY-MM' -> 'YYYY-MM-01'. Sem parâmetro, mês atual (Brasília).
function competencia(mes) {
  if (mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return `${mes}-01`;
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  return `${hoje.slice(0, 7)}-01`;
}

// Cria as mensalidades do mês para todas as matrículas ativas (idempotente).
async function gerarMensalidades(comp, client = db) {
  await client.query(
    `INSERT INTO mensalidades (matricula_id, competencia, vencimento, valor)
     SELECT m.id, $1::date, $1::date + (m.dia_vencimento - 1), c.valor_mensal
       FROM matriculas m
       JOIN cursos c ON c.id = m.curso_id
      WHERE m.ativa
        AND date_trunc('month', m.inicio)::date <= $1::date
     ON CONFLICT (matricula_id, competencia) DO NOTHING`,
    [comp]
  );
}

// Cria aluna + matrícula + primeira mensalidade, dentro de uma transação.
// A primeira mensalidade vence no mínimo 3 dias depois de hoje.
async function matricular(client, { nome, whatsapp, email, nascimento, observacoes, curso_id, forma_pagamento, dia_vencimento }) {
  const curso = await client.query('SELECT id, valor_mensal FROM cursos WHERE id = $1', [curso_id]);
  if (!curso.rowCount) throw httpErro(400, 'Curso não encontrado.');

  const aluna = await client.query(
    `INSERT INTO alunas (nome, whatsapp, email, nascimento, observacoes)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [nome, whatsapp, email || null, nascimento || null, observacoes || null]
  );
  const mat = await client.query(
    `INSERT INTO matriculas (aluna_id, curso_id, forma_pagamento, dia_vencimento)
     VALUES ($1, $2, $3, $4) RETURNING id, dia_vencimento`,
    [aluna.rows[0].id, curso_id, forma_pagamento, dia_vencimento || 10]
  );
  await client.query(
    `INSERT INTO mensalidades (matricula_id, competencia, vencimento, valor, forma_pagamento)
     VALUES ($1, date_trunc('month', CURRENT_DATE)::date,
             GREATEST(date_trunc('month', CURRENT_DATE)::date + ($2 - 1), CURRENT_DATE + 3),
             $3, $4)
     ON CONFLICT DO NOTHING`,
    [mat.rows[0].id, mat.rows[0].dia_vencimento, curso.rows[0].valor_mensal, forma_pagamento]
  );
  return { aluna_id: aluna.rows[0].id, matricula_id: mat.rows[0].id };
}

function httpErro(status, mensagem) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

// Validação simples de campos de pessoa.
function validarPessoa(b) {
  const erros = [];
  const nome = String(b.nome || '').trim();
  const whatsapp = String(b.whatsapp || '').replace(/\D/g, '');
  const email = String(b.email || '').trim().toLowerCase();
  const nascimento = String(b.nascimento || '').trim();
  if (nome.length < 3 || nome.length > 120) erros.push('Informe o nome completo.');
  if (whatsapp.length < 10 || whatsapp.length > 13) erros.push('Informe um WhatsApp válido com DDD.');
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160)) erros.push('E-mail inválido.');
  if (nascimento && !/^\d{4}-\d{2}-\d{2}$/.test(nascimento)) erros.push('Data de nascimento inválida.');
  return {
    erros,
    dados: {
      nome,
      whatsapp,
      email: email || null,
      nascimento: nascimento || null,
      observacoes: String(b.observacoes || '').trim().slice(0, 1000) || null,
    },
  };
}

// Expressão SQL da situação de uma mensalidade (alias "ms").
const SITUACAO_SQL = `CASE WHEN ms.pago_em IS NOT NULL THEN 'pago'
                           WHEN ms.vencimento < CURRENT_DATE THEN 'atrasado'
                           ELSE 'a_vencer' END`;

module.exports = { FORMAS, competencia, gerarMensalidades, matricular, httpErro, validarPessoa, SITUACAO_SQL };

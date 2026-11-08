// Serviço de WhatsApp: configurações, textos automáticos, envio e registro das conversas.
const crypto = require('crypto');
const db = require('../db');
const evo = require('./evolution');
const { gerarMensalidades, competencia } = require('../servicos');

const ATELIE = process.env.ATELIE_NOME || 'Trinar Ateliê Criativo';

const PADRAO = {
  automacoes: {
    inscricao_recebida: true, // aluna recebe "recebemos sua inscrição"
    aviso_dona: true,         // dona recebe aviso de nova inscrição no número pessoal
    boas_vindas: true,        // ao confirmar a vaga
    lembrete: true,           // X dias antes do vencimento
    cobranca: true,           // 1 dia depois do vencimento, uma vez
  },
  lembrete_dias_antes: 2,
  chave_pix: '',
  numero_dona: '',
  textos: {
    inscricao_recebida: 'Olá, {nome}! Recebemos sua inscrição em {curso} no {atelie}. Em breve confirmamos sua vaga por aqui.',
    lista_espera: 'Olá, {nome}! A turma de {curso} está cheia no momento, mas você entrou na nossa lista de espera. Avisamos por aqui assim que abrir uma vaga.',
    boas_vindas: 'Olá, {nome}! Sua vaga em {curso} ({horario}) está confirmada. Seja muito bem-vinda ao {atelie}! A mensalidade de {valor} vence todo dia {dia}. Qualquer dúvida, é só responder esta mensagem.',
    lembrete: 'Oi, {nome}! Passando para lembrar que a mensalidade de {curso} ({valor}) vence em {vencimento}. {pagamento}',
    cobranca: 'Oi, {nome}, tudo bem? Ainda não identificamos o pagamento da mensalidade de {curso} ({valor}), que venceu em {vencimento}. {pagamento} Se já pagou, é só nos enviar o comprovante por aqui.',
    aviso_dona: 'Nova inscrição pelo site: {nome} em {curso} ({whatsapp}). Confirme no painel: {painel}',
  },
};

// ---------- utilidades ----------
function numeroWhats(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d;
}
const moeda = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
function formatarTel(t) {
  let d = String(t || '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}
const primeiroNome = (n) => String(n || '').trim().split(/\s+/)[0] || '';

function preencher(modelo, vars) {
  return String(modelo || '')
    .replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''))
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function tokenWebhook() {
  if (process.env.WHATSAPP_WEBHOOK_TOKEN) return process.env.WHATSAPP_WEBHOOK_TOKEN;
  const segredo = process.env.SESSION_SECRET || 'dev';
  return crypto.createHmac('sha256', segredo).update('whatsapp-webhook').digest('hex').slice(0, 32);
}

// ---------- configurações ----------
async function lerConfig() {
  const { rows } = await db.query(`SELECT valor FROM configuracoes WHERE chave = 'whatsapp'`);
  const salvo = rows[0]?.valor || {};
  return {
    ...PADRAO,
    ...salvo,
    automacoes: { ...PADRAO.automacoes, ...(salvo.automacoes || {}) },
    textos: { ...PADRAO.textos, ...(salvo.textos || {}) },
    numero_dona: salvo.numero_dona || process.env.ATELIE_WHATSAPP_DONA || '',
  };
}

async function salvarConfig(novo) {
  const atual = await lerConfig();
  const cfg = {
    automacoes: Object.fromEntries(Object.keys(PADRAO.automacoes).map((k) => [k, Boolean(novo.automacoes?.[k] ?? atual.automacoes[k])])),
    lembrete_dias_antes: Math.min(10, Math.max(0, parseInt(novo.lembrete_dias_antes ?? atual.lembrete_dias_antes, 10) || 0)),
    chave_pix: String(novo.chave_pix ?? atual.chave_pix).slice(0, 140),
    numero_dona: String(novo.numero_dona ?? atual.numero_dona).replace(/\D/g, '').slice(0, 13),
    textos: Object.fromEntries(Object.keys(PADRAO.textos).map((k) => {
      const t = String(novo.textos?.[k] ?? atual.textos[k]).trim().slice(0, 1000);
      return [k, t || PADRAO.textos[k]];
    })),
  };
  await db.query(
    `INSERT INTO configuracoes (chave, valor) VALUES ('whatsapp', $1)
     ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`, [cfg]);
  return cfg;
}

// ---------- estado da conexão (cache curto para não sobrecarregar a API) ----------
let cacheEstado = { em: 0, valor: null };
async function estado(forcar = false) {
  if (!evo.configurado()) return 'nao_configurado';
  if (!forcar && cacheEstado.valor && Date.now() - cacheEstado.em < 20000) return cacheEstado.valor;
  try {
    const v = await evo.estado();
    cacheEstado = { em: Date.now(), valor: v };
    return v;
  } catch (e) {
    console.error('[whatsapp] estado:', e.message);
    return 'erro';
  }
}
function definirEstado(v) { cacheEstado = { em: Date.now(), valor: v }; }

// ---------- envio ----------
// Envia e registra na conversa. Nunca lança erro: devolve { ok, erro }.
async function enviar({ telefone, texto, tipo = 'manual' }) {
  const numero = numeroWhats(telefone);
  if (numero.length < 12) return { ok: false, erro: 'Número de WhatsApp inválido.' };
  if (!texto || !String(texto).trim()) return { ok: false, erro: 'Mensagem vazia.' };
  let waId = null;
  let erro = null;
  try {
    if ((await estado()) !== 'open') throw new Error('O WhatsApp do ateliê não está conectado.');
    waId = await evo.enviarTexto(numero, texto);
  } catch (e) {
    erro = e.message;
  }
  await db.query(
    `INSERT INTO whatsapp_mensagens (telefone, direcao, texto, tipo, status, erro, wa_id)
     VALUES ($1, 'saida', $2, $3, $4, $5, $6)
     ON CONFLICT (wa_id) DO UPDATE SET tipo = EXCLUDED.tipo, status = EXCLUDED.status, texto = EXCLUDED.texto`,
    [numero, texto, tipo, erro ? 'erro' : 'enviada', erro, waId]);
  if (erro) console.warn(`[whatsapp] falha ao enviar (${tipo}) para ${numero}: ${erro}`);
  return { ok: !erro, erro };
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const INTERVALO = parseInt(process.env.WHATSAPP_INTERVALO_MS || '4000', 10); // pausa mínima entre envios em lote
// Envio em sequência com intervalo aleatório (reduz risco de bloqueio do número).
async function enviarEmLote(itens, aoEnviar) {
  let ok = 0;
  for (const [i, item] of itens.entries()) {
    if (i > 0) await espera(INTERVALO + Math.random() * INTERVALO * 1.25);
    const r = await enviar(item);
    if (r.ok) ok += 1;
    if (aoEnviar) await aoEnviar(item, r).catch(() => {});
  }
  return { total: itens.length, enviadas: ok };
}

// ---------- eventos automáticos ----------
const pagamentoTexto = (cfg) => (cfg.chave_pix ? `Chave Pix: ${cfg.chave_pix}.` : '');

async function aoReceberInscricao({ nome, whatsapp, curso, lista_espera }) {
  const cfg = await lerConfig();
  const vars = { nome: primeiroNome(nome), curso, atelie: ATELIE };
  if (cfg.automacoes.inscricao_recebida) {
    await enviar({ telefone: whatsapp, tipo: 'inscricao_recebida',
      texto: preencher(lista_espera ? cfg.textos.lista_espera : cfg.textos.inscricao_recebida, vars) });
  }
  if (cfg.automacoes.aviso_dona && cfg.numero_dona) {
    const painel = process.env.APP_URL ? `${process.env.APP_URL.replace(/\/+$/, '')}/admin` : 'área da professora no site';
    await enviar({ telefone: cfg.numero_dona, tipo: 'aviso_dona',
      texto: preencher(cfg.textos.aviso_dona, { nome, curso: lista_espera ? `${curso} (lista de espera)` : curso,
        whatsapp: formatarTel(whatsapp), painel }) });
  }
}

async function aoConfirmarMatricula(matriculaId) {
  const cfg = await lerConfig();
  if (!cfg.automacoes.boas_vindas) return { ok: false, erro: 'desativado' };
  const { rows } = await db.query(
    `SELECT a.nome, a.whatsapp, c.nome AS curso, c.horario, c.valor_mensal, m.dia_vencimento
       FROM matriculas m JOIN alunas a ON a.id = m.aluna_id JOIN cursos c ON c.id = m.curso_id WHERE m.id = $1`, [matriculaId]);
  if (!rows.length) return { ok: false, erro: 'matrícula não encontrada' };
  const r = rows[0];
  return enviar({ telefone: r.whatsapp, tipo: 'boas_vindas', texto: preencher(cfg.textos.boas_vindas, {
    nome: primeiroNome(r.nome), curso: r.curso, horario: r.horario, valor: moeda(r.valor_mensal),
    dia: r.dia_vencimento, atelie: ATELIE, pagamento: pagamentoTexto(cfg) }) });
}

// Texto de cobrança de uma mensalidade (usado pelo botão do painel e pela rotina).
async function textoMensalidade(mensalidadeId, tipo) {
  const cfg = await lerConfig();
  const { rows } = await db.query(
    `SELECT ms.id, ms.valor, ms.vencimento, a.nome, a.whatsapp, c.nome AS curso
       FROM mensalidades ms JOIN matriculas m ON m.id = ms.matricula_id
       JOIN alunas a ON a.id = m.aluna_id JOIN cursos c ON c.id = m.curso_id WHERE ms.id = $1`, [mensalidadeId]);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    telefone: r.whatsapp,
    tipo,
    texto: preencher(cfg.textos[tipo], { nome: primeiroNome(r.nome), curso: r.curso, valor: moeda(r.valor),
      vencimento: dataBR(r.vencimento), atelie: ATELIE, pagamento: pagamentoTexto(cfg) }),
  };
}

// ---------- rotina diária: lembretes e cobranças ----------
async function rotinaDiaria() {
  if ((await estado(true)) !== 'open') return { pulada: 'WhatsApp não conectado' };
  const cfg = await lerConfig();
  const dias = cfg.lembrete_dias_antes;

  // Garante as mensalidades do mês atual e do mês em que cai o próximo lembrete.
  await gerarMensalidades(competencia());
  const { rows: [{ futuro }] } = await db.query(`SELECT to_char(CURRENT_DATE + $1::int, 'YYYY-MM') AS futuro`, [dias]);
  await gerarMensalidades(competencia(futuro));

  const base = `SELECT ms.id FROM mensalidades ms JOIN matriculas m ON m.id = ms.matricula_id
                 WHERE m.ativa AND ms.pago_em IS NULL`;
  const lembretes = cfg.automacoes.lembrete ? (await db.query(
    `${base} AND ms.lembrete_enviado_em IS NULL AND ms.vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::int
     ORDER BY ms.vencimento`, [dias])).rows : [];
  // Cobra só atrasos recentes (até 30 dias), para não disparar mensagens antigas de uma vez.
  const cobrancas = cfg.automacoes.cobranca ? (await db.query(
    `${base} AND ms.cobranca_enviada_em IS NULL AND ms.vencimento < CURRENT_DATE AND ms.vencimento >= CURRENT_DATE - 30
     ORDER BY ms.vencimento`)).rows : [];

  const itens = [];
  for (const { id } of lembretes) itens.push({ ...(await textoMensalidade(id, 'lembrete')), mensalidadeId: id });
  for (const { id } of cobrancas) itens.push({ ...(await textoMensalidade(id, 'cobranca')), mensalidadeId: id });

  const res = await enviarEmLote(itens, async (item, r) => {
    if (!r.ok) return;
    const col = item.tipo === 'lembrete' ? 'lembrete_enviado_em' : 'cobranca_enviada_em';
    await db.query(`UPDATE mensalidades SET ${col} = now() WHERE id = $1`, [item.mensalidadeId]);
  });
  console.log(`[whatsapp] rotina diária: ${lembretes.length} lembrete(s), ${cobrancas.length} cobrança(s), ${res.enviadas} enviada(s).`);
  return { lembretes: lembretes.length, cobrancas: cobrancas.length, ...res };
}

// Roda a rotina uma vez por dia, entre 9h e 19h (Brasília). Seguro com mais de um dyno.
function iniciarAgendador() {
  if (process.env.WHATSAPP_AGENDADOR === 'false' || !evo.configurado()) return;
  const checar = async () => {
    try {
      const { rows: [{ hoje, hora }] } = await db.query(
        `SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS hoje, extract(hour FROM localtime)::int AS hora`);
      if (hora < 9 || hora >= 19) return;
      const { rowCount } = await db.query(
        `INSERT INTO configuracoes (chave, valor) VALUES ('rotina_whatsapp', to_jsonb($1::text))
         ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor
         WHERE configuracoes.valor <> EXCLUDED.valor`, [hoje]);
      if (rowCount) await rotinaDiaria();
    } catch (e) {
      console.error('[whatsapp] agendador:', e.message);
    }
  };
  setTimeout(checar, 60 * 1000);
  setInterval(checar, 15 * 60 * 1000).unref();
}

// ---------- webhook (mensagens recebidas) ----------
function extrairTexto(msg) {
  if (!msg) return null;
  if (msg.conversation) return msg.conversation;
  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
  if (msg.imageMessage) return `[imagem] ${msg.imageMessage.caption || ''}`.trim();
  if (msg.videoMessage) return `[vídeo] ${msg.videoMessage.caption || ''}`.trim();
  if (msg.audioMessage) return '[áudio]';
  if (msg.documentMessage) return `[documento] ${msg.documentMessage.fileName || ''}`.trim();
  if (msg.documentWithCaptionMessage) return '[documento]';
  if (msg.stickerMessage) return '[figurinha]';
  if (msg.locationMessage) return '[localização]';
  if (msg.contactMessage) return `[contato] ${msg.contactMessage.displayName || ''}`.trim();
  if (msg.reactionMessage) return null; // ignora reações
  if (msg.protocolMessage || msg.senderKeyDistributionMessage) return null;
  return '[mensagem]';
}

async function processarWebhook(payload) {
  const evento = String(payload?.event || '').toLowerCase().replace(/_/g, '.');
  if (evento === 'connection.update') {
    const st = payload?.data?.state;
    if (st) definirEstado(st);
    return;
  }
  if (evento !== 'messages.upsert') return;

  const lista = Array.isArray(payload.data) ? payload.data : payload.data?.messages || [payload.data];
  for (const d of lista) {
    const key = d?.key || {};
    let jid = key.remoteJid || '';
    if (/@g\.us$|status@broadcast|@newsletter$|@broadcast$/.test(jid)) continue;
    if (jid.endsWith('@lid')) jid = key.remoteJidAlt || key.senderPn || d.senderPn || jid;
    const telefone = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
    const texto = extrairTexto(d.message);
    if (!telefone || !texto) continue;
    const fromMe = Boolean(key.fromMe);
    await db.query(
      `INSERT INTO whatsapp_mensagens (telefone, direcao, texto, tipo, status, wa_id, nome_contato, lida, criado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
               -- usa a hora do WhatsApp só para mensagens antigas (sincronização); senão, a hora de chegada
               COALESCE(CASE WHEN to_timestamp($9) < now() - interval '2 minutes' THEN to_timestamp($9) END, now()))
       ON CONFLICT (wa_id) DO NOTHING`,
      [telefone, fromMe ? 'saida' : 'entrada', texto, fromMe ? 'celular' : 'manual', fromMe ? 'enviada' : 'recebida',
       key.id || null, fromMe ? null : (d.pushName || null), fromMe, Number(d.messageTimestamp) || null]);
  }
}

module.exports = {
  PADRAO, lerConfig, salvarConfig, estado, definirEstado, enviar, enviarEmLote, preencher, numeroWhats,
  aoReceberInscricao, aoConfirmarMatricula, textoMensalidade, rotinaDiaria, iniciarAgendador,
  processarWebhook, tokenWebhook, configurado: evo.configurado, evo,
};

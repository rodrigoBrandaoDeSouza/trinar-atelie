// Cliente da Evolution API v2 (WhatsApp open source, conectado por QR code).
// Docs: https://doc.evolution-api.com/v2
const BASE = (process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
const KEY = process.env.EVOLUTION_API_KEY || '';
const INSTANCIA = process.env.EVOLUTION_INSTANCE || 'trinar';

const configurado = () => Boolean(BASE && KEY);

async function chamar(metodo, caminho, body) {
  if (!configurado()) throw new Error('WhatsApp não configurado (EVOLUTION_API_URL / EVOLUTION_API_KEY).');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`${BASE}${caminho}`, {
      method: metodo,
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const txt = await r.text();
    let dados;
    try { dados = txt ? JSON.parse(txt) : {}; } catch { dados = { raw: txt }; }
    if (!r.ok) {
      const msg = dados?.response?.message || dados?.message || dados?.error || `HTTP ${r.status}`;
      const e = new Error(Array.isArray(msg) ? msg.flat().join(' ') : String(msg));
      e.status = r.status;
      e.dados = dados;
      throw e;
    }
    return dados;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('A Evolution API não respondeu a tempo.');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

const EVENTOS = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'];

// 'open' (conectado), 'connecting', 'close' ou 'inexistente'
async function estado() {
  try {
    const r = await chamar('GET', `/instance/connectionState/${encodeURIComponent(INSTANCIA)}`);
    return r?.instance?.state || r?.state || 'close';
  } catch (e) {
    if (e.status === 404) return 'inexistente';
    throw e;
  }
}

// Cria a instância (se preciso), configura o webhook e devolve o QR code.
async function conectar(webhookUrl) {
  const webhook = { enabled: true, url: webhookUrl, byEvents: false, base64: false, events: EVENTOS };
  let qr = null;
  const atual = await estado();
  if (atual === 'inexistente') {
    const r = await chamar('POST', '/instance/create', {
      instanceName: INSTANCIA,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      groupsIgnore: true,
      rejectCall: false,
      webhook,
    });
    qr = r?.qrcode?.base64 || null;
  } else {
    await chamar('POST', `/webhook/set/${encodeURIComponent(INSTANCIA)}`, { webhook });
  }
  if (atual === 'open') return { estado: 'open', qr: null };
  if (!qr) {
    const r = await chamar('GET', `/instance/connect/${encodeURIComponent(INSTANCIA)}`);
    qr = r?.base64 || null;
  }
  return { estado: 'connecting', qr };
}

async function desconectar() {
  await chamar('DELETE', `/instance/logout/${encodeURIComponent(INSTANCIA)}`);
}

// Envia texto. numero = só dígitos com DDI (55...). Retorna o id da mensagem.
async function enviarTexto(numero, texto) {
  const r = await chamar('POST', `/message/sendText/${encodeURIComponent(INSTANCIA)}`, {
    number: numero,
    text: texto,
    delay: 1200, // mostra "digitando..." antes de enviar
  });
  return r?.key?.id || null;
}

module.exports = { configurado, estado, conectar, desconectar, enviarTexto, INSTANCIA };

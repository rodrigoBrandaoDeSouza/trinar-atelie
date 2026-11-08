const crypto = require('crypto');

const COOKIE = 'trinar_sessao';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 dias

let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('SESSION_SECRET não definida. Rode: heroku config:set SESSION_SECRET=$(openssl rand -hex 32)');
    process.exit(1);
  }
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[aviso] SESSION_SECRET não definida; usando uma temporária (sessões caem a cada reinício).');
}

function hashPassword(senha) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(senha, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const got = crypto.scryptSync(senha, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, got);
}

function mac(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
}

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${mac(data)}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(mac(data));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return null;
}

function currentUser(req) {
  return verify(readCookie(req, COOKIE));
}

function startSession(res, user) {
  const token = sign({ id: user.id, nome: user.nome, email: user.email, exp: Date.now() + MAX_AGE_MS });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_MS,
    path: '/',
  });
}

function endSession(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ erro: 'Faça login para continuar.' });
  req.user = user;
  next();
}

module.exports = { hashPassword, verifyPassword, currentUser, startSession, endSession, requireAuth };

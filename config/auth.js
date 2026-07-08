// =====================================================================
// AUTH — poucos logins fixos, senhas com hash bcrypt, sessão via JWT.
// Credenciais vêm de variáveis de ambiente (nunca do código, repo público):
//   AUTH_USERS    = JSON: [{"login":"enrico","name":"Enrico","role":"admin","hash":"$2a$..."}]
//   SESSION_SECRET = string aleatória forte (assina o cookie de sessão)
// Gere hashes com:  npm run hash -- "sua-senha"
// =====================================================================
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const onRailway = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('[auth] SESSION_SECRET não definido — usando segredo aleatório (sessões caem a cada restart). Defina no Railway.');
}

let USERS = [];
try {
  USERS = JSON.parse(process.env.AUTH_USERS || '[]');
} catch (e) {
  console.error('[auth] AUTH_USERS inválido (não é JSON):', e.message);
}
if (!Array.isArray(USERS)) USERS = [];

if (!USERS.length) {
  if (onRailway) {
    console.warn('[auth] AUTH_USERS não definido em produção — NINGUÉM consegue logar até configurar (fail-closed).');
  } else {
    // Fallback apenas para desenvolvimento local (nunca no Railway)
    USERS = [{ login: 'dev', name: 'Dev', role: 'admin', hash: bcrypt.hashSync('dev', 10) }];
    console.warn('[auth] Dev local: usuário "dev" / senha "dev". NÃO use em produção.');
  }
}

// Senhas trocadas em runtime pelo próprio usuário (botão "trocar senha").
// Ficam no store (kv_docs 'auth_pw') e são carregadas no boot; sobrepõem o hash vindo do AUTH_USERS (env).
let pwOverrides = {}; // { loginLower: hash }
function setPasswordOverrides(map) { pwOverrides = (map && typeof map === 'object') ? map : {}; }
function setPasswordOverride(login, hash) { pwOverrides[String(login || '').toLowerCase()] = hash; }
function hashPassword(plain) { return bcrypt.hashSync(String(plain || ''), 10); }

function verifyCredentials(login, password) {
  const u = USERS.find((x) => String(x.login).toLowerCase() === String(login || '').toLowerCase().trim());
  if (!u) return null;
  const effectiveHash = pwOverrides[String(u.login).toLowerCase()] || u.hash; // override do banco vence o env
  if (!effectiveHash) return null;
  if (!bcrypt.compareSync(String(password || ''), effectiveHash)) return null;
  return { login: u.login, name: u.name || u.login, role: u.role || 'user' };
}

function sign(user) {
  return jwt.sign(user, SECRET, { expiresIn: '7d' });
}
function verify(token) {
  try { return jwt.verify(token, SECRET); } catch (e) { return null; }
}

module.exports = { verifyCredentials, sign, verify, onRailway, setPasswordOverrides, setPasswordOverride, hashPassword };

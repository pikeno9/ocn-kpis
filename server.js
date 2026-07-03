const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');
const { fetchAllTabs, fetchUeTabs } = require('./lib/sheet');
const compute = require('./lib/compute');
const ue = require('./lib/ue');
const cobrancas = require('./lib/cobrancas');
const frota = require('./lib/frota');
const revisoes = require('./lib/revisoes');
const utilization = require('./lib/utilization');
const store = require('./lib/store');
const C = require('./config/static');
const auth = require('./config/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 5 * * *';
const refDate = () => (process.env.REFERENCE_DATE ? new Date(process.env.REFERENCE_DATE + 'T12:00:00') : new Date());
const COOKIE = 'ocn_session';

app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json());

// ---------- cache de dados ----------
let cache = { data: null, updatedAt: null, ok: false, error: null };
async function refresh() {
  try {
    const [sheets, ueSheets] = await Promise.all([fetchAllTabs(C.TABS), fetchUeTabs(C.UE_TABS)]);
    const data = compute.build(sheets, refDate());
    data.ue = ue.build(ueSheets, sheets.importData, sheets.clientes, refDate());
    try { data.ue.pagamentos = await cobrancas.fetchPagamentos(); }
    catch (e) { console.error('[cobrancas] falhou:', e.message); data.ue.pagamentos = null; }
    try { data.ue.frota = await frota.fetchFrota(); }
    catch (e) { console.error('[frota] falhou:', e.message); data.ue.frota = null; }
    try { data.ue.revisoes = await revisoes.fetchRevisoes(); }
    catch (e) { console.error('[revisoes] falhou:', e.message); data.ue.revisoes = {}; }
    try { data.utilization = utilization.build(sheets.importData, data.ue.frota, refDate(), data.ue.losses); }
    catch (e) { console.error('[utilization] falhou:', e.message); data.utilization = null; }
    cache = { data, updatedAt: new Date().toISOString(), ok: true, error: null };
    console.log(`[refresh] OK — ${data.kpis.recebidosAno} carros, ${data.ocorrencias.total} ocorrências (${cache.updatedAt})`);
  } catch (e) {
    cache.ok = false; cache.error = e.message;
    console.error('[refresh] FALHOU:', e.message);
  }
  return cache.ok;
}

// ======================= ROTAS PÚBLICAS =======================
app.get('/health', (_req, res) => res.json({ ok: true, dataOk: cache.ok, updatedAt: cache.updatedAt }));
app.get('/login', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.use('/brand', express.static(path.join(__dirname, 'public', 'brand')));
app.get('/favicon.ico', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'favicon.ico')));

app.post('/api/login', (req, res) => {
  const user = auth.verifyCredentials(req.body && req.body.login, req.body && req.body.password);
  if (!user) return res.status(401).json({ error: 'Invalid login or password.' });
  const token = auth.sign(user);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: auth.onRailway, maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.json({ ok: true, user });
});
app.post('/api/logout', (_req, res) => { res.clearCookie(COOKIE); res.json({ ok: true }); });

// ======================= GATING =======================
function requireAuth(req, res, next) {
  const user = auth.verify(req.cookies && req.cookies[COOKIE]);
  if (user) { req.user = user; return next(); }
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'não autenticado' });
  return res.redirect('/login');
}
app.use(requireAuth);

// ======================= ROTAS PROTEGIDAS =======================
app.get('/api/data', (req, res) => {
  if (cache.data) return res.json({ ...cache.data, _meta: { updatedAt: cache.updatedAt, live: cache.ok, user: req.user } });
  res.status(503).json({ error: cache.error || 'dados ainda não disponíveis' });
});
app.get('/api/refresh', async (_req, res) => {
  const ok = await refresh();
  res.status(ok ? 200 : 502).json({ ok, updatedAt: cache.updatedAt, error: cache.error });
});
app.get('/api/me', (req, res) => res.json({ user: req.user }));

// ---------- Unit Economics: valores realizados/projetados ----------
// Settings globais (% do Security Deposit Refund) — qualquer usuário autenticado pode alterar
const UE_SETTINGS = ['__refund_pct__'];
app.post('/api/ue/setting', async (req, res) => {
  const b = req.body || {};
  const line = String(b.line || '');
  const value = Number(b.value);
  if (!UE_SETTINGS.includes(line) || !isFinite(value)) return res.status(400).json({ error: 'inválido' });
  try { await store.set({ fleetId: '__cfg__', line, period: 0, value, kind: 'real', user: req.user.login }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ error: 'apenas administradores podem editar' });
}
app.get('/api/ue/values', async (req, res) => {
  try { res.json({ values: await store.getFleet(String(req.query.fleet || '')) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/ue/value', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const fleet = String(b.fleet || '').trim();
  const line = String(b.line || '').trim();
  const period = parseInt(b.period, 10);
  const value = Number(b.value);
  const kind = b.kind === 'proj' ? 'proj' : 'real';
  if (!fleet || !line || !(period >= 0 && period <= 24) || !isFinite(value)) {
    return res.status(400).json({ error: 'dados inválidos' });
  }
  try { await store.set({ fleetId: fleet, line, period, value, kind, user: req.user.login }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/ue/values/bulk', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const fleet = String(b.fleet || '').trim();
  const items = Array.isArray(b.items) ? b.items : [];
  if (!fleet || !items.length) return res.status(400).json({ error: 'dados inválidos' });
  try {
    let n = 0;
    for (const it of items) {
      const line = String(it.line || '').trim();
      const period = parseInt(it.period, 10);
      const value = Number(it.value);
      const kind = it.kind === 'proj' ? 'proj' : 'real';
      if (!line || !(period >= 0 && period <= 24) || !isFinite(value)) continue;
      await store.set({ fleetId: fleet, line, period, value, kind, user: req.user.login });
      n++;
    }
    res.json({ ok: true, n });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/ue/value/delete', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const fleet = String(b.fleet || '').trim();
  const line = String(b.line || '').trim();
  const period = parseInt(b.period, 10);
  if (!fleet || !line || !(period >= 0)) return res.status(400).json({ error: 'dados inválidos' });
  try { await store.del({ fleetId: fleet, line, period }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, async () => {
  console.log(`OCN KPIs rodando na porta ${PORT}`);
  try { await store.init(); } catch (e) { console.error('[store] init falhou:', e.message); }
  await refresh();
  cron.schedule(CRON_SCHEDULE, refresh, { timezone: 'America/Sao_Paulo' });
  console.log(`[cron] agendado: "${CRON_SCHEDULE}" (America/Sao_Paulo)`);
});

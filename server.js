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
const payments = require('./lib/payments');
const ocorrSite = require('./lib/ocorrenciasSite');
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
let frozen = false; // congela as atualizações automáticas (cron/boot/manual) — toggle via /api/freeze (admin)
async function refresh(force) {
  // só força com `true` explícito; qualquer outro argumento (ex.: o Date que o node-cron passa) NÃO fura o freeze
  if (frozen && force !== true) { console.log('[refresh] pulado — dados congelados (freeze ligado)'); return cache.ok; }
  try {
    const [sheets, ueSheets] = await Promise.all([fetchAllTabs(C.TABS), fetchUeTabs(C.UE_TABS)]);
    // mescla ocorrências NOVAS do site (painel de cobranças) na base da planilha; falha não derruba o refresh
    try {
      const siteOcorr = await ocorrSite.fetchSite();
      const antes = sheets.ocorrencias.length;
      sheets.ocorrencias = ocorrSite.mergeIntoSheet(sheets.ocorrencias, siteOcorr);
      console.log(`[ocorrencias-site] ${siteOcorr.length} no site, +${sheets.ocorrencias.length - antes} novas mescladas`);
    } catch (e) { console.error('[ocorrencias-site] falhou (usando só a planilha):', e.message); }
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
    try {
      const [matriz, esperado] = await Promise.all([payments.fetchMatriz(), payments.fetchResumo()]);
      data.payments = payments.build(matriz, sheets.clientes, refDate(), esperado);
    }
    catch (e) { console.error('[payments] falhou:', e.message); data.payments = null; }
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
// Seções restritas a não-admin (visualizador): sub-aba -> chaves de dados removidas do payload.
// Bloqueio REAL: o visualizador não recebe esses dados (nem via dev tools / chamada direta à API).
const RESTRICTED_NON_ADMIN = { unit: ['ue'], indrive: ['inDrive'], headcount: ['rh'] };
app.get('/api/data', (req, res) => {
  if (!cache.data) return res.status(503).json({ error: cache.error || 'dados ainda não disponíveis' });
  const isAdmin = !!(req.user && req.user.role === 'admin');
  let payload = cache.data;
  const hiddenSubs = [];
  if (!isAdmin) {
    payload = { ...cache.data }; // clone raso: apagar chaves top-level não mexe no cache
    for (const [sub, keys] of Object.entries(RESTRICTED_NON_ADMIN)) {
      keys.forEach((k) => { delete payload[k]; });
      hiddenSubs.push(sub);
    }
  }
  res.json({ ...payload, _meta: { updatedAt: cache.updatedAt, live: cache.ok, user: req.user, frozen, hiddenSubs } });
});
app.get('/api/refresh', async (_req, res) => {
  const ok = await refresh();
  res.status(ok ? 200 : 502).json({ ok, updatedAt: cache.updatedAt, error: cache.error });
});
app.get('/api/me', (req, res) => res.json({ user: req.user }));

// ---------- Trocar a própria senha (qualquer usuário autenticado) ----------
// Confere a senha atual e grava a nova (hash) no store como override, sobre o AUTH_USERS do env.
app.post('/api/change-password', async (req, res) => {
  const cur = String((req.body && req.body.currentPassword) || '');
  const nw = String((req.body && req.body.newPassword) || '');
  if (nw.length < 8) return res.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres.' });
  if (!auth.verifyCredentials(req.user.login, cur)) return res.status(400).json({ error: 'Senha atual incorreta.' });
  try {
    const hash = auth.hashPassword(nw);
    const doc = (await store.getDoc('auth_pw')) || {};
    doc[String(req.user.login).toLowerCase()] = hash;
    await store.setDoc('auth_pw', doc, req.user.login);
    auth.setPasswordOverride(req.user.login, hash);
    console.log(`[change-password] senha atualizada para ${req.user.login}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- Freeze: congela/descongela as atualizações automáticas (estado global) ----------
app.get('/api/freeze', (req, res) => res.json({ frozen }));
// só admin altera; ao descongelar, dispara um refresh imediato
// (requireAdmin é definido mais abaixo, mas hoisted não se aplica a const; então checa inline)
app.post('/api/freeze', async (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'apenas administradores podem congelar/descongelar' });
  frozen = !!(req.body && req.body.frozen);
  try {
    await store.setDoc('freeze', { frozen }, req.user.login);
    // ao congelar, salva o SNAPSHOT INTEIRO — assim o congelamento sobrevive a restart/deploy
    if (frozen) await store.setDoc('freeze_snapshot', { data: cache.data, updatedAt: cache.updatedAt }, req.user.login);
  } catch (e) { console.error('[freeze] persistência falhou:', e.message); }
  console.log(`[freeze] ${frozen ? 'LIGADO' : 'desligado'} por ${req.user.login}`);
  if (!frozen) { try { await refresh(); } catch (e) {} } // ao descongelar, atualiza já
  res.json({ ok: true, frozen, updatedAt: cache.updatedAt });
});

// ---------- Organograma (Headcount): overrides de nome/cargo por nó ----------
app.get('/api/org', async (req, res) => {
  try { res.json({ overrides: (await store.getDoc('org')) || {} }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

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

// edição de um nó do organograma (nome/cargo) — só admin
app.post('/api/org', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const id = String(b.id || '').trim();
  if (!id) return res.status(400).json({ error: 'id obrigatório' });
  try {
    const cur = (await store.getDoc('org')) || {};
    cur[id] = { name: String(b.name == null ? '' : b.name).slice(0, 120), title: String(b.title == null ? '' : b.title).slice(0, 200) };
    await store.setDoc('org', cur, req.user.login);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
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

// ---------- Migração de dados manuais entre ambientes (main <-> experimentos) ----------
// Exporta TODOS os dados manuais (Unit Economics + overrides + organograma) como JSON.
// Não inclui o estado de freeze (é específico do ambiente e o snapshot é enorme).
app.get('/api/store/export', requireAdmin, async (req, res) => {
  try {
    const dump = await store.dumpAll();
    if (dump && dump.docs) { delete dump.docs.freeze; delete dump.docs.freeze_snapshot; }
    res.setHeader('Content-Disposition', 'attachment; filename="ocn-kpis-dados-manuais.json"');
    res.json({ exportedAt: new Date().toISOString(), ...dump });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Importa (upsert) os dados manuais exportados de outro ambiente. Sobrescreve os valores existentes.
app.post('/api/store/import', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const rows = Array.isArray(b.ue_values) ? b.ue_values : [];
  const docs = b.docs && typeof b.docs === 'object' ? b.docs : {};
  try {
    let nv = 0, nd = 0;
    for (const it of rows) {
      const fleet = String(it.fleetId || it.fleet || '').trim();
      const line = String(it.line || '').trim();
      const period = parseInt(it.period, 10);
      const value = Number(it.value);
      const kind = it.kind === 'proj' ? 'proj' : 'real';
      if (!fleet || !line || !(period >= 0 && period <= 120) || !isFinite(value)) continue;
      await store.set({ fleetId: fleet, line, period, value, kind, user: req.user.login });
      nv++;
    }
    for (const [k, v] of Object.entries(docs)) {
      if (k === 'freeze' || k === 'freeze_snapshot') continue; // não mexe no freeze do ambiente de destino
      await store.setDoc(k, v, req.user.login);
      nd++;
    }
    console.log(`[store/import] ${nv} valores + ${nd} docs importados por ${req.user.login}`);
    res.json({ ok: true, values: nv, docs: nd });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, async () => {
  console.log(`OCN KPIs rodando na porta ${PORT}`);
  try { await store.init(); } catch (e) { console.error('[store] init falhou:', e.message); }
  try { const pw = await store.getDoc('auth_pw'); auth.setPasswordOverrides(pw || {}); } catch (e) {}
  try { const f = await store.getDoc('freeze'); frozen = !!(f && f.frozen); } catch (e) {}
  if (frozen) {
    // congelado: restaura o snapshot salvo (não busca dados frescos), sobrevivendo ao restart
    let snap = null;
    try { snap = await store.getDoc('freeze_snapshot'); } catch (e) {}
    if (snap && snap.data) { cache = { data: snap.data, updatedAt: snap.updatedAt || null, ok: true, error: null }; console.log('[freeze] LIGADO — snapshot restaurado do store (sem buscar dados novos)'); }
    else { await refresh(true); console.log('[freeze] LIGADO mas sem snapshot salvo — fez refresh de boot (fallback)'); }
  } else {
    await refresh(); // não congelado: refresh normal de boot
  }
  // wrapper sem args: o node-cron passa um Date pro callback; chamar refresh() direto evita que esse Date vire `force`
  cron.schedule(CRON_SCHEDULE, () => refresh(), { timezone: 'America/Sao_Paulo' });
  console.log(`[cron] agendado: "${CRON_SCHEDULE}" (America/Sao_Paulo)`);
});

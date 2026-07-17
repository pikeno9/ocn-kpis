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
// unittheoric/pnl/fleetplan/finassump não têm chave em /api/data (dados vêm de /api/ue/values e
// /api/finance/*); [] só esconde a sub-aba (hiddenSubs). Sem sub-aba visível, a aba principal some.
const RESTRICTED_NON_ADMIN = { unit: ['ue'], headcount: ['rh'], unittheoric: [], pnl: [], fleetplan: [], finassump: [], finhc: [], finadmin: [], fincac: [] };
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
  const fleet = String(req.query.fleet || '');
  // dados do Unit Economics Theoric e do Finance são restritos a admin (bloqueio real, não só visual)
  if ((fleet.startsWith('__theoric_') || fleet.startsWith('__fin_')) && !(req.user && req.user.role === 'admin')) {
    return res.status(403).json({ error: 'apenas administradores' });
  }
  try { res.json({ values: await store.getFleet(fleet) }); }
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

// ---------- Unit Economics Theoric: lista de modelos de carro (editável por admin) ----------
const THEORIC_SEED = [
  { id: 'Polo', name: 'Polo Track', color: '#3B0A91' },
  { id: 'Argo', name: 'Argo Drive', color: '#7C3AED' },
  { id: 'Tera', name: 'Tera', color: '#DDD6FE' },
];
const THEORIC_PALETTE = ['#5A00F8', '#0EA5E9', '#F97316', '#16A34A', '#DB2777', '#CA8A04', '#0D9488', '#9333EA'];
app.get('/api/theoric/models', requireAdmin, async (req, res) => {
  try { const stored = await store.getDoc('theoric_models'); res.json({ models: (Array.isArray(stored) && stored.length) ? stored : THEORIC_SEED }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/theoric/models', requireAdmin, async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'nome do modelo é obrigatório' });
  try {
    const stored = await store.getDoc('theoric_models');
    const list = (Array.isArray(stored) && stored.length) ? stored.slice() : THEORIC_SEED.slice();
    let base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'model';
    let id = base, i = 2; while (list.some((m) => m.id === id)) { id = base + '_' + i; i++; }
    const color = THEORIC_PALETTE[list.length % THEORIC_PALETTE.length];
    const added = { id, name, color };
    list.push(added);
    await store.setDoc('theoric_models', list, req.user.login);
    res.json({ ok: true, models: list, added });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- Finance: plano de frota (coortes dinâmicas) ----------
// Cada coorte = um lote: { id, model (id do modelo do Theoric), month (0..11 de 2026),
// week (1..5 = semana do mês do recebimento — entra pro-rata), qty }.
// Seed = o plano do Excel "(09.06.26) BR - P&L projection" (F1..F23, 775 carros).
const FIN_COHORT_SEED = [
  { id: 'F1', model: 'Polo', month: 3, week: 2, qty: 50 }, { id: 'F2', model: 'Argo', month: 4, week: 2, qty: 30 },
  { id: 'F3', model: 'Polo', month: 4, week: 3, qty: 25 }, { id: 'F4', model: 'Argo', month: 5, week: 1, qty: 33 },
  { id: 'F5', model: 'Argo', month: 5, week: 2, qty: 6 }, { id: 'F6', model: 'Polo', month: 5, week: 3, qty: 25 },
  { id: 'F7', model: 'Polo', month: 6, week: 1, qty: 25 }, { id: 'F8', model: 'Polo', month: 6, week: 2, qty: 25 },
  { id: 'F9', model: 'Polo', month: 6, week: 3, qty: 24 }, { id: 'F10', model: 'Polo', month: 7, week: 2, qty: 28 },
  { id: 'F11', model: 'Polo', month: 7, week: 3, qty: 28 }, { id: 'F12', model: 'Polo', month: 7, week: 4, qty: 28 },
  { id: 'F13', model: 'Polo', month: 8, week: 1, qty: 34 }, { id: 'F14', model: 'Polo', month: 8, week: 2, qty: 30 },
  { id: 'F15', model: 'Polo', month: 8, week: 3, qty: 30 }, { id: 'F16', model: 'Polo', month: 9, week: 1, qty: 36 },
  { id: 'F17', model: 'Polo', month: 9, week: 2, qty: 36 }, { id: 'F18', model: 'Polo', month: 9, week: 3, qty: 34 },
  { id: 'F19', model: 'Polo', month: 10, week: 2, qty: 50 }, { id: 'F20', model: 'Polo', month: 10, week: 3, qty: 50 },
  { id: 'F21', model: 'Polo', month: 10, week: 4, qty: 47 }, { id: 'F22', model: 'Polo', month: 10, week: 5, qty: 50 },
  { id: 'F23', model: 'Polo', month: 11, week: 1, qty: 51 },
];
app.get('/api/finance/cohorts', requireAdmin, async (req, res) => {
  try { const c = await store.getDoc('fin_cohorts'); res.json({ cohorts: (Array.isArray(c) && c.length) ? c : FIN_COHORT_SEED }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/finance/cohorts', requireAdmin, async (req, res) => {
  const list = Array.isArray(req.body && req.body.cohorts) ? req.body.cohorts : null;
  if (!list) return res.status(400).json({ error: 'cohorts deve ser uma lista' });
  const clean = list.slice(0, 200).map((c, i) => ({
    id: String(c.id || ('c' + i)).slice(0, 40),
    model: String(c.model || '').slice(0, 40),
    month: Math.max(0, Math.min(11, parseInt(c.month, 10) || 0)),
    week: Math.max(1, Math.min(5, parseInt(c.week, 10) || 1)),
    qty: Math.max(0, Number(c.qty) || 0),
  })).filter((c) => c.model);
  try { await store.setDoc('fin_cohorts', clean, req.user.login); res.json({ ok: true, cohorts: clean }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- Finance: headcount (cargos + plano mensal) ----------
// { roles: [{id,name,salary,meal,health,taxPct,bonus}], plan: { roleId: [12 números] } }
const FIN_SEED = require('./config/finance-seed');
app.get('/api/finance/hc', requireAdmin, async (req, res) => {
  try { const d = await store.getDoc('fin_hc'); res.json({ hc: (d && Array.isArray(d.roles) && d.roles.length) ? d : FIN_SEED.HC }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/finance/hc', requireAdmin, async (req, res) => {
  const b = (req.body && req.body.hc) || null;
  if (!b || !Array.isArray(b.roles)) return res.status(400).json({ error: 'hc.roles deve ser uma lista' });
  const num = (v) => Math.max(0, Number(v) || 0);
  const roles = b.roles.slice(0, 100).map((r, i) => ({
    id: String(r.id || ('r' + i)).slice(0, 40),
    name: String(r.name || '').slice(0, 80),
    salary: num(r.salary), meal: num(r.meal), health: num(r.health),
    taxPct: num(r.taxPct), bonus: num(r.bonus),
  })).filter((r) => r.name);
  const plan = {};
  roles.forEach((r) => {
    const arr = (b.plan && Array.isArray(b.plan[r.id])) ? b.plan[r.id] : [];
    plan[r.id] = Array.from({ length: 12 }, (_, i) => num(arr[i]));
  });
  try { await store.setDoc('fin_hc', { roles, plan }, req.user.login); res.json({ ok: true, hc: { roles, plan } }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- Finance: SG&A (Rent & Utilities / Professional Services / IT, itens × 12 meses) ----------
// { rent: [{label, v:[12]}], prof: [...], it: [...] } — valores positivos (entram negativos no P&L)
function cleanItems(list, max) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, max || 60).map((it) => ({
    label: String(it.label || '').slice(0, 80),
    v: Array.from({ length: 12 }, (_, i) => Math.max(0, Number((it.v || [])[i]) || 0)),
  })).filter((it) => it.label);
}
app.get('/api/finance/sga', requireAdmin, async (req, res) => {
  try { const d = await store.getDoc('fin_sga'); res.json({ sga: (d && Array.isArray(d.rent)) ? d : FIN_SEED.SGA }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/finance/sga', requireAdmin, async (req, res) => {
  const b = (req.body && req.body.sga) || null;
  if (!b) return res.status(400).json({ error: 'sga obrigatório' });
  const sga = { rent: cleanItems(b.rent), prof: cleanItems(b.prof), it: cleanItems(b.it) };
  try { await store.setDoc('fin_sga', sga, req.user.login); res.json({ ok: true, sga }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- Finance: CAC (comissão por carro entregue, Ads, influenciadores) ----------
// { perUnit: USD/carro, ads: [{label, v:[12]}], inf: [{label, price, profiles:[12]}] }
app.get('/api/finance/cac', requireAdmin, async (req, res) => {
  try { const d = await store.getDoc('fin_cac'); res.json({ cac: (d && d.ads) ? d : FIN_SEED.CAC }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/finance/cac', requireAdmin, async (req, res) => {
  const b = (req.body && req.body.cac) || null;
  if (!b) return res.status(400).json({ error: 'cac obrigatório' });
  const cac = {
    perUnit: Math.max(0, Number(b.perUnit) || 0),
    ads: cleanItems(b.ads),
    inf: (Array.isArray(b.inf) ? b.inf : []).slice(0, 20).map((t) => ({
      label: String(t.label || '').slice(0, 80),
      price: Math.max(0, Number(t.price) || 0),
      profiles: Array.from({ length: 12 }, (_, i) => Math.max(0, Number((t.profiles || [])[i]) || 0)),
    })).filter((t) => t.label),
  };
  try { await store.setDoc('fin_cac', cac, req.user.login); res.json({ ok: true, cac }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- Finance: carregar os inputs do Excel (força o seed por seção) ----------
app.post('/api/finance/load-excel', requireAdmin, async (req, res) => {
  const which = String((req.body && req.body.which) || '');
  try {
    if (which === 'cohorts') { await store.setDoc('fin_cohorts', FIN_COHORT_SEED, req.user.login); return res.json({ ok: true, cohorts: FIN_COHORT_SEED }); }
    if (which === 'hc') { await store.setDoc('fin_hc', FIN_SEED.HC, req.user.login); return res.json({ ok: true, hc: FIN_SEED.HC }); }
    if (which === 'sga') { await store.setDoc('fin_sga', FIN_SEED.SGA, req.user.login); return res.json({ ok: true, sga: FIN_SEED.SGA }); }
    if (which === 'cac') { await store.setDoc('fin_cac', FIN_SEED.CAC, req.user.login); return res.json({ ok: true, cac: FIN_SEED.CAC }); }
    return res.status(400).json({ error: 'which deve ser cohorts|hc|sga|cac' });
  } catch (e) { res.status(500).json({ error: e.message }); }
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

const express = require('express');
const path = require('path');
const cron = require('node-cron');
const { fetchAllTabs } = require('./lib/sheet');
const compute = require('./lib/compute');
const C = require('./config/static');

const app = express();
const PORT = process.env.PORT || 3000;
// Cron de atualização (default: diária às 05:00). Ex.: CRON_SCHEDULE="0 */6 * * *"
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 5 * * *';
// Data de referência (default: hoje). Útil para testes: REFERENCE_DATE=2026-06-24
const refDate = () => (process.env.REFERENCE_DATE ? new Date(process.env.REFERENCE_DATE + 'T12:00:00') : new Date());

let cache = { data: null, updatedAt: null, ok: false, error: null };

async function refresh() {
  try {
    const sheets = await fetchAllTabs(C.TABS);
    const data = compute.build(sheets, refDate());
    cache = { data, updatedAt: new Date().toISOString(), ok: true, error: null };
    console.log(`[refresh] OK — ${data.kpis.recebidosAno} carros, ${data.ocorrencias.total} ocorrências (${cache.updatedAt})`);
  } catch (e) {
    cache.ok = false;
    cache.error = e.message;
    console.error('[refresh] FALHOU:', e.message);
  }
  return cache.ok;
}

// API: dados computados (ou 503 se nunca obteve com sucesso → front usa fallback)
app.get('/api/data', (_req, res) => {
  if (cache.data) return res.json({ ...cache.data, _meta: { updatedAt: cache.updatedAt, live: cache.ok } });
  res.status(503).json({ error: cache.error || 'dados ainda não disponíveis' });
});

app.get('/api/refresh', async (_req, res) => {
  const ok = await refresh();
  res.status(ok ? 200 : 502).json({ ok, updatedAt: cache.updatedAt, error: cache.error });
});

app.get('/health', (_req, res) => res.json({ ok: true, dataOk: cache.ok, updatedAt: cache.updatedAt }));

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, async () => {
  console.log(`OCN KPIs rodando na porta ${PORT}`);
  await refresh(); // primeira carga
  cron.schedule(CRON_SCHEDULE, refresh, { timezone: 'America/Sao_Paulo' });
  console.log(`[cron] agendado: "${CRON_SCHEDULE}" (America/Sao_Paulo)`);
});

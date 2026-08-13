// =====================================================================
// FROTA — puxa odômetro + última revisão concluída por placa do site
// ocn-frota e devolve { placas: { PLACA: { odo, lastKm, lastAt, ok, driver } } }.
//   odo    = odômetro atual (km)
//   lastKm = km da última revisão CONCLUÍDA no site (null se nenhuma)
//   lastAt = data da última revisão concluída (ISO)
//   ok     = carro ativo e sincronizado (odômetro confiável p/ projeção)
//   driver = motorista atual (para o painel de Utilization)
// A API só expõe a última revisão de cada carro — as anteriores (quando
// houver 2+) têm o mês inferido pelo ritmo de km da própria placa.
// =====================================================================
const C = require('../config/static');

async function fetchFrota() {
  if (!C.FROTA_TOKEN) throw new Error('FROTA_TOKEN não definido');
  const r = await fetch(C.FROTA_API, { headers: { Authorization: 'Bearer ' + C.FROTA_TOKEN } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  const placas = {};
  for (const v of (d && d.vehicles) || []) {
    const plate = String(v.plate || '').toUpperCase();
    if (!plate) continue;
    placas[plate] = {
      odo: Number(v.odometer_km) || 0,
      lastKm: v.last_service_km ? Number(v.last_service_km) : null,
      lastAt: v.last_service_at || null,
      ok: String(v.status || '').toLowerCase() === 'active' && v.synced !== false && !!v.last_sync_at,
      driver: v.driver || null,
    };
  }
  return { as_of: (d && d.as_of) || null, placas };
}

// ---- HISTÓRICO de km por SEMANA, placa a placa (resource=readings) ----
// O site guarda leituras de odômetro desde abril (~3/dia). Aqui viram km rodado por semana
// (segunda a domingo): base da análise de "queda brusca de uso" — carro que some do uso
// normal costuma anteceder recuperação. Grade de semanas GLOBAL + um array por placa.
async function fetchKmSemanal(plates) {
  if (!C.FROTA_TOKEN) throw new Error('FROTA_TOKEN não definido');
  const monday = (d) => { const x = new Date(d); x.setUTCHours(12, 0, 0, 0); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
  const perPlate = {};
  let firstWeek = null, lastWeek = null;
  const fetchOne = async (plate) => {
    try {
      const r = await fetch(C.FROTA_API + '?resource=readings&plate=' + encodeURIComponent(plate) + '&limit=500', { headers: { Authorization: 'Bearer ' + C.FROTA_TOKEN } });
      if (!r.ok) return;
      const d = await r.json();
      // odômetro MÁXIMO por dia -> km da semana = último dia da semana − último dia da anterior
      const byDay = {};
      for (const l of (d.leituras || [])) {
        const day = String(l.lido_em || '').slice(0, 10);
        const km = Number(l.odometro_km);
        if (!day || !isFinite(km) || km <= 0) continue;
        if (byDay[day] == null || km > byDay[day]) byDay[day] = km;
      }
      const days = Object.keys(byDay).sort();
      if (days.length < 2) return;
      const byWeek = {};   // última leitura de cada semana
      for (const day of days) { const w = monday(day + 'T12:00:00Z'); byWeek[w] = byDay[day]; }
      const weeks = Object.keys(byWeek).sort();
      const out = {};
      for (let i = 1; i < weeks.length; i++) {
        const km = byWeek[weeks[i]] - byWeek[weeks[i - 1]];
        if (km >= 0 && km < 6000) out[weeks[i]] = Math.round(km);   // salto absurdo = troca de odômetro/ruído
      }
      if (!Object.keys(out).length) return;
      perPlate[plate] = out;
      const ws = Object.keys(out).sort();
      if (!firstWeek || ws[0] < firstWeek) firstWeek = ws[0];
      if (!lastWeek || ws[ws.length - 1] > lastWeek) lastWeek = ws[ws.length - 1];
    } catch (e) { /* placa sem leitura não derruba o resto */ }
  };
  // concorrência limitada: ~170 placas sem estourar a API
  const queue = [...plates];
  await Promise.all(Array.from({ length: 8 }, async () => { while (queue.length) await fetchOne(queue.shift()); }));
  if (!firstWeek) return null;
  // grade global de semanas + array alinhado por placa (null = sem leitura naquela semana)
  const weeks = [];
  for (let d = new Date(firstWeek + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= lastWeek; d.setUTCDate(d.getUTCDate() + 7)) weeks.push(d.toISOString().slice(0, 10));
  const placas = {};
  Object.entries(perPlate).forEach(([pl, byW]) => { placas[pl] = weeks.map((w) => (byW[w] != null ? byW[w] : null)); });
  return { weeks, placas };
}

module.exports = { fetchFrota, fetchKmSemanal };

// =====================================================================
// FROTA — puxa odômetro + última revisão concluída por placa do site
// ocn-frota e devolve { placas: { PLACA: { odo, lastKm, lastAt, ok } } }.
//   odo    = odômetro atual (km)
//   lastKm = km da última revisão CONCLUÍDA no site (null se nenhuma)
//   lastAt = data da última revisão concluída (ISO)
//   ok     = carro ativo e sincronizado (odômetro confiável p/ projeção)
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
    };
  }
  return { as_of: (d && d.as_of) || null, placas };
}

module.exports = { fetchFrota };

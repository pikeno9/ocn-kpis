// =====================================================================
// FROTA — puxa odômetro + revisões reais por carro do site ocn-frota
// e agrega por frota: { "1": { count, synced, cars: [{odo, done}] } }.
//   odo  = odômetro atual (km)
//   done = nº de revisões já feitas = round(last_service_km / 10.000)
// Só carros ativos e sincronizados entram (odômetro confiável).
// =====================================================================
const C = require('./../config/static');

async function fetchFrota() {
  if (!C.FROTA_TOKEN) throw new Error('FROTA_TOKEN não definido');
  const r = await fetch(C.FROTA_API, { headers: { Authorization: 'Bearer ' + C.FROTA_TOKEN } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  const vehicles = Array.isArray(d && d.vehicles) ? d.vehicles : [];

  const fleets = {};
  for (const v of vehicles) {
    const fleet = String(v.fleet == null ? '' : v.fleet).trim();
    if (!fleet) continue;
    if (!fleets[fleet]) fleets[fleet] = { count: 0, synced: 0, cars: [] };
    const f = fleets[fleet];
    f.count++;
    const active = String(v.status || '').toLowerCase() === 'active';
    const synced = v.synced !== false && v.last_sync_at;
    if (!active || !synced) continue; // odômetro não confiável → fora dos cálculos
    f.synced++;
    const odo = Number(v.odometer_km) || 0;
    const done = v.last_service_km ? Math.round(Number(v.last_service_km) / C.REVISAO_KM) : 0;
    f.cars.push({ odo, done });
  }
  return { as_of: (d && d.as_of) || null, fleets };
}

module.exports = { fetchFrota };

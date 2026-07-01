// =====================================================================
// FROTA — puxa odômetro + revisões reais por carro do site ocn-frota
// e agrega por frota: { "1": { count, synced, cars: [{odo, done}] } }.
//   odo  = odômetro atual (km)
//   done = nº de revisões consideradas FEITAS. Conta as concluídas no site
//          (last_service_km) E as em aberto/vencidas — a API não expõe as
//          revisões agendadas, então o marco de km já ultrapassado é o proxy:
//          done = max( round(last_service_km/10.000), floor(odômetro/10.000) ).
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
    const concluidas = v.last_service_km ? Math.round(Number(v.last_service_km) / C.REVISAO_KM) : 0; // fechadas no site
    const vencidas = Math.floor(odo / C.REVISAO_KM); // marcos de km já ultrapassados (inclui as em aberto/agendadas com data passada)
    const done = Math.max(concluidas, vencidas);
    f.cars.push({ odo, done });
  }
  return { as_of: (d && d.as_of) || null, fleets };
}

module.exports = { fetchFrota };

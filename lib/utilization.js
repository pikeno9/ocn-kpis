// =====================================================================
// UTILIZATION — km/semana médio por placa (odômetro atual ÷ semanas
// desde o recebimento do carro). Cruza import_data (placa/frota/data de
// recebimento) com o odômetro + motorista da API de frota.
// =====================================================================
const C = require('../config/static');

const cell = (r, i) => String(r && r[i] != null ? r[i] : '').trim();

// mesma heurística de data mista D/M e M/D usada em lib/ue.js
function parseData(s) {
  const p = String(s || '').trim().split('/');
  if (p.length !== 3) return null;
  let a = +p[0], b = +p[1]; const y = +p[2];
  let d, m;
  if (a > 12) { d = a; m = b; } else if (b > 12) { m = a; d = b; } else { d = a; m = b; }
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}

// carro precisa de pelo menos alguns dias de uso pra a média de km/semana não virar ruído
const MIN_DIAS = 3;

function build(importRows, frota, refDate) {
  const hoje = refDate || new Date();
  const placas = (frota && frota.placas) || {};
  const out = [];
  for (let i = 9; i < (importRows || []).length; i++) {
    const modelo = C.mapModelo(cell(importRows[i], 5));
    if (!modelo) continue;
    const placa = cell(importRows[i], 2).toUpperCase();
    const fleet = cell(importRows[i], C.UE_FLEET_COL);
    if (!placa || !fleet) continue;
    const dt = parseData(cell(importRows[i], 3));
    if (!dt) continue;
    const fr = placas[placa];
    if (!fr || !fr.ok || fr.odo <= 0) continue; // sem odômetro confiável
    const dias = (hoje - dt) / 86400000;
    if (dias < MIN_DIAS) continue; // carro muito novo — média ainda não é representativa
    const semanas = dias / 7;
    out.push({
      plate: placa,
      fleet,
      model: modelo,
      modelLabel: (C.modelos[modelo] || {}).label || modelo,
      driver: fr.driver || cell(importRows[i], 15) || null,
      odo: fr.odo,
      arrivalDate: dt.toISOString().slice(0, 10),
      daysElapsed: Math.round(dias),
      weeksElapsed: Math.round(semanas * 10) / 10,
      kmWeek: Math.round(fr.odo / semanas),
    });
  }
  return { asOf: (frota && frota.as_of) || null, plates: out };
}

module.exports = { build };

// =====================================================================
// UNIT ECONOMICS — lê o cashflow ORÇADO (por veículo) das abas UE - XXX
// e monta a lista de frotas (safras) a partir do import_data.
// =====================================================================
const C = require('../config/static');

const cell = (r, i) => String(r && r[i] != null ? r[i] : '').trim();

// Números em formato US/USD: vírgula = milhar, parênteses = negativo. Ex.: "(1,057)" -> -1057
function parseNum(s) {
  s = String(s == null ? '' : s).trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[(),$\s]/g, '');
  if (!s || s === '-') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : (neg ? -n : n);
}

// Linhas que encerram a parte útil da tabela (a partir daí: variações de IRR / LA version)
const STOP_PREFIX = ['Acc cashflow Month 12', 'Montlhy IRR', 'Monthly IRR', 'Anual IRR', 'Annual IRR', 'LA version'];

function parseTab(rows, periods) {
  const lines = [];
  let section = 'inflow';
  for (const r of rows) {
    const label = cell(r, 1);
    if (!label || label === 'Figures in USD' || /subrental \(12m\)/i.test(label)) continue;
    if (STOP_PREFIX.some((p) => label.startsWith(p))) break;

    // col 2 = M0 (setup inicial); cols 3..(3+periods-1) = M1..M12 → values[p] = período p (0..periods)
    const values = [];
    for (let c = 2; c <= 2 + periods; c++) values.push(parseNum(r[c]));

    let group;
    if (label === 'Total Inflow') group = 'totalInflow';
    else if (label === 'Total Outflow') group = 'totalOutflow';
    else if (label === 'Net monthly cashflow') group = 'net';
    else if (label === 'Acc Cashflow') group = 'acc';
    else group = section;

    const isTotal = group !== 'inflow' && group !== 'outflow';
    const hasVal = values.some((v) => v !== null && v !== 0);
    if (isTotal || hasVal) lines.push({ label, group, values }); // ignora linhas sem valor em nenhum período

    if (label === 'Total Inflow') section = 'outflow';
  }
  return lines;
}

// Frotas = coluna "O" (índice 14) do import_data. Cada frota é de um único modelo.
// data de recebimento (col D import_data): formatos mistos D/M e M/D
function parseData(s) {
  const p = String(s || '').trim().split('/');
  if (p.length !== 3) return null;
  let a = +p[0], b = +p[1]; const y = +p[2];
  let d, m;
  if (a > 12) { d = a; m = b; } else if (b > 12) { m = a; d = b; } else { d = a; m = b; }
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}

function buildFleets(importRows) {
  const map = {};
  for (let i = 9; i < importRows.length; i++) {
    const modelo = C.mapModelo(cell(importRows[i], 5));
    if (!modelo) continue;
    const fleet = cell(importRows[i], C.UE_FLEET_COL);
    if (!fleet) continue;
    if (!map[fleet]) map[fleet] = { fleet, model: modelo, cars: 0, inicio: null };
    map[fleet].cars++;
    const d = parseData(cell(importRows[i], 3)); // col D = data de recebimento
    if (d && (!map[fleet].inicio || d < map[fleet].inicio)) map[fleet].inicio = d;
  }
  const arr = Object.values(map).sort((a, b) => (parseInt(a.fleet, 10) || 0) - (parseInt(b.fleet, 10) || 0));
  return arr.map((f) => ({
    id: f.fleet,
    n: parseInt(f.fleet, 10) || 0,
    label: 'Frota ' + f.fleet,
    fleet: f.fleet,
    model: f.model,
    modelLabel: (C.modelos[f.model] || {}).label || f.model,
    cars: f.cars,
    inicio: f.inicio ? f.inicio.toISOString().slice(0, 10) : null, // data mais antiga da frota
  }));
}

function build(ueSheets, importRows, refDate) {
  const periods = C.UE_PERIODS || 12;
  const orcado = {};
  for (const [model, rows] of Object.entries(ueSheets)) {
    if (rows) orcado[model] = { periods, lines: parseTab(rows, periods) };
  }
  const hoje = (refDate || new Date());
  return { periods, fleets: buildFleets(importRows || []), orcado, hoje: hoje.toISOString().slice(0, 10) };
}

module.exports = { build, parseNum, parseTab, buildFleets };

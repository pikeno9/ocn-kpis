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

    const values = [];
    for (let c = 3; c < 3 + periods; c++) values.push(parseNum(r[c]));

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

// Frotas = safras (col 13). Cada safra é de um único modelo. Conta carros.
function buildFleets(importRows) {
  const map = {};
  for (let i = 9; i < importRows.length; i++) {
    const modelo = C.mapModelo(cell(importRows[i], 5));
    if (!modelo) continue;
    const safra = cell(importRows[i], C.UE_SAFRA_COL) || '—';
    if (!map[safra]) map[safra] = { safra, model: modelo, cars: 0 };
    map[safra].cars++;
  }
  const modelOrder = { Polo: 0, Argo: 1, Tera: 2 };
  const safraNum = (s) => { const m = s.match(/(\d+)/); return m ? +m[1] : 0; };
  const arr = Object.values(map).sort((a, b) =>
    (modelOrder[a.model] - modelOrder[b.model]) || (safraNum(a.safra) - safraNum(b.safra))
  );
  return arr.map((f, i) => ({
    id: f.safra,
    n: i + 1,
    label: 'Frota ' + (i + 1),
    safra: f.safra,
    model: f.model,
    modelLabel: (C.modelos[f.model] || {}).label || f.model,
    cars: f.cars,
  }));
}

function build(ueSheets, importRows) {
  const periods = C.UE_PERIODS || 12;
  const orcado = {};
  for (const [model, rows] of Object.entries(ueSheets)) {
    if (rows) orcado[model] = { periods, lines: parseTab(rows, periods) };
  }
  return { periods, fleets: buildFleets(importRows || []), orcado };
}

module.exports = { build, parseNum, parseTab, buildFleets };

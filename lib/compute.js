// =====================================================================
// COMPUTE — recalcula todos os KPIs a partir das abas da planilha.
// Reproduz a análise feita em Python, com as exceções vindas da config.
// =====================================================================
const C = require('../config/static');

const cell = (r, i) => ((r && r[i] != null) ? String(r[i]).trim() : '');
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
const f2 = (x) => (Math.round(x * 100) / 100).toFixed(2).replace('.', ',');

function weekIndex(day) { return Math.min(4, Math.floor((day - 1) / 7)); }

// Data import_data: formatos misturados (D/M e M/D). Heurística com preferência D/M.
function parseBR(s) {
  const p = s.split('/');
  if (p.length !== 3) return null;
  let a = +p[0], b = +p[1]; const y = +p[2];
  let d, m;
  if (a > 12) { d = a; m = b; }       // 31/05 -> D/M
  else if (b > 12) { m = a; d = b; }  // 06/19 -> M/D
  else { d = a; m = b; }              // ambíguo (08/04) -> D/M (padrão do import_data)
  if (!d || !m || !y) return null;
  return { y, m, d };
}
// Data import_clientes: formatos misturados (M/D e D/M) — desambigua por heurística
function parseFlex(s, prefer) {
  s = s.trim();
  const p = s.split('/');
  if (p.length !== 3) return null;
  let a = +p[0], b = +p[1]; const y = +p[2];
  let d, m;
  if (a > 12) { d = a; m = b; }
  else if (b > 12) { m = a; d = b; }
  else if (prefer === 'MD') { m = a; d = b; }
  else { d = a; m = b; }
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
const daysBetween = (a, b) => Math.round((b - a) / 86400000);

function matchItem(value, items) {
  const v = value.toLowerCase().trim();
  if (!v) return null;
  return items.find((it) => it.match.some((m) => v.includes(m))) || null;
}

// ----------------- RH: headcount (aba import_RH) -----------------
// Dois blocos ("Active HC (Actual)" e "Active HC (Budget)"): cabeçalho com meses YYYY-MM,
// uma linha por cargo e uma linha "Total HC". Meses futuros do Actual viram null (a planilha
// preenche 0 por fórmula, o que viraria barra zerada no gráfico).
const MES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function parseRH(rows, todayKey) {
  if (!rows || !rows.length) return null;
  const cv = (r, i) => ((r && r[i] != null) ? String(r[i]).trim() : '');
  const findBlock = (title) => {
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].some((c) => String(c).trim() === title)) continue;
      for (let h = i; h < Math.min(i + 4, rows.length); h++) {
        const monthCols = [];
        rows[h].forEach((c, j) => { if (/^\d{4}-\d{2}$/.test(String(c).trim())) monthCols.push(j); });
        if (monthCols.length) {
          return {
            start: h + 1, monthCols,
            months: monthCols.map((j) => cv(rows[h], j)),
            roleCol: rows[h].findIndex((c) => /hc per role/i.test(String(c))),
          };
        }
      }
    }
    return null;
  };
  const readBlock = (b) => {
    const roles = []; let total = null;
    for (let i = b.start; i < rows.length; i++) {
      const name = cv(rows[i], b.roleCol);
      if (!name) break;
      const vals = b.monthCols.map((j) => { const v = cv(rows[i], j); return v === '' ? null : (parseFloat(v.replace(',', '.')) || 0); });
      if (/^total hc$/i.test(name)) { total = vals; break; }
      roles.push({ role: name, vals });
    }
    return { roles, total };
  };
  const bA = findBlock('Active HC (Actual)');
  const bB = findBlock('Active HC (Budget)');
  if (!bA || !bB) return null;
  const A = readBlock(bA), B = readBlock(bB);
  if (!A.total || !B.total) return null;
  const months = bA.months;
  const currentIdx = months.indexOf(todayKey);
  const actual = A.total.map((v, i) => (currentIdx >= 0 && i > currentIdx) ? null : v); // futuro sem barra
  // cargos (união dos dois blocos), com actual/budget do mês vigente para a tabela
  const budByRole = {}; B.roles.forEach((r) => { budByRole[r.role] = r.vals; });
  const seen = new Set();
  const roles = [];
  A.roles.concat(B.roles).forEach((r) => {
    if (seen.has(r.role)) return;
    seen.add(r.role);
    const av = (A.roles.find((x) => x.role === r.role) || {}).vals || [];
    const bv = budByRole[r.role] || [];
    const idx = currentIdx >= 0 ? currentIdx : months.length - 1;
    roles.push({ role: r.role, act: av[idx] != null ? av[idx] : 0, bud: bv[idx] != null ? bv[idx] : 0 });
  });
  return {
    months,
    labels: months.map((m) => MES_EN[(+m.slice(5)) - 1] || m),
    actual,
    budget: B.total,
    currentIdx,
    currentLabel: currentIdx >= 0 ? (MES_EN[(+months[currentIdx].slice(5)) - 1]) : null,
    roles,
  };
}

// ----------------- LEADS (aba import_Leads) -----------------
// Colunas: A=mês, B=semana, C=data, D=leads/dia, E=leads em datas de destaque, F=evento.
// Mensal e semanal = soma de D; diário = série D por data, com rótulo/evento só nas datas com E preenchida.
function parseLeads(rows) {
  if (!rows || rows.length < 2) return null;
  const cv = (r, i) => ((r && r[i] != null) ? String(r[i]).trim() : '');
  const num = (s) => { const n = parseFloat(String(s).replace(/[.\s]/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };
  const mMap = {}, wMap = {}, days = [], peaks = [];
  for (let i = 1; i < rows.length; i++) {
    const date = cv(rows[i], 2);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const mo = cv(rows[i], 0), wk = cv(rows[i], 1);
    const d = num(cv(rows[i], 3));
    if (!mMap[mo]) mMap[mo] = { n: +mo, v: 0 };
    mMap[mo].v += d;
    if (!wMap[wk]) wMap[wk] = { n: +wk, v: 0, start: date };
    wMap[wk].v += d; if (date < wMap[wk].start) wMap[wk].start = date;
    days.push({ date, v: d });
    const eVal = cv(rows[i], 4), event = cv(rows[i], 5);
    if (eVal) peaks.push({ date, v: num(eVal), event: event || null });
  }
  if (!days.length) return null;
  const months = Object.values(mMap).sort((a, b) => a.n - b.n);
  const weeks = Object.values(wMap).sort((a, b) => a.n - b.n);
  const dmy = (iso) => { const p = iso.split('-'); return p[2] + '/' + p[1]; };
  const peakByDate = {}; peaks.forEach((p) => { peakByDate[p.date] = { v: p.v, event: p.event }; });
  return {
    monthly: { labels: months.map((m) => MES_EN[m.n - 1] || String(m.n)), values: months.map((m) => m.v) },
    weekly: { labels: weeks.map((w) => dmy(w.start)), values: weeks.map((w) => w.v) },
    daily: { dates: days.map((d) => d.date), values: days.map((d) => d.v), peakByDate },
    events: peaks.filter((p) => p.event).sort((a, b) => (a.date < b.date ? 1 : -1)), // mais recentes primeiro
    total: days.reduce((a, b) => a + b.v, 0),
  };
}

function build(sheets, referenceDate) {
  const today = referenceDate || new Date();
  const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // ----------------- FROTA: recebimento -----------------
  const recM = { Polo: Array(9).fill(0), Argo: Array(9).fill(0), Tera: Array(9).fill(0) };
  const recS = { Polo: {}, Argo: {}, Tera: {} };
  const statusCount = {}; // texto bruto -> contagem
  let totalCarros = 0;

  for (const r of sheets.importData) {
    const modelo = C.mapModelo(cell(r, 5));
    if (!modelo) continue;
    totalCarros++;

    // status (coluna Q = idx 16)
    const st = cell(r, 16).toLowerCase();
    if (st) statusCount[st] = (statusCount[st] || 0) + 1;

    // data de recebimento (coluna D = idx 3) + exceções
    let dstr = cell(r, 3);
    if (!dstr) dstr = C.undatedReceivedDate;
    if (C.spilloverDates[dstr]) dstr = C.spilloverDates[dstr];
    const dt = parseBR(dstr);
    if (!dt) continue;
    const mi = dt.m - 4; // Abr=0
    if (mi < 0 || mi > 8) continue;
    const wk = weekIndex(dt.d);
    recM[modelo][mi]++;
    if (!recS[modelo][mi]) recS[modelo][mi] = [0, 0, 0, 0, 0];
    recS[modelo][mi][wk]++;
  }

  const modelTotal = { Polo: recM.Polo.reduce((a, b) => a + b, 0), Argo: recM.Argo.reduce((a, b) => a + b, 0), Tera: recM.Tera.reduce((a, b) => a + b, 0) };
  const recebidosAno = modelTotal.Polo + modelTotal.Argo + modelTotal.Tera;
  const breakdown = ['Polo', 'Argo', 'Tera'].filter((k) => modelTotal[k] > 0).map((k) => `${modelTotal[k]} ${k}`).join(' · ');

  // acumulado por modelo (até o último mês com dados; depois null)
  let lastMonth = 0;
  for (let mi = 0; mi <= 8; mi++) if (recM.Polo[mi] + recM.Argo[mi] + recM.Tera[mi] > 0) lastMonth = mi;
  const acumRecebido = {};
  for (const k of ['Polo', 'Argo', 'Tera']) {
    const out = []; let acc = 0;
    for (let mi = 0; mi <= 8; mi++) { acc += recM[k][mi]; out.push(mi <= lastMonth ? acc : null); }
    acumRecebido[k] = out;
  }

  // status da frota
  const statusItems = C.statusItems.map((it) => {
    let valor = 0;
    for (const [texto, n] of Object.entries(statusCount)) {
      if (it.match.some((m) => texto.includes(m))) valor += n;
    }
    const o = { label: it.label, valor, cor: it.cor };
    if (it.listrado) o.listrado = true;
    return o;
  });

  // ----------------- OCORRÊNCIAS -----------------
  const occ = sheets.ocorrencias.filter((r) => {
    const placa = cell(r, 1);
    return placa && placa.toLowerCase() !== 'placa' && cell(r, 8);
  });
  const tipoCount = C.ocorrenciaTipos.map(() => 0);
  const sinCom = C.ocorrenciaTipos.map(() => 0);
  const sinSem = C.ocorrenciaTipos.map(() => 0);
  let comSinistro = 0, foramOficina = 0;
  for (const r of occ) {
    const it = matchItem(cell(r, 8), C.ocorrenciaTipos);
    const idx = it ? C.ocorrenciaTipos.indexOf(it) : -1;
    const sin = cell(r, 4);
    const hasSin = sin && sin.toUpperCase() !== 'N/A';
    const ofi = cell(r, 7);
    const hasOfi = ofi && ofi.toUpperCase() !== 'N/A' && ofi !== '-' && ofi !== '–';
    if (hasSin) comSinistro++;
    if (hasOfi) foramOficina++;
    if (idx >= 0) { tipoCount[idx]++; if (hasSin) sinCom[idx]++; else sinSem[idx]++; }
  }
  const totalOcc = occ.length;
  const porTipo = C.ocorrenciaTipos.map((it, i) => ({ label: it.label, valor: tipoCount[i], cor: it.cor }));
  const sinistroPorTipo = { labels: C.ocorrenciaTipos.map((it) => it.barLabel), com: sinCom, sem: sinSem };

  // ----------------- CONTRATOS (import_clientes) -----------------
  const contr = sheets.clientes.filter((r) => {
    const st = cell(r, 11).toLowerCase();
    return (st === 'ativo' || st === 'inativo') && cell(r, 9);
  });
  let carrosDia = 0, nAtivos = 0, nInativos = 0;
  let rescindidos = 0;
  const churnCount = C.churnTipos.map(() => 0);
  for (const r of contr) {
    const st = cell(r, 11).toLowerCase();
    const di = parseFlex(cell(r, 9), 'MD');
    if (st === 'ativo') {
      nAtivos++;
      if (di) carrosDia += daysBetween(new Date(di.getFullYear(), di.getMonth(), di.getDate()), todayDateOnly);
    } else {
      nInativos++;
      const df = parseFlex(cell(r, 10), 'DM');
      if (di && df) { const d = daysBetween(di, df); if (d > 0) carrosDia += d; }
      const motivo = cell(r, 12).toLowerCase();
      const isTroca = C.churnExcluir.some((m) => motivo.includes(m));
      if (!isTroca) {
        rescindidos++;
        const it = matchItem(motivo, C.churnTipos);
        if (it) churnCount[C.churnTipos.indexOf(it)]++;
      }
    }
  }
  const carrosMes = carrosDia / 30;
  const carrosDiaPorOcorr = totalOcc ? Math.round(carrosDia / totalOcc) : 0;
  const lambda = carrosMes > 0 ? rescindidos / carrosMes : 0; // rescisões por carro-mês
  const estimada = lambda > 0 ? (1 - Math.exp(-lambda * C.contratoNominalMeses)) / lambda : C.contratoNominalMeses;
  const churn = C.churnTipos.map((it, i) => ({ label: it.label, valor: churnCount[i], cor: it.cor }));

  // ----------------- FROTA: ativo × inativo por mês (histórico reconstruído) -----------------
  // Total(T) = carros chegados até T (import_data col D) − perdas totais até T
  //            (import_clientes: motivo fim = "Sinistro - PT", na data fim do vínculo).
  // Active(T) = contratos ativos em T (início ≤ T e fim vazio ou > T). Inactive = Total − Active.
  // Posição de cada mês: meses passados = último dia do mês; mês atual = hoje.
  const YEAR = today.getFullYear();
  const arrivals = [];
  for (const r of sheets.importData) {
    if (!C.mapModelo(cell(r, 5))) continue;
    let dstr = cell(r, 3); if (!dstr) dstr = C.undatedReceivedDate; if (C.spilloverDates[dstr]) dstr = C.spilloverDates[dstr];
    const dt = parseBR(dstr); if (!dt) continue;
    arrivals.push(new Date(dt.y, dt.m - 1, dt.d));
  }
  const contracts = [], lossDates = [];
  for (const r of sheets.clientes) {
    const di = parseFlex(cell(r, 9), 'MD'); // Data Início Vínculo (col J)
    if (!di) continue;
    const endRaw = cell(r, 10);              // Data Fim Vínculo (col K)
    const df = endRaw ? parseFlex(endRaw, 'DM') : null;
    contracts.push({ start: di, end: df });
    if (df && /sinistro|sinitro|perda total/.test(cell(r, 12).toLowerCase())) lossDates.push(df); // Motivo Fim Vínculo (col M) — "Sinitro - PT" (typo real da planilha)
  }
  const fsActive = [], fsInactive = [], fsTotal = [], fsActivePct = [], fsInactivePct = [];
  for (let mi = 0; mi < C.mLabels.length; mi++) {
    const monthNum = mi + 4; // Abr=4 ... Dez=12
    const curMonth = today.getMonth() + 1;
    let T;
    if (monthNum < curMonth) T = new Date(YEAR, monthNum, 0, 23, 59, 59); // último dia do mês
    else if (monthNum === curMonth) T = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59); // hoje
    else { fsActive.push(null); fsInactive.push(null); fsTotal.push(null); fsActivePct.push(null); fsInactivePct.push(null); continue; }
    const total = Math.max(0, arrivals.filter((d) => d <= T).length - lossDates.filter((d) => d <= T).length);
    let active = contracts.filter((c) => c.start <= T && (!c.end || c.end > T)).length;
    if (active > total) active = total;
    const inactive = Math.max(0, total - active);
    const aPct = total ? Math.round((active / total) * 1000) / 10 : null;
    fsActive.push(total ? active : null); fsInactive.push(total ? inactive : null); fsTotal.push(total || null);
    fsActivePct.push(aPct); fsInactivePct.push(aPct == null ? null : Math.round((100 - aPct) * 10) / 10);
  }

  // ----------------- MONTAGEM FINAL -----------------
  const pad = (n) => String(n).padStart(2, '0');
  const atualizadoEm = `${pad(today.getDate())}/${pad(today.getMonth() + 1)}/${today.getFullYear()}`;

  return {
    ano: 2026,
    atualizadoEm,
    modelos: C.modelos,
    corEsperado: C.corEsperado,
    mensal: {
      labels: C.mLabels, full: C.mFull,
      recebido: recM,
      esperadoTotal: C.esperado.total,
      esperadoModelo: C.esperado.modelo,
      interativo: C.esperado.interativo,
    },
    semanal: {
      labels: C.semanaLabels,
      recebido: recS,
      esperadoTotal: C.esperadoSemanal.total,
      esperadoModelo: C.esperadoSemanal.modelo,
      notas: C.esperadoSemanal.notas,
    },
    acumulado: { recebido: acumRecebido, esperado: C.esperado.acumulado },
    fleetStatus: { labels: C.mLabels, activePct: fsActivePct, inactivePct: fsInactivePct, active: fsActive, inactive: fsInactive, total: fsTotal },
    rh: parseRH(sheets.rh, `${today.getFullYear()}-${pad(today.getMonth() + 1)}`),
    leads: parseLeads(sheets.leads),
    kpis: {
      recebidosAno, recebidosBreakdown: breakdown,
      esperadoAno: C.esperado.anoTotal,
      proximoLoteData: C.proximoLote.dataLabel, proximoLoteDesc: C.proximoLote.desc,
    },
    proximoLote: C.proximoLote,
    statusFrota: { total: totalCarros, items: statusItems },
    ocorrencias: {
      total: totalOcc,
      comSinistro, comSinistroPct: totalOcc ? Math.round((comSinistro / totalOcc) * 100) : 0,
      foramOficina,
      porTipo, sinistroPorTipo, churn,
      contratos: {
        totalContratos: contr.length, ativos: nAtivos, encerrados: nInativos,
        carrosMes: Math.round(carrosMes), carrosDia,
        carrosDiaPorOcorr, rescindidos,
        taxaCarroMes: f2(totalOcc / (carrosMes || 1)),
        taxaTexto: `1 incident every ~${carrosDiaPorOcorr} car-days under contract (${nAtivos} active + ${nInativos} ended).`,
      },
      duracao: {
        nominalMeses: C.contratoNominalMeses,
        estimadaMeses: f1(estimada),
        pctDoNominal: Math.round((estimada / C.contratoNominalMeses) * 100),
        churnMensalPct: f1(lambda * 100),
        encerramentosChurn: rescindidos,
      },
    },
    notaMensal: C.notaMensal,
  };
}

module.exports = { build };

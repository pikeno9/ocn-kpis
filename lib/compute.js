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
// "2026-02" - 1 mês -> "2026-01" (rollover de ano)
function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
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
          const roleCol = rows[h].findIndex((c) => /hc per role/i.test(String(c)));
          const months = monthCols.map((j) => cv(rows[h], j));
          // a planilha tem uma 1ª coluna de dados (mês anterior ao 1º rotulado) com o cabeçalho em branco
          // — não bate no regex acima, mas existe e tem valores (tudo zero, mês de "setup"); recupera-a.
          const firstCol = monthCols[0];
          if (firstCol - 1 > roleCol && cv(rows[h], firstCol - 1) === '') {
            monthCols.unshift(firstCol - 1);
            months.unshift(shiftMonth(months[0], -1));
          }
          return { start: h + 1, monthCols, months, roleCol };
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
  // matriz de cargos (união dos dois blocos, ordem do bloco Actual primeiro): act[]/bud[] em TODOS os meses
  const budByRole = {}; B.roles.forEach((r) => { budByRole[r.role] = r.vals; });
  const seen = new Set();
  const roles = [];
  A.roles.concat(B.roles).forEach((r) => {
    if (seen.has(r.role)) return;
    seen.add(r.role);
    const av = (A.roles.find((x) => x.role === r.role) || {}).vals || [];
    const bv = budByRole[r.role] || [];
    roles.push({
      role: r.role,
      act: months.map((_, i) => (av[i] != null ? av[i] : 0)),
      bud: months.map((_, i) => (bv[i] != null ? bv[i] : 0)),
    });
  });
  return {
    months,
    totalActual: A.total, totalBudget: B.total,
    labels: months.map((m) => MES_EN[(+m.slice(5)) - 1] || m),
    actual,
    budget: B.total,
    currentIdx,
    currentLabel: currentIdx >= 0 ? (MES_EN[(+months[currentIdx].slice(5)) - 1]) : null,
    roles,
  };
}

// ----------------- CARROS ESPERADOS (aba CarrosEsperados) -----------------
// Linha de meses ("Mar/26", "Apr/26", ...), linha "Novos" (mensal) e "Acumulado".
// Usado como budget do Received Fleet (acumulado), começando em Março.
const MES_ABREV_EN = { jan: 'Jan', feb: 'Feb', fev: 'Feb', mar: 'Mar', apr: 'Apr', abr: 'Apr', may: 'May', mai: 'May', jun: 'Jun', jul: 'Jul', aug: 'Aug', ago: 'Aug', sep: 'Sep', set: 'Sep', oct: 'Oct', out: 'Oct', nov: 'Nov', dec: 'Dec', dez: 'Dec' };
function parseCarrosEsperados(rows) {
  if (!rows || !rows.length) return null;
  const cv = (r, i) => ((r && r[i] != null) ? String(r[i]).trim() : '');
  // linha de meses: a que tem células no formato "Mmm/YY"
  const monRe = /^([a-zç]{3})\.?\/?\s*(\d{2,4})?$/i;
  let hdrRow = -1, monCols = [];
  for (let i = 0; i < rows.length; i++) {
    const cols = [];
    for (let j = 0; j < rows[i].length; j++) { const m = cv(rows[i], j).match(monRe); if (m && MES_ABREV_EN[m[1].toLowerCase()]) cols.push({ j, label: MES_ABREV_EN[m[1].toLowerCase()] }); }
    if (cols.length >= 3) { hdrRow = i; monCols = cols; break; }
  }
  if (hdrRow < 0) return null;
  const findRow = (re) => rows.findIndex((r) => re.test(cv(r, 0)));
  const rowAcum = findRow(/acumulad/i);
  const rowNovos = findRow(/^novos?$/i);
  if (rowAcum < 0) return null;
  const num = (s) => { const n = parseFloat(String(s).replace(/[.\s]/g, '').replace(',', '.')); return isNaN(n) ? null : n; };
  return {
    labels: monCols.map((c) => c.label),
    acumulado: monCols.map((c) => num(cv(rows[rowAcum], c.j))),
    novos: rowNovos >= 0 ? monCols.map((c) => num(cv(rows[rowNovos], c.j))) : null,
  };
}

// ----------------- LEADS (aba import_Leads) -----------------
// Colunas: A=mês, B=semana, C=data, D=leads/dia, E=leads em datas de destaque, F=evento.
// Mensal e semanal = soma de D; diário = série D por data, com rótulo/evento só nas datas com E preenchida.
function parseLeads(rows) {
  if (!rows || rows.length < 2) return null;
  const cv = (r, i) => ((r && r[i] != null) ? String(r[i]).trim() : '');
  const num = (s) => { const n = parseFloat(String(s).replace(/[.\s]/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };
  // Colunas resolvidas pelo CABEÇALHO (a planilha já ganhou colunas novas no meio,
  // que quebraram os índices fixos): há DUAS colunas "Creation Date" (ISO + "Apr-10")
  // e DUAS "Leads" (diária + só nos dias de destaque) — desambiguar por conteúdo/ordem.
  const header = rows[0].map((c) => String(c || '').trim());
  const findCol = (re, from = 0) => { for (let i = from; i < header.length; i++) if (re.test(header[i])) return i; return -1; };
  let cols = null;
  const cLeads = findCol(/^leads$/i);
  if (cLeads >= 0) {
    // coluna de data = a "Creation Date" cujo VALOR das primeiras linhas é ISO (YYYY-MM-DD)
    let cDate = -1;
    for (let i = 0; i < header.length; i++) {
      if (!/^creation date$/i.test(header[i])) continue;
      const sample = rows.slice(1, 8).map((r) => cv(r, i)).find(Boolean);
      if (sample && /^\d{4}-\d{2}-\d{2}$/.test(sample)) { cDate = i; break; }
    }
    cols = {
      month: findCol(/^creation month$/i),
      week: findCol(/^creation week$/i),
      date: cDate,
      leads: cLeads,
      peak: findCol(/^leads$/i, cLeads + 1), // 2ª coluna "Leads" = leads dos dias de destaque
      event: findCol(/^events?$/i),
      action: findCol(/^action$/i),
    };
  }
  // fallback: layout antigo por posição (A=mês, B=semana, C=data, D=leads, E=destaque, F=evento)
  if (!cols || cols.date < 0 || cols.month < 0 || cols.week < 0) cols = { month: 0, week: 1, date: 2, leads: 3, peak: 4, event: 5, action: -1 };
  const mMap = {}, wMap = {}, days = [], peaks = [];
  for (let i = 1; i < rows.length; i++) {
    const date = cv(rows[i], cols.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const mo = cv(rows[i], cols.month), wk = cv(rows[i], cols.week);
    const d = num(cv(rows[i], cols.leads));
    if (!mMap[mo]) mMap[mo] = { n: +mo, v: 0 };
    mMap[mo].v += d;
    if (!wMap[wk]) wMap[wk] = { n: +wk, v: 0, start: date };
    wMap[wk].v += d; if (date < wMap[wk].start) wMap[wk].start = date;
    days.push({ date, v: d });
    const eVal = cols.peak >= 0 ? cv(rows[i], cols.peak) : '';
    // texto do evento: coluna "Events"; se vazia, "Action" (a planilha nova dividiu em duas)
    const event = (cols.event >= 0 ? cv(rows[i], cols.event) : '') || (cols.action >= 0 ? cv(rows[i], cols.action) : '');
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

// ----------------- COMMERCIAL FUNNEL (aba funil) -----------------
// Uma linha por semana: Semana, Contatos únicos, Enviados p/ análise, Aprovados,
// e 3 taxas já calculadas na planilha ("37%" etc.) — colunas resolvidas por
// TEXTO de cabeçalho (robusto a reordenação), não por posição fixa.
const MES_PT = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
function parsePTDate(s) {
  const m = String(s || '').toLowerCase().match(/(\d{1,2})\s+de\s+([a-zçã]{3})\.?\s+de\s+(\d{4})/);
  if (!m) return null;
  const mo = MES_PT[m[2]];
  if (!mo) return null;
  return { y: +m[3], m: mo, d: +m[1] };
}
function parseFunil(rows) {
  if (!rows || rows.length < 2) return null;
  const cv = (r, i) => ((r && r[i] != null) ? String(r[i]).trim() : '');
  const pct = (s) => { const n = parseFloat(String(s).replace('%', '').replace(',', '.')); return isNaN(n) ? null : n; };
  const headerRow = rows.findIndex((r) => r.some((c) => /^semana$/i.test(String(c || '').trim())));
  if (headerRow < 0) return null;
  const findCol = (re) => rows[headerRow].findIndex((c) => re.test(String(c || '').trim()));
  const cols = {
    semana: findCol(/^semana$/i),
    contatos: findCol(/contatos/i),
    enviados: findCol(/enviados/i),
    aprovados: findCol(/^aprovados$/i),
    taxaEnvio: findCol(/taxa de envio/i),
    taxaAprov: findCol(/taxa de aprova/i),
    convBruta: findCol(/convers[aã]o bruta/i),
  };
  const weeks = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const dt = parsePTDate(cv(rows[i], cols.semana));
    if (!dt) continue;
    weeks.push({
      iso: `${dt.y}-${String(dt.m).padStart(2, '0')}-${String(dt.d).padStart(2, '0')}`,
      contatos: +cv(rows[i], cols.contatos) || 0,
      enviados: +cv(rows[i], cols.enviados) || 0,
      aprovados: +cv(rows[i], cols.aprovados) || 0,
      taxaEnvio: pct(cv(rows[i], cols.taxaEnvio)),
      taxaAprov: pct(cv(rows[i], cols.taxaAprov)),
      convBruta: pct(cv(rows[i], cols.convBruta)),
    });
  }
  if (!weeks.length) return null;
  weeks.sort((a, b) => (a.iso < b.iso ? -1 : 1));
  const dmy = (iso) => { const p = iso.split('-'); return p[2] + '/' + p[1]; };
  return {
    labels: weeks.map((w) => dmy(w.iso)),
    dates: weeks.map((w) => w.iso),
    contatos: weeks.map((w) => w.contatos),
    enviados: weeks.map((w) => w.enviados),
    aprovados: weeks.map((w) => w.aprovados),
    taxaEnvio: weeks.map((w) => w.taxaEnvio),
    taxaAprov: weeks.map((w) => w.taxaAprov),
    convBruta: weeks.map((w) => w.convBruta),
  };
}

// ----------------- INDRIVE (abas "Leads inDrive" e "Performance inDrive") -----------------
// Parceria inDrive: OCN recebe bônus por motorista que estreia na plataforma.
// ATENÇÃO: gviz devolve a PRIMEIRA aba da planilha quando o nome pedido não existe
// (sem erro HTTP) — por isso cada parser exige o cabeçalho específico da sua aba e
// retorna null se não encontrar, em vez de engolir dados de outra aba.
function parseLeadsInDrive(rows) {
  if (!rows || rows.length < 2) return null;
  const cv = (r, i) => ((r && r[i] != null) ? String(r[i]).trim() : '');
  const headerRow = rows.findIndex((r) => r.some((c) => /acumulado da lista de espera/i.test(String(c || ''))));
  if (headerRow < 0) return null;
  const findCol = (re) => rows[headerRow].findIndex((c) => re.test(String(c || '').trim()));
  const cols = {
    semana: findCol(/^semana$/i),
    total: findCol(/acumulado da lista de espera/i),
    eleg: findCol(/acumulado de eleg/i),
  };
  const weeks = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const dt = parsePTDate(cv(rows[i], cols.semana));
    if (!dt) continue;
    const total = +cv(rows[i], cols.total) || 0;
    const eleg = +cv(rows[i], cols.eleg) || 0;
    weeks.push({
      iso: `${dt.y}-${String(dt.m).padStart(2, '0')}-${String(dt.d).padStart(2, '0')}`,
      total, eleg,
      pct: total ? Math.round((eleg / total) * 100) : 0,
    });
  }
  if (!weeks.length) return null;
  weeks.sort((a, b) => (a.iso < b.iso ? -1 : 1));
  const dmy = (iso) => { const p = iso.split('-'); return p[2] + '/' + p[1]; };
  return {
    labels: weeks.map((w) => dmy(w.iso)),
    dates: weeks.map((w) => w.iso),
    total: weeks.map((w) => w.total),
    elegiveis: weeks.map((w) => w.eleg),
    pct: weeks.map((w) => w.pct),
  };
}

// Aba "Performance inDrive": B=Semana ("Sem 2 · sexta 12/06"), C=Ativos total,
// D=Elegíveis, E=Aceitaram, F=Enviaram prints. Valores já ACUMULADOS por semana.
function parsePerfInDrive(rows) {
  if (!rows || rows.length < 2) return null;
  const cv = (r, i) => ((r && r[i] != null) ? String(r[i]).trim() : '');
  const headerRow = rows.findIndex((r) => r.some((c) => /enviaram prints/i.test(String(c || ''))));
  if (headerRow < 0) return null;
  const findCol = (re) => rows[headerRow].findIndex((c) => re.test(String(c || '').trim()));
  const cols = {
    semana: findCol(/^semana$/i),
    ativos: findCol(/^ativos/i),
    eleg: findCol(/^eleg/i),
    prints: findCol(/enviaram prints/i),
  };
  const weeks = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const sem = cv(rows[i], cols.semana);
    const ativos = +cv(rows[i], cols.ativos) || 0;
    if (!sem || !ativos) continue;
    const eleg = +cv(rows[i], cols.eleg) || 0;
    const prints = +cv(rows[i], cols.prints) || 0;
    const dm = sem.match(/(\d{1,2}\/\d{1,2})/); // "Sem 2 · sexta 12/06" -> "12/06"
    weeks.push({
      label: dm ? dm[1] : sem,
      full: sem,
      ativos, eleg, prints,
      naoEleg: Math.max(0, ativos - eleg),
      pctEleg: Math.round((eleg / ativos) * 100),
      pctCaptura: Math.round((prints / ativos) * 100),
    });
  }
  if (!weeks.length) return null;
  return {
    labels: weeks.map((w) => w.label),
    full: weeks.map((w) => w.full),
    ativos: weeks.map((w) => w.ativos),
    elegiveis: weeks.map((w) => w.eleg),
    naoElegiveis: weeks.map((w) => w.naoEleg),
    pctElegiveis: weeks.map((w) => w.pctEleg),
    prints: weeks.map((w) => w.prints),
    pctCaptura: weeks.map((w) => w.pctCaptura),
  };
}

// ----------------- REDEPLOYMENT (aba import_Time) -----------------
// 3 blocos com o MESMO layout de colunas (C..K): "Tempo para recolocação - Recuperações"
// (título + cabeçalho de coluna na mesma linha), "... Devoluções" e "... Troca de carro"
// (só o título — sem repetir os rótulos de coluna, apenas um resquício "Car Plate" antes
// dos dados). Colunas resolvidas 1x pelo cabeçalho de Recuperações e reaproveitadas nos
// outros dois blocos, já que a planilha usa a mesma disposição nos três.
// Datas em formato americano (MM/DD/YYYY) — só nesta aba, diferente do resto da planilha.
function parseDataUS(s) {
  const p = String(s || '').trim().split('/');
  if (p.length !== 3) return null;
  const m = +p[0], d = +p[1], y = +p[2];
  if (!m || !d || !y) return null;
  return new Date(y, m - 1, d);
}
// dias ÚTEIS entre duas datas (exclui d1, inclui d2): tira fins de semana e
// feriados/emendas de SP (config.FERIADOS_SP). Negativo/aberto → null.
function workingDaysBetween(d1, d2) {
  if (!d1 || !d2) return null;
  const a = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const b = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
  if (b < a) return null;
  let n = 0;
  const cur = new Date(a);
  for (let guard = 0; guard < 400 && cur < b; guard++) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    const iso = cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0') + '-' + String(cur.getDate()).padStart(2, '0');
    if (dow === 0 || dow === 6) continue;         // domingo/sábado
    if (C.FERIADOS_SP && C.FERIADOS_SP.has(iso)) continue; // feriado/emenda SP
    n++;
  }
  return n;
}
function parseTimeSections(rows) {
  if (!rows || !rows.length) return null;
  const cv = (r, i) => ((r && r[i] != null) ? String(r[i]).trim() : '');
  let headerRow = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some((c) => /tempo para recoloca[cç][aã]o\s*-\s*recupera[cç][oõ]es/i.test(String(c)))) { headerRow = i; break; }
  }
  if (headerRow < 0) return null;
  const hdr = rows[headerRow];
  const findCol = (re) => hdr.findIndex((c) => re.test(String(c || '').trim()));
  const cols = {
    placa: findCol(/^car plate$/i),
    cliente: findCol(/^client$/i),
    dataEvento: findCol(/data da recupera/i),
    dataPronto: findCol(/pronto para recoloca/i),        // "Data de carro pronto para recolocação"
    dataRecoloc: findCol(/^data de recoloca/i),           // "Data de recolocação" (não contém "pronto")
    motivo: findCol(/^motivo$/i),
    detalhe: findCol(/detalhamento/i),
    diasPronto: findCol(/recup.*pronto/i),                // "Recup -> Pronto"
    diasAlocado: findCol(/pronto.*alocado/i),              // "Pronto -> Alocado"
  };
  if (cols.dataEvento < 0 || cols.placa < 0) return null;

  // lê um bloco a partir de startRow até a linha ficar em branco na coluna Placa (fim da seção);
  // pula o resquício de cabeçalho ("Car Plate" sozinho, sem as outras colunas) sem parar por causa dele
  function readItems(startRow) {
    const items = [];
    for (let i = startRow; i < rows.length; i++) {
      const placaCell = cv(rows[i], cols.placa);
      if (!placaCell) break;
      if (/^car plate$/i.test(placaCell)) continue; // resquício de cabeçalho do bloco (Devoluções/Troca de carro)
      const dtEvento = parseDataUS(cv(rows[i], cols.dataEvento));
      if (!dtEvento) continue;
      const rawPronto = cols.dataPronto >= 0 ? cv(rows[i], cols.dataPronto) : '';
      const rawRecoloc = cols.dataRecoloc >= 0 ? cv(rows[i], cols.dataRecoloc) : '';
      const dtPronto = parseDataUS(rawPronto);
      const dtRecoloc = parseDataUS(rawRecoloc);
      // Repair time = dias ÚTEIS entre Recovery date e Ready; Relocation time = dias ÚTEIS entre Ready e Reallocation
      items.push({
        placa: placaCell,
        cliente: cv(rows[i], cols.cliente),
        dataEvento: dtEvento.toISOString().slice(0, 10),
        dataPronto: rawPronto,
        dataRecolocacao: rawRecoloc,
        motivo: cols.motivo >= 0 ? cv(rows[i], cols.motivo) : '',
        detalhamento: cols.detalhe >= 0 ? cv(rows[i], cols.detalhe) : '',
        diasRecupParaPronto: workingDaysBetween(dtEvento, dtPronto),
        diasProntoParaAlocado: workingDaysBetween(dtPronto, dtRecoloc),
        monthKey: dtEvento.getFullYear() + '-' + String(dtEvento.getMonth() + 1).padStart(2, '0'),
      });
    }
    return items;
  }

  const round1 = (x) => Math.round(x * 10) / 10;
  const dmy = (iso) => { const p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; };
  function summarize(items) {
    if (!items.length) return null;
    const byMonth = {};
    items.forEach((it) => {
      if (!byMonth[it.monthKey]) byMonth[it.monthKey] = { items: [], sumPronto: 0, nPronto: 0, sumAlocado: 0, nAlocado: 0 };
      const b = byMonth[it.monthKey];
      b.items.push(it);
      if (it.diasRecupParaPronto != null) { b.sumPronto += it.diasRecupParaPronto; b.nPronto++; }
      if (it.diasProntoParaAlocado != null) { b.sumAlocado += it.diasProntoParaAlocado; b.nAlocado++; }
    });
    const monthKeys = Object.keys(byMonth).sort();
    // médias GERAIS (todos os casos, não só a visão mensal)
    let gSumP = 0, gNP = 0, gSumA = 0, gNA = 0, gSumT = 0, gNT = 0;
    items.forEach((it) => {
      if (it.diasRecupParaPronto != null) { gSumP += it.diasRecupParaPronto; gNP++; }
      if (it.diasProntoParaAlocado != null) { gSumA += it.diasProntoParaAlocado; gNA++; }
      if (it.diasRecupParaPronto != null && it.diasProntoParaAlocado != null) { gSumT += it.diasRecupParaPronto + it.diasProntoParaAlocado; gNT++; }
    });
    return {
      labels: monthKeys.map((k) => [MES_EN[(+k.slice(5)) - 1] || k, 'n=' + byMonth[k].items.length]),
      monthKeys,
      total: monthKeys.map((k) => byMonth[k].items.length),
      count: items.length,
      overall: { repair: gNP ? round1(gSumP / gNP) : 0, reloc: gNA ? round1(gSumA / gNA) : 0, total: gNT ? round1(gSumT / gNT) : 0, nComplete: gNT },
      avgRecupParaPronto: monthKeys.map((k) => (byMonth[k].nPronto ? round1(byMonth[k].sumPronto / byMonth[k].nPronto) : 0)),
      avgProntoParaAlocado: monthKeys.map((k) => (byMonth[k].nAlocado ? round1(byMonth[k].sumAlocado / byMonth[k].nAlocado) : 0)),
      detail: monthKeys.map((k) => byMonth[k].items.map((it) => ({
        placa: it.placa, cliente: it.cliente,
        dataEvento: dmy(it.dataEvento),
        dataPronto: it.dataPronto ? dmy(parseDataUS(it.dataPronto).toISOString().slice(0, 10)) : '—',
        dataRecolocacao: it.dataRecolocacao ? dmy(parseDataUS(it.dataRecolocacao).toISOString().slice(0, 10)) : '—',
        motivo: it.motivo || '—',
        detalhamento: it.detalhamento || '—',
      }))),
    };
  }

  // encontra a linha de título de cada bloco pra saber onde cada seção começa
  const findTitleRow = (re) => { for (let i = 0; i < rows.length; i++) if (rows[i].some((c) => re.test(String(c || '')))) return i; return -1; };
  const rowRecuperacoes = headerRow + 1; // já tem o cabeçalho completo nesta linha
  const rowDevolucoes = findTitleRow(/tempo para recoloca[cç][aã]o\s*-\s*devolu[cç][oõ]es/i);
  const rowTroca = findTitleRow(/tempo para recoloca[cç][aã]o\s*-\s*troca de carro/i);
  const recItems = readItems(rowRecuperacoes);
  const retItems = rowDevolucoes >= 0 ? readItems(rowDevolucoes + 1) : [];
  const swpItems = rowTroca >= 0 ? readItems(rowTroca + 1) : [];
  return {
    // Recoveries + Returns juntos num único gráfico/lista (pedido do usuário)
    combined: summarize([...recItems, ...retItems]),
    swaps: summarize(swpItems),
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

  // detalhamento por caso (cronológico decrescente) — alimenta a tabela clicável de Incidents
  const p2 = (n) => String(n).padStart(2, '0');
  const occCases = occ.map((r) => {
    const d = parseFlex(cell(r, 3), 'DM'); // col D = Data do Evento (D/M)
    const it = matchItem(cell(r, 8), C.ocorrenciaTipos);
    const ofi = cell(r, 7);
    const hasOfi = ofi && ofi.toUpperCase() !== 'N/A' && ofi !== '-' && ofi !== '–';
    const sin = cell(r, 4);
    return {
      iso: d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : '',
      data: d ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}` : '—',
      monthKey: d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}` : '',
      placa: cell(r, 1) || '—',
      cliente: (cell(r, 2) && cell(r, 2) !== '—') ? cell(r, 2) : '—',
      tipo: it ? it.label : (cell(r, 8) || '—'),
      tipoCor: it ? it.cor : '#6B7280',
      oficina: hasOfi ? ofi : '—',
      sinistro: !!(sin && sin.toUpperCase() !== 'N/A'),
      sinistroId: (sin && sin.toUpperCase() !== 'N/A' && sin !== '-' && sin !== '–') ? sin : '—', // ID do sinistro (col E)
      detalhamento: (cell(r, 6) && cell(r, 6) !== '—') ? cell(r, 6) : '—',
    };
  }).sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0)); // mais recente primeiro

  // série mensal de ocorrências (col D = Data do Evento), SEPARADA POR TIPO (mesma
  // classificação do donut). Linhas sem data ficam de fora e contam em semData.
  const occMesMap = {};           // monthKey -> total
  const occMesTipoMap = {};       // monthKey -> [count por índice de tipo]
  let occSemData = 0;
  for (const r of occ) {
    const d = parseFlex(cell(r, 3), 'DM');
    if (!d) { occSemData++; continue; }
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    occMesMap[k] = (occMesMap[k] || 0) + 1;
    if (!occMesTipoMap[k]) occMesTipoMap[k] = C.ocorrenciaTipos.map(() => 0);
    const it = matchItem(cell(r, 8), C.ocorrenciaTipos);
    const idx = it ? C.ocorrenciaTipos.indexOf(it) : -1;
    if (idx >= 0) occMesTipoMap[k][idx]++;
  }
  const occKeys = Object.keys(occMesMap).sort();
  const occMensal = {
    labels: [], monthKeys: [], values: [], semData: occSemData,
    // uma série por tipo, alinhada aos meses (values = valores mensais por tipo)
    porTipo: C.ocorrenciaTipos.map((it) => ({ label: it.label, cor: it.cor, values: [] })),
  };
  if (occKeys.length) {
    // meses contínuos do primeiro registro até o mês vigente (zeros no meio contam)
    let [y, m] = occKeys[0].split('-').map(Number);
    const endKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    for (let guard = 0; guard < 36; guard++) {
      const k = `${y}-${String(m).padStart(2, '0')}`;
      occMensal.monthKeys.push(k);
      occMensal.labels.push(MES_EN[m - 1] || k);
      occMensal.values.push(occMesMap[k] || 0);
      const tipos = occMesTipoMap[k] || C.ocorrenciaTipos.map(() => 0);
      occMensal.porTipo.forEach((s, ti) => s.values.push(tipos[ti]));
      if (k === endKey) break;
      m++; if (m > 12) { m = 1; y++; }
    }
  }

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
  const fsActive = [], fsInactive = [], fsLoss = [], fsTotal = [], fsActivePct = [], fsInactivePct = [], fsLossPct = [];
  for (let mi = 0; mi < C.mLabels.length; mi++) {
    const monthNum = mi + 4; // Abr=4 ... Dez=12
    const curMonth = today.getMonth() + 1;
    let T;
    if (monthNum < curMonth) T = new Date(YEAR, monthNum, 0, 23, 59, 59); // último dia do mês
    else if (monthNum === curMonth) T = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59); // hoje
    else { fsActive.push(null); fsInactive.push(null); fsLoss.push(null); fsTotal.push(null); fsActivePct.push(null); fsInactivePct.push(null); fsLossPct.push(null); continue; }
    const loss = lossDates.filter((d) => d <= T).length;           // perdas totais acumuladas
    const running = Math.max(0, arrivals.filter((d) => d <= T).length - loss); // frota em operação (sem perdas)
    let active = contracts.filter((c) => c.start <= T && (!c.end || c.end > T)).length;
    if (active > running) active = running;
    const inactive = Math.max(0, running - active);
    const grand = running + loss;                                  // total incluindo perdas (denominador das 3 barras)
    const pct = (n) => (grand ? Math.round((n / grand) * 1000) / 10 : null);
    fsActive.push(grand ? active : null); fsInactive.push(grand ? inactive : null); fsLoss.push(grand ? loss : null);
    fsTotal.push(grand || null);
    fsActivePct.push(pct(active)); fsInactivePct.push(pct(inactive)); fsLossPct.push(pct(loss));
  }

  // ----------------- MONTAGEM FINAL -----------------
  const pad = (n) => String(n).padStart(2, '0');
  const atualizadoEm = `${pad(today.getDate())}/${pad(today.getMonth() + 1)}/${today.getFullYear()}`;

  // Received Fleet (acumulado): budget/labels da aba CarrosEsperados (começa em Março).
  // Prefixa meses ANTES do 1º mês recebido (Abril) com 0. Sem a aba → fallback ao config (Abr..Dez).
  const CE = parseCarrosEsperados(sheets.carrosEsperados);
  let acumLabels = null, acumBudget = C.esperado.acumulado, acumRec = acumRecebido, acumBudgetNovos = null;
  if (CE && CE.labels && CE.labels.length && CE.acumulado) {
    acumLabels = CE.labels;
    acumBudget = CE.acumulado;
    acumBudgetNovos = CE.novos; // esperado de NOVOS por mês (linha "Novos" da aba)
    const offset = CE.labels.indexOf(C.mLabels[0]); // onde 'Apr' cai nas labels da aba
    if (offset > 0) {
      acumRec = {};
      for (const k of ['Polo', 'Argo', 'Tera']) acumRec[k] = [...Array(offset).fill(0), ...acumRecebido[k]].slice(0, CE.labels.length);
    }
  }

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
    acumulado: { labels: acumLabels, recebido: acumRec, esperado: acumBudget, esperadoNovos: acumBudgetNovos },
    fleetStatus: { labels: C.mLabels, activePct: fsActivePct, inactivePct: fsInactivePct, lossPct: fsLossPct, active: fsActive, inactive: fsInactive, loss: fsLoss, total: fsTotal },
    rh: parseRH(sheets.rh, `${today.getFullYear()}-${pad(today.getMonth() + 1)}`),
    leads: parseLeads(sheets.leads),
    funnel: parseFunil(sheets.funil),
    inDrive: { leads: parseLeadsInDrive(sheets.leadsInDrive), perf: parsePerfInDrive(sheets.perfInDrive) },
    redeployment: parseTimeSections(sheets.time) || { combined: null, swaps: null },
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
      mensal: occMensal,
      casos: occCases,
      contratos: {
        totalContratos: contr.length, ativos: nAtivos, encerrados: nInativos,
        carrosMes: Math.round(carrosMes), carrosDia,
        carrosDiaPorOcorr, rescindidos,
        taxaCarroMes: f2(totalOcc / (carrosMes || 1)),
        taxaCarroMesPct: Math.round((totalOcc / (carrosMes || 1)) * 100),
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

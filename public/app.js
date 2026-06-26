/* ===================== OCN KPIs — app ===================== */
(function () {
  Chart.register(ChartDataLabels);

  // Busca dados ao vivo da API; em falha, usa o snapshot fallback (data.js)
  (async function boot() {
    let OCN = window.OCN_FALLBACK || null;
    try {
      const r = await fetch('/api/data', { cache: 'no-store' });
      if (r.status === 401) { window.location.href = '/login'; return; }
      if (r.ok) OCN = await r.json();
    } catch (e) { /* mantém fallback */ }
    if (!OCN) { console.error('OCN: sem dados'); return; }
    start(OCN);
  })();

  function start(OCN) {
  const NAVY = OCN.corEsperado;
  // mostra a data da última atualização no header
  const hl = document.getElementById('hojeLabel');
  if (hl && OCN.atualizadoEm) hl.textContent = OCN.atualizadoEm;
  // usuário logado + botão Sair
  const meta = OCN._meta || {};
  if (meta.user) {
    const un = document.getElementById('userName'); if (un) un.textContent = meta.user.name || meta.user.login;
    const ur = document.getElementById('userRole'); if (ur) ur.textContent = (meta.user.role || '').toUpperCase();
  }
  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) btnLogout.addEventListener('click', async () => {
    try { await fetch('/api/logout', { method: 'POST' }); } catch (e) {}
    window.location.href = '/login';
  });
  const COR = { Polo: OCN.modelos.Polo.cor, Argo: OCN.modelos.Argo.cor, Tera: OCN.modelos.Tera.cor };
  const TXT2 = '#6b7280';

  // ---------- navegação abas principais ----------
  document.querySelectorAll('.main-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.main-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('sec-' + tab.dataset.sec).classList.add('active');
    });
  });

  // ---------- navegação sub-abas ----------
  document.querySelectorAll('.sub-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const sec = tab.closest('.section');
      sec.querySelectorAll('.sub-tab').forEach((t) => t.classList.remove('active'));
      sec.querySelectorAll('.subsection').forEach((s) => s.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('sub-' + tab.dataset.sub).classList.add('active');
      if (tab.dataset.sub === 'ocorrencias') initOcorrencias();
      if (tab.dataset.sub === 'unit') initUnit();
    });
  });

  // ---------- Status atual da frota / big numbers ----------
  const SF = OCN.statusFrota;
  document.getElementById('fleetSub').textContent = SF.total + ' veículos cadastrados';
  const stripe = 'repeating-linear-gradient(45deg, rgba(40,39,40,0.13) 0, rgba(40,39,40,0.13) 5px, rgba(40,39,40,0.04) 5px, rgba(40,39,40,0.04) 10px)';
  document.getElementById('fleetGrid').innerHTML = SF.items.map((it) => {
    const bg = it.listrado ? stripe : it.cor + '14';
    const numCor = it.listrado ? '#282728' : it.cor;
    return `
    <div class="fleet-tile${it.valor === 0 ? ' is-zero' : ''}" style="background:${bg}">
      <div class="fleet-tile-num" style="color:${numCor}">${it.valor}</div>
      <div class="fleet-tile-label">${it.label}</div>
    </div>`;
  }).join('');

  // ---------- KPIs de topo ----------
  const k = OCN.kpis;
  const Mref = OCN.mensal;
  // Mês vigente: deriva da data atual (Abr=0 ... Dez=8), com clamp ao período
  const vi = Math.max(0, Math.min(Mref.labels.length - 1, (new Date().getMonth() + 1) - 4));
  const recVig = (Mref.recebido.Polo[vi] || 0) + (Mref.recebido.Argo[vi] || 0) + (Mref.recebido.Tera[vi] || 0);
  const expVig = Mref.esperadoTotal[vi];
  const pctVig = expVig ? Math.round((recVig / expVig) * 100) : null;
  document.getElementById('frotaKpis').innerHTML = `
    <div class="kpi-card"><div class="kpi-label"><i class="ti ti-car"></i> Recebidos no ano</div><div class="kpi-value">${k.recebidosAno}</div><div class="kpi-sub">${k.recebidosBreakdown}</div></div>
    <div class="kpi-card"><div class="kpi-label"><i class="ti ti-calendar-stats"></i> Esperado no ano</div><div class="kpi-value">${k.esperadoAno}</div><div class="kpi-sub">Abr–Dez (calendário)</div></div>
    <div class="kpi-card"><div class="kpi-label"><i class="ti ti-percentage"></i> Realizado ${Mref.full[vi]}</div><div class="kpi-value">${recVig} / ${expVig == null ? '—' : expVig}</div><div class="kpi-sub">${pctVig == null ? 'sem esperado no mês' : pctVig + '% do esperado'}</div></div>
    <div class="kpi-card"><div class="kpi-label"><i class="ti ti-truck-delivery"></i> Próximo lote</div><div class="kpi-value">${k.proximoLoteData}</div><div class="kpi-sub">${k.proximoLoteDesc}</div></div>`;

  // ---------- helpers ----------
  function mdlStr(o) { return o ? Object.entries(o).map(([m, v]) => v + ' ' + m).join(' · ') : ''; }
  const dlBar = { color: '#282728', anchor: 'center', align: 'center', font: { size: 10, weight: 500 }, formatter: (v) => (v > 0 ? v : '') };
  const dlLine = { color: NAVY, anchor: 'end', align: 'top', offset: 4, font: { size: 11, weight: 500 }, formatter: (v) => ((v || v === 0) ? v : '') };
  const Z = [0, 0, 0, 0, 0];

  function barDS(model, data) {
    return { label: OCN.modelos[model].label, data, backgroundColor: COR[model], stack: 'r', borderRadius: 3, maxBarThickness: 48, order: 2, datalabels: dlBar };
  }

  // Padrão hachurado (diagonal) para indicar previsão
  function hatch(color) {
    const c = document.createElement('canvas'); c.width = 8; c.height = 8;
    const x = c.getContext('2d');
    x.strokeStyle = color; x.lineWidth = 1.5;
    x.beginPath();
    x.moveTo(0, 8); x.lineTo(8, 0);
    x.moveTo(-2, 2); x.lineTo(2, -2);
    x.moveTo(6, 10); x.lineTo(10, 6);
    x.stroke();
    return x.createPattern(c, 'repeat');
  }

  const PL = OCN.proximoLote;
  function forecastDS(data) {
    const cor = COR[PL.modelo];
    return {
      label: 'Previsão (próx. lote)', data, backgroundColor: hatch(cor), borderColor: cor, borderWidth: 1.5,
      stack: 'r', borderRadius: 3, maxBarThickness: 48, order: 2,
      datalabels: { color: '#282728', anchor: 'center', align: 'center', font: { size: 10, weight: 500 }, formatter: (v) => (v > 0 ? v : '') },
    };
  }
  function forecastMonthly() {
    const a = new Array(OCN.mensal.labels.length).fill(0);
    if (PL) a[PL.mesIndex] = PL.qtd;
    return a;
  }
  function forecastWeekly(mi) {
    const a = new Array(OCN.semanal.labels.length).fill(0);
    if (PL && mi === PL.mesIndex) a[PL.semanaIndex] = PL.qtd;
    return a;
  }
  function lineDS(data, dashed) {
    return { label: 'Esperado', data, type: 'line', borderColor: NAVY, backgroundColor: NAVY, borderWidth: 2, borderDash: dashed ? [5, 4] : [], pointRadius: 4, pointHoverRadius: 6, tension: 0.25, spanGaps: false, order: 1, datalabels: dlLine };
  }

  // ---------- estado / chart principal ----------
  const M = OCN.mensal, W = OCN.semanal;
  let chartMensal, view = 'monthly', cur = null;
  const toast = document.getElementById('toast');
  const backBtn = document.getElementById('backBtn');
  function showToast(m) { toast.textContent = m; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2200); }

  function opts(isMonthly) {
    return {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22 } },
      onClick: (e, els) => {
        if (view !== 'monthly' || !els.length) return;
        const i = els[0].index;
        if (!M.interativo[i]) { showToast('Abril não tem data esperada no calendário'); return; }
        goWeekly(i);
      },
      onHover: (e, els) => { e.native.target.style.cursor = (view === 'monthly' && els.length && M.interativo[els[0].index]) ? 'pointer' : 'default'; },
      plugins: {
        legend: { display: false }, datalabels: { clamp: true },
        tooltip: {
          callbacks: {
            title: (it) => isMonthly ? (M.full[it[0].dataIndex] + '/26') : (M.full[cur] + ' · ' + W.labels[it[0].dataIndex][0]),
            label: (c) => {
              if (c.dataset.label === 'Esperado') {
                const m = isMonthly ? M.esperadoModelo[c.dataIndex] : (W.esperadoModelo[cur] ? W.esperadoModelo[cur][c.dataIndex] : null);
                return 'Esperado: ' + (c.parsed.y == null ? '—' : c.parsed.y) + (m ? ' (' + mdlStr(m) + ')' : '');
              }
              return c.dataset.label + ': ' + c.parsed.y;
            },
          },
        },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: TXT2 } },
        y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, precision: 0 }, title: { display: true, text: 'carros', color: '#9ca3af', font: { size: 11 } } },
      },
    };
  }

  function buildMonthly() {
    return { type: 'bar', data: { labels: M.labels, datasets: [barDS('Polo', M.recebido.Polo), barDS('Argo', M.recebido.Argo), barDS('Tera', M.recebido.Tera), forecastDS(forecastMonthly()), lineDS(M.esperadoTotal, true)] }, options: opts(true) };
  }
  function buildWeekly(mi) {
    const rp = (W.recebido.Polo[mi] || Z), ra = (W.recebido.Argo[mi] || Z), rt = (W.recebido.Tera[mi] || Z);
    return { type: 'bar', data: { labels: W.labels, datasets: [barDS('Polo', rp), barDS('Argo', ra), barDS('Tera', rt), forecastDS(forecastWeekly(mi)), lineDS(W.esperadoTotal[mi] || [null, null, null, null, null], true)] }, options: opts(false) };
  }
  function render(cfg) { if (chartMensal) chartMensal.destroy(); chartMensal = new Chart(document.getElementById('chartMensal'), cfg); }

  function goWeekly(mi) {
    view = 'weekly'; cur = mi;
    document.getElementById('frotaSub').textContent = 'Detalhe semanal de ' + M.full[mi] + '/26 · por modelo';
    document.getElementById('frotaCrumb').innerHTML = '<i class="ti ti-calendar"></i> 2026 › <b>' + M.full[mi] + '</b>';
    backBtn.style.display = 'inline-flex';
    render(buildWeekly(mi));
  }
  function goMonthly() {
    view = 'monthly'; cur = null;
    document.getElementById('frotaSub').textContent = 'Recebidos vs. esperado · por modelo · visão mensal (2026)';
    document.getElementById('frotaCrumb').innerHTML = '<i class="ti ti-calendar"></i> ano de 2026';
    backBtn.style.display = 'none';
    render(buildMonthly());
  }
  backBtn.addEventListener('click', goMonthly);

  render(buildMonthly());

  // ---------- chart acumulado ----------
  const A = OCN.acumulado;
  function cumDS(model) {
    return { label: OCN.modelos[model].label, data: A.recebido[model], backgroundColor: COR[model], stack: 'r', borderRadius: 3, maxBarThickness: 48, datalabels: { display: false } };
  }
  new Chart(document.getElementById('chartAcum'), {
    type: 'bar',
    data: {
      labels: M.labels,
      datasets: [
        cumDS('Polo'), cumDS('Argo'), cumDS('Tera'),
        { label: 'Esperado acum.', data: A.esperado, type: 'line', borderColor: NAVY, backgroundColor: NAVY, borderWidth: 2, pointRadius: 3, pointHoverRadius: 6, tension: 0.25, datalabels: { color: NAVY, anchor: 'end', align: 'top', offset: 4, font: { size: 10, weight: 500 }, formatter: (v) => v } },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22 } },
      plugins: { legend: { display: false }, datalabels: { clamp: true }, tooltip: { callbacks: { label: (c) => (c.parsed.y == null ? null : c.dataset.label + ': ' + c.parsed.y) } } },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: TXT2 } },
        y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, precision: 0 }, title: { display: true, text: 'carros (acum.)', color: '#9ca3af', font: { size: 11 } } },
      },
    },
  });

  // esconde a tela de loading quando o dashboard está pronto
  const _ld = document.getElementById('appLoading');
  if (_ld) _ld.classList.add('hidden');

  // ===================== OCORRÊNCIAS (lazy init) =====================
  let ocorReady = false;
  // legenda simples: apenas cor + rótulo (percentuais ficam dentro da pizza)
  function donutLegend(items) {
    return items.map((it) => `<span class="dl-it"><span class="dl-sw" style="background:${it.cor}"></span><span class="dl-label">${it.label}</span></span>`).join('');
  }
  // cor de texto legível conforme luminância do fundo
  function txtOn(hex) {
    const c = hex.replace('#', '');
    const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#3A0BA3' : '#fff';
  }
  function initOcorrencias() {
    if (ocorReady) return;
    ocorReady = true;
    const O = OCN.ocorrencias;

    // KPIs
    document.getElementById('ocorKpis').innerHTML = `
      <div class="kpi-card"><div class="kpi-label"><i class="ti ti-alert-triangle"></i> Total de ocorrências</div><div class="kpi-value">${O.total}</div><div class="kpi-sub">${O.foramOficina} foram para oficina</div></div>
      <div class="kpi-card"><div class="kpi-label"><i class="ti ti-shield-half"></i> Com sinistro</div><div class="kpi-value">${O.comSinistro}</div><div class="kpi-sub">${O.comSinistroPct}% das ocorrências</div></div>
      <div class="kpi-card"><div class="kpi-label"><i class="ti ti-clock-hour-4"></i> Taxa</div><div class="kpi-value">${O.contratos.taxaCarroMes}</div><div class="kpi-sub">ocorrência / carro-mês</div></div>`;

    // Probabilidade & contratos
    const c = O.contratos;
    document.getElementById('ocorTaxaDesc').textContent = c.taxaTexto;
    document.getElementById('ocorContratos').innerHTML = `
      <div class="mini-stat"><div class="v">${c.totalContratos}</div><div class="l">contratos (${c.ativos} ativos)</div></div>
      <div class="mini-stat"><div class="v">${c.taxaCarroMes}</div><div class="l">ocorr./carro-mês</div></div>
      <div class="mini-stat"><div class="v">${c.rescindidos}</div><div class="l">contratos rescindidos</div></div>`;

    // Duração esperada de contrato
    const D = O.duracao;
    document.getElementById('duracaoPanel').innerHTML = `
      <div style="display:flex;align-items:baseline;gap:8px;margin:12px 0 4px;">
        <span style="font-size:34px;font-weight:600;color:#5A00F8;">~${D.estimadaMeses}</span>
        <span style="font-size:14px;color:var(--text-2);">meses estimados</span>
      </div>
      <div style="font-size:12px;color:var(--text-2);margin-bottom:14px;">vs. ${D.nominalMeses} meses do contrato nominal</div>
      <div style="height:10px;border-radius:6px;background:#EDE9FB;overflow:hidden;">
        <div style="height:100%;width:${D.pctDoNominal}%;background:#5A00F8;border-radius:6px;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-3);margin:5px 0 14px;"><span>0</span><span>${D.nominalMeses} meses</span></div>
      <div style="font-size:12px;color:var(--text-2);line-height:1.55;">Baseado em churn mensal de <b style="color:var(--text)">${D.churnMensalPct}%</b> (${D.encerramentosChurn} encerramentos, excl. troca de carro). Estimativa preliminar — janela de ~2,5 meses.</div>`;

    // Donut por tipo
    document.getElementById('legendTipo').innerHTML = donutLegend(O.porTipo);
    new Chart(document.getElementById('chartTipo'), {
      type: 'doughnut',
      data: { labels: O.porTipo.map((t) => t.label), datasets: [{ data: O.porTipo.map((t) => t.valor), backgroundColor: O.porTipo.map((t) => t.cor), borderColor: '#fff', borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '56%',
        plugins: { legend: { display: false }, datalabels: { color: (ctx) => txtOn(ctx.dataset.backgroundColor[ctx.dataIndex]), font: { size: 13, weight: 600 }, formatter: (v) => Math.round((v / O.total) * 100) + '%' }, tooltip: { callbacks: { label: (x) => `${x.label}: ${Math.round((x.parsed / O.total) * 100)}% (${x.parsed})` } } },
      },
    });

    // Sinistro por tipo (barra empilhada horizontal) — tons de roxo
    const S = O.sinistroPorTipo;
    document.getElementById('legendSinistro').innerHTML = `<span class="dl-it"><span class="dl-sw" style="background:#5A00F8"></span>Com sinistro</span><span class="dl-it"><span class="dl-sw" style="background:#E0D8F7"></span>Sem sinistro</span>`;
    new Chart(document.getElementById('chartSinistro'), {
      type: 'bar',
      data: { labels: S.labels, datasets: [
        { label: 'Com sinistro', data: S.com, backgroundColor: '#5A00F8', stack: 's', borderRadius: 3, datalabels: { display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, color: '#fff', font: { size: 11, weight: 600 }, formatter: (v) => v } },
        { label: 'Sem sinistro', data: S.sem, backgroundColor: '#E0D8F7', stack: 's', borderRadius: 3, datalabels: { display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, color: '#5A2BB0', font: { size: 11, weight: 600 }, formatter: (v) => v } },
      ] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${x.parsed.x}` } } },
        scales: { x: { stacked: true, display: false }, y: { stacked: true, grid: { display: false }, ticks: { color: TXT2 } } },
      },
    });

    // Churn (motivo fim)
    const churnTotal = O.churn.reduce((a, b) => a + b.valor, 0);
    document.getElementById('legendChurn').innerHTML = donutLegend(O.churn);
    new Chart(document.getElementById('chartChurn'), {
      type: 'doughnut',
      data: { labels: O.churn.map((t) => t.label), datasets: [{ data: O.churn.map((t) => t.valor), backgroundColor: O.churn.map((t) => t.cor), borderColor: '#fff', borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '56%',
        plugins: { legend: { display: false }, datalabels: { color: (ctx) => txtOn(ctx.dataset.backgroundColor[ctx.dataIndex]), font: { size: 13, weight: 600 }, formatter: (v) => Math.round((v / churnTotal) * 100) + '%' }, tooltip: { callbacks: { label: (x) => `${x.label}: ${Math.round((x.parsed / churnTotal) * 100)}% (${x.parsed})` } } },
      },
    });
  }

  // ===================== UNIT ECONOMICS (lazy init) =====================
  let unitReady = false;
  function initUnit() {
    if (unitReady) return;
    unitReady = true;
    const U = OCN.ue;
    const isAdmin = !!(OCN._meta && OCN._meta.user && OCN._meta.user.role === 'admin');
    const fleetsEl = document.getElementById('ueFleets');
    if (!U || !U.fleets || !U.fleets.length) {
      fleetsEl.innerHTML = '<div style="color:var(--text-2);font-size:13px">Sem dados de Unit Economics.</div>';
      return;
    }
    let current = U.fleets[0].id;
    let model = U.fleets[0].model;
    let entered = {}; // "line@@period" -> {value, kind}
    const ekey = (l, p) => l + '@@' + p;

    const fmtNum = (v) => Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    const ueFmt = (v) => (v === null || v === undefined) ? '' : (v < 0 ? '(' + fmtNum(v) + ')' : fmtNum(v));
    const parseInput = (raw) => {
      raw = String(raw).trim().replace(/,/g, '');
      if (raw === '') return null;
      const neg = /^\(.*\)$/.test(raw);
      raw = raw.replace(/[()$\s]/g, '');
      const n = parseFloat(raw);
      if (isNaN(n)) return NaN;
      return neg ? -n : n;
    };
    const orcVal = (line, period) => {
      const l = (U.orcado[model] && U.orcado[model].lines.find((x) => x.label === line));
      return l ? l.values[period] : null; // period 0..12 (M0..M12)
    };
    const isLeaf = (g) => g === 'inflow' || g === 'outflow';

    fleetsEl.innerHTML = U.fleets
      .map((f) => `<button class="ue-fleet-btn" data-id="${f.id}"><span class="n">${f.label}</span><span class="m">${f.modelLabel} · ${f.cars} carros</span></button>`)
      .join('');
    fleetsEl.querySelectorAll('.ue-fleet-btn').forEach((b) =>
      b.addEventListener('click', () => { current = b.dataset.id; loadFleet(); })
    );

    function cellLeaf(line, period) {
      const e = entered[ekey(line, period)];
      const orc = orcVal(line, period);
      let s = '';
      if (e) s += `<span class="ue-main ue-${e.kind}">${ueFmt(e.value)}</span>`;
      if (orc !== null && orc !== undefined) s += `<span class="ue-orc">${ueFmt(orc)}</span>`;
      return s;
    }
    function cellTotal(t) {
      let s = '';
      if (t && t.hasMain) s += `<span class="ue-main ue-${t.kind}">${ueFmt(t.eff)}</span>`;
      if (t && t.orc !== null && t.orc !== undefined) s += `<span class="ue-orc">${ueFmt(t.orc)}</span>`;
      return s;
    }
    // Totalizadores: orçado vem da planilha; efetivo = soma das linhas (entrada ou orçado) por período
    function computeTotals(lines) {
      const P = U.periods;
      const leavesOf = (g) => lines.filter((l) => l.group === g);
      const sheet = (label, p) => { const l = lines.find((x) => x.label === label); return l ? l.values[p] : null; };
      const res = { totalInflow: [], totalOutflow: [], net: [], acc: [] };
      let accEff = 0, accEnt = false, accProj = false;
      for (let p = 0; p <= P; p++) {
        let inEnt = false, inProj = false, inSum = 0;
        leavesOf('inflow').forEach((l) => { const e = entered[ekey(l.label, p)]; if (e) { inEnt = true; inSum += e.value; if (e.kind === 'proj') inProj = true; } else { const o = l.values[p]; inSum += (o == null ? 0 : o); } });
        let ouEnt = false, ouProj = false, ouSum = 0;
        leavesOf('outflow').forEach((l) => { const e = entered[ekey(l.label, p)]; if (e) { ouEnt = true; ouSum += e.value; if (e.kind === 'proj') ouProj = true; } else { const o = l.values[p]; ouSum += (o == null ? 0 : o); } });
        const inOrc = sheet('Total Inflow', p), ouOrc = sheet('Total Outflow', p), netOrc = sheet('Net monthly cashflow', p);
        const inEff = inEnt ? inSum : (inOrc == null ? 0 : inOrc);
        const ouEff = ouEnt ? ouSum : (ouOrc == null ? 0 : ouOrc);
        const netEnt = inEnt || ouEnt;
        const netEff = netEnt ? (inEff + ouEff) : (netOrc == null ? 0 : netOrc);
        const netProj = inProj || ouProj;
        res.totalInflow[p] = { orc: inOrc, eff: inEff, hasMain: inEnt, kind: inProj ? 'proj' : 'real' };
        res.totalOutflow[p] = { orc: ouOrc, eff: ouEff, hasMain: ouEnt, kind: ouProj ? 'proj' : 'real' };
        res.net[p] = { orc: netOrc, eff: netEff, hasMain: netEnt, kind: netProj ? 'proj' : 'real' };
        accEff += netEff; accEnt = accEnt || netEnt; accProj = accProj || netProj;
        res.acc[p] = { orc: sheet('Acc Cashflow', p), eff: accEff, hasMain: accEnt, kind: accProj ? 'proj' : 'real' };
      }
      return res;
    }

    async function loadFleet() {
      const f = U.fleets.find((x) => x.id === current);
      model = f.model;
      fleetsEl.querySelectorAll('.ue-fleet-btn').forEach((b) => b.classList.toggle('active', b.dataset.id === current));
      document.getElementById('ueHead').innerHTML =
        `<div class="ue-fleet-title">${f.label} — ${f.modelLabel}</div>` +
        `<div class="ue-fleet-sub">${f.cars} carros · contrato de ${U.periods} meses · valores por veículo (USD)${isAdmin ? ' · <b>admin</b>: clique numa célula para editar' : ''}</div>`;
      entered = {};
      try {
        const r = await fetch('/api/ue/values?fleet=' + encodeURIComponent(current), { cache: 'no-store' });
        if (r.ok) { const d = await r.json(); (d.values || []).forEach((v) => { entered[ekey(v.line, v.period)] = { value: v.value, kind: v.kind }; }); }
      } catch (e) { /* segue com orçado */ }
      renderTable(f);
    }

    function renderTable(f) {
      const orc = U.orcado[f.model];
      const tbl = document.getElementById('ueTable');
      if (!orc) { tbl.innerHTML = '<tbody><tr><td>Sem orçado para ' + f.modelLabel + '</td></tr></tbody>'; return; }
      const T = computeTotals(orc.lines);
      const gmap = { totalInflow: T.totalInflow, totalOutflow: T.totalOutflow, net: T.net, acc: T.acc };
      let html = '<thead><tr><th class="ue-rowlabel">Linha</th><th>M0</th>';
      for (let p = 1; p <= U.periods; p++) html += `<th>M${p}</th>`;
      html += '</tr></thead><tbody>';
      orc.lines.forEach((l) => {
        html += `<tr class="ue-row ue-${l.group}"><td class="ue-rowlabel">${l.label}</td>`;
        for (let p = 0; p <= U.periods; p++) {
          if (isLeaf(l.group)) {
            html += `<td class="ue-cell${isAdmin ? ' ue-editable' : ''}" data-line="${l.label.replace(/"/g, '&quot;')}" data-period="${p}">${cellLeaf(l.label, p)}</td>`;
          } else {
            html += `<td class="ue-cell ue-computed">${cellTotal(gmap[l.group][p])}</td>`;
          }
        }
        html += '</tr>';
      });
      html += '</tbody>';
      tbl.innerHTML = html;
      if (isAdmin) tbl.querySelectorAll('.ue-editable').forEach((td) => td.addEventListener('click', () => openEditor(td, f)));
      document.getElementById('ueFoot').innerHTML =
        '<span class="ue-tag ue-tag-real">Realizado</span><span class="ue-tag ue-tag-proj">Projetado</span><span class="ue-tag ue-tag-orc">Orçado</span>' +
        ' M0 = setup inicial · Totais, Net e Acc são calculados automaticamente.' +
        (isAdmin ? ' Clique numa linha-item para preencher; vazio + Enter apaga.' : '');
    }

    function openEditor(td, f) {
      if (td.querySelector('.ue-input')) return;
      const line = td.dataset.line, period = +td.dataset.period;
      const e = entered[ekey(line, period)] || {};
      let kind = e.kind || 'real';
      td.innerHTML =
        `<div class="ue-editor"><input class="ue-input" type="text" value="${e.value != null ? e.value : ''}" />` +
        `<div class="ue-kinds"><button type="button" class="ue-kbtn ${kind === 'real' ? 'on' : ''}" data-k="real">Real</button>` +
        `<button type="button" class="ue-kbtn ${kind === 'proj' ? 'on' : ''}" data-k="proj">Proj</button></div></div>`;
      const input = td.querySelector('.ue-input');
      input.focus(); input.select();
      td.querySelectorAll('.ue-kbtn').forEach((b) => b.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        kind = b.dataset.k;
        td.querySelectorAll('.ue-kbtn').forEach((x) => x.classList.toggle('on', x === b));
        input.focus();
      }));
      let done = false;
      async function commit() {
        if (done) return; done = true;
        const val = parseInput(input.value);
        try {
          if (val === null) {
            delete entered[ekey(line, period)];
            await fetch('/api/ue/value/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fleet: current, line, period }) });
          } else if (!isNaN(val)) {
            entered[ekey(line, period)] = { value: val, kind };
            await fetch('/api/ue/value', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fleet: current, line, period, value: val, kind }) });
          }
        } catch (err) { /* mantém estado local */ }
        renderTable(f);
      }
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        else if (ev.key === 'Escape') { done = true; renderTable(f); }
      });
      input.addEventListener('blur', () => { setTimeout(commit, 120); });
    }

    loadFleet();
  }
  }
})();

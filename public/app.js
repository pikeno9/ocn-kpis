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
  document.getElementById('fleetSub').textContent = SF.total + ' registered vehicles';
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

  // ---------- mês vigente (base do recorte YTD do gráfico) ----------
  const Mref = OCN.mensal;
  const vi = Math.max(0, Math.min(Mref.labels.length - 1, (new Date().getMonth() + 1) - 4)); // Abr=0 ... Dez=8

  // ---------- helpers ----------
  function mdlStr(o) { return o ? Object.entries(o).map(([m, v]) => v + ' ' + m).join(' · ') : ''; }
  // cor de texto legível sobre a barra (branco em fundo escuro, grafite em fundo claro)
  const txtOnBar = (hex) => { if (typeof hex !== 'string' || hex[0] !== '#') return '#282728'; const c = hex.replace('#', ''); const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16); return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#282728' : '#fff'; };
  const dlBar = { color: (ctx) => txtOnBar(ctx.dataset.backgroundColor), anchor: 'center', align: 'center', font: { size: 10, weight: 600 }, formatter: (v) => (v > 0 ? v : '') };
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
    return { label: 'Expected', data, type: 'line', borderColor: NAVY, backgroundColor: NAVY, borderWidth: 2, borderDash: dashed ? [5, 4] : [], pointRadius: 4, pointHoverRadius: 6, tension: 0.25, spanGaps: false, order: 1, datalabels: dlLine };
  }

  // ---------- estado / chart principal ----------
  const M = OCN.mensal, W = OCN.semanal;
  let chartMensal, view = 'monthly', cur = null, range = 'ytd';
  const rng = (arr) => (range === 'ytd' ? arr.slice(0, vi + 1) : arr); // YTD = abr até o mês vigente; FY = ano todo
  const toast = document.getElementById('toast');
  const backBtn = document.getElementById('backBtn');
  function showToast(m) { toast.textContent = m; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2200); }

  function opts(isMonthly) {
    return {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22 } },
      onClick: (e, els) => {
        if (view !== 'monthly' || !els.length) return;
        const i = els[0].index;
        if (!M.interativo[i]) { showToast('April has no expected date in the calendar'); return; }
        goWeekly(i);
      },
      onHover: (e, els) => { e.native.target.style.cursor = (view === 'monthly' && els.length && M.interativo[els[0].index]) ? 'pointer' : 'default'; },
      plugins: {
        legend: { display: false }, datalabels: { clamp: true },
        tooltip: {
          callbacks: {
            title: (it) => isMonthly ? (M.full[it[0].dataIndex] + '/26') : (M.full[cur] + ' · ' + W.labels[it[0].dataIndex][0]),
            label: (c) => {
              if (c.dataset.label === 'Expected') {
                const m = isMonthly ? M.esperadoModelo[c.dataIndex] : (W.esperadoModelo[cur] ? W.esperadoModelo[cur][c.dataIndex] : null);
                return 'Expected: ' + (c.parsed.y == null ? '—' : c.parsed.y) + (m ? ' (' + mdlStr(m) + ')' : '');
              }
              return c.dataset.label + ': ' + c.parsed.y;
            },
          },
        },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: TXT2 } },
        y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, precision: 0 }, title: { display: true, text: 'cars', color: '#9ca3af', font: { size: 11 } } },
      },
    };
  }

  function buildMonthly() {
    return { type: 'bar', data: { labels: rng(M.labels), datasets: [barDS('Polo', rng(M.recebido.Polo)), barDS('Argo', rng(M.recebido.Argo)), barDS('Tera', rng(M.recebido.Tera)), forecastDS(rng(forecastMonthly())), lineDS(rng(M.esperadoTotal), true)] }, options: opts(true) };
  }
  function buildWeekly(mi) {
    const rp = (W.recebido.Polo[mi] || Z), ra = (W.recebido.Argo[mi] || Z), rt = (W.recebido.Tera[mi] || Z);
    return { type: 'bar', data: { labels: W.labels, datasets: [barDS('Polo', rp), barDS('Argo', ra), barDS('Tera', rt), forecastDS(forecastWeekly(mi)), lineDS(W.esperadoTotal[mi] || [null, null, null, null, null], true)] }, options: opts(false) };
  }
  function render(cfg) { if (chartMensal) chartMensal.destroy(); chartMensal = new Chart(document.getElementById('chartMensal'), cfg); }

  const rangeToggle = document.getElementById('rangeToggle');
  const frotaSubEl = document.getElementById('frotaSub'); // cabeçalho da seção foi removido — guardas abaixo
  const frotaCrumbEl = document.getElementById('frotaCrumb');
  function goWeekly(mi) {
    view = 'weekly'; cur = mi;
    if (frotaSubEl) frotaSubEl.textContent = 'Weekly detail for ' + M.full[mi] + '/26 · by model';
    if (frotaCrumbEl) frotaCrumbEl.innerHTML = '<i class="ti ti-calendar"></i> 2026 › <b>' + M.full[mi] + '</b>';
    backBtn.style.display = 'inline-flex';
    if (rangeToggle) rangeToggle.style.display = 'none'; // recorte YTD/FY só faz sentido na visão mensal
    render(buildWeekly(mi));
  }
  function goMonthly() {
    view = 'monthly'; cur = null;
    if (frotaSubEl) frotaSubEl.textContent = 'Received vs. expected · by model · monthly view (2026)';
    if (frotaCrumbEl) frotaCrumbEl.innerHTML = '<i class="ti ti-calendar"></i> year 2026';
    backBtn.style.display = 'none';
    if (rangeToggle) rangeToggle.style.display = '';
    render(buildMonthly());
  }
  backBtn.addEventListener('click', goMonthly);
  // toggle YTD (abr→hoje) × FY26 (abr→dez)
  if (rangeToggle) rangeToggle.querySelectorAll('.range-btn').forEach((b) => b.addEventListener('click', () => {
    range = b.dataset.range;
    rangeToggle.querySelectorAll('.range-btn').forEach((x) => x.classList.toggle('active', x === b));
    if (view === 'monthly') render(buildMonthly());
  }));

  render(buildMonthly());

  // ---------- chart acumulado (Received Fleet) ----------
  const A = OCN.acumulado;
  const cumTotal = M.labels.map((_, i) => (A.recebido.Polo[i] || 0) + (A.recebido.Argo[i] || 0) + (A.recebido.Tera[i] || 0));
  function cumDS(model) {
    // número por modelo dentro do segmento (menor)
    const labels = { seg: { anchor: 'center', align: 'center', color: txtOnBar(COR[model]), font: { size: 9, weight: 600 }, formatter: (v) => (v > 0 ? v : '') } };
    return { label: OCN.modelos[model].label, data: A.recebido[model], backgroundColor: COR[model], stack: 'r', borderRadius: 3, maxBarThickness: 48, order: 2, datalabels: { labels } };
  }
  // plugin: total ao lado da barra, no meio (vertical), com caixinha de borda pontilhada roxa (datalabels não faz traço pontilhado)
  const acumTotalTag = {
    id: 'acumTotalTag',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx, yScale = chart.scales.y, meta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.font = "400 10px " + ((Chart.defaults.font && Chart.defaults.font.family) || 'sans-serif');
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      for (let i = 0; i < cumTotal.length; i++) {
        const tot = cumTotal[i], bar = meta.data[i];
        if (!tot || !bar) continue; // mês sem valor → sem caixinha
        const txt = String(tot), tw = ctx.measureText(txt).width;
        const padX = 5, padY = 3, h = 10 + padY * 2, w = tw + padX * 2;
        const bx = bar.x + bar.width / 2 + 10; // à direita da barra, sem encostar
        const py = yScale.getPixelForValue(tot / 2); // meio da barra (metade do acumulado)
        const by = py - h / 2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, by, w, h, 4); else ctx.rect(bx, by, w, h);
        ctx.setLineDash([2, 2]); ctx.lineWidth = 1; ctx.strokeStyle = '#5A00F8'; ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#111827'; ctx.fillText(txt, bx + padX, py + 0.5);
      }
      ctx.restore();
    },
  };
  new Chart(document.getElementById('chartAcum'), {
    type: 'bar',
    data: {
      labels: M.labels,
      datasets: [
        cumDS('Polo'), cumDS('Argo'), cumDS('Tera'),
        // linha esperada: mesmo formato do gráfico mensal (tracejada + rótulo dlLine); order maior = desenhada ATRÁS das barras
        { label: 'Expected (cum.)', data: A.esperado, type: 'line', borderColor: NAVY, backgroundColor: NAVY, borderWidth: 2, borderDash: [5, 4], pointRadius: 4, pointHoverRadius: 6, tension: 0.25, order: 3, datalabels: dlLine },
      ],
    },
    plugins: [acumTotalTag],
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 26, right: 20 } },
      plugins: { legend: { display: false }, datalabels: { clamp: true }, tooltip: { callbacks: { label: (c) => (c.parsed.y == null ? null : c.dataset.label + ': ' + c.parsed.y) } } },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: TXT2 } },
        y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, precision: 0 }, title: { display: true, text: 'cars (cum.)', color: '#9ca3af', font: { size: 11 } } },
      },
    },
  });

  // ---------- chart utilização (Active × Inactive, 100% empilhado, sempre YTD) ----------
  const FS = OCN.fleetStatus;
  if (FS && FS.labels && document.getElementById('chartUtil')) {
    const sl = (arr) => arr.slice(0, vi + 1); // abr..mês atual (sem meses futuros vazios)
    const pctFmt = (v) => (v == null ? '' : String(Math.round(v * 10) / 10).replace('.', ',') + '%');
    const absFmt = (ctx) => { const a = ctx.dataset._abs ? ctx.dataset._abs[ctx.dataIndex] : null; return a == null ? '' : a; };
    // Active: segmento grande — percentual em cima, absoluto embaixo, ambos dentro da barra roxa
    const activeDS = (label, pct, abs, color) => ({
      label, data: sl(pct), _abs: sl(abs), backgroundColor: color, stack: 'u', borderRadius: 3, maxBarThickness: 88,
      datalabels: {
        display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
        color: (ctx) => txtOnBar(ctx.dataset.backgroundColor), anchor: 'center',
        labels: {
          pct: { align: 'top', offset: 1, font: { size: 11, weight: 600 }, formatter: (v) => pctFmt(v) },
          abs: { align: 'bottom', offset: 1, font: { size: 9, weight: 500 }, formatter: (v, ctx) => absFmt(ctx) },
        },
      },
    });
    // Inactive: segmento fino — percentual e absoluto centralizados dentro da própria faixa cinza (halo branco para legibilidade)
    const inactiveDS = (label, pct, abs, color) => ({
      label, data: sl(pct), _abs: sl(abs), backgroundColor: color, stack: 'u', borderRadius: 3, maxBarThickness: 88,
      datalabels: {
        display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
        anchor: 'center', color: '#111827', textStrokeColor: '#fff', textStrokeWidth: 3,
        labels: {
          // pct exatamente no centro da faixa (align 'center' ignora offset — é isso que centraliza de fato);
          // abs "empurrado" para baixo a partir do centro, para não colidir com o pct
          pct: { align: 'center', font: { size: 11, weight: 600 }, formatter: (v) => pctFmt(v) },
          abs: { align: 'bottom', offset: 8, font: { size: 8, weight: 500 }, formatter: (v, ctx) => absFmt(ctx) },
        },
      },
    });
    new Chart(document.getElementById('chartUtil'), {
      type: 'bar',
      data: { labels: sl(FS.labels), datasets: [
        activeDS('Active Vehicles', FS.activePct, FS.active, '#5A00F8'),
        inactiveDS('Inactive Vehicles', FS.inactivePct, FS.inactive, '#CBD5E1'),
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false }, datalabels: { clamp: true },
          tooltip: { callbacks: { label: (c) => { const abs = c.dataset._abs ? c.dataset._abs[c.dataIndex] : null; return c.dataset.label + ': ' + pctFmt(c.parsed.y) + (abs != null ? ' (' + abs + ')' : ''); } } },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: TXT2 } },
          // teto acima de 100% dá folga para o rótulo do segmento fino (Inactive) não sair da barra; tick > 100% escondido
          y: { stacked: true, min: 0, max: 108, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, stepSize: 10, callback: (v) => (v <= 100 ? v + '%' : '') } },
        },
      },
    });
  }

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
      <div class="kpi-card"><div class="kpi-label"><i class="ti ti-alert-triangle"></i> Total incidents</div><div class="kpi-value">${O.total}</div><div class="kpi-sub">${O.foramOficina} went to the workshop</div></div>
      <div class="kpi-card"><div class="kpi-label"><i class="ti ti-shield-half"></i> With claim</div><div class="kpi-value">${O.comSinistro}</div><div class="kpi-sub">${O.comSinistroPct}% of incidents</div></div>
      <div class="kpi-card"><div class="kpi-label"><i class="ti ti-clock-hour-4"></i> Rate</div><div class="kpi-value">${O.contratos.taxaCarroMes}</div><div class="kpi-sub">incidents / car-month</div></div>`;

    // Probability & contracts
    const c = O.contratos;
    document.getElementById('ocorTaxaDesc').textContent = c.taxaTexto;
    document.getElementById('ocorContratos').innerHTML = `
      <div class="mini-stat"><div class="v">${c.totalContratos}</div><div class="l">contracts (${c.ativos} active)</div></div>
      <div class="mini-stat"><div class="v">${c.taxaCarroMes}</div><div class="l">incidents/car-month</div></div>
      <div class="mini-stat"><div class="v">${c.rescindidos}</div><div class="l">terminated contracts</div></div>`;

    // Expected contract duration
    const D = O.duracao;
    document.getElementById('duracaoPanel').innerHTML = `
      <div style="display:flex;align-items:baseline;gap:8px;margin:12px 0 4px;">
        <span style="font-size:34px;font-weight:600;color:#5A00F8;">~${D.estimadaMeses}</span>
        <span style="font-size:14px;color:var(--text-2);">estimated months</span>
      </div>
      <div style="font-size:12px;color:var(--text-2);margin-bottom:14px;">vs. ${D.nominalMeses} months of the nominal contract</div>
      <div style="height:10px;border-radius:6px;background:#EDE9FB;overflow:hidden;">
        <div style="height:100%;width:${D.pctDoNominal}%;background:#5A00F8;border-radius:6px;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-3);margin:5px 0 14px;"><span>0</span><span>${D.nominalMeses} months</span></div>
      <div style="font-size:12px;color:var(--text-2);line-height:1.55;">Based on monthly churn of <b style="color:var(--text)">${D.churnMensalPct}%</b> (${D.encerramentosChurn} terminations, excl. car swaps). Preliminary estimate — ~2.5-month window.</div>`;

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
    document.getElementById('legendSinistro').innerHTML = `<span class="dl-it"><span class="dl-sw" style="background:#5A00F8"></span>With claim</span><span class="dl-it"><span class="dl-sw" style="background:#E0D8F7"></span>Without claim</span>`;
    new Chart(document.getElementById('chartSinistro'), {
      type: 'bar',
      data: { labels: S.labels, datasets: [
        { label: 'With claim', data: S.com, backgroundColor: '#5A00F8', stack: 's', borderRadius: 3, datalabels: { display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, color: '#fff', font: { size: 11, weight: 600 }, formatter: (v) => v } },
        { label: 'Without claim', data: S.sem, backgroundColor: '#E0D8F7', stack: 's', borderRadius: 3, datalabels: { display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, color: '#5A2BB0', font: { size: 11, weight: 600 }, formatter: (v) => v } },
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
      fleetsEl.innerHTML = '<div style="color:var(--text-2);font-size:13px">No Unit Economics data.</div>';
      return;
    }
    let current = U.fleets[0].id;
    let model = U.fleets[0].model;
    let plateView = null; // null = visão agregada da frota; string = placa selecionada (valores ainda não diferem — vem depois)
    let entered = {}; // "line@@period" -> {value, kind} — valores manuais em R$ (moeda principal)
    let manualMode = false; // edição manual desligada por padrão
    let currency = 'BRL';   // moeda de exibição: R$ (principal) ou US$ (toggle no cabeçalho)
    let cotacao = 5.5;      // câmbio futuro R$/US$ (slider, global) — converte os PROJETADOS
    let cotacaoReal = 5.0;  // cotação indicada para os REALIZADOS (campo, global)
    let refundPct = 0.13;   // correção a.a. do Security Deposit Refund (campo, global)
    const ORCADO_FX = 5.0;  // câmbio em que o orçado (USD, planilha) foi construído — só para exibi-lo em R$
    let params = {}; // parâmetros por frota: subrental, seguro, GPS, nº aluguéis, compra
    const LINE_PARAMS = {
      'Subscription': [{ k: '__sub_semanal__', label: 'Weekly subscription fee (R$)' }, { k: '__sub_juros__', label: 'Late-payment interest (%)' }],
      'Subrental fee': [{ k: '__subrental_mensal__', label: 'Monthly Subrental fee (R$)' }],
      'Insurance': [{ k: '__ins_total__', label: 'Total insurance for the year (R$)' }, { k: '__ins_parcelas__', label: 'Number of installments (from M1)' }],
      'GPS': [{ k: '__gps_m0__', label: 'Amount at M0 (R$)' }, { k: '__gps_mensal__', label: 'Monthly amount, from M1 (R$)' }],
      'Security Deposit': [{ k: '__num_alugueis__', label: 'Number of rentals (deposit = N × monthly Subrental)' }],
      'Vehicle Purchase': [{ k: '__vehicle__', label: 'Purchase/buyback amount (R$) — enters at M13' }],
    };
    // rótulo de exibição ≠ chave interna (que segue a planilha)
    const DISPLAY_LABEL = { 'Deposit Refund': 'Security Deposit Refund' };
    const par = (k) => +params[k] || 0;
    const SEMANAS_MES = 52 / 12; // 4,3333
    const PMAX = U.periods + 1;  // M13 = período pós-contrato (só lançamentos pontuais; recorrências param no M12)
    const ekey = (l, p) => l + '@@' + p;
    // separação realizado × projetado por TEMPO (início da frota até hoje)
    const hoje = U.hoje ? new Date(U.hoje + 'T12:00:00') : new Date();
    let elapsed = 0;      // meses decorridos desde o início da frota (fracionário)
    let realizedFull = 0; // meses já realizados, incluindo o mês vigente (valor integral, sem proporção)
    const fmtDate = (iso) => { if (!iso) return '—'; const p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; };

    const fmtNum = (v) => Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    const ueFmt = (v) => (v === null || v === undefined) ? '' : (v === 0 ? '-' : (v < 0 ? '(' + fmtNum(v) + ')' : fmtNum(v)));
    // entrada em pt-BR (ponto = milhar, vírgula = decimal) — mesma convenção do modal de parâmetros
    const parseInput = (raw) => {
      raw = String(raw).trim();
      if (raw === '') return null;
      const neg = /^\(.*\)$/.test(raw) || /^-/.test(raw);
      raw = raw.replace(/[()R$\s-]/gi, '').replace(/\./g, '').replace(',', '.');
      if (raw === '') return null;
      const n = parseFloat(raw);
      if (isNaN(n)) return NaN;
      return neg ? -n : n;
    };
    // número JS → string editável pt-BR (round-trip com parseInput)
    const toInput = (v) => (v == null ? '' : String(v).replace('.', ','));
    const orcVal = (line, period) => {
      const l = (U.orcado[model] && U.orcado[model].lines.find((x) => x.label === line));
      return l ? l.values[period] : null; // period 0..12 (M0..M12)
    };
    const isLeaf = (g) => g === 'inflow' || g === 'outflow';

    fleetsEl.innerHTML = U.fleets
      .map((f) => `<button class="ue-fleet-btn" data-id="${f.id}"><span class="n">${f.label}</span><span class="m">${f.modelLabel} · ${f.cars} cars</span></button>`)
      .join('');
    fleetsEl.querySelectorAll('.ue-fleet-btn').forEach((b) =>
      b.addEventListener('click', () => { current = b.dataset.id; loadFleet(); })
    );

    // média dos meses realizados de uma linha (base da projeção automática)
    function realizedAvg(line) {
      let sum = 0, n = 0;
      for (let p = 0; p <= U.periods; p++) { const e = entered[ekey(line, p)]; if (e && e.kind === 'real') { sum += e.value; n++; } }
      return n ? sum / n : null;
    }
    // status do período: realizado (do início até o mês vigente, incluso — valor integral) × projetado (meses futuros)
    function periodStatus(p) { return (p === 0 || p <= realizedFull) ? 'real' : 'proj'; }

    // Subscription por dados reais (matriz de pagamentos por placa): receita do mês = Σ semanas pagas
    // (vencimento no mês) × semanalidade, com juros % sobre as pagas em atraso. Agregado = soma ÷ nº de
    // placas da frota; visão por placa = só as semanas daquela placa, sem divisão.
    let subsRS = [], subsReady = false;
    function computeSubs(f) {
      subsRS = []; subsReady = false;
      const fee = par('__sub_semanal__');
      const pag = U.pagamentos && U.pagamentos.placas;
      const ini = f.inicio ? new Date(f.inicio + 'T12:00:00') : null;
      if (!(fee > 0) || !pag || !ini) return;
      const juros = par('__sub_juros__') / 100;
      const plates = plateView ? [plateView] : (f.placas || []);
      const nDiv = plateView ? 1 : (f.cars || plates.length || 1);
      for (let p = 0; p <= PMAX; p++) subsRS[p] = 0;
      plates.forEach((pl) => (pag[pl] || []).forEach((s) => {
        const venc = new Date(s.v + 'T12:00:00');
        let mo = Math.ceil(((venc - ini) / 86400000) / (SEMANAS_MES * 7));
        if (mo < 1) mo = 1;
        if (mo > U.periods) return;
        subsRS[mo] += fee * (1 + (s.a ? juros : 0));
      }));
      for (let p = 0; p <= PMAX; p++) subsRS[p] = subsRS[p] / nDiv;
      subsReady = true;
    }

    // valor NATIVO da linha num período: { rs } para valores em R$ (manuais/derivados) ou { usd } para
    // valores fixos em dólar. Sem câmbio aqui — a conversão para a moeda de exibição acontece no effSplit.
    // Recorrências mensais param no M12; o M13 só recebe os lançamentos pontuais pós-contrato.
    function effNative(line, period) {
      if (line === 'Subscription' && subsReady) {
        if (period === 0 || period === PMAX) return { rs: 0 };
        if (periodStatus(period) === 'real') return { rs: subsRS[period] || 0 };
        return null; // meses futuros: sem projeção automática por ora (só orçado como referência)
      }
      if (line === 'Subrental fee' && par('__subrental_mensal__') > 0) {
        return { rs: (period >= 1 && period <= U.periods) ? -par('__subrental_mensal__') : 0 };
      }
      if (line === 'Insurance' && par('__ins_total__') > 0 && par('__ins_parcelas__') >= 1) {
        // parcela = total/N; se N > 12, as parcelas além do M12 ficam fora da tabela (trunca, não reamortiza)
        const N = Math.round(par('__ins_parcelas__'));
        return { rs: (period >= 1 && period <= Math.min(N, U.periods)) ? -(par('__ins_total__') / N) : 0 };
      }
      // fixos (sem nenhuma conversão/exceção): R$50/US$10 e R$15/US$3, tratados direto em effSplit
      if (line === 'GPS' && (par('__gps_m0__') > 0 || par('__gps_mensal__') > 0)) {
        return { rs: period === 0 ? -par('__gps_m0__') : (period <= U.periods ? -par('__gps_mensal__') : 0) };
      }
      // calção = nº de aluguéis × mensalidade do Subrental (ambos manuais, R$)
      const secDepMag = () => (par('__num_alugueis__') > 0 && par('__subrental_mensal__') > 0)
        ? par('__num_alugueis__') * par('__subrental_mensal__') : 0;
      if (line === 'Security Deposit' && secDepMag() > 0) return { rs: period === 0 ? -secDepMag() : 0 };
      if (line === 'Deposit Refund' && secDepMag() > 0) {
        return { rs: period === PMAX ? secDepMag() * (1 + refundPct) : 0 }; // devolução corrigida, no M13
      }
      if (line === 'Vehicle Purchase' && par('__vehicle__') > 0) return { rs: period === PMAX ? -par('__vehicle__') : 0 };
      if (line === 'Initial Fee / Vehicle Sell' && par('__vehicle__') > 0) {
        return { rs: period === PMAX ? par('__vehicle__') * 1.03 : 0 }; // venda = 103% da compra, no M13
      }
      // demais linhas (Subscription, Maintenance...): sem cálculo automático — só orçado + entradas manuais
      const orc = orcVal(line, period);
      if (orc == null) return null;
      const avg = realizedAvg(line);
      return avg == null ? null : { rs: avg }; // projeção automática pela média dos realizados manuais
    }
    // converte um valor nativo para a moeda de exibição; realizados usam a cotação indicada, projetados o câmbio futuro
    function toDisplay(v, rate) {
      if (v == null) return null;
      if (currency === 'BRL') return Math.round('rs' in v ? v.rs : v.usd * rate);
      return Math.round('usd' in v ? v.usd : v.rs / rate);
    }
    // efetivo separando realizado (preto, cotação indicada — não muda com o slider) × projetado (roxo, câmbio futuro).
    // `status` diz qual dos dois campos é o "ativo" no período (o outro fica 0) — necessário pra exibir 0 como "-"
    // sem confundir com "não se aplica" (effNative/manual ausente, que continua totalmente em branco).
    function effSplit(line, period) {
      // Car Preparation/Sticker: valor fixo literal por moeda, sem nenhum cálculo/câmbio/exceção
      if (line === 'Car Preparation (wash + delivery)') return period === 0 ? { real: currency === 'BRL' ? -50 : -10, proj: 0, status: 'real' } : null;
      if (line === 'Sticker') return period === 0 ? { real: currency === 'BRL' ? -15 : -3, proj: 0, status: 'real' } : null;
      const m = entered[ekey(line, period)]; // entradas manuais são em R$
      if (m) {
        const val = toDisplay({ rs: m.value }, m.kind === 'proj' ? cotacao : cotacaoReal);
        return m.kind === 'proj' ? { real: 0, proj: val, status: 'proj' } : { real: val, proj: 0, status: 'real' };
      }
      const v = effNative(line, period);
      if (!v) return null;
      const st = periodStatus(period);
      return st === 'real'
        ? { real: toDisplay(v, cotacaoReal), proj: 0, status: 'real' }
        : { real: 0, proj: toDisplay(v, cotacao), status: 'proj' };
    }
    // linhas cujo lançamento pontual foi movido para o M13 (planilha original só vai até M12) — o orçado de
    // referência sai do M12 e passa a aparecer só no M13 (substituição, não duplicação)
    const M13_LINES = ['Vehicle Purchase', 'Initial Fee / Vehicle Sell', 'Deposit Refund'];
    // orçado (planilha, USD) na moeda de exibição: em R$ multiplica pelo câmbio em que foi construído
    const orcDisp = (line, period) => {
      const isM13Line = M13_LINES.includes(line);
      if (isM13Line && period === U.periods) return null; // M12 não mostra mais (valor foi para o M13)
      const srcP = (isM13Line && period === PMAX) ? U.periods : period; // M13 reaproveita o valor do M12
      const o = orcVal(line, srcP);
      return o == null ? null : Math.round(o * (currency === 'BRL' ? ORCADO_FX : 1));
    };
    function cellLeaf(line, period) {
      const e = effSplit(line, period);
      const orc = orcDisp(line, period);
      let s = '';
      if (e) s += `<span class="ue-main ue-${e.status}">${ueFmt(e.status === 'real' ? e.real : e.proj)}</span>`;
      if (orc != null) s += `<span class="ue-orc">${ueFmt(orc)}</span>`;
      return s;
    }
    function cellVal(t) { // totalizador (computado) ou coluna Total
      let s = '';
      if (t && t.hasMain) s += `<span class="ue-main ue-${t.kind}">${ueFmt(t.eff)}</span>`;
      if (t && t.orc != null) s += `<span class="ue-orc">${ueFmt(t.orc)}</span>`;
      return s;
    }
    function sectionEff(lines, group, p) {
      let sum = 0, anyMain = false;
      lines.filter((l) => l.group === group).forEach((l) => {
        const e = effSplit(l.label, p);
        if (e) { sum += (e.real || 0) + (e.proj || 0); anyMain = true; }
        else { const o = orcDisp(l.label, p); sum += (o == null ? 0 : o); }
      });
      return { sum, anyMain, kind: periodStatus(p) === 'real' ? 'real' : 'proj' };
    }
    // Totalizadores por período. O orçado dos totais é recalculado somando o orçado EXIBIDO de cada linha
    // (orcDisp) — assim os pontuais movidos para o M13 (compra/venda/refund) entram nos totais no M13, não
    // no M12 como nas linhas de total da planilha original. Efetivo = soma realizado/projetado das linhas.
    function computeTotals(lines) {
      const P = PMAX;
      const sumOrc = (group, p) => {
        let s = 0, any = false;
        lines.filter((l) => l.group === group).forEach((l) => { const o = orcDisp(l.label, p); if (o != null) { s += o; any = true; } });
        return any ? s : null;
      };
      const per = { totalInflow: [], totalOutflow: [], net: [], acc: [] };
      let accEff = 0, accOrc = 0, accEnt = false, accProj = false;
      for (let p = 0; p <= P; p++) {
        const inE = sectionEff(lines, 'inflow', p);
        const ouE = sectionEff(lines, 'outflow', p);
        const inOrc = sumOrc('inflow', p), ouOrc = sumOrc('outflow', p);
        const netOrc = (inOrc == null && ouOrc == null) ? null : (inOrc || 0) + (ouOrc || 0);
        const inEff = inE.anyMain ? inE.sum : (inOrc == null ? 0 : inOrc);
        const ouEff = ouE.anyMain ? ouE.sum : (ouOrc == null ? 0 : ouOrc);
        const netEnt = inE.anyMain || ouE.anyMain;
        const netEff = netEnt ? (inEff + ouEff) : (netOrc == null ? 0 : netOrc);
        const netProj = (inE.anyMain && inE.kind === 'proj') || (ouE.anyMain && ouE.kind === 'proj');
        per.totalInflow[p] = { orc: inOrc, eff: inEff, hasMain: inE.anyMain, kind: inE.kind };
        per.totalOutflow[p] = { orc: ouOrc, eff: ouEff, hasMain: ouE.anyMain, kind: ouE.kind };
        per.net[p] = { orc: netOrc, eff: netEff, hasMain: netEnt, kind: netProj ? 'proj' : 'real' };
        accEff += netEff; accOrc += (netOrc || 0); accEnt = accEnt || netEnt; accProj = accProj || netProj;
        per.acc[p] = { orc: accOrc, eff: accEff, hasMain: accEnt, kind: accProj ? 'proj' : 'real' };
      }
      return per;
    }
    // coluna "Total": soma dos períodos (M0..M13); para Acc, o total é o valor final (M13)
    function colTotal(arr, isAcc) {
      const P = PMAX;
      // orçado da planilha termina no M12 — no Acc, mantém o acumulado final do orçado como referência cinza
      if (isAcc) { const c = arr[P]; return (c && c.orc == null) ? { ...c, orc: arr[U.periods] ? arr[U.periods].orc : null } : c; }
      let orc = 0, effv = 0, hasMain = false, anyProj = false;
      for (let p = 0; p <= P; p++) { const c = arr[p]; orc += (c.orc == null ? 0 : c.orc); effv += (c.hasMain ? c.eff : (c.orc == null ? 0 : c.orc)); if (c.hasMain) { hasMain = true; if (c.kind === 'proj') anyProj = true; } }
      return { orc, eff: effv, hasMain, kind: anyProj ? 'proj' : 'real' };
    }
    function leafTotal(line) {
      const P = PMAX;
      let orc = 0, effv = 0, hasMain = false, anyProj = false;
      for (let p = 0; p <= P; p++) { const o = orcDisp(line, p); const oc = (o == null ? 0 : o); orc += oc; const e = effSplit(line, p); if (e) { effv += (e.real || 0) + (e.proj || 0); hasMain = true; if (periodStatus(p) !== 'real') anyProj = true; } else effv += oc; }
      return { orc, eff: effv, hasMain, kind: anyProj ? 'proj' : 'real' };
    }

    function slider(id, label, min, max, step, val) {
      return `<div class="ue-slider"><label>${label}</label>` +
        `<input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"${isAdmin ? '' : ' disabled'}/>` +
        `<span class="ue-sl-val" id="${id}Val"></span></div>`;
    }
    function wireSlider(id, setter, fmtLabel, getter, line, fleetKey, f) {
      const inp = document.getElementById(id), lab = document.getElementById(id + 'Val');
      if (!inp) return;
      lab.textContent = fmtLabel();
      inp.addEventListener('input', () => { setter(parseFloat(inp.value)); lab.textContent = fmtLabel(); renderTable(f); });
      inp.addEventListener('change', () => {
        if (!isAdmin) return;
        try { fetch('/api/ue/value', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fleet: fleetKey, line, period: 0, value: getter(), kind: 'real' }) }); } catch (e) {}
      });
    }
    // campo numérico (câmbio do orçado, % refund) — editável por todos, persiste em setting global
    function field(id, label, val, step) {
      return `<div class="ue-field"><label>${label}</label><input type="number" id="${id}" step="${step}" value="${val}"/></div>`;
    }
    function wireField(id, setter, settingLine, getValue, f) {
      const inp = document.getElementById(id);
      if (!inp) return;
      inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (isFinite(v)) { setter(v); renderTable(f); } });
      inp.addEventListener('change', () => {
        const v = parseFloat(inp.value); if (!isFinite(v)) return;
        try { fetch('/api/ue/setting', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ line: settingLine, value: getValue() }) }); } catch (e) {}
      });
    }

    // caixinha de input (R$) para Insurance / GPS / Security Deposit / Vehicle Purchase
    function openParamModal(line, f) {
      const fields = LINE_PARAMS[line];
      if (!fields) return;
      const ov = document.createElement('div');
      ov.className = 'ue-modal-overlay';
      ov.innerHTML =
        `<div class="ue-modal"><div class="ue-modal-title">${DISPLAY_LABEL[line] || line} — actual</div>` +
        fields.map((fl) => `<div class="ue-modal-field"><label>${fl.label}</label><input type="text" inputmode="decimal" data-k="${fl.k}" value="${toInput(params[fl.k])}"/></div>`).join('') +
        `<div class="ue-modal-hint">Amounts are in R$ (primary currency). Use the R$/US$ toggle in the header to view converted values.</div>` +
        `<div class="ue-modal-actions"><button type="button" class="ue-modal-cancel">Cancel</button><button type="button" class="ue-modal-save">Save</button></div></div>`;
      document.body.appendChild(ov);
      const close = () => ov.remove();
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      ov.querySelector('.ue-modal-cancel').addEventListener('click', close);
      const first = ov.querySelector('input'); if (first) { first.focus(); first.select(); }
      ov.querySelector('.ue-modal-save').addEventListener('click', async () => {
        const ops = [];
        ov.querySelectorAll('input[data-k]').forEach((inp) => {
          const k = inp.dataset.k;
          const raw = inp.value.trim();
          if (raw === '') { delete params[k]; ops.push({ del: true, k }); return; }
          const val = parseFloat(raw.replace(/\./g, '').replace(',', '.'));
          if (isNaN(val)) return;
          params[k] = val; ops.push({ k, value: val });
        });
        for (const o of ops) {
          try {
            if (o.del) await fetch('/api/ue/value/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fleet: current, line: o.k, period: 0 }) });
            else await fetch('/api/ue/value', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fleet: current, line: o.k, period: 0, value: o.value, kind: 'real' }) });
          } catch (e) {}
        }
        close();
        renderTable(f);
      });
    }

    // painel "ver por placa": um botão por carro da frota + "Fleet (aggregate)"; só troca a seleção por ora — valores vêm depois
    function renderPlates(f) {
      const platesEl = document.getElementById('uePlates');
      if (!platesEl) return;
      const plates = f.placas || [];
      if (!plates.length) { platesEl.innerHTML = ''; return; }
      platesEl.innerHTML =
        `<div class="ue-plates-label">View by plate</div><div class="ue-plates-grid">` +
        `<button class="ue-plate-btn${plateView ? '' : ' active'}" data-plate="">Fleet (aggregate)</button>` +
        plates.map((p) => `<button class="ue-plate-btn${plateView === p ? ' active' : ''}" data-plate="${p}">${p}</button>`).join('') +
        `</div>`;
      platesEl.querySelectorAll('.ue-plate-btn').forEach((b) => b.addEventListener('click', () => {
        plateView = b.dataset.plate || null;
        platesEl.querySelectorAll('.ue-plate-btn').forEach((x) => x.classList.toggle('active', x === b));
        const titleEl = document.querySelector('#ueHead .ue-fleet-title');
        if (titleEl) titleEl.textContent = f.label + ' — ' + f.modelLabel + (plateView ? ' · ' + plateView : '');
        renderTable(f);
      }));
    }
    async function loadFleet() {
      const f = U.fleets.find((x) => x.id === current);
      model = f.model;
      plateView = null; // trocar de frota volta para a visão agregada
      const foto = (OCN.modelos[f.model] || {}).foto;
      fleetsEl.querySelectorAll('.ue-fleet-btn').forEach((b) => b.classList.toggle('active', b.dataset.id === current));
      // carrega valores da frota (entradas manuais + params)
      entered = {}; params = {};
      try {
        const r = await fetch('/api/ue/values?fleet=' + encodeURIComponent(current), { cache: 'no-store' });
        if (r.ok) {
          const d = await r.json();
          (d.values || []).forEach((v) => {
            if (String(v.line).startsWith('__')) { params[v.line] = v.value; return; }
            entered[ekey(v.line, v.period)] = { value: v.value, kind: v.kind };
          });
        }
      } catch (e) { /* segue com orçado */ }
      // meses decorridos = (hoje - início) em semanas ÷ 4,3333; M0 é sempre realizado
      const ini = f.inicio ? new Date(f.inicio + 'T12:00:00') : null;
      elapsed = ini ? Math.max(0, (hoje - ini) / 86400000 / (SEMANAS_MES * 7)) : 0;
      realizedFull = Math.min(PMAX, Math.ceil(elapsed)); // mês vigente conta inteiro como realizado
      const subInfo = ini
        ? `start ${fmtDate(f.inicio)} · today ${fmtDate(U.hoje)} · ${elapsed.toFixed(1)} months elapsed`
        : 'no start date in the base';
      document.getElementById('ueHead').innerHTML =
        `<div class="ue-headrow">` +
          `<div class="ue-fleet-head">` +
            (foto ? `<div class="ue-car-photo"><img src="${foto}" alt="${f.modelLabel}"/></div>` : '') +
            `<div><div class="ue-fleet-title">${f.label} — ${f.modelLabel}</div>` +
            `<div class="ue-fleet-sub">${f.cars} cars · ${U.periods}-month contract</div>` +
            `<div class="ue-fleet-sub">${subInfo}</div></div>` +
          `</div>` +
          `<div class="ue-head-actions">` +
            `<div class="ue-cur-toggle" id="ueCurToggle">` +
              `<button class="ue-cur-btn${currency === 'BRL' ? ' active' : ''}" data-c="BRL">R$</button>` +
              `<button class="ue-cur-btn${currency === 'USD' ? ' active' : ''}" data-c="USD">US$</button>` +
            `</div>` +
            (isAdmin ? `<label class="ue-switch"><input type="checkbox" id="ueManual"${manualMode ? ' checked' : ''}/><span>Manual mode</span></label>` : '') +
            `<button class="ue-refresh-btn" id="ueRefresh" title="Re-fetches the spreadsheet data">↻ Refresh data</button>` +
          `</div>` +
        `</div>` +
        `<div class="ue-sliders">` +
          slider('ueCotacao', 'future FX (R$/US$)', 3, 8, 0.05, cotacao) +
          field('ueRefundPct', 'Security Deposit Refund adj. (% p.a.)', Math.round(refundPct * 10000) / 100, 1) +
        `</div>`;
      if (isAdmin) document.getElementById('ueManual').addEventListener('change', (e) => { manualMode = e.target.checked; renderTable(f); });
      // toggle da moeda de exibição (R$ principal · US$ convertido)
      document.querySelectorAll('#ueCurToggle .ue-cur-btn').forEach((b) => b.addEventListener('click', () => {
        currency = b.dataset.c;
        document.querySelectorAll('#ueCurToggle .ue-cur-btn').forEach((x) => x.classList.toggle('active', x === b));
        renderTable(f);
      }));
      // Atualizar dados: re-busca a planilha no servidor e re-renderiza
      const btnR = document.getElementById('ueRefresh');
      if (btnR) btnR.addEventListener('click', async () => {
        btnR.disabled = true; btnR.textContent = '↻ Refreshing…';
        try {
          await fetch('/api/refresh');
          const r = await fetch('/api/data', { cache: 'no-store' });
          if (r.ok) { const d = await r.json(); if (d.ue) Object.assign(U, d.ue); if (d.atualizadoEm) OCN.atualizadoEm = d.atualizadoEm; }
          const hl = document.getElementById('hojeLabel'); if (hl && OCN.atualizadoEm) hl.textContent = OCN.atualizadoEm;
          await loadFleet(); // reconstrói cabeçalho + tabela com os dados novos (botão volta ao normal)
        } catch (e) { btnR.textContent = '✗ failed — try again'; btnR.disabled = false; }
      });
      wireSlider('ueCotacao', (v) => { cotacao = v; }, () => 'R$ ' + cotacao.toFixed(2).replace('.', ','), () => cotacao, '__cotacao__', '__cfg__', f);
      wireField('ueRefundPct', (v) => { refundPct = v / 100; }, '__refund_pct__', () => refundPct, f);
      renderTable(f);
      renderPlates(f);
    }

    function renderTable(f) {
      const orc = U.orcado[f.model];
      const tbl = document.getElementById('ueTable');
      if (!orc) { tbl.innerHTML = '<tbody><tr><td>No budget for ' + f.modelLabel + '</td></tr></tbody>'; return; }
      computeSubs(f); // Subscription depende da frota E da placa selecionada (plateView)
      const T = computeTotals(orc.lines);
      const gmap = { totalInflow: T.totalInflow, totalOutflow: T.totalOutflow, net: T.net, acc: T.acc };
      const editable = isAdmin && manualMode;
      let html = '<thead><tr><th class="ue-rowlabel">Line</th><th>M0</th>';
      for (let p = 1; p <= PMAX; p++) html += `<th>M${p}</th>`;
      html += '<th class="ue-totalcol">Total</th></tr></thead><tbody>';
      orc.lines.forEach((l) => {
        const leaf = isLeaf(l.group);
        const isParam = editable && LINE_PARAMS[l.label];
        const shown = DISPLAY_LABEL[l.label] || l.label;
        const labelInner = isParam
          ? `<span class="ue-param-label" data-pline="${l.label.replace(/"/g, '&quot;')}">${shown} <span class="ue-pencil">✎</span></span>`
          : shown;
        html += `<tr class="ue-row ue-${l.group} ${leaf ? 'ue-leaf' : 'ue-calc'}"><td class="ue-rowlabel">${labelInner}</td>`;
        for (let p = 0; p <= PMAX; p++) {
          if (leaf) {
            html += `<td class="ue-cell${editable ? ' ue-editable' : ''}" data-line="${l.label.replace(/"/g, '&quot;')}" data-period="${p}">${cellLeaf(l.label, p)}</td>`;
          } else {
            html += `<td class="ue-cell ue-computed">${cellVal(gmap[l.group][p])}</td>`;
          }
        }
        const tot = leaf ? leafTotal(l.label) : colTotal(gmap[l.group], l.group === 'acc');
        html += `<td class="ue-cell ue-totalcol">${cellVal(tot)}</td>`;
        html += '</tr>';
      });
      html += '</tbody>';
      tbl.innerHTML = html;
      if (editable) {
        tbl.querySelectorAll('.ue-editable').forEach((td) => td.addEventListener('click', () => openEditor(td, f)));
        tbl.querySelectorAll('.ue-param-label').forEach((el) => el.addEventListener('click', () => openParamModal(el.dataset.pline, f)));
      }
      document.getElementById('ueFoot').innerHTML =
        '<span class="ue-tag ue-tag-real">Actual</span><span class="ue-tag ue-tag-proj">Projected</span><span class="ue-tag ue-tag-orc">Budget</span>';
    }

    function openEditor(td, f) {
      if (td.querySelector('.ue-input')) return;
      const line = td.dataset.line, period = +td.dataset.period;
      const e = entered[ekey(line, period)] || {};
      let kind = e.kind || 'real';
      td.innerHTML =
        `<div class="ue-editor"><span class="ue-editor-cur">R$</span><input class="ue-input" type="text" value="${toInput(e.value)}" />` +
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

    // carrega os globais (câmbio futuro, cotação dos realizados, % refund) e então a primeira frota
    (async function () {
      try {
        const r = await fetch('/api/ue/values?fleet=__cfg__', { cache: 'no-store' });
        if (r.ok) {
          const d = await r.json(); const get = (k) => { const x = (d.values || []).find((v) => v.line === k); return x ? x.value : undefined; };
          const c = get('__cotacao__'); if (c != null) cotacao = c;
          const cr = get('__cotacao_real__'); if (cr != null) cotacaoReal = cr;
          const rp = get('__refund_pct__'); if (rp != null) refundPct = rp;
        }
      } catch (e) { /* usa defaults */ }
      loadFleet();
    })();
  }
  }
})();

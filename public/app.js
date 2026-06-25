/* ===================== OCN KPIs — app ===================== */
(function () {
  Chart.register(ChartDataLabels);

  const NAVY = OCN.corEsperado;
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
    });
  });

  // ---------- modal admin (stub) ----------
  document.getElementById('btnAdmin').addEventListener('click', () =>
    document.getElementById('adminModal').classList.add('show')
  );
  document.getElementById('adminClose').addEventListener('click', () =>
    document.getElementById('adminModal').classList.remove('show')
  );

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

  // ===================== OCORRÊNCIAS (lazy init) =====================
  let ocorReady = false;
  function donutLegend(items, total) {
    return items.map((it) => `<span class="dl-it"><span class="dl-sw" style="background:${it.cor}"></span>${it.label} <b>${it.valor}</b> <span class="dl-pct">${Math.round((it.valor / total) * 100)}%</span></span>`).join('');
  }
  function initOcorrencias() {
    if (ocorReady) return;
    ocorReady = true;
    const O = OCN.ocorrencias;

    // KPIs
    document.getElementById('ocorKpis').innerHTML = `
      <div class="kpi-card"><div class="kpi-label"><i class="ti ti-alert-triangle"></i> Total de ocorrências</div><div class="kpi-value">${O.total}</div><div class="kpi-sub">${O.foramOficina} foram para oficina</div></div>
      <div class="kpi-card"><div class="kpi-label"><i class="ti ti-cars"></i> Frota afetada</div><div class="kpi-value">${O.frotaAfetadaPct}%</div><div class="kpi-sub">${O.frotaAfetadaN} de ${O.frotaTotalContrato} carros</div></div>
      <div class="kpi-card"><div class="kpi-label"><i class="ti ti-shield-half"></i> Com sinistro</div><div class="kpi-value">${O.comSinistro}</div><div class="kpi-sub">${O.comSinistroPct}% das ocorrências</div></div>
      <div class="kpi-card"><div class="kpi-label"><i class="ti ti-clock-hour-4"></i> Taxa</div><div class="kpi-value">${O.contratos.taxaCarroMes}</div><div class="kpi-sub">ocorrência / carro-mês</div></div>`;

    // Probabilidade & contratos
    document.getElementById('ocorTaxaDesc').textContent = O.contratos.taxaTexto + ' · base de ' + OCN.ocorrencias.contratos.ativos + ' contratos ativos.';
    const c = O.contratos;
    document.getElementById('ocorContratos').innerHTML = `
      <div class="mini-stat"><div class="v">${c.ativos}</div><div class="l">contratos ativos</div></div>
      <div class="mini-stat"><div class="v">${c.carrosMes}</div><div class="l">carros-mês ativos</div></div>
      <div class="mini-stat"><div class="v">${c.mediaDias} d</div><div class="l">duração média</div></div>
      <div class="mini-stat"><div class="v">${c.taxaCarroMes}</div><div class="l">ocorr./carro-mês</div></div>`;

    // Insights
    document.getElementById('ocorInsights').innerHTML = O.insights.map((t) => `<li>${t}</li>`).join('');

    // Donut por tipo
    document.getElementById('legendTipo').innerHTML = donutLegend(O.porTipo, O.total);
    new Chart(document.getElementById('chartTipo'), {
      type: 'doughnut',
      data: { labels: O.porTipo.map((t) => t.label), datasets: [{ data: O.porTipo.map((t) => t.valor), backgroundColor: O.porTipo.map((t) => t.cor), borderColor: '#fff', borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '56%',
        plugins: { legend: { display: false }, datalabels: { color: '#fff', font: { size: 12, weight: 600 }, formatter: (v) => v }, tooltip: { callbacks: { label: (x) => `${x.label}: ${x.parsed} (${Math.round((x.parsed / O.total) * 100)}%)` } } },
      },
    });

    // Sinistro por tipo (barra empilhada horizontal)
    const S = O.sinistroPorTipo;
    document.getElementById('legendSinistro').innerHTML = `<span class="dl-it"><span class="dl-sw" style="background:#E24B4A"></span>Com sinistro</span><span class="dl-it"><span class="dl-sw" style="background:#D6D6D9"></span>Sem sinistro</span>`;
    new Chart(document.getElementById('chartSinistro'), {
      type: 'bar',
      data: { labels: S.labels, datasets: [
        { label: 'Com sinistro', data: S.com, backgroundColor: '#E24B4A', stack: 's', borderRadius: 3, datalabels: { display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, color: '#fff', font: { size: 11, weight: 600 }, formatter: (v) => v } },
        { label: 'Sem sinistro', data: S.sem, backgroundColor: '#D6D6D9', stack: 's', borderRadius: 3, datalabels: { display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, color: '#5F5E5A', font: { size: 11, weight: 600 }, formatter: (v) => v } },
      ] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${x.parsed.x}` } } },
        scales: { x: { stacked: true, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, precision: 0 } }, y: { stacked: true, grid: { display: false }, ticks: { color: TXT2 } } },
      },
    });

    // Churn (motivo fim)
    const churnTotal = O.churn.reduce((a, b) => a + b.valor, 0);
    document.getElementById('legendChurn').innerHTML = donutLegend(O.churn, churnTotal);
    new Chart(document.getElementById('chartChurn'), {
      type: 'doughnut',
      data: { labels: O.churn.map((t) => t.label), datasets: [{ data: O.churn.map((t) => t.valor), backgroundColor: O.churn.map((t) => t.cor), borderColor: '#fff', borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '56%',
        plugins: { legend: { display: false }, datalabels: { color: '#fff', font: { size: 12, weight: 600 }, formatter: (v) => v }, tooltip: { callbacks: { label: (x) => `${x.label}: ${x.parsed} (${Math.round((x.parsed / churnTotal) * 100)}%)` } } },
      },
    });
  }
})();

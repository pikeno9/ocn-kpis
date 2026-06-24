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
    });
  });

  // ---------- modal admin (stub) ----------
  document.getElementById('btnAdmin').addEventListener('click', () =>
    document.getElementById('adminModal').classList.add('show')
  );
  document.getElementById('adminClose').addEventListener('click', () =>
    document.getElementById('adminModal').classList.remove('show')
  );

  // ---------- KPIs de topo ----------
  const k = OCN.kpis;
  document.getElementById('frotaKpis').innerHTML = `
    <div class="kpi-card"><div class="kpi-label"><i class="ti ti-car"></i> Recebidos no ano</div><div class="kpi-value">${k.recebidosAno}</div><div class="kpi-sub">${k.recebidosBreakdown}</div></div>
    <div class="kpi-card"><div class="kpi-label"><i class="ti ti-calendar-stats"></i> Esperado no ano</div><div class="kpi-value">${k.esperadoAno}</div><div class="kpi-sub">Abr–Dez (calendário)</div></div>
    <div class="kpi-card"><div class="kpi-label"><i class="ti ti-percentage"></i> Realizado Mai+Jun</div><div class="kpi-value">${k.realizadoMaiJun}</div><div class="kpi-sub">${k.realizadoPct} do esperado</div></div>
    <div class="kpi-card"><div class="kpi-label"><i class="ti ti-truck-delivery"></i> Próximo lote</div><div class="kpi-value">${k.proximoLote}</div><div class="kpi-sub">${k.proximoLoteDesc}</div></div>`;

  // ---------- helpers ----------
  function mdlStr(o) { return o ? Object.entries(o).map(([m, v]) => v + ' ' + m).join(' · ') : ''; }
  const dlBar = { color: '#fff', anchor: 'center', align: 'center', font: { size: 10, weight: 500 }, formatter: (v) => (v > 0 ? v : '') };
  const dlLine = { color: NAVY, anchor: 'end', align: 'top', offset: 4, font: { size: 11, weight: 500 }, formatter: (v) => ((v || v === 0) ? v : '') };
  const Z = [0, 0, 0, 0, 0];

  function barDS(model, data) {
    return { label: OCN.modelos[model].label, data, backgroundColor: COR[model], stack: 'r', borderRadius: 3, maxBarThickness: 48, order: 2, datalabels: dlBar };
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
    return { type: 'bar', data: { labels: M.labels, datasets: [barDS('Polo', M.recebido.Polo), barDS('Argo', M.recebido.Argo), barDS('Tera', M.recebido.Tera), lineDS(M.esperadoTotal, true)] }, options: opts(true) };
  }
  function buildWeekly(mi) {
    const rp = (W.recebido.Polo[mi] || Z), ra = (W.recebido.Argo[mi] || Z), rt = (W.recebido.Tera[mi] || Z);
    return { type: 'bar', data: { labels: W.labels, datasets: [barDS('Polo', rp), barDS('Argo', ra), barDS('Tera', rt), lineDS(W.esperadoTotal[mi] || [null, null, null, null, null], true)] }, options: opts(false) };
  }
  function render(cfg) { if (chartMensal) chartMensal.destroy(); chartMensal = new Chart(document.getElementById('chartMensal'), cfg); }

  function goWeekly(mi) {
    view = 'weekly'; cur = mi;
    document.getElementById('frotaSub').textContent = 'Detalhe semanal de ' + M.full[mi] + '/26 · por modelo';
    document.getElementById('frotaCrumb').innerHTML = '<i class="ti ti-calendar"></i> 2026 › <b>' + M.full[mi] + '</b>';
    document.getElementById('frotaNota').textContent = W.notas[mi] || '';
    backBtn.style.display = 'inline-flex';
    render(buildWeekly(mi));
  }
  function goMonthly() {
    view = 'monthly'; cur = null;
    document.getElementById('frotaSub').textContent = 'Recebidos vs. esperado · por modelo · visão mensal (2026)';
    document.getElementById('frotaCrumb').innerHTML = '<i class="ti ti-calendar"></i> ano de 2026';
    document.getElementById('frotaNota').textContent = OCN.notaMensal;
    backBtn.style.display = 'none';
    render(buildMonthly());
  }
  backBtn.addEventListener('click', goMonthly);

  document.getElementById('frotaNota').textContent = OCN.notaMensal;
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
})();

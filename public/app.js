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
    // overrides manuais do gráfico Active × Inactive (fleet '__fleetstatus__' no store do UE)
    try {
      const r2 = await fetch('/api/ue/values?fleet=__fleetstatus__', { cache: 'no-store' });
      if (r2.ok) OCN._fleetOvr = (await r2.json()).values || [];
    } catch (e) { /* sem overrides */ }
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
      if (tab.dataset.sec === 'rh') initRH();
      if (tab.dataset.sec === 'comercial') initLeads();
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
      if (tab.dataset.sub === 'utilization') initUtilization();
      if (tab.dataset.sub === 'funnel') initFunnel();
      if (tab.dataset.sub === 'indrive') initInDrive();
      if (tab.dataset.sub === 'payments') initPayments();
      if (tab.dataset.sub === 'redeployment') initRedeployment();
    });
  });

  // ---------- Status atual da frota / big numbers ----------
  const SF = OCN.statusFrota;
  const fleetSubEl = document.getElementById('fleetSub');
  const metaUpdatedAt = (OCN._meta && OCN._meta.updatedAt) || null;
  if (fleetSubEl) {
    if (metaUpdatedAt) {
      const d = new Date(metaUpdatedAt);
      const dd = d.toLocaleDateString('en-GB', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
      const hm = d.toLocaleTimeString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
      fleetSubEl.textContent = `Updated at ${dd} at ${hm} BRT`;
    } else {
      fleetSubEl.textContent = SF.total + ' registered vehicles';
    }
  }
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

  function lineDS(data, dashed) {
    return { label: 'Budget', data, type: 'line', borderColor: NAVY, backgroundColor: NAVY, borderWidth: 2, borderDash: dashed ? [5, 4] : [], pointRadius: 4, pointHoverRadius: 6, tension: 0.25, spanGaps: false, order: 1, datalabels: dlLine };
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
        if (!M.interativo[i]) { showToast('April has no weekly calendar detail'); return; }
        goWeekly(i);
      },
      onHover: (e, els) => { e.native.target.style.cursor = (view === 'monthly' && els.length && M.interativo[els[0].index]) ? 'pointer' : 'default'; },
      plugins: {
        legend: { display: false }, datalabels: { clamp: true },
        tooltip: {
          callbacks: {
            title: (it) => isMonthly ? (M.full[it[0].dataIndex] + '/26') : (M.full[cur] + ' · ' + W.labels[it[0].dataIndex][0]),
            label: (c) => {
              if (c.dataset.label === 'Budget') {
                const m = isMonthly ? M.esperadoModelo[c.dataIndex] : (W.esperadoModelo[cur] ? W.esperadoModelo[cur][c.dataIndex] : null);
                return 'Budget: ' + (c.parsed.y == null ? '—' : c.parsed.y) + (m ? ' (' + mdlStr(m) + ')' : '');
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
    return { type: 'bar', data: { labels: rng(M.labels), datasets: [barDS('Polo', rng(M.recebido.Polo)), barDS('Argo', rng(M.recebido.Argo)), barDS('Tera', rng(M.recebido.Tera)), lineDS(rng(M.esperadoTotal), true)] }, options: opts(true) };
  }
  function buildWeekly(mi) {
    const rp = (W.recebido.Polo[mi] || Z), ra = (W.recebido.Argo[mi] || Z), rt = (W.recebido.Tera[mi] || Z);
    return { type: 'bar', data: { labels: W.labels, datasets: [barDS('Polo', rp), barDS('Argo', ra), barDS('Tera', rt), lineDS(W.esperadoTotal[mi] || [null, null, null, null, null], true)] }, options: opts(false) };
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
  function cumDS(model, isTop) {
    // número por modelo dentro do segmento (menor); no último dataset da pilha, o TOTAL acima da barra
    const labels = { seg: { anchor: 'center', align: 'center', color: txtOnBar(COR[model]), font: { size: 9, weight: 600 }, formatter: (v) => (v > 0 ? v : '') } };
    if (isTop) labels.total = { anchor: 'end', align: 'top', offset: 2, color: '#111827', font: { size: 12, weight: 700 }, display: (ctx) => cumTotal[ctx.dataIndex] > 0, formatter: (v, ctx) => cumTotal[ctx.dataIndex] };
    return { label: OCN.modelos[model].label, data: A.recebido[model], backgroundColor: COR[model], stack: 'r', borderRadius: 3, maxBarThickness: 48, order: 2, datalabels: { labels } };
  }
  // duas linhas abaixo do eixo X, com legenda à esquerda:
  // "Total Fleet (actual)" = soma realizada do mês; "Actual vs. Budget" = % entregue (verde >=100%, vermelho escuro <100%)
  const deltaRow = {
    id: 'deltaRow',
    afterDraw(chart) {
      const ctx = chart.ctx, xScale = chart.scales.x;
      const fam = (Chart.defaults.font && Chart.defaults.font.family) || 'sans-serif';
      const y1 = chart.chartArea.bottom + 26; // Total Fleet (actual)
      const y2 = y1 + 19;                     // Actual vs. Budget
      ctx.save();
      ctx.textBaseline = 'top';
      // legendas das linhas, à esquerda do eixo
      ctx.font = '600 10px ' + fam;
      ctx.fillStyle = '#6b7280';
      ctx.textAlign = 'right';
      const lx = chart.chartArea.left - 12;
      ctx.fillText('Total Fleet (actual)', lx, y1 + 1);
      ctx.fillText('Actual vs. Budget', lx, y2 + 1);
      // valores por mês
      ctx.textAlign = 'center';
      for (let i = 0; i < cumTotal.length; i++) {
        const real = cumTotal[i], bud = A.esperado[i];
        if (!real) continue; // só meses com realizado
        const x = xScale.getPixelForValue(i);
        ctx.font = '700 11px ' + fam;
        ctx.fillStyle = '#111827';
        ctx.fillText(String(real), x, y1);
        if (bud) {
          const pct = Math.round((real / bud) * 100);
          ctx.fillStyle = pct >= 100 ? '#16A34A' : '#B91C1C';
          ctx.fillText(pct + '%', x, y2);
        }
      }
      ctx.restore();
    },
  };
  new Chart(document.getElementById('chartAcum'), {
    type: 'bar',
    data: {
      labels: M.labels,
      datasets: [
        cumDS('Polo'), cumDS('Argo'), cumDS('Tera', true),
        // linha do budget: tracejada; rótulo só nos meses SEM barra (nos realizados o budget já está na linha de % e no tooltip),
        // na mesma fonte do totalizador das barras e ACIMA da bola preta
        { label: 'Budget', data: A.esperado, type: 'line', borderColor: NAVY, backgroundColor: NAVY, borderWidth: 2, borderDash: [5, 4], pointRadius: 4, pointHoverRadius: 6, tension: 0.25, order: 3,
          datalabels: { color: '#111827', anchor: 'end', align: 'top', offset: 2, font: { size: 12, weight: 700 }, display: (ctx) => !cumTotal[ctx.dataIndex], formatter: (v) => ((v || v === 0) ? v : '') } },
      ],
    },
    plugins: [deltaRow],
    options: {
      // padding esquerdo abre espaço pras legendas das data rows; inferior, pras duas linhas de valores
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 26, right: 20, bottom: 42, left: 105 } },
      plugins: { legend: { display: false }, datalabels: { clamp: true }, tooltip: { callbacks: { label: (c) => (c.parsed.y == null ? null : c.dataset.label + ': ' + c.parsed.y) } } },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: TXT2 } },
        y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, precision: 0 }, title: { display: true, text: 'cars', color: '#9ca3af', font: { size: 11 } } },
      },
    },
  });

  // ---------- chart utilização (Active × Inactive, 100% empilhado, sempre YTD) ----------
  // Valores absolutos podem ser sobrescritos manualmente (admin) — os % são sempre recalculados.
  // Overrides persistidos no store do UE com fleet '__fleetstatus__' (line active/inactive, period = índice do mês).
  const FS = OCN.fleetStatus;
  if (FS && FS.labels && document.getElementById('chartUtil')) {
    const sl = (arr) => arr.slice(0, vi + 1); // abr..mês atual (sem meses futuros vazios)
    const pctFmt = (v) => (v == null ? '' : String(Math.round(v * 10) / 10).replace('.', ',') + '%'); // tooltip (com decimal)
    const pctTag = (v) => (v == null ? '' : '(' + Math.round(v) + '%)'); // rótulo na barra: entre parênteses, sem decimais
    const absFmt = (ctx) => { const a = ctx.dataset._abs ? ctx.dataset._abs[ctx.dataIndex] : null; return a == null ? '' : a; };
    const baseActive = FS.active.slice(), baseInactive = FS.inactive.slice();
    const ovr = { active: {}, inactive: {} };
    (OCN._fleetOvr || []).forEach((o) => { if (ovr[o.line] && o.value != null) ovr[o.line][o.period] = o.value; });
    const eff = { active: [], inactive: [], total: [], activePct: [], inactivePct: [] };
    function recalc() {
      for (let i = 0; i < FS.labels.length; i++) {
        const a = (ovr.active[i] != null) ? ovr.active[i] : baseActive[i];
        const n = (ovr.inactive[i] != null) ? ovr.inactive[i] : baseInactive[i];
        const t = (a || 0) + (n || 0);
        eff.active[i] = a; eff.inactive[i] = n; eff.total[i] = t || null;
        eff.activePct[i] = t ? (a / t) * 100 : null;
        eff.inactivePct[i] = t ? (n / t) * 100 : null;
      }
    }
    let totalArr = [];
    // Active: segmento grande — ABSOLUTO em destaque em cima, percentual menor embaixo, dentro da barra roxa
    const activeDS = (label, pct, abs, color) => ({
      label, data: sl(pct), _abs: sl(abs), backgroundColor: color, stack: 'u', borderRadius: 3, maxBarThickness: 88,
      datalabels: {
        display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
        color: (ctx) => txtOnBar(ctx.dataset.backgroundColor), anchor: 'center', textAlign: 'center',
        labels: {
          abs: { align: 'top', offset: 1, font: { size: 12, weight: 700 }, formatter: (v, ctx) => absFmt(ctx) },
          pct: { align: 'bottom', offset: 1, font: { size: 9, weight: 500 }, formatter: (v) => pctTag(v) },
        },
      },
    });
    // Inactive: segmento fino — absoluto em destaque no centro da faixa, percentual menor abaixo; halo branco.
    // O topo da pilha também carrega o TOTAL da frota (acima da barra).
    const inactiveDS = (label, pct, abs, color) => ({
      label, data: sl(pct), _abs: sl(abs), backgroundColor: color, stack: 'u', borderRadius: 3, maxBarThickness: 88,
      datalabels: {
        display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
        anchor: 'center', textAlign: 'center', color: '#111827', textStrokeColor: '#fff', textStrokeWidth: 3,
        labels: {
          abs: { align: 'center', font: { size: 12, weight: 700 }, formatter: (v, ctx) => absFmt(ctx) },
          pct: { align: 'bottom', offset: 8, font: { size: 8, weight: 500 }, formatter: (v) => pctTag(v) },
          total: { anchor: 'end', align: 'top', offset: 4, font: { size: 12, weight: 700 }, color: '#111827', textStrokeWidth: 0, formatter: (v, ctx) => (totalArr[ctx.dataIndex] != null ? totalArr[ctx.dataIndex] : '') },
        },
      },
    });
    let chartUtil = null;
    function renderUtil() {
      recalc();
      totalArr = sl(eff.total);
      if (chartUtil) chartUtil.destroy();
      chartUtil = new Chart(document.getElementById('chartUtil'), {
        type: 'bar',
        data: { labels: sl(FS.labels), datasets: [
          activeDS('Active Vehicles', eff.activePct, eff.active, '#5A00F8'),
          inactiveDS('Inactive Vehicles', eff.inactivePct, eff.inactive, '#CBD5E1'),
        ] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false }, datalabels: { clamp: true },
            tooltip: { callbacks: { label: (c) => { const abs = c.dataset._abs ? c.dataset._abs[c.dataIndex] : null; return c.dataset.label + ': ' + pctFmt(c.parsed.y) + (abs != null ? ' (' + abs + ')' : ''); } } },
          },
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { color: TXT2 } },
            // teto acima de 100% dá folga para os rótulos no topo da barra; eixo Y sem labels (pedido do usuário)
            y: { stacked: true, min: 0, max: 110, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { display: false } },
          },
        },
      });
    }
    renderUtil();

    // editor manual (admin): sobrescreve os absolutos; valor igual ao da planilha remove o override
    const editBtn = document.getElementById('utilEditBtn');
    const editEl = document.getElementById('utilEdit');
    if (editBtn && editEl && meta.user && meta.user.role === 'admin') {
      editBtn.style.display = 'inline-flex';
      let open = false;
      const inpStyle = 'width:80px;padding:4px 6px;border:1px solid #d1d5db;border-radius:6px;font-size:13px';
      function renderEditor() {
        if (!open) { editEl.innerHTML = ''; return; }
        recalc();
        const rows = sl(FS.labels).map((lab, i) =>
          `<tr><td>${lab}</td>` +
          `<td><input type="number" min="0" step="1" id="utilA${i}" value="${eff.active[i] != null ? eff.active[i] : ''}" style="${inpStyle}"></td>` +
          `<td><input type="number" min="0" step="1" id="utilI${i}" value="${eff.inactive[i] != null ? eff.inactive[i] : ''}" style="${inpStyle}"></td>` +
          `<td style="color:var(--text-2)">${(ovr.active[i] != null || ovr.inactive[i] != null) ? 'manual' : ''}</td></tr>`).join('');
        editEl.innerHTML =
          `<table class="rh-table" style="max-width:460px;margin-top:10px"><thead><tr><th>Month</th><th>Active</th><th>Inactive</th><th></th></tr></thead><tbody>${rows}</tbody></table>` +
          `<div style="margin-top:10px;display:flex;gap:8px;align-items:center">` +
          `<button class="backbtn" id="utilSave" style="display:inline-flex"><i class="ti ti-check"></i> Save</button>` +
          `<button class="backbtn" id="utilCancel" style="display:inline-flex">Cancel</button>` +
          `<span id="utilEditMsg" style="font-size:12px;color:var(--text-2)"></span></div>` +
          `<div style="font-size:11.5px;color:var(--text-2);margin-top:6px">Leave a value equal to the sheet-computed one (or empty) to go back to automatic. Percentages are always recalculated.</div>`;
        document.getElementById('utilCancel').addEventListener('click', () => { open = false; renderEditor(); });
        document.getElementById('utilSave').addEventListener('click', save);
      }
      async function save() {
        const msg = document.getElementById('utilEditMsg');
        msg.textContent = 'Saving…';
        const jobs = [];
        const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); });
        for (let i = 0; i <= vi && i < FS.labels.length; i++) {
          [['active', 'utilA', baseActive], ['inactive', 'utilI', baseInactive]].forEach(([line, pre, baseArr]) => {
            const inp = document.getElementById(pre + i);
            if (!inp) return;
            const v = inp.value === '' ? null : Number(inp.value);
            const cur = ovr[line][i] != null ? ovr[line][i] : null;
            if (v == null || v === baseArr[i]) {
              if (cur != null) jobs.push(post('/api/ue/value/delete', { fleet: '__fleetstatus__', line, period: i }).then(() => { delete ovr[line][i]; }));
            } else if (v !== cur && isFinite(v) && v >= 0) {
              jobs.push(post('/api/ue/value', { fleet: '__fleetstatus__', line, period: i, value: v }).then(() => { ovr[line][i] = v; }));
            }
          });
        }
        try { await Promise.all(jobs); renderUtil(); renderEditor(); const m2 = document.getElementById('utilEditMsg'); if (m2) m2.textContent = 'Saved.'; }
        catch (e) { msg.textContent = 'Error saving (' + e.message + ').'; }
      }
      editBtn.addEventListener('click', () => { open = !open; renderEditor(); });
    }
  }

  // ===================== RH / HEAD COUNT (lazy init) =====================
  let rhReady = false;
  function initRH() {
    if (rhReady) return;
    rhReady = true;
    const H = OCN.rh;
    const kpisEl = document.getElementById('rhKpis');
    if (!H || !H.months || !H.months.length) {
      if (kpisEl) kpisEl.innerHTML = '<div style="color:var(--text-2);font-size:13px">No headcount data (import_RH tab not available).</div>';
      return;
    }
    const cur = H.currentIdx;
    const act = cur >= 0 ? (H.actual[cur] || 0) : null;
    const bud = cur >= 0 ? (H.budget[cur] || 0) : null;
    const gap = (act != null && bud != null) ? act - bud : null;
    const yearEnd = H.budget[H.budget.length - 1];
    kpisEl.innerHTML = `
      <div class="kpi-card"><div class="kpi-label"><i class="ti ti-users"></i> Current headcount</div><div class="kpi-value">${act != null ? act : '—'}</div><div class="kpi-sub">${H.currentLabel || ''} (actual)</div></div>
      <div class="kpi-card"><div class="kpi-label"><i class="ti ti-target"></i> Budgeted for ${H.currentLabel || 'now'}</div><div class="kpi-value">${bud != null ? bud : '—'}</div><div class="kpi-sub">${(act != null && bud > 0) ? Math.round((act / bud) * 100) + '% of budget' : ''}</div></div>
      <div class="kpi-card"><div class="kpi-label"><i class="ti ti-arrows-diff"></i> Gap vs. budget</div><div class="kpi-value">${gap == null ? '—' : (gap > 0 ? '+' + gap : gap)}</div><div class="kpi-sub">open positions this month</div></div>
      <div class="kpi-card"><div class="kpi-label"><i class="ti ti-calendar-stats"></i> Year-end budget</div><div class="kpi-value">${yearEnd != null ? yearEnd : '—'}</div><div class="kpi-sub">Dec (planned team size)</div></div>`;
    // gráfico principal: barras = Actual, linha tracejada = Budget
    new Chart(document.getElementById('chartHC'), {
      type: 'bar',
      data: {
        labels: H.labels,
        datasets: [
          { label: 'Active HC (Actual)', data: H.actual, backgroundColor: '#5A00F8', borderRadius: 3, maxBarThickness: 48, order: 2,
            datalabels: { anchor: 'end', align: 'bottom', offset: 2, color: '#fff', font: { size: 11, weight: 700 }, display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, formatter: (v) => v } },
          { label: 'Active HC (Budget)', data: H.budget, type: 'line', borderColor: NAVY, backgroundColor: NAVY, borderWidth: 2, borderDash: [5, 4], pointRadius: 4, pointHoverRadius: 6, tension: 0.25, order: 1,
            datalabels: { color: NAVY, anchor: 'end', align: 'top', offset: 4, font: { size: 10, weight: 600 }, formatter: (v) => (v == null ? '' : v) } },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24 } },
        plugins: { legend: { display: false }, datalabels: { clamp: true }, tooltip: { callbacks: { label: (c) => (c.parsed.y == null ? null : c.dataset.label + ': ' + c.parsed.y) } } },
        scales: {
          x: { stacked: false, grid: { display: false }, ticks: { color: TXT2 } },
          y: { beginAtZero: true, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, precision: 0 }, title: { display: true, text: 'people', color: '#9ca3af', font: { size: 11 } } },
        },
      },
    });
    // matriz de cargos × meses (mesma ordem de linhas/colunas da planilha, só até o mês vigente):
    // cada célula = Actual em destaque + Budget menor/cinza entre parênteses; cor indica o gap.
    const rolesEl = document.getElementById('rhRoles');
    const upTo = H.currentIdx >= 0 ? H.currentIdx : H.labels.length - 1;
    const monthIdxs = H.labels.map((_, i) => i).filter((i) => i <= upTo);
    const gapCell = (act, bud) => {
      const gap = act - bud;
      const cls = gap < 0 ? 'rh-gap-neg' : (gap > 0 ? 'rh-gap-pos' : 'rh-gap-zero');
      return `<span class="rh-cell-act ${cls}">${act}</span><span class="rh-cell-bud">(${bud})</span>`;
    };
    let html = '<table class="rh-table rh-matrix"><thead><tr><th>HC per role</th>' +
      monthIdxs.map((i) => `<th>${H.months[i]}</th>`).join('') + '</tr></thead><tbody>';
    H.roles.forEach((r) => {
      html += `<tr><td>${r.role}</td>` + monthIdxs.map((i) => `<td>${gapCell(r.act[i], r.bud[i])}</td>`).join('') + '</tr>';
    });
    html += `<tr class="rh-total-row"><td>Total HC</td>` +
      monthIdxs.map((i) => `<td>${gapCell(H.totalActual[i] != null ? H.totalActual[i] : 0, H.totalBudget[i] != null ? H.totalBudget[i] : 0)}</td>`).join('') +
      '</tr></tbody></table>';
    rolesEl.innerHTML = html;
  }

  // ===================== VEHICLES / UTILIZATION (lazy init) =====================
  let utilReady = false;
  function initUtilization() {
    if (utilReady) return;
    utilReady = true;
    const UT = OCN.utilization;
    const kpisEl = document.getElementById('utilKpis');
    if (!UT || !UT.plates || !UT.plates.length) {
      if (kpisEl) kpisEl.innerHTML = '<div style="color:var(--text-2);font-size:13px">No utilization data (fleet odometer API unavailable).</div>';
      return;
    }
    const fleetIds = [...new Set(UT.plates.map((p) => p.fleet))].sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
    let filter = 'all';
    const btnsEl = document.getElementById('utilFleetBtns');
    btnsEl.innerHTML = `<button class="ue-plate-btn active" data-f="all">All fleets</button>` +
      fleetIds.map((f) => `<button class="ue-plate-btn" data-f="${f}">Fleet ${f}</button>`).join('');
    // histograma: faixas de 200 km/sem (a 1ª "< 400" e a última "> 2000" são catch-all), tons de roxo crescentes
    const HIST_BINS = [
      { max: 400, label: '<400' }, { max: 600, label: '400-600' }, { max: 800, label: '600-800' },
      { max: 1000, label: '800-1000' }, { max: 1200, label: '1000-1200' }, { max: 1400, label: '1200-1400' },
      { max: 1600, label: '1400-1600' }, { max: 1800, label: '1600-1800' }, { max: 2000, label: '1800-2000' },
      { max: Infinity, label: '>2000' },
    ];
    const LIGHT = [233, 216, 253], DARK = [59, 7, 100]; // lavanda claro -> roxo bem escuro
    const binColor = (i, n, alpha) => { const t = n > 1 ? i / (n - 1) : 0; const c = LIGHT.map((v, k) => Math.round(v + (DARK[k] - v) * t)); return `rgba(${c[0]},${c[1]},${c[2]},${alpha == null ? 1 : alpha})`; };
    let chart, histChart, histBinIdx = null; // faixa selecionada no histograma (filtra só a lista abaixo)
    const binIdxOf = (p) => { const idx = HIST_BINS.findIndex((b) => p.kmWeek < b.max); return idx >= 0 ? idx : HIST_BINS.length - 1; };
    function currentSet() { return filter === 'all' ? UT.plates : UT.plates.filter((p) => p.fleet === filter); }
    function render() {
      const set = currentSet();
      // faixa do histograma clicada filtra também o dispersão + a lista abaixo (mesmo conjunto nos dois)
      const listSet = histBinIdx == null ? set : set.filter((p) => binIdxOf(p) === histBinIdx);
      const avg = Math.round(set.reduce((a, p) => a + p.kmWeek, 0) / (set.length || 1));
      // taxa média de km/dia do conjunto (soma dos km ÷ soma dos dias) — dita a inclinação da linha média
      const totalKm = set.reduce((a, p) => a + p.odo, 0), totalDays = set.reduce((a, p) => a + p.daysElapsed, 0);
      const kmPerDay = totalDays > 0 ? totalKm / totalDays : 0;
      const maxDays = Math.max(...set.map((p) => p.daysElapsed), 1);
      kpisEl.innerHTML = `
        <div class="kpi-card"><div class="kpi-label"><i class="ti ti-car"></i> Vehicles shown</div><div class="kpi-value">${set.length}</div><div class="kpi-sub">${filter === 'all' ? 'all fleets' : 'Fleet ' + filter}</div></div>
        <div class="kpi-card"><div class="kpi-label"><i class="ti ti-road"></i> Average km/week</div><div class="kpi-value">${avg.toLocaleString('en-US')}</div><div class="kpi-sub">weighted by vehicles shown</div></div>
        <div class="kpi-card"><div class="kpi-label"><i class="ti ti-trophy"></i> Top vehicle</div><div class="kpi-value">${set.length ? Math.max(...set.map((p) => p.kmWeek)).toLocaleString('en-US') : '—'}</div><div class="kpi-sub">highest km/week</div></div>
        <div class="kpi-card"><div class="kpi-label"><i class="ti ti-trending-down"></i> Lowest vehicle</div><div class="kpi-value">${set.length ? Math.min(...set.map((p) => p.kmWeek)).toLocaleString('en-US') : '—'}</div><div class="kpi-sub">lowest km/week</div></div>
        <div class="kpi-card"><div class="kpi-label"><i class="ti ti-calendar"></i> Data as of</div><div class="kpi-value" style="font-size:20px">${UT.asOf ? fmtDMY(UT.asOf.slice(0, 10)) : '—'}</div><div class="kpi-sub">last odometer sync</div></div>`;
      // histograma (gráfico principal): conta veículos por faixa de km/semana; clicar numa barra filtra a lista
      const counts = HIST_BINS.map(() => 0);
      set.forEach((p) => { counts[binIdxOf(p)]++; });
      if (histChart) histChart.destroy();
      histChart = new Chart(document.getElementById('chartUtilHist'), {
        type: 'bar',
        data: { labels: HIST_BINS.map((b) => b.label), datasets: [{
          label: 'Vehicles', data: counts,
          backgroundColor: HIST_BINS.map((_, i) => binColor(i, HIST_BINS.length, (histBinIdx == null || histBinIdx === i) ? 1 : 0.35)),
          borderColor: '#1d1d1b', borderWidth: (ctx) => (histBinIdx === ctx.dataIndex ? 2 : 0),
          borderRadius: 4, maxBarThickness: 70,
          datalabels: { anchor: 'end', align: 'top', offset: 2, color: '#1d1d1b', font: { size: 12, weight: 700 }, display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, formatter: (v) => v },
        }] },
        options: {
          responsive: true, maintainAspectRatio: false, layout: { padding: { top: 20 } },
          onClick: (evt, els) => {
            if (!els.length) return;
            const idx = els[0].index;
            histBinIdx = histBinIdx === idx ? null : idx;
            render();
          },
          onHover: (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
          plugins: { legend: { display: false }, datalabels: { clamp: true }, tooltip: { callbacks: { label: (c) => c.parsed.y + ' vehicle' + (c.parsed.y === 1 ? '' : 's') } } },
          scales: {
            x: { grid: { display: false }, ticks: { color: TXT2 }, title: { display: true, text: 'km/week', color: '#9ca3af', font: { size: 11, style: 'italic' } } },
            y: { display: false, beginAtZero: true, grid: { display: false } },
          },
        },
      });
      if (chart) chart.destroy();
      chart = new Chart(document.getElementById('chartUtilKm'), {
        type: 'scatter',
        data: {
          datasets: [
            { label: 'Vehicle', data: listSet.map((p) => ({ x: p.daysElapsed, y: p.odo, meta: p })), backgroundColor: 'rgba(90,0,248,0.65)', borderColor: PURPLE_HEX, borderWidth: 1, pointRadius: 5, pointHoverRadius: 7 },
            { label: 'Fleet average', data: [{ x: 0, y: 0 }, { x: maxDays, y: Math.round(kmPerDay * maxDays) }], type: 'line', borderColor: NAVY, borderWidth: 2, borderDash: [6, 4], pointRadius: 0, fill: false },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false }, datalabels: { display: false },
            tooltip: { callbacks: {
              title: (it) => { const m = it[0].raw.meta; return m ? m.plate : ''; },
              label: (c) => { const m = c.raw.meta; if (!m) return 'Fleet average pace: ' + Math.round(kmPerDay).toLocaleString('en-US') + ' km/day'; return [(m.driver || 'No driver') + ' · Fleet ' + m.fleet + ' · ' + m.modelLabel, Math.round(m.odo).toLocaleString('en-US') + ' km in ' + m.daysElapsed + ' days · ' + Math.round(m.kmWeek).toLocaleString('en-US') + ' km/week']; },
            } },
          },
          scales: {
            x: { title: { display: true, text: 'days in fleet', color: '#9ca3af', font: { size: 11 } }, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2 } },
            y: { beginAtZero: true, title: { display: true, text: 'km', color: '#9ca3af', font: { size: 11 } }, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2 } },
          },
        },
      });
      // veículos: lista filtrada pela frota + (se selecionada) a faixa do histograma clicada, maior km/semana primeiro
      const drvEl = document.getElementById('utilDrivers');
      const drvTitleEl = document.getElementById('utilDriversTitle');
      if (drvTitleEl) {
        drvTitleEl.innerHTML = histBinIdx == null
          ? ''
          : ` — <span class="util-filter-tag">${HIST_BINS[histBinIdx].label} km/week <button type="button" id="utilClearBin" title="Clear filter">&times;</button></span>`;
        const clearBtn = document.getElementById('utilClearBin');
        if (clearBtn) clearBtn.addEventListener('click', () => { histBinIdx = null; render(); });
      }
      const ranked = listSet.slice().sort((a, b) => b.kmWeek - a.kmWeek);
      drvEl.innerHTML = ranked.length
        ? '<table class="rh-table"><thead><tr><th>Driver</th><th class="util-plate-col">Plate</th><th>Fleet</th><th>Model</th><th>Total km</th><th>Total weeks</th><th>km/week</th></tr></thead><tbody>' +
          ranked.map((p) => `<tr><td>${p.driver || '—'}</td><td class="util-plate-col">${p.plate}</td><td>Fleet ${p.fleet}</td><td>${p.modelLabel}</td><td>${p.odo.toLocaleString('en-US')}</td><td>${p.weeksElapsed.toFixed(1)}</td><td>${p.kmWeek.toLocaleString('en-US')}</td></tr>`).join('') +
          '</tbody></table>'
        : '<div style="color:var(--text-2);font-size:13px">No vehicles in this band.</div>';
    }
    btnsEl.querySelectorAll('.ue-plate-btn').forEach((b) => b.addEventListener('click', () => {
      filter = b.dataset.f;
      histBinIdx = null; // trocar de frota limpa a seleção de faixa (o conjunto de base mudou)
      btnsEl.querySelectorAll('.ue-plate-btn').forEach((x) => x.classList.toggle('active', x === b));
      render();
    }));
    render();
  }
  const PURPLE_HEX = '#5A00F8';

  // ===================== CLIENTS / NEW LEADS (lazy init) =====================
  let leadsReady = false;
  function initLeads() {
    if (leadsReady) return;
    leadsReady = true;
    const L = OCN.leads;
    const kpisEl = document.getElementById('leadsKpis');
    if (!L || !L.daily || !L.daily.dates.length) {
      if (kpisEl) kpisEl.innerHTML = '<div style="color:var(--text-2);font-size:13px">No leads data (import_Leads tab not available).</div>';
      return;
    }
    const nDays = L.daily.dates.length;
    const avg = Math.round(L.total / nDays);
    const bestM = L.monthly.values.indexOf(Math.max(...L.monthly.values));
    const peak = L.events.length ? L.events.reduce((a, b) => (b.v > a.v ? b : a)) : null;
    kpisEl.innerHTML = `
      <div class="kpi-card"><div class="kpi-label"><i class="ti ti-users-plus"></i> Total leads</div><div class="kpi-value">${L.total.toLocaleString('en-US')}</div><div class="kpi-sub">over ${nDays} days</div></div>
      <div class="kpi-card"><div class="kpi-label"><i class="ti ti-calendar-stats"></i> Best month</div><div class="kpi-value">${L.monthly.values[bestM].toLocaleString('en-US')}</div><div class="kpi-sub">${L.monthly.labels[bestM]}</div></div>
      <div class="kpi-card"><div class="kpi-label"><i class="ti ti-chart-line"></i> Daily average</div><div class="kpi-value">${avg}</div><div class="kpi-sub">leads / day</div></div>
      <div class="kpi-card"><div class="kpi-label"><i class="ti ti-flame"></i> Peak day</div><div class="kpi-value">${peak ? peak.v.toLocaleString('en-US') : '—'}</div><div class="kpi-sub">${peak ? fmtDMY(peak.date) : ''}</div></div>`;

    const PURPLE = '#5A00F8';
    const nFmt = (v) => (v > 0 ? v.toLocaleString('en-US') : '');
    const barDL = { anchor: 'end', align: 'top', offset: 2, color: NAVY, font: { size: 11, weight: 600 }, formatter: nFmt };
    const baseOpts = (yTitle) => ({
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22 } },
      plugins: { legend: { display: false }, datalabels: { clamp: true }, tooltip: { callbacks: { label: (c) => 'Leads: ' + c.parsed.y.toLocaleString('en-US') } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: TXT2, autoSkip: true, maxRotation: 0 } },
        y: { beginAtZero: true, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, precision: 0 }, title: { display: true, text: yTitle, color: '#9ca3af', font: { size: 11 } } },
      },
    });
    // 1) mensal (barras)
    new Chart(document.getElementById('chartLeadsM'), {
      type: 'bar',
      data: { labels: L.monthly.labels, datasets: [{ label: 'Leads', data: L.monthly.values, backgroundColor: PURPLE, borderRadius: 4, maxBarThickness: 70, datalabels: barDL }] },
      options: baseOpts('leads'),
    });
    // 2) semanal (barras) — rótulo = data de início da semana
    new Chart(document.getElementById('chartLeadsW'), {
      type: 'bar',
      data: { labels: L.weekly.labels, datasets: [{ label: 'Leads', data: L.weekly.values, backgroundColor: PURPLE, borderRadius: 3, maxBarThickness: 40, datalabels: { ...barDL, font: { size: 9, weight: 600 } } }] },
      options: baseOpts('leads / week'),
    });
    // 3) diário (linha) — rótulo só nos dias de destaque (peakByDate)
    const pk = L.daily.peakByDate;
    new Chart(document.getElementById('chartLeadsD'), {
      type: 'line',
      data: { labels: L.daily.dates, datasets: [{
        label: 'Leads', data: L.daily.values, borderColor: PURPLE, backgroundColor: 'rgba(90,0,248,0.06)',
        borderWidth: 2, fill: true, tension: 0.3, pointRadius: (ctx) => (pk[L.daily.dates[ctx.dataIndex]] ? 4 : 0), pointBackgroundColor: PURPLE,
        datalabels: { align: 'top', anchor: 'end', offset: 4, color: NAVY, font: { size: 10, weight: 700 }, display: (ctx) => !!pk[L.daily.dates[ctx.dataIndex]], formatter: (v, ctx) => { const p = pk[L.daily.dates[ctx.dataIndex]]; return p ? p.v.toLocaleString('en-US') : ''; } },
      }] },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24 } },
        plugins: {
          legend: { display: false }, datalabels: { clamp: true },
          tooltip: { callbacks: { title: (it) => fmtDMY(L.daily.dates[it[0].dataIndex]), label: (c) => { const p = pk[L.daily.dates[c.dataIndex]]; return 'Leads: ' + c.parsed.y + (p && p.event ? ' · ' + p.event : ''); } } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: TXT2, autoSkip: true, maxTicksLimit: 8, maxRotation: 0, callback: function (val) { return fmtDMY(this.getLabelForValue(val)); } } },
          y: { beginAtZero: true, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, precision: 0 }, title: { display: true, text: 'leads / day', color: '#9ca3af', font: { size: 11 } } },
        },
      },
    });
    // painel de eventos (col F) — os disparos por trás dos picos
    const evEl = document.getElementById('leadsEvents');
    const evSorted = L.events.slice().sort((a, b) => b.v - a.v); // maior → menor
    if (evEl) evEl.innerHTML = evSorted.length
      ? '<div class="leads-events">' + evSorted.map((e) => `<div class="lead-ev"><div class="lead-ev-v">${e.v.toLocaleString('en-US')}</div><div class="lead-ev-body"><div class="lead-ev-name">${e.event}</div><div class="lead-ev-date">${fmtDMY(e.date)}</div></div></div>`).join('') + '</div>'
      : '<div style="color:var(--text-2);font-size:13px">No events recorded.</div>';
  }
  const fmtDMY = (iso) => { if (!iso) return ''; const p = String(iso).split('-'); return p.length === 3 ? p[2] + '/' + p[1] : iso; };

  // ===================== CLIENTS / COMMERCIAL FUNNEL (lazy init) =====================
  let funnelReady = false;
  function initFunnel() {
    if (funnelReady) return;
    funnelReady = true;
    const F = OCN.funnel;
    const wrapEl = document.getElementById('sub-funnel');
    if (!F || !F.labels || !F.labels.length) {
      if (wrapEl) wrapEl.innerHTML = '<div style="color:var(--text-2);font-size:13px">No funnel data (funil tab not available).</div>';
      return;
    }
    function funnelChart(canvasId, data, color, num, den) {
      new Chart(document.getElementById(canvasId), {
        type: 'line',
        data: { labels: F.labels, datasets: [{
          data, borderColor: color, backgroundColor: color, borderWidth: 2, tension: 0.3,
          pointRadius: 4, pointBackgroundColor: color,
          datalabels: { align: 'top', anchor: 'end', offset: 4, color: NAVY, font: { size: 10, weight: 700 }, formatter: (v) => (v == null ? '' : v + '%') },
        }] },
        options: {
          responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24 } },
          plugins: {
            legend: { display: false }, datalabels: { clamp: true },
            tooltip: { callbacks: { label: (c) => `${c.parsed.y}% (${num[c.dataIndex]}/${den[c.dataIndex]})` } },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: TXT2, maxRotation: 0 } },
            y: { beginAtZero: true, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, callback: (v) => v + '%' }, title: { display: true, text: '%', color: '#9ca3af', font: { size: 11 } } },
          },
        },
      });
    }
    funnelChart('chartFunnel1', F.taxaEnvio, '#374151', F.enviados, F.contatos);
    funnelChart('chartFunnel2', F.taxaAprov, '#DC2626', F.aprovados, F.enviados);
    funnelChart('chartFunnel3', F.convBruta, '#2563EB', F.aprovados, F.contatos);
  }

  // ===================== CLIENTS / INDRIVE (lazy init) =====================
  let inDriveReady = false;
  function initInDrive() {
    if (inDriveReady) return;
    inDriveReady = true;
    const ID = OCN.inDrive || {};
    const PURPLE = '#5A00F8';
    const wrapEl = document.getElementById('sub-indrive');
    if (!ID.leads && !ID.perf) {
      if (wrapEl) wrapEl.innerHTML = '<div style="color:var(--text-2);font-size:13px">No inDrive data (sheet tabs not available).</div>';
      return;
    }
    const hideCard = (canvasId) => { const c = document.getElementById(canvasId); if (c) { const card = c.closest('.card'); if (card) card.style.display = 'none'; } };

    // 1) Leads elegíveis — 2 linhas: elegíveis (destaque, valor + % do todo) e total (só valor).
    // Toggle Accumulated (default) × Weekly: a planilha traz ACUMULADO; a visão semanal é a
    // diferença entre semanas consecutivas (leads novos que entraram naquela semana).
    const L = ID.leads;
    if (!L) { hideCard('chartInDriveLeads'); } else {
      const delta = (arr) => arr.map((v, i) => Math.max(0, v - (i > 0 ? arr[i - 1] : 0)));
      const elegW = delta(L.elegiveis), totW = delta(L.total);
      const pctW = totW.map((t, i) => (t ? Math.round((elegW[i] / t) * 100) : 0));
      const SERIES = {
        acc: { eleg: L.elegiveis, tot: L.total, pct: L.pct, yTitle: 'leads (cumulative)' },
        weekly: { eleg: elegW, tot: totW, pct: pctW, yTitle: 'new leads / week' },
      };
      let leadsChart = null;
      function renderLeadsChart(mode) {
        const S = SERIES[mode];
        if (leadsChart) leadsChart.destroy();
        leadsChart = new Chart(document.getElementById('chartInDriveLeads'), {
          type: 'line',
          data: { labels: L.labels, datasets: [
            { label: 'Eligible for inDrive bonus', data: S.eleg, borderColor: PURPLE, backgroundColor: PURPLE, borderWidth: 2.5, tension: 0.3, pointRadius: 4, pointBackgroundColor: PURPLE,
              datalabels: { align: 'bottom', anchor: 'start', offset: 6, color: PURPLE, font: { size: 10, weight: 700 }, textAlign: 'center', formatter: (v, ctx) => v.toLocaleString('en-US') + '\n(' + S.pct[ctx.dataIndex] + '%)' } },
            { label: 'Total waitlist (approved)', data: S.tot, borderColor: '#9ca3af', backgroundColor: '#9ca3af', borderWidth: 2, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#9ca3af',
              datalabels: { align: 'top', anchor: 'end', offset: 4, color: TXT2, font: { size: 10, weight: 600 }, formatter: (v) => v.toLocaleString('en-US') } },
          ] },
          options: {
            responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24, bottom: 8 } },
            plugins: {
              legend: { display: false }, datalabels: { clamp: true },
              tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + c.parsed.y.toLocaleString('en-US') + (c.datasetIndex === 0 ? ' (' + S.pct[c.dataIndex] + '% of total)' : '') } },
            },
            scales: {
              // ticks afastados do eixo: rótulos dos pontos baixos descem além da área do gráfico
              x: { grid: { display: false }, ticks: { color: TXT2, maxRotation: 0, padding: 28 } },
              y: { beginAtZero: true, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, precision: 0 }, title: { display: true, text: S.yTitle, color: '#9ca3af', font: { size: 11 } } },
            },
          },
        });
      }
      renderLeadsChart('acc');
      const tg = document.getElementById('idLeadsToggle');
      if (tg) tg.querySelectorAll('.range-btn').forEach((b) => b.addEventListener('click', () => {
        tg.querySelectorAll('.range-btn').forEach((x) => x.classList.toggle('active', x === b));
        renderLeadsChart(b.dataset.range === 'weekly' ? 'weekly' : 'acc');
      }));
    }

    // 2) Base ativa — barras empilhadas acumuladas: elegíveis (destaque) + não elegíveis (rachurado), total no topo
    const P = ID.perf;
    if (!P) { hideCard('chartInDriveBase'); hideCard('chartInDriveConv'); } else {
      // padrão rachurado (listras diagonais) pros não elegíveis
      const pc = document.createElement('canvas'); pc.width = 8; pc.height = 8;
      const px = pc.getContext('2d');
      px.fillStyle = '#f3f4f6'; px.fillRect(0, 0, 8, 8);
      px.strokeStyle = '#d1d5db'; px.lineWidth = 2;
      px.beginPath(); px.moveTo(-2, 6); px.lineTo(6, -2); px.moveTo(2, 10); px.lineTo(10, 2); px.stroke();
      const hatch = document.getElementById('chartInDriveBase').getContext('2d').createPattern(pc, 'repeat');
      new Chart(document.getElementById('chartInDriveBase'), {
        type: 'bar',
        data: { labels: P.labels, datasets: [
          { label: 'Eligible for inDrive bonus', data: P.elegiveis, backgroundColor: PURPLE, stack: 's', borderRadius: 3, maxBarThickness: 70,
            datalabels: { color: '#fff', font: { size: 11, weight: 700 }, textAlign: 'center', formatter: (v, ctx) => v.toLocaleString('en-US') + '\n(' + P.pctElegiveis[ctx.dataIndex] + '%)' } },
          { label: 'Not eligible', data: P.naoElegiveis, backgroundColor: hatch, borderColor: '#d1d5db', borderWidth: 1, stack: 's', borderRadius: 3, maxBarThickness: 70,
            datalabels: { anchor: 'end', align: 'top', offset: 2, color: NAVY, font: { size: 12, weight: 700 }, formatter: (v, ctx) => P.ativos[ctx.dataIndex].toLocaleString('en-US') } },
        ] },
        options: {
          responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24 } },
          plugins: {
            legend: { display: false }, datalabels: { clamp: true },
            tooltip: { callbacks: {
              title: (it) => P.full[it[0].dataIndex],
              label: (c) => (c.datasetIndex === 0
                ? 'Eligible: ' + c.parsed.y.toLocaleString('en-US') + ' (' + P.pctElegiveis[c.dataIndex] + '% of active base)'
                : 'Not eligible: ' + c.parsed.y.toLocaleString('en-US') + ' · Active base: ' + P.ativos[c.dataIndex].toLocaleString('en-US')),
            } },
          },
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { color: TXT2 } },
            y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, precision: 0 }, title: { display: true, text: 'active clients (cumulative)', color: '#9ca3af', font: { size: 11 } } },
          },
        },
      });

      // 3) Oportunidade capturada — % da base ativa que enviou prints (convertidos inDrive)
      new Chart(document.getElementById('chartInDriveConv'), {
        type: 'line',
        data: { labels: P.labels, datasets: [{
          data: P.pctCaptura, borderColor: '#16A34A', backgroundColor: 'rgba(22,163,74,0.07)', borderWidth: 2.5, fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: '#16A34A',
          datalabels: { align: 'top', anchor: 'end', offset: 4, color: '#16A34A', font: { size: 11, weight: 700 }, formatter: (v) => v + '%' },
        }] },
        options: {
          responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24 } },
          plugins: {
            legend: { display: false }, datalabels: { clamp: true },
            tooltip: { callbacks: {
              title: (it) => P.full[it[0].dataIndex],
              label: (c) => 'Captured: ' + c.parsed.y + '% (' + P.prints[c.dataIndex] + '/' + P.ativos[c.dataIndex] + ' sent prints)',
            } },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: TXT2, maxRotation: 0 } },
            y: { beginAtZero: true, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, callback: (v) => v + '%' }, title: { display: true, text: '% of active base', color: '#9ca3af', font: { size: 11 } } },
          },
        },
      });
    }
  }

  // ===================== CLIENTS / PAYMENTS (lazy init) =====================
  let paymentsReady = false;
  function initPayments() {
    if (paymentsReady) return;
    paymentsReady = true;
    const P = OCN.payments;
    const legendEl = document.getElementById('payLegend');
    const detailEl = document.getElementById('payDetail');
    if (!P || !P.weeks || !P.weeks.length) {
      if (legendEl) legendEl.innerHTML = '<div style="color:var(--text-2);font-size:13px">No payments data (payments API unavailable).</div>';
      return;
    }
    // categorias na ordem em que empilham (baixo → cima), cor por categoria
    const CATS = [
      { key: 'onTime', label: 'Pago no prazo', color: '#16A34A' },
      { key: 'late1', label: 'Atraso 1 dia', color: '#F59E0B' },
      { key: 'late2', label: 'Atraso 2+ dias', color: '#B45309' },
      { key: 'returned', label: 'Veículo devolvido', color: '#7C3AED' },
      { key: 'recovered', label: 'Veículo recuperado', color: '#DC2626' },
    ];
    legendEl.innerHTML = CATS.map((c) => `<span class="it"><span class="sw" style="background:${c.color}"></span> ${c.label}</span>`).join('');
    const labels = P.weeks.map((w) => fmtDMY(w.date));
    const totals = P.weeks.map((w) => CATS.reduce((s, c) => s + w.counts[c.key], 0));
    let mode = 'abs', chart, selWeekIdx = null;
    function datasetsFor() {
      return CATS.map((c) => {
        const raw = P.weeks.map((w) => w.counts[c.key]);
        const data = mode === 'pct' ? raw.map((v, i) => (totals[i] ? Math.round((v / totals[i]) * 1000) / 10 : 0)) : raw;
        return {
          label: c.label, data, backgroundColor: c.color, stack: 'w', maxBarThickness: 60,
          datalabels: {
            color: '#fff', font: { size: 10, weight: 700 },
            display: (ctx) => ctx.dataset.data[ctx.dataIndex] > (mode === 'pct' ? 4 : 0),
            formatter: (v) => (mode === 'pct' ? Math.round(v) + '%' : v),
          },
        };
      });
    }
    function renderDetail() {
      if (selWeekIdx == null) { detailEl.innerHTML = ''; return; }
      const w = P.weeks[selWeekIdx];
      detailEl.innerHTML = `<div class="pay-detail-title">Week of ${fmtDMY(w.date)} <button type="button" id="payDetailClose">&times;</button></div>` +
        '<div class="pay-detail-grid">' + CATS.map((c) => {
          const names = (w.names && w.names[c.key]) || [];
          if (!names.length) return '';
          return `<div class="pay-detail-col"><div class="pay-detail-cat" style="color:${c.color}">${c.label} (${names.length})</div>` +
            names.map((n) => `<div class="pay-detail-name">${n.nome} <span class="pay-detail-plate">${n.placa}</span></div>`).join('') + '</div>';
        }).join('') + '</div>';
      const closeBtn = document.getElementById('payDetailClose');
      if (closeBtn) closeBtn.addEventListener('click', () => { selWeekIdx = null; renderDetail(); });
    }
    function render() {
      if (chart) chart.destroy();
      chart = new Chart(document.getElementById('chartPayments'), {
        type: 'bar',
        data: { labels, datasets: datasetsFor() },
        options: {
          responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22 } },
          onClick: (evt, els) => { if (!els.length) return; selWeekIdx = els[0].index; renderDetail(); },
          onHover: (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
          plugins: {
            legend: { display: false }, datalabels: { clamp: true },
            tooltip: { callbacks: {
              title: (it) => 'Week of ' + labels[it[0].dataIndex],
              label: (c) => c.dataset.label + ': ' + c.parsed.y + (mode === 'pct' ? '%' : ''),
              afterBody: () => 'Click for names',
            } },
          },
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { color: TXT2 } },
            y: { stacked: true, beginAtZero: true, max: mode === 'pct' ? 100 : undefined, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, precision: 0, callback: (v) => (mode === 'pct' ? v + '%' : v) } },
          },
        },
      });
      renderDetail();
    }
    document.getElementById('payViewSelect').addEventListener('change', (e) => { mode = e.target.value === 'pct' ? 'pct' : 'abs'; render(); });
    render();
  }

  // ===================== VEHICLES / REDEPLOYMENT (lazy init) =====================
  let redeployReady = false;
  // uma seção (Recoveries/Returns/Swaps) — mesmo gráfico+lista, só muda a fonte de dados e os rótulos
  function renderTimeSection(section, chartId, detailId, itemNoun, eventLabel) {
    const canvas = document.getElementById(chartId);
    const detailEl = document.getElementById(detailId);
    if (!canvas) return;
    const card = canvas.closest('.card');
    if (!section || !section.labels || !section.labels.length) {
      if (card) card.style.display = 'none'; // sem dados nesse mês/bloco — não mostra card vazio
      return;
    }
    let selIdx = null;
    function renderDetail() {
      if (selIdx == null) { detailEl.innerHTML = ''; return; }
      const rows = section.detail[selIdx] || [];
      const closeId = detailId + 'Close';
      detailEl.innerHTML = `<div class="pay-detail-title">${section.labels[selIdx][0]} ${itemNoun} (${rows.length}) <button type="button" id="${closeId}">&times;</button></div>` +
        (rows.length
          ? `<table class="rh-table"><thead><tr><th>Client</th><th>Plate</th><th>${eventLabel} date</th><th>Ready for realloc.</th><th>Reallocation date</th><th>Reason</th><th>Details</th></tr></thead><tbody>` +
            rows.map((it) => `<tr><td>${it.cliente || '—'}</td><td class="util-plate-col">${it.placa || '—'}</td><td>${it.dataEvento}</td><td>${it.dataPronto}</td><td>${it.dataRecolocacao}</td><td>${it.motivo}</td><td class="redeploy-details">${it.detalhamento}</td></tr>`).join('') +
            '</tbody></table>'
          : '<div style="color:var(--text-2);font-size:13px">No records.</div>');
      const closeBtn = document.getElementById(closeId);
      if (closeBtn) closeBtn.addEventListener('click', () => { selIdx = null; renderDetail(); });
    }
    // total de dias do mês (verde+roxo) — vira o totalizador acima da barra;
    // meses com total 0 não têm barra clicável, ganham uma bolinha preta no zero
    const totalDays = section.labels.map((_, i) => Math.round(((section.avgRecupParaPronto[i] || 0) + (section.avgProntoParaAlocado[i] || 0)) * 10) / 10);
    new Chart(canvas, {
      type: 'bar',
      data: {
        labels: section.labels,
        datasets: [
          { label: eventLabel + ' → Ready', data: section.avgRecupParaPronto, backgroundColor: '#16A34A', stack: 's', borderRadius: 3, maxBarThickness: 60, order: 1,
            datalabels: { color: '#fff', font: { size: 11, weight: 700 }, display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, formatter: (v) => v } },
          { label: 'Ready → Reallocated', data: section.avgProntoParaAlocado, backgroundColor: PURPLE_HEX, stack: 's', borderRadius: 3, maxBarThickness: 60, order: 1,
            datalabels: { labels: {
              value: { color: '#fff', font: { size: 11, weight: 700 }, display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, formatter: (v) => v },
              total: { anchor: 'end', align: 'top', offset: 2, color: NAVY, font: { size: 12, weight: 700 }, display: (ctx) => totalDays[ctx.dataIndex] > 0, formatter: (v, ctx) => totalDays[ctx.dataIndex] },
            } } },
          { type: 'scatter', label: 'zero', data: totalDays.map((t) => (t === 0 ? 0 : null)), pointRadius: 6, pointHoverRadius: 8, pointBackgroundColor: '#111827', pointBorderColor: '#111827', order: 0,
            datalabels: { anchor: 'end', align: 'top', offset: 4, color: NAVY, font: { size: 12, weight: 700 }, display: (ctx) => ctx.dataset.data[ctx.dataIndex] != null, formatter: () => 0 } },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22 } },
        onClick: (evt, els) => { if (!els.length) return; selIdx = els[0].index; renderDetail(); },
        onHover: (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
        plugins: {
          legend: { display: false }, datalabels: { clamp: true },
          tooltip: { callbacks: {
            title: (it) => section.labels[it[0].dataIndex][0] + ' · ' + section.total[it[0].dataIndex] + ' ' + itemNoun,
            label: (c) => (c.dataset.type === 'scatter' ? '0 days to redeploy' : c.dataset.label + ': ' + c.parsed.y + ' days (avg)'),
            afterBody: () => 'Click for the list',
          } },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: TXT2 } },
          y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, precision: 0 }, title: { display: true, text: 'avg. days', color: '#9ca3af', font: { size: 11 } } },
        },
      },
    });
  }
  function initRedeployment() {
    if (redeployReady) return;
    redeployReady = true;
    const RD = OCN.redeployment;
    const wrapEl = document.getElementById('sub-redeployment');
    if (!RD || (!RD.recoveries && !RD.returns && !RD.swaps)) {
      const cardEl = wrapEl && wrapEl.querySelector('.card');
      if (cardEl) cardEl.innerHTML = '<div style="color:var(--text-2);font-size:13px">No redeployment data (import_Time tab not available).</div>';
      return;
    }
    renderTimeSection(RD.recoveries, 'chartRecoveries', 'recoveriesDetail', 'recoveries', 'Recovery');
    renderTimeSection(RD.returns, 'chartReturns', 'returnsDetail', 'returns', 'Return');
    renderTimeSection(RD.swaps, 'chartSwaps', 'swapsDetail', 'swaps', 'Swap');
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
    let plateView = null;  // null = visão da frota; string = placa selecionada
    let viewAgg = false;   // false = Fleet (unitary), por veículo; true = Fleet (aggregate), soma de todas as placas
    let allMode = false;   // true = "All fleets": média ponderada por carros de todas as frotas (÷ N total)
    let curCars = 0;       // nº de carros da visão atual (frota ou total geral) — multiplicador do aggregate
    let ctxCars = 0;       // nº de carros do CONTEXTO de cálculo (frota corrente; no all-mode, a frota da vez)
    let fleetCtx = null;   // all-mode: contexto por frota (params/entradas/derivados) p/ combinar célula a célula
    const viewMult = () => (plateView ? 1 : (viewAgg ? (curCars || 1) : 1)); // usado só pelo orçado (referência por modelo)
    let entered = {}; // "line@@period" -> {value, kind} — valores manuais em R$ (moeda principal)
    let manualMode = false; // edição manual desligada por padrão
    let currency = 'BRL';   // moeda de exibição: R$ (principal) ou US$ (toggle no cabeçalho)
    let cotacao = 5.5;      // câmbio futuro R$/US$ (slider, global) — converte os PROJETADOS
    // realizados convertem R$↔US$ no câmbio nominal fixo (ORCADO_FX, 5,0) — o campo editável foi removido
    // e o setting antigo (__cotacao_real__) é ignorado de propósito (ficou um valor fantasma no banco)
    let refundPct = 0.13;   // correção a.a. do Security Deposit Refund (campo, global)
    let inadimplencia = 0;  // taxa de inadimplência % (slider, global) — desconta a projeção do Subscription
    let curIni = null;            // início da frota selecionada (Date) — base do eixo de meses
    let lossMonthByPlate = {};    // placa → mês do UE em que deu perda total (corta Subrental/GPS dali em diante)
    let activeFracArr = [];       // fração de carros ativos (sem perda total) por mês — aplica no agregado
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
    const REVISAO_KM = 10000;    // revisão a cada 10.000 km
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

    const totalCarsAll = U.fleets.reduce((a, x) => a + (x.cars || 0), 0);
    // frota sintética "All fleets": todas as placas, início = mais antigo, orçado = média ponderada por carros
    const allFleet = () => ({
      id: 'all', label: 'All fleets', model: U.fleets[0].model, modelLabel: 'all models',
      cars: totalCarsAll,
      inicio: U.fleets.map((x) => x.inicio).filter(Boolean).sort()[0] || null,
      placas: U.fleets.flatMap((x) => x.placas || []).sort(),
    });
    fleetsEl.innerHTML = U.fleets
      .map((f) => `<button class="ue-fleet-btn" data-id="${f.id}"><span class="n">${f.label}</span><span class="m">${f.modelLabel} · ${f.cars} cars</span></button>`)
      .join('') +
      `<button class="ue-fleet-btn" data-id="all"><span class="n">All fleets</span><span class="m">${totalCarsAll} cars</span></button>`;
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

    // nº de segundas-feiras (dia de pagamento) dentro da janela do mês m do UE (mês = 4,333 semanas do início)
    function mondaysInMonth(ini, m) {
      const MS = 86400000, len = SEMANAS_MES * 7 * MS;
      const start = new Date(ini.getTime() + (m - 1) * len);
      const end = new Date(ini.getTime() + m * len);
      let d = new Date(start.getTime() + (((1 - start.getDay()) % 7 + 7) % 7) * MS); // primeira segunda ≥ start
      let n = 0;
      while (d < end) { n++; d = new Date(d.getTime() + 7 * MS); }
      return n;
    }
    // visão por placa: 0 a partir do mês do incidente (perda total); nas visões de frota o valor unitário
    // fica CHEIO — a placa perdida sai do numerador E do denominador (base = carros ativos, activeCarsAt)
    function plateCut(m) {
      if (!plateView) return 1;
      const lm = lossMonthByPlate[plateView];
      return (lm != null && m >= lm) ? 0 : 1;
    }
    // nº de carros ativos (sem perda total) no mês m do contexto atual — denominador das linhas "por carro ativo"
    function activeCarsAt(m) {
      const frac = activeFracArr[m] != null ? activeFracArr[m] : 1;
      return Math.max(1, Math.round(frac * (ctxCars || 1)));
    }
    // Maintenance por dados reais: REALIZADO = revisões concluídas (API da frota: última revisão com data;
    // anteriores inferidas pelo ritmo de km da placa) × preço do site de revisões; PROJETADO = próximas
    // revisões pelo hodômetro atual + km médio mensal da FROTA. Valores em R$; unitário ÷ carros ativos.
    let maintRealRS = [], maintProjRS = [], maintReady = false;
    function computeMaint(f) {
      maintRealRS = []; maintProjRS = []; maintReady = false;
      const fr = U.frota && U.frota.placas;
      const prices = (U.revisoes && U.revisoes[model]) || [];
      if (!fr || !prices.length || !curIni || elapsed <= 0) return;
      const priceOf = (n) => { const r = prices.find((x) => x.n === n); return r ? r.valor : 0; };
      const kmOf = (n) => { const r = prices.find((x) => x.n === n); return (r && r.km) ? r.km : n * REVISAO_KM; };
      const plates = plateView ? [plateView] : (f.placas || []);
      for (let p = 0; p <= PMAX; p++) { maintRealRS[p] = 0; maintProjRS[p] = 0; }
      // km médio MENSAL da frota (placas com odômetro confiável) — base da projeção
      let kmSum = 0, kmN = 0;
      (f.placas || []).forEach((pl) => { const d = fr[pl]; if (d && d.ok && d.odo > 0) { kmSum += d.odo; kmN++; } });
      const kmMesFrota = kmN ? (kmSum / kmN) / elapsed : 0;
      const projStart = Math.min(realizedFull + 1, PMAX); // revisão vencida cai no 1º mês projetado
      plates.forEach((pl) => {
        const d = fr[pl];
        if (!d) return;
        const done = d.lastKm ? Math.round(d.lastKm / REVISAO_KM) : 0;
        // realizado: revisões 1..done — mês inferido pelo ritmo de km da placa. ATENÇÃO: last_service_at é a
        // data em que o registro foi FECHADO no site (pode atrasar semanas vs. a revisão real/agendada, que a
        // API não expõe) — serve só de TETO: a revisão nunca ocorre depois do fechamento.
        for (let k = 1; k <= done; k++) {
          const pace = elapsed > 0 && d.odo > 0 ? d.odo / elapsed : 0; // km/mês da própria placa
          let mo = pace > 0 ? Math.ceil(kmOf(k) / pace) : null;
          if (k === done && d.lastAt) {
            const moAt = Math.ceil(((new Date(d.lastAt) - curIni) / 86400000) / (SEMANAS_MES * 7));
            mo = mo ? Math.min(mo, moAt) : moAt;
          }
          if (!mo || mo < 1) mo = 1;
          if (mo > realizedFull) mo = realizedFull; // evento que já ocorreu fica em mês realizado
          maintRealRS[mo] += priceOf(k);
        }
        // projetado: próximas revisões (done+1...) — meses até lá = km que falta ÷ km médio mensal da frota
        if (!(d.ok && d.odo > 0) || kmMesFrota <= 0) return;
        if (lossMonthByPlate[pl] != null) return; // perda total: sem revisões futuras
        for (let n = done + 1; n <= 200; n++) {
          let mo = Math.ceil(elapsed + Math.max(0, kmOf(n) - d.odo) / kmMesFrota);
          if (mo < projStart) mo = projStart;
          if (mo > U.periods) break; // dentro do contrato (M13 = só pontuais)
          maintProjRS[mo] += priceOf(n);
        }
      });
      // ÷ carros ATIVOS do mês (mesma regra das demais linhas por carro); placa = sem divisão
      if (!plateView) for (let p = 0; p <= PMAX; p++) { maintRealRS[p] /= activeCarsAt(p); maintProjRS[p] /= activeCarsAt(p); }
      maintReady = true;
    }
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
      for (let p = 0; p <= PMAX; p++) subsRS[p] = 0;
      plates.forEach((pl) => (pag[pl] || []).forEach((s) => {
        const venc = new Date(s.v + 'T12:00:00');
        let mo = Math.ceil(((venc - ini) / 86400000) / (SEMANAS_MES * 7));
        if (mo < 1) mo = 1;
        if (mo > U.periods) return;
        subsRS[mo] += fee * (1 + (s.a ? juros : 0));
      }));
      // ÷ carros ATIVOS do mês (perda total sai do denominador a partir do incidente); placa = sem divisão
      if (!plateView) for (let p = 0; p <= PMAX; p++) subsRS[p] = subsRS[p] / activeCarsAt(p);
      subsReady = true;
    }

    // valor NATIVO da linha num período: { rs } para valores em R$ (manuais/derivados) ou { usd } para
    // valores fixos em dólar. Sem câmbio aqui — a conversão para a moeda de exibição acontece no effSplit.
    // Recorrências mensais param no M12; o M13 só recebe os lançamentos pontuais pós-contrato.
    function effNative(line, period) {
      if (line === 'Subscription' && par('__sub_semanal__') > 0) {
        if (period === 0 || period === PMAX) return { rs: 0, perActive: true };
        if (periodStatus(period) === 'real') return subsReady ? { rs: subsRS[period] || 0, perActive: true } : null;
        // projeção: segundas-feiras (dia de pagamento) do mês × semanalidade × (1 − inadimplência do slider);
        // placa com perda total não paga mais (plateCut); na frota o valor é por carro ATIVO (perActive)
        if (!curIni) return null;
        return { rs: mondaysInMonth(curIni, period) * par('__sub_semanal__') * (1 - inadimplencia / 100) * plateCut(period), perActive: true };
      }
      if (line === 'Subrental fee' && par('__subrental_mensal__') > 0) {
        // valor por carro ATIVO (a placa perdida sai do numerador e do denominador a partir do incidente)
        return { rs: (period >= 1 && period <= U.periods) ? -par('__subrental_mensal__') * plateCut(period) : 0, perActive: true };
      }
      if (line === 'Maintenance' && maintReady) {
        if (period === 0 || period === PMAX) return { rs: 0, perActive: true };
        return periodStatus(period) === 'real'
          ? { rs: -(maintRealRS[period] || 0), perActive: true }
          : { rs: -(maintProjRS[period] || 0), perActive: true };
      }
      if (line === 'Insurance' && par('__ins_total__') > 0 && par('__ins_parcelas__') >= 1) {
        // parcela = total/N; se N > 12, as parcelas além do M12 ficam fora da tabela (trunca, não reamortiza)
        const N = Math.round(par('__ins_parcelas__'));
        return { rs: (period >= 1 && period <= Math.min(N, U.periods)) ? -(par('__ins_total__') / N) : 0 };
      }
      // fixos (sem nenhuma conversão/exceção): R$50/US$10 e R$15/US$3, tratados direto em effSplit
      if (line === 'GPS' && (par('__gps_m0__') > 0 || par('__gps_mensal__') > 0)) {
        // GPS recorrente por carro ATIVO (perda total sai da conta; o do M0 fica — já foi gasto)
        return { rs: period === 0 ? -par('__gps_m0__') : (period <= U.periods ? -par('__gps_mensal__') * plateCut(period) : 0), perActive: period > 0 };
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
    // converte um valor nativo para a moeda de exibição; realizados usam a cotação indicada, projetados o câmbio
    // futuro. SEM arredondar aqui — o arredondamento final é do effSplit (depois do multiplicador da visão)
    function toDisplay(v, rate) {
      if (v == null) return null;
      if (currency === 'BRL') return 'rs' in v ? v.rs : v.usd * rate;
      return 'usd' in v ? v.usd : v.rs / rate;
    }
    // efetivo POR VEÍCULO da frota em contexto (globals) — realizado (preto, câmbio fixo) × projetado (roxo,
    // câmbio futuro). `status` diz o lado "ativo" (p/ exibir 0 como "-" sem confundir com "não se aplica").
    function effSplitOne(line, period) {
      // Car Preparation/Sticker: valor fixo literal por moeda, sem nenhum cálculo/câmbio/exceção
      if (line === 'Car Preparation (wash + delivery)') return period === 0 ? { real: currency === 'BRL' ? -50 : -10, proj: 0, status: 'real' } : null;
      if (line === 'Sticker') return period === 0 ? { real: currency === 'BRL' ? -15 : -3, proj: 0, status: 'real' } : null;
      const m = entered[ekey(line, period)]; // entradas manuais são em R$
      if (m) {
        const val = toDisplay({ rs: m.value }, m.kind === 'proj' ? cotacao : ORCADO_FX);
        return m.kind === 'proj' ? { real: 0, proj: val, status: 'proj' } : { real: val, proj: 0, status: 'real' };
      }
      const v = effNative(line, period);
      if (!v) return null;
      const st = periodStatus(period);
      return st === 'real'
        ? { real: toDisplay(v, ORCADO_FX), proj: 0, status: 'real', perActive: !!v.perActive }
        : { real: 0, proj: toDisplay(v, cotacao), status: 'proj', perActive: !!v.perActive };
    }
    // all-mode: contexto por frota — cada frota tem params/entradas/eixo de meses/perdas/pagamentos próprios
    function applyCtx(c) {
      model = c.f.model; params = c.params; entered = c.entered; curIni = c.ini; ctxCars = c.f.cars || 0;
      elapsed = c.elapsed; realizedFull = c.realizedFull; lossMonthByPlate = c.lossMonthByPlate; activeFracArr = c.activeFracArr;
      subsRS = c.subsRS || []; subsReady = !!c.subsReady;
      maintRealRS = c.maintRealRS || []; maintProjRS = c.maintProjRS || []; maintReady = !!c.maintReady;
    }
    // combinação "All fleets": média por veículo ponderada — linhas "por carro ativo" pesam pelos carros ativos
    // do mês; as demais (Insurance etc.) pelos carros totais. Uma célula pode sair com realizado E projetado
    // (frotas em fases diferentes) — o cellLeaf mostra os dois.
    function combinedSplit(line, period) {
      let real = 0, proj = 0, den = 0, any = false, anyReal = false;
      for (const c of fleetCtx) {
        applyCtx(c);
        const e = effSplitOne(line, period);
        if (!e) continue;
        const w = e.perActive ? activeCarsAt(period) : (c.f.cars || 1);
        real += (e.real || 0) * w; proj += (e.proj || 0) * w; den += w;
        any = true; if (e.status === 'real') anyReal = true;
      }
      if (!any) return null;
      return { real, proj, den: den || 1, status: anyReal ? 'real' : 'proj' };
    }
    // camada de visão: unitary (÷ carros — ativos p/ linhas perActive) × aggregate (soma) × placa (individual)
    function effSplit(line, period) {
      if (allMode && !plateView) {
        const r = combinedSplit(line, period);
        if (!r) return null;
        const k = viewAgg ? 1 : 1 / r.den; // combinado já vem como soma total; unitary divide pelo denominador
        return { real: Math.round(r.real * k), proj: Math.round(r.proj * k), status: r.status };
      }
      const e = effSplitOne(line, period);
      if (!e) return null;
      const k = plateView ? 1 : (viewAgg ? (e.perActive ? activeCarsAt(period) : (curCars || 1)) : 1);
      return { real: Math.round((e.real || 0) * k), proj: Math.round((e.proj || 0) * k), status: e.status };
    }
    // linhas cujo lançamento pontual foi movido para o M13 (planilha original só vai até M12) — o orçado de
    // referência sai do M12 e passa a aparecer só no M13 (substituição, não duplicação)
    const M13_LINES = ['Vehicle Purchase', 'Initial Fee / Vehicle Sell', 'Deposit Refund'];
    // orçado (planilha, USD) na moeda de exibição; all-mode = média ponderada dos orçados por modelo
    const orcDisp = (line, period) => {
      const isM13Line = M13_LINES.includes(line);
      if (isM13Line && period === U.periods) return null; // M12 não mostra mais (valor foi para o M13)
      const srcP = (isM13Line && period === PMAX) ? U.periods : period; // M13 reaproveita o valor do M12
      const fx = currency === 'BRL' ? ORCADO_FX : 1;
      const k = viewMult();
      if (allMode && !plateView) {
        let sum = 0, any = false;
        U.fleets.forEach((ff) => {
          const l = U.orcado[ff.model] && U.orcado[ff.model].lines.find((x) => x.label === line);
          const v = l ? l.values[srcP] : null;
          if (v != null) { sum += v * ff.cars; any = true; }
        });
        return any ? Math.round((sum / (curCars || 1)) * fx * k) : null;
      }
      const o = orcVal(line, srcP);
      return o == null ? null : Math.round(o * fx * k);
    };
    function cellLeaf(line, period) {
      const e = effSplit(line, period);
      const orc = orcDisp(line, period);
      let s = '';
      if (e) {
        if (e.real) s += `<span class="ue-main ue-real">${ueFmt(e.real)}</span>`;
        if (e.proj) s += `<span class="ue-main ue-proj">${ueFmt(e.proj)}</span>`;
        if (!e.real && !e.proj) s += `<span class="ue-main ue-${e.status}">-</span>`;
      }
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

    // painel de visões: Fleet (unitary) = por veículo · Fleet (aggregate) = soma de todas as placas · uma placa
    function renderPlates(f) {
      const platesEl = document.getElementById('uePlates');
      if (!platesEl) return;
      const plates = f.placas || [];
      platesEl.innerHTML =
        `<div class="ue-plates-label">View by plate</div><div class="ue-plates-grid">` +
        `<button class="ue-plate-btn${(!plateView && !viewAgg) ? ' active' : ''}" data-view="unit">Fleet (unitary)</button>` +
        `<button class="ue-plate-btn${(!plateView && viewAgg) ? ' active' : ''}" data-view="agg">Fleet (aggregate)</button>` +
        plates.map((p) => `<button class="ue-plate-btn${plateView === p ? ' active' : ''}" data-plate="${p}">${p}</button>`).join('') +
        `</div>`;
      platesEl.querySelectorAll('.ue-plate-btn').forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.view) { plateView = null; viewAgg = b.dataset.view === 'agg'; }
        else { plateView = b.dataset.plate; viewAgg = false; }
        platesEl.querySelectorAll('.ue-plate-btn').forEach((x) => x.classList.toggle('active', x === b));
        const titleEl = document.querySelector('#ueHead .ue-fleet-title');
        if (titleEl) titleEl.textContent = f.label + ' — ' + f.modelLabel + (plateView ? ' · ' + plateView : (viewAgg ? ' · aggregate' : ''));
        renderTable(f);
      }));
    }
    // busca params + entradas manuais de uma frota no store
    async function fetchFleetValues(fleetId) {
      const p_ = {}, e_ = {};
      try {
        const r = await fetch('/api/ue/values?fleet=' + encodeURIComponent(fleetId), { cache: 'no-store' });
        if (r.ok) {
          const d = await r.json();
          (d.values || []).forEach((v) => {
            if (String(v.line).startsWith('__')) { p_[v.line] = v.value; return; }
            e_[ekey(v.line, v.period)] = { value: v.value, kind: v.kind };
          });
        }
      } catch (e) { /* segue com orçado */ }
      return { params: p_, entered: e_ };
    }
    // contexto derivado de uma frota (eixo de meses, perdas totais) — usado no all-mode
    function buildCtx(ff, vals) {
      const ini = ff.inicio ? new Date(ff.inicio + 'T12:00:00') : null;
      const el = ini ? Math.max(0, (hoje - ini) / 86400000 / (SEMANAS_MES * 7)) : 0;
      const lmp = {}, afa = [];
      if (ini && U.losses) {
        (ff.placas || []).forEach((pl) => {
          const d = U.losses[pl];
          if (!d) return;
          let mo = Math.ceil(((new Date(d + 'T12:00:00') - ini) / 86400000) / (SEMANAS_MES * 7));
          if (mo < 1) mo = 1;
          lmp[pl] = mo;
        });
        const nCars = ff.cars || 1;
        for (let p = 0; p <= PMAX; p++) { const lost = Object.values(lmp).filter((lm) => lm <= p).length; afa[p] = Math.max(0, nCars - lost) / nCars; }
      }
      return { f: ff, params: vals.params, entered: vals.entered, ini, elapsed: el, realizedFull: Math.min(PMAX, Math.ceil(el)), lossMonthByPlate: lmp, activeFracArr: afa, subsRS: [], subsReady: false };
    }
    async function loadFleet() {
      allMode = current === 'all';
      const f = allMode ? allFleet() : U.fleets.find((x) => x.id === current);
      model = f.model;
      plateView = null; viewAgg = false; // trocar de frota volta para a visão unitária
      curCars = f.cars || 0; ctxCars = f.cars || 0;
      const foto = allMode ? null : (OCN.modelos[f.model] || {}).foto;
      fleetsEl.querySelectorAll('.ue-fleet-btn').forEach((b) => b.classList.toggle('active', b.dataset.id === current));
      // carrega valores (entradas manuais + params) — all-mode busca de todas as frotas em paralelo
      entered = {}; params = {};
      if (allMode) {
        const valsList = await Promise.all(U.fleets.map((ff) => fetchFleetValues(ff.id)));
        fleetCtx = U.fleets.map((ff, i) => buildCtx(ff, valsList[i]));
      } else {
        fleetCtx = null;
        const vals = await fetchFleetValues(current);
        params = vals.params; entered = vals.entered;
      }
      // meses decorridos = (hoje - início) em semanas ÷ 4,3333; M0 é sempre realizado
      const ini = f.inicio ? new Date(f.inicio + 'T12:00:00') : null;
      curIni = ini;
      elapsed = ini ? Math.max(0, (hoje - ini) / 86400000 / (SEMANAS_MES * 7)) : 0;
      realizedFull = Math.min(PMAX, Math.ceil(elapsed)); // mês vigente conta inteiro como realizado
      // perdas totais da frota: mês do incidente por placa + fração de carros ativos por mês (p/ o agregado)
      lossMonthByPlate = {}; activeFracArr = [];
      if (ini && U.losses) {
        (f.placas || []).forEach((pl) => {
          const d = U.losses[pl];
          if (!d) return;
          let mo = Math.ceil(((new Date(d + 'T12:00:00') - ini) / 86400000) / (SEMANAS_MES * 7));
          if (mo < 1) mo = 1;
          lossMonthByPlate[pl] = mo;
        });
        const nCars = f.cars || 1;
        for (let p = 0; p <= PMAX; p++) {
          const lost = Object.values(lossMonthByPlate).filter((lm) => lm <= p).length;
          activeFracArr[p] = Math.max(0, nCars - lost) / nCars;
        }
      }
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
          slider('ueInad', 'delinquency rate (%)', 0, 50, 1, inadimplencia) +
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
      wireSlider('ueInad', (v) => { inadimplencia = v; }, () => inadimplencia + '%', () => inadimplencia, '__inadimplencia__', '__cfg__', f);
      wireField('ueRefundPct', (v) => { refundPct = v / 100; }, '__refund_pct__', () => refundPct, f);
      renderTable(f);
      renderPlates(f);
    }

    function renderTable(f) {
      const orc = U.orcado[f.model];
      const tbl = document.getElementById('ueTable');
      if (!orc) { tbl.innerHTML = '<tbody><tr><td>No budget for ' + f.modelLabel + '</td></tr></tbody>'; return; }
      // Subscription/Maintenance dependem da frota E da visão (placa/agregado); all-mode pré-computa por frota
      if (allMode && fleetCtx) {
        if (plateView) {
          const c = fleetCtx.find((x) => (x.f.placas || []).includes(plateView));
          if (c) { applyCtx(c); computeSubs(c.f); computeMaint(c.f); }
        } else {
          fleetCtx.forEach((c) => {
            applyCtx(c); computeSubs(c.f); computeMaint(c.f);
            c.subsRS = subsRS; c.subsReady = subsReady;
            c.maintRealRS = maintRealRS; c.maintProjRS = maintProjRS; c.maintReady = maintReady;
          });
        }
      } else {
        computeSubs(f);
        computeMaint(f);
      }
      const T = computeTotals(orc.lines);
      const gmap = { totalInflow: T.totalInflow, totalOutflow: T.totalOutflow, net: T.net, acc: T.acc };
      const editable = isAdmin && manualMode && !allMode; // no all-mode não há frota única p/ salvar edições
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
          const ind = get('__inadimplencia__'); if (ind != null) inadimplencia = ind;
          const rp = get('__refund_pct__'); if (rp != null) refundPct = rp;
        }
      } catch (e) { /* usa defaults */ }
      loadFleet();
    })();
  }
  }
})();

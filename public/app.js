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
  // esconde sub-abas restritas ao papel — o servidor manda meta.hiddenSubs (admin recebe []).
  // O servidor já removeu os dados dessas seções do payload (bloqueio real, não só visual).
  (meta.hiddenSubs || []).forEach((sub) => {
    document.querySelectorAll('.sub-tab[data-sub="' + sub + '"]').forEach((b) => { b.style.display = 'none'; });
    const pane = document.getElementById('sub-' + sub);
    if (pane) pane.style.display = 'none';
  });
  // se uma seção ficou sem NENHUMA sub-aba visível (ex.: Unit Economics para o visualizador),
  // esconde a aba principal e a seção inteira — senão sobraria uma aba vazia
  document.querySelectorAll('.section').forEach((sec) => {
    const tabs = sec.querySelectorAll('.sub-tab');
    if (!tabs.length) return;
    if ([...tabs].some((t) => t.style.display !== 'none')) return;
    sec.style.display = 'none';
    const mt = document.querySelector('.main-tab[data-sec="' + sec.id.replace(/^sec-/, '') + '"]');
    if (mt) mt.style.display = 'none';
  });
  if (meta.user) {
    const un = document.getElementById('userName'); if (un) un.textContent = meta.user.name || meta.user.login;
    const ur = document.getElementById('userRole'); if (ur) ur.textContent = (meta.user.role || '').replace(/_/g, ' ').toUpperCase();
  }
  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) btnLogout.addEventListener('click', async () => {
    try { await fetch('/api/logout', { method: 'POST' }); } catch (e) {}
    window.location.href = '/login';
  });
  // ---------- Freeze: pausa/retoma as atualizações automáticas (visível a todos; só admin aperta) ----------
  const btnFreeze = document.getElementById('btnFreeze');
  const btnFreezeLabel = document.getElementById('btnFreezeLabel');
  if (btnFreeze) {
    const isAdminHdr = !!(meta.user && (meta.user.role === 'admin' || meta.user.role === 'giga_admin'));
    let frozen = !!meta.frozen;
    const paintFreeze = () => {
      btnFreeze.style.display = 'inline-flex';
      btnFreeze.classList.toggle('frozen', frozen);
      if (btnFreezeLabel) btnFreezeLabel.textContent = frozen ? 'Frozen' : 'Freeze';
      btnFreeze.disabled = !isAdminHdr;
      btnFreeze.title = frozen
        ? ('Automatic updates paused' + (isAdminHdr ? ' — click to resume' : ' (admin only)'))
        : ('Pause automatic data updates' + (isAdminHdr ? '' : ' (admin only)'));
    };
    paintFreeze();
    if (isAdminHdr) btnFreeze.addEventListener('click', async () => {
      const next = !frozen;
      // confirmação antes de agir (freeze pausa; unfreeze volta a atualizar)
      const confirmMsg = next
        ? 'Freeze automatic updates?\n\nThe dashboard will stop refreshing and keep showing the current data until someone unfreezes it.'
        : 'Resume automatic updates?\n\nThe dashboard will start refreshing again and the frozen snapshot will be replaced by live data.';
      if (!window.confirm(confirmMsg)) return; // cancelou → não faz nada
      btnFreeze.disabled = true;
      try {
        const r = await fetch('/api/freeze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ frozen: next }) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        frozen = next;
        if (!frozen) { window.location.reload(); return; } // descongelou → recarrega p/ mostrar os dados já atualizados
      } catch (e) { /* mantém estado */ }
      paintFreeze();
    });
  }
  // ---------- Trocar senha (qualquer usuário autenticado) ----------
  const btnChangePw = document.getElementById('btnChangePw');
  const pwModal = document.getElementById('pwModal');
  if (btnChangePw && pwModal) {
    const $ = (id) => document.getElementById(id);
    const pwCur = $('pwCurrent'), pwNew = $('pwNew'), pwConf = $('pwConfirm'), pwMsg = $('pwMsg'), pwSave = $('pwSave'), pwCancel = $('pwCancel');
    const pwShow = (kind, txt) => { pwMsg.style.display = 'block'; pwMsg.style.color = kind === 'ok' ? '#176a3a' : '#a11414'; pwMsg.textContent = txt; };
    const openPw = () => { pwCur.value = pwNew.value = pwConf.value = ''; pwMsg.style.display = 'none'; pwModal.classList.add('show'); pwCur.focus(); };
    const closePw = () => pwModal.classList.remove('show');
    btnChangePw.addEventListener('click', openPw);
    pwCancel.addEventListener('click', closePw);
    pwModal.addEventListener('click', (e) => { if (e.target === pwModal) closePw(); }); // clique no fundo fecha
    pwSave.addEventListener('click', async () => {
      if (pwNew.value.length < 8) return pwShow('err', 'The new password must be at least 8 characters.');
      if (pwNew.value !== pwConf.value) return pwShow('err', 'The new passwords do not match.');
      pwSave.disabled = true; pwShow('ok', 'Saving…');
      try {
        const r = await fetch('/api/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ currentPassword: pwCur.value, newPassword: pwNew.value }) });
        const res = await r.json().catch(() => ({}));
        if (!r.ok || !res.ok) { pwShow('err', res.error || ('HTTP ' + r.status)); pwSave.disabled = false; return; }
        pwShow('ok', 'Password updated.');
        setTimeout(closePw, 1200);
      } catch (e) { pwShow('err', e.message); }
      pwSave.disabled = false;
    });
  }
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
      if (tab.dataset.sec === 'ue') initUnit(); // sub-aba padrão da seção Unit Economics
      if (tab.dataset.sec === 'finance') initFinance();
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
      if (tab.dataset.sub === 'unittheoric') initUnitTheoric();
      if (tab.dataset.sub === 'utilization') initUtilization();
      if (tab.dataset.sub === 'funnel') initFunnel();
      if (tab.dataset.sub === 'indrive') initInDrive();
      if (tab.dataset.sub === 'payments') initPayments();
      if (tab.dataset.sub === 'redeployment') initRedeployment();
      if (tab.dataset.sub === 'headcount') initHeadcount();
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
  // tile totalizador (caixa diferenciada), à esquerda das demais
  const totalTile = (SF.total != null)
    ? `<div class="fleet-tile fleet-tile-total"><div class="fleet-tile-num">${SF.total}</div><div class="fleet-tile-label">Total fleet</div></div>`
    : '';
  document.getElementById('fleetGrid').innerHTML = totalTile + SF.items.map((it) => {
    const bg = it.listrado ? stripe : it.cor + '14';
    const numCor = it.listrado ? '#282728' : it.cor;
    return `
    <div class="fleet-tile${it.valor === 0 ? ' is-zero' : ''}" style="background:${bg}">
      <div class="fleet-tile-num" style="color:${numCor}">${it.valor}</div>
      <div class="fleet-tile-label">${it.label}</div>
    </div>`;
  }).join('');

  // ---------- data "as of" dos dados (fonte única de "hoje" no cliente) ----------
  // Se congelado, é o momento do freeze; senão, a última atualização real. Fallback: hoje.
  // Gráficos que liam new Date() passam a usar isto, para refletirem o snapshot e não o "hoje" do navegador.
  const asOfDate = metaUpdatedAt ? new Date(metaUpdatedAt) : new Date();
  const _asOfSP = (opt) => asOfDate.toLocaleString('en-GB', { timeZone: 'America/Sao_Paulo', ...opt });
  const asOfDay = parseInt(_asOfSP({ day: '2-digit' }), 10);
  const asOfMonth = parseInt(_asOfSP({ month: '2-digit' }), 10);
  const asOfYear = parseInt(_asOfSP({ year: 'numeric' }), 10);

  // ---------- mês vigente (base do recorte YTD do gráfico) ----------
  const Mref = OCN.mensal;
  const vi = Math.max(0, Math.min(Mref.labels.length - 1, asOfMonth - 4)); // Abr=0 ... Dez=8

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
  // budget MENSAL derivado do budget ACUMULADO (cada mês = acumulado − mês anterior),
  // pra sempre bater com o gráfico "Received Fleet (acc.)"
  const _A = OCN.acumulado || {};
  const _acumBud = _A.esperado || [];
  const _acumLbl = _A.labels || M.labels;
  const _off = Math.max(0, _acumLbl.indexOf(M.labels[0])); // posição de 'Apr' no acumulado
  const monthlyBudget = M.labels.map((_, i) => {
    const idx = _off + i, cur = _acumBud[idx];
    if (cur == null) return null;
    const prev = idx > 0 ? _acumBud[idx - 1] : 0;
    return cur - (prev == null ? 0 : prev);
  });
  // gráfico mensal COMEÇA EM MARÇO (recebido 0, budget = 1º valor do acumulado), como o gráfico de cima.
  // arrays prefixados; índice 0 = Março; os demais deslocam +1 vs. M (Abr=0).
  const MLbl = ['Mar', ...M.labels];
  const MFull = ['March', ...M.full];
  const MRec = { Polo: [0, ...M.recebido.Polo], Argo: [0, ...M.recebido.Argo], Tera: [0, ...M.recebido.Tera] };
  const MBud = [(_acumBud[0] != null ? _acumBud[0] : 50), ...monthlyBudget]; // Março = acumulado do 1º mês
  const MInter = [false, ...M.interativo]; // Março sem detalhe semanal
  // duas linhas abaixo do eixo X do gráfico mensal (mesmo padrão do acumulado):
  // "Total Fleet Month" = recebido do mês (soma dos modelos); "Actual vs. Budget" = recebido ÷ budget do mês.
  const monthlyRow = {
    id: 'monthlyRow',
    afterDraw(chart) {
      const lbl = rngM(MLbl);
      const rp = rngM(MRec.Polo), ra = rngM(MRec.Argo), rt = rngM(MRec.Tera), bd = rngM(MBud);
      const totals = lbl.map((_, i) => (rp[i] || 0) + (ra[i] || 0) + (rt[i] || 0));
      const lastIdx = lbl.reduce((acc, _, i) => ((rp[i] != null || ra[i] != null || rt[i] != null) ? i : acc), -1);
      const ctx = chart.ctx, xScale = chart.scales.x;
      const fam = (Chart.defaults.font && Chart.defaults.font.family) || 'sans-serif';
      const y1 = chart.chartArea.bottom + 40;
      const y2 = y1 + 19;
      ctx.save();
      ctx.textBaseline = 'top';
      ctx.font = '600 9px ' + fam;
      ctx.fillStyle = '#6b7280';
      ctx.textAlign = 'left'; // alinhado à esquerda p/ os títulos não serem cortados na borda; podem ultrapassar à direita
      const lx = 0;
      ctx.fillText('Total Fleet Month', lx, y1 + 1);
      ctx.fillText('Actual vs. Budget', lx, y2 + 1);
      ctx.textAlign = 'center';
      for (let i = 0; i <= lastIdx; i++) {
        const x = xScale.getPixelForValue(i);
        ctx.font = '700 11px ' + fam;
        ctx.fillStyle = '#111827';
        ctx.fillText(String(totals[i]), x, y1);
        const bud = bd[i];
        if (bud) {
          const pct = Math.round((totals[i] / bud) * 100);
          ctx.fillStyle = pct >= 100 ? '#16A34A' : '#B91C1C';
          ctx.fillText(pct + '%', x, y2);
        }
      }
      ctx.restore();
    },
  };
  let chartMensal, view = 'monthly', cur = null, range = 'ytd';
  const rng = (arr) => (range === 'ytd' ? arr.slice(0, vi + 1) : arr); // YTD = abr até o mês vigente; FY = ano todo
  const rngM = (arr) => (range === 'ytd' ? arr.slice(0, vi + 2) : arr); // idem, mas c/ Março na frente (índice extra)
  const toast = document.getElementById('toast');
  const backBtn = document.getElementById('backBtn');
  function showToast(m) { toast.textContent = m; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2200); }

  function opts(isMonthly) {
    return {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22, bottom: isMonthly ? 52 : 0 } },
      onClick: (e, els) => {
        if (view !== 'monthly' || !els.length) return;
        const i = els[0].index;
        if (!MInter[i]) { showToast('No weekly calendar detail for this month'); return; }
        goWeekly(i - 1); // índice de exibição (com Março) → índice original (Abr=0)
      },
      onHover: (e, els) => { e.native.target.style.cursor = (view === 'monthly' && els.length && MInter[els[0].index]) ? 'pointer' : 'default'; },
      plugins: {
        legend: { display: false }, datalabels: { clamp: true },
        tooltip: {
          callbacks: {
            title: (it) => isMonthly ? (MFull[it[0].dataIndex] + '/26') : (M.full[cur] + ' · ' + W.labels[it[0].dataIndex][0]),
            label: (c) => {
              if (c.dataset.label === 'Budget') {
                // no mensal, o budget vem do acumulado (sem breakdown por modelo); no semanal mantém o breakdown
                if (isMonthly) return 'Budget: ' + (c.parsed.y == null ? '—' : c.parsed.y);
                const m = W.esperadoModelo[cur] ? W.esperadoModelo[cur][c.dataIndex] : null;
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
    return { type: 'bar', data: { labels: rngM(MLbl), datasets: [barDS('Polo', rngM(MRec.Polo)), barDS('Argo', rngM(MRec.Argo)), barDS('Tera', rngM(MRec.Tera)), lineDS(rngM(MBud), true)] }, options: opts(true), plugins: [monthlyRow] };
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
  const aLabels = A.labels || M.labels;
  const cumTotal = aLabels.map((_, i) => (A.recebido.Polo[i] || 0) + (A.recebido.Argo[i] || 0) + (A.recebido.Tera[i] || 0));
  function cumDS(model) {
    // número por modelo dentro do segmento (o TOTAL vem do plugin acumTotalTag, no topo real da barra)
    const labels = { seg: { anchor: 'center', align: 'center', color: txtOnBar(COR[model]), font: { size: 12, weight: 700 }, formatter: (v) => (v > 0 ? v : '') } };
    return { label: OCN.modelos[model].label, data: A.recebido[model], backgroundColor: COR[model], stack: 'r', borderRadius: 3, maxBarThickness: 48, order: 2, datalabels: { labels } };
  }
  // até que mês há dado real (0 conta como dado; null = mês futuro, não conta)
  const lastDataIdx = aLabels.reduce((acc, _, i) => ((A.recebido.Polo[i] != null || A.recebido.Argo[i] != null || A.recebido.Tera[i] != null) ? i : acc), -1);
  // duas linhas abaixo do eixo X, com legenda à esquerda:
  // "Total Fleet (actual)" = acumulado realizado (total das barras);
  // "Actual vs. Budget" = total das barras ÷ valor da linha (budget) no mês (verde >=100%, vermelho <100%).
  const deltaRow = {
    id: 'deltaRow',
    afterDraw(chart) {
      const ctx = chart.ctx, xScale = chart.scales.x;
      const fam = (Chart.defaults.font && Chart.defaults.font.family) || 'sans-serif';
      const y1 = chart.chartArea.bottom + 40; // Total Fleet (actual) — desce mais pra não colar nos meses
      const y2 = y1 + 19;                     // Actual vs. Budget
      ctx.save();
      ctx.textBaseline = 'top';
      // legendas das linhas, à esquerda do eixo
      ctx.font = '600 9px ' + fam;
      ctx.fillStyle = '#6b7280';
      ctx.textAlign = 'left'; // alinhado à esquerda p/ os títulos não cortarem; podem ultrapassar à direita
      const lx = 0;
      ctx.fillText('Total Fleet (actual)', lx, y1 + 1);
      ctx.fillText('Actual vs. Budget', lx, y2 + 1);
      // valores por mês (Março .. último mês com dado)
      ctx.textAlign = 'center';
      for (let i = 0; i <= lastDataIdx; i++) {
        const x = xScale.getPixelForValue(i);
        ctx.font = '700 11px ' + fam;
        ctx.fillStyle = '#111827';
        ctx.fillText(String(cumTotal[i]), x, y1);
        // % = total das barras (actual acumulado) ÷ valor da linha (budget) naquele mês
        const bud = A.esperado[i];
        if (bud) {
          const pct = Math.round((cumTotal[i] / bud) * 100);
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
      labels: aLabels,
      datasets: [
        cumDS('Polo'), cumDS('Argo'), cumDS('Tera'),
        // linha do budget: tracejada; valor do budget acima da bolinha em TODOS os meses
        { label: 'Budget', data: A.esperado, type: 'line', borderColor: NAVY, backgroundColor: NAVY, borderWidth: 2, borderDash: [5, 4], pointRadius: 4, pointHoverRadius: 6, tension: 0.25, order: 3,
          datalabels: { color: '#111827', anchor: 'end', align: 'top', offset: 4, font: { size: 12, weight: 700 }, display: (ctx) => ctx.dataset.data[ctx.dataIndex] != null, formatter: (v) => ((v || v === 0) ? v : '') } },
      ],
    },
    plugins: [deltaRow],
    options: {
      // padding esquerdo enxuto (só o necessário pra legenda das data rows caber); inferior, pras duas linhas de valores (y1=bottom+40, y2=+59)
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 26, right: 20, bottom: 64, left: 0 } },
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
    // eixo X: data do último dia do mês (meses fechados) e a data "as of" no mês vigente
    // (usa a data do snapshot, não new Date() — assim congelado mostra a data do freeze, não "hoje")
    const p2d = (n) => String(n).padStart(2, '0');
    const dateLbls = FS.labels.map((_, j) => {
      const mm = j + 4; // Abr=4
      if (mm === asOfMonth) return p2d(asOfDay) + '/' + p2d(mm); // mês vigente = data "as of"
      const last = new Date(asOfYear, mm, 0).getDate();          // dia 0 do mês seguinte = último dia deste mês
      return p2d(last) + '/' + p2d(mm);
    });
    const pctFmt = (v) => (v == null ? '' : String(Math.round(v * 10) / 10).replace('.', ',') + '%'); // tooltip (com decimal)
    const pctTag = (v) => (v == null ? '' : '(' + Math.round(v) + '%)'); // rótulo na barra: entre parênteses, sem decimais
    const absFmt = (ctx) => { const a = ctx.dataset._abs ? ctx.dataset._abs[ctx.dataIndex] : null; return a == null ? '' : a; };
    const baseActive = FS.active.slice(), baseInactive = FS.inactive.slice(), baseLoss = (FS.loss || FS.labels.map(() => 0)).slice();
    const ovr = { active: {}, inactive: {} };
    (OCN._fleetOvr || []).forEach((o) => { if (ovr[o.line] && o.value != null) ovr[o.line][o.period] = o.value; });
    const eff = { active: [], inactive: [], loss: [], total: [], activePct: [], inactivePct: [], lossPct: [] };
    function recalc() {
      for (let i = 0; i < FS.labels.length; i++) {
        const a = (ovr.active[i] != null) ? ovr.active[i] : baseActive[i];
        const n = (ovr.inactive[i] != null) ? ovr.inactive[i] : baseInactive[i];
        const l = baseLoss[i] || 0; // perda total não é editável (só active/inactive)
        const t = (a || 0) + (n || 0) + l;
        eff.active[i] = a; eff.inactive[i] = n; eff.loss[i] = l; eff.total[i] = t || null;
        eff.activePct[i] = t ? (a / t) * 100 : null;
        eff.inactivePct[i] = t ? (n / t) * 100 : null;
        eff.lossPct[i] = t ? (l / t) * 100 : null;
      }
    }
    let totalArr = [];
    // Active: segmento grande — ABSOLUTO em destaque em cima, percentual menor embaixo
    const activeDS = (label, pct, abs, color) => ({
      label, data: sl(pct), _abs: sl(abs), backgroundColor: color, stack: 'u', borderRadius: 3, maxBarThickness: 88,
      datalabels: {
        display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
        color: (ctx) => txtOnBar(ctx.dataset.backgroundColor), anchor: 'center', textAlign: 'center',
        labels: {
          abs: { align: 'top', offset: 1, font: { size: 12, weight: 700 }, formatter: (v, ctx) => absFmt(ctx) },
          pct: { align: 'bottom', offset: 1, color: '#fff', font: { size: 9, weight: 600 }, formatter: (v) => pctTag(v) }, // % dentro da barra: branco
        },
      },
    });
    // segmento fino (inactive): absoluto no centro, percentual abaixo; halo pra ler sobre a barra.
    // hideInner (loss) desliga os rótulos internos — o número vem do plugin lossTag ao lado da barra.
    const thinDS = (label, pct, abs, color, hideInner) => ({
      label, data: sl(pct), _abs: sl(abs), backgroundColor: color, stack: 'u', borderRadius: 3, maxBarThickness: 88,
      datalabels: hideInner ? { display: false } : {
        display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
        anchor: 'center', textAlign: 'center',
        labels: {
          // número numa "caixinha" da cor da barra (em vez de texto com borda branca)
          abs: { align: 'center', backgroundColor: color, borderRadius: 4, padding: { top: 2, bottom: 2, left: 5, right: 5 }, color: txtOnBar(color), font: { size: 11, weight: 700 }, formatter: (v, ctx) => absFmt(ctx) },
          pct: { align: 'bottom', offset: 10, color: '#fff', font: { size: 8, weight: 700 }, formatter: (v) => pctTag(v) }, // % dentro da barra: branco
        },
      },
    });
    // total da frota (active+inactive+loss) acima de cada barra, via plugin (topo da pilha varia)
    const utilTotalTag = {
      id: 'utilTotalTag',
      afterDatasetsDraw(chart) {
        const ctx = chart.ctx, yScale = chart.scales.y, meta = chart.getDatasetMeta(0);
        ctx.save();
        ctx.font = '700 12px ' + ((Chart.defaults.font && Chart.defaults.font.family) || 'sans-serif');
        ctx.fillStyle = '#111827'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        for (let i = 0; i < totalArr.length; i++) {
          if (totalArr[i] == null || !meta.data[i]) continue;
          ctx.fillText(String(totalArr[i]), meta.data[i].x, yScale.getPixelForValue(100) - 6);
        }
        ctx.restore();
      },
    };
    // nº de total loss ao lado do topo da barra (segmento fino demais p/ rótulo dentro), só quando >=1
    let lossArr = [], lossPctArr = [];
    const lossTag = {
      id: 'lossTag',
      afterDatasetsDraw(chart) {
        const ctx = chart.ctx, meta = chart.getDatasetMeta(2); // dataset "Total loss" (topo da pilha)
        if (!meta || !meta.data.length) return;
        const fam = (Chart.defaults.font && Chart.defaults.font.family) || 'sans-serif';
        ctx.save();
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        for (let i = 0; i < lossArr.length; i++) {
          if ((lossArr[i] || 0) < 1 || !meta.data[i]) continue;
          const bar = meta.data[i];
          const x = bar.x + bar.width / 2 + 5, y = bar.y + 3, txt = String(lossArr[i]);
          ctx.font = '700 11px ' + fam;
          const bw = ctx.measureText(txt).width + 10, bh = 16;
          ctx.fillStyle = '#374151'; // caixinha da cor da barra (Total loss)
          if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y - bh / 2, bw, bh, 4); ctx.fill(); }
          else ctx.fillRect(x, y - bh / 2, bw, bh);
          ctx.fillStyle = '#fff'; ctx.fillText(txt, x + 5, y);
          if (lossPctArr[i] != null) { ctx.font = '600 8px ' + fam; ctx.fillStyle = '#6b7280'; ctx.fillText(pctTag(lossPctArr[i]), x, y + 13); } // % abaixo, fora da caixinha
        }
        ctx.restore();
      },
    };
    let chartUtil = null;
    function renderUtil() {
      recalc();
      totalArr = sl(eff.total);
      lossArr = sl(eff.loss);
      lossPctArr = sl(eff.lossPct);
      if (chartUtil) chartUtil.destroy();
      chartUtil = new Chart(document.getElementById('chartUtil'), {
        type: 'bar',
        data: { labels: sl(dateLbls), datasets: [
          activeDS('Active Vehicles', eff.activePct, eff.active, '#5A00F8'),
          thinDS('Inactive Vehicles', eff.inactivePct, eff.inactive, '#CBD5E1', false),
          thinDS('Total loss', eff.lossPct, eff.loss, '#374151', true),
        ] },
        plugins: [utilTotalTag, lossTag],
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
    if (editBtn && editEl && meta.user && (meta.user.role === 'admin' || meta.user.role === 'giga_admin')) {
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
  // Organograma executivo — estrutura fixa; nomes/cargos editáveis por admins (persistidos em /api/org)
  function renderOrgChart() {
    const el = document.getElementById('orgChart');
    if (!el) return;
    const meta = OCN._meta || {};
    const isAdmin = !!(meta.user && (meta.user.role === 'admin' || meta.user.role === 'giga_admin'));
    const ORG = { id: 'luiz', name: 'Luiz Apostólico', title: 'VP of Business Development', children: [
      { id: 'lucas', name: 'Lucas Gomes', title: 'Head of Fleet', children: [
        { id: 'livia', name: 'Lívia Selegatto', title: 'Control Tower, Claims & Repairs and Recovery Manager', children: [
          { id: 'enrico', name: 'Enrico Barbato', title: 'Fleet Management Analyst' } ] },
        { id: 'anderson', name: 'Anderson Evangelista', title: 'Fleet Delivery Manager', children: [
          { id: 'luana', name: 'Luana Coelho', title: 'Onboarding Analyst' } ] },
      ] },
      { id: 'gabriel', name: 'Gabriel Ribeiro', title: 'Head of Clients', children: [
        { id: 'william', name: 'William Padua', title: 'Commercial Manager', children: [
          { id: 'ielena', name: 'Ielena Jalskulski', title: 'Sales Analyst' },
          { id: 'gabrielrosa', name: 'Gabriel Rosa', title: 'Sales Analyst' },
          { id: 'natalice', name: 'Natalice Santos', title: 'Sales Analyst' },
          { id: 'andre', name: 'André Germano', title: 'Sales Analyst' },
        ] },
        { id: 'yuji', name: 'Yuji Hirata', title: 'Customer Support and Collections Manager', children: [
          { id: 'andresa', name: 'Andresa Arruda', title: 'Customer Support Analyst' } ] },
      ] },
      { id: 'henrique', name: 'Henrique Ressel', title: 'Head of Marketing' },
      { id: 'karen', name: 'Karen Nicoletti', title: 'Office Manager' },
    ] };
    let overrides = {};
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
    const nameOf = (n) => (overrides[n.id] && overrides[n.id].name != null) ? overrides[n.id].name : n.name;
    const titleOf = (n) => (overrides[n.id] && overrides[n.id].title != null) ? overrides[n.id].title : n.title;
    const findNode = (root, id) => { if (root.id === id) return root; for (const c of (root.children || [])) { const f = findNode(c, id); if (f) return f; } return null; };
    function nodeHTML(n, lvl) {
      const pencil = isAdmin ? '<span class="org-pencil ti ti-pencil"></span>' : '';
      return `<div class="org-node lvl-${lvl}${isAdmin ? ' editable' : ''}" data-id="${n.id}">${pencil}<div class="org-name">${esc(nameOf(n))}</div><div class="org-title">${esc(titleOf(n))}</div></div>`;
    }
    function treeHTML(n, lvl) {
      let h = '<li>' + nodeHTML(n, lvl);
      if (n.children && n.children.length) {
        // filhos que são todos folhas (analistas) => lista VERTICAL pendurada (compacta, evita scroll horizontal)
        const allLeaves = n.children.every((c) => !(c.children && c.children.length));
        h += allLeaves
          ? '<div class="org-reports ' + (n.children.length > 1 ? 'multi' : 'single') + '">' + n.children.map((c) => '<div class="org-report">' + nodeHTML(c, lvl + 1) + '</div>').join('') + '</div>'
          : '<ul>' + n.children.map((c) => treeHTML(c, lvl + 1)).join('') + '</ul>';
      }
      return h + '</li>';
    }
    function draw() {
      el.innerHTML = '<ul class="org-tree">' + treeHTML(ORG, 1) + '</ul>';
      if (isAdmin) el.querySelectorAll('.org-node.editable').forEach((node) => node.addEventListener('click', () => openEdit(node)));
    }
    function openEdit(node) {
      if (node.querySelector('input')) return; // já em edição
      const id = node.dataset.id, n = findNode(ORG, id);
      // cargo é <textarea> (multi-linha): Shift+Enter quebra linha; Enter salva
      node.innerHTML = `<input class="org-in-name" value="${esc(nameOf(n))}" placeholder="Name" /><textarea class="org-in-title" rows="2" placeholder="Role">${esc(titleOf(n))}</textarea><div class="org-edit-actions"><button class="save">Save</button><button class="cancel">Cancel</button></div>`;
      const inName = node.querySelector('.org-in-name'), inTitle = node.querySelector('.org-in-title');
      inName.focus();
      const doSave = async () => {
        const name = inName.value.trim(), title = inTitle.value.replace(/\r/g, '').trim();
        overrides[id] = { name, title };
        try { await fetch('/api/org', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ id, name, title }) }); } catch (err) {}
        draw();
      };
      node.querySelector('.cancel').addEventListener('click', (e) => { e.stopPropagation(); draw(); });
      node.querySelector('.save').addEventListener('click', (e) => { e.stopPropagation(); doSave(); });
      inName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSave(); } });
      inTitle.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSave(); } }); // Enter salva; Shift+Enter quebra linha
    }
    const hintEl = document.getElementById('orgEditHint');
    if (hintEl) hintEl.textContent = isAdmin ? '✎ Click a box to edit name / role' : '';
    fetch('/api/org', { credentials: 'include' }).then((r) => r.json()).then((d) => { overrides = (d && d.overrides) || {}; draw(); }).catch(() => draw());
  }
  function initRH() { // aba Human Resources abre em "Org. Structure" (sub-aba default)
    if (rhReady) return;
    rhReady = true;
    renderOrgChart();
  }
  let hcReady = false;
  function initHeadcount() {
    if (hcReady) return;
    hcReady = true;
    const H = OCN.rh;
    if (!H || !H.months || !H.months.length) {
      const cardEl = document.getElementById('chartHC') && document.getElementById('chartHC').closest('.card');
      if (cardEl) cardEl.innerHTML = '<div style="color:var(--text-2);font-size:13px">No headcount data (import_RH tab not available).</div>';
      return;
    }
    // data row abaixo do eixo X: % de HC realizado vs. budget, com legenda à esquerda.
    // Fonte toda em cinza escuro (sem cor condicional).
    const hcPctRow = {
      id: 'hcPctRow',
      afterDraw(chart) {
        const ctx = chart.ctx, xScale = chart.scales.x;
        const fam = (Chart.defaults.font && Chart.defaults.font.family) || 'sans-serif';
        const yPos = chart.chartArea.bottom + 40; // desce mais pra não colar nos rótulos dos meses
        ctx.save();
        ctx.textBaseline = 'top';
        // legenda da linha, à esquerda do eixo
        ctx.font = '600 10px ' + fam;
        ctx.fillStyle = '#6b7280';
        ctx.textAlign = 'right';
        ctx.fillText('Actual vs. Budget', chart.chartArea.left - 12, yPos + 1);
        // valores por mês — todos em cinza escuro
        ctx.font = '700 11px ' + fam;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#374151';
        for (let i = 0; i < H.labels.length; i++) {
          const a = H.actual[i], b = H.budget[i];
          if (a == null || !b) continue;
          ctx.fillText(Math.round((a / b) * 100) + '%', xScale.getPixelForValue(i), yPos);
        }
        ctx.restore();
      },
    };
    // gráfico principal: barras = Actual, linha tracejada = Budget
    new Chart(document.getElementById('chartHC'), {
      type: 'bar',
      data: {
        labels: H.labels,
        datasets: [
          { label: 'Active HC (Actual)', data: H.actual, backgroundColor: '#5A00F8', borderRadius: 3, maxBarThickness: 48, order: 2,
            // barra pequena (ex. Feb=2): rótulo ACIMA da barra, em preto, pra não colar no eixo X
            datalabels: {
              anchor: 'end', display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, font: { size: 11, weight: 700 }, formatter: (v) => v,
              align: (ctx) => (ctx.dataset.data[ctx.dataIndex] <= 3 ? 'top' : 'bottom'),
              offset: (ctx) => (ctx.dataset.data[ctx.dataIndex] <= 3 ? -3 : 2), // barra pequena: uns pixels mais pra baixo (colado no topo, longe da linha)
              color: (ctx) => (ctx.dataset.data[ctx.dataIndex] <= 3 ? '#111827' : '#fff'),
            } },
          // rótulo do budget vai pra BAIXO da bolinha quando o budget está abaixo do realizado
          // (senão invade o rótulo da barra — ex. Março: budget 5 × realizado 8); halo branco pra ler dentro da barra roxa
          { label: 'Active HC (Budget)', data: H.budget, type: 'line', borderColor: NAVY, backgroundColor: NAVY, borderWidth: 2, borderDash: [5, 4], pointRadius: 4, pointHoverRadius: 6, tension: 0.25, order: 1,
            datalabels: { color: NAVY, anchor: 'end', offset: 4, font: { size: 10, weight: 600 }, textStrokeColor: '#fff', textStrokeWidth: 3,
              align: (ctx) => { const i = ctx.dataIndex; const a = H.actual[i], b = H.budget[i]; return (a != null && b != null && b < a) ? 'bottom' : 'top'; },
              formatter: (v) => (v == null ? '' : v) } },
        ],
      },
      plugins: [hcPctRow],
      options: {
        // bottom acomoda a data row descida (yPos = bottom+40); left abre espaço pra legenda "Actual vs. Budget"
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24, bottom: 46, left: 100 } },
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

    // Turnover — 1 saída até agora (dados fixos; mova pra planilha quando houver mais)
    const turnEl = document.getElementById('rhTurnover');
    if (turnEl) {
      const leavers = [
        { role: 'Customer Support Manager', hired: '19/03/2026', left: '15/04/2026', tenureDays: 27, monthIdx: 3 }, // saiu em Abril (idx 3)
      ];
      // turnover mensal % = saídas no mês ÷ headcount daquele mês (0% nos meses sem saída)
      const upToT = H.currentIdx >= 0 ? H.currentIdx : (H.actual.filter((v) => v != null).length - 1);
      const monLabels = [], monPct = [], monDep = [];
      for (let i = 0; i <= upToT; i++) {
        const dep = leavers.filter((l) => l.monthIdx === i).length;
        const hc = H.actual[i];
        monLabels.push(H.labels[i]); monDep.push(dep);
        monPct.push(hc ? Math.round((dep / hc) * 1000) / 10 : 0);
      }
      const aprPct = monPct[3] != null ? monPct[3] : 0;
      turnEl.innerHTML =
        `<div class="kpi-grid" style="margin-bottom:14px">
          <div class="kpi-card"><div class="kpi-label"><i class="ti ti-user-minus"></i> Total turnover</div><div class="kpi-value">${leavers.length}</div><div class="kpi-sub">person left YTD</div></div>
          <div class="kpi-card"><div class="kpi-label"><i class="ti ti-clock"></i> Avg. tenure</div><div class="kpi-value">${Math.round(leavers.reduce((a, l) => a + l.tenureDays, 0) / leavers.length)}</div><div class="kpi-sub">days at the company</div></div>
        </div>` +
        `<div class="sub2-desc" style="margin:2px 0 6px">Monthly turnover rate — departures ÷ headcount that month</div>` +
        `<div class="chart-box" style="height:210px"><canvas id="chartTurnover" role="img" aria-label="Monthly turnover rate"></canvas></div>` +
        `<table class="rh-table" style="margin-top:12px"><thead><tr><th>Role</th><th>Hired</th><th>Left</th><th>Tenure</th></tr></thead><tbody>` +
        leavers.map((l) => `<tr><td>${l.role}</td><td>${l.hired}</td><td>${l.left}</td><td>${l.tenureDays} days</td></tr>`).join('') +
        '</tbody></table>';
      const tCanvas = document.getElementById('chartTurnover');
      if (tCanvas) new Chart(tCanvas, {
        type: 'line',
        data: { labels: monLabels, datasets: [{
          label: 'Turnover', data: monPct,
          borderColor: '#111827', backgroundColor: 'rgba(17,24,39,0.06)', fill: true, // linha preta; preenchimento neutro suave
          borderWidth: 2, tension: 0, spanGaps: true, // tension 0 = segmentos retos (pico agudo, sem suavizar)
          pointRadius: 4, pointHoverRadius: 5,
          pointBackgroundColor: '#111827',
          pointBorderColor: '#111827',
          datalabels: { anchor: 'end', align: 'top', offset: 4, color: '#111827', font: { size: 11, weight: 700 }, formatter: (v) => v + '%' },
        }] },
        options: {
          responsive: true, maintainAspectRatio: false, layout: { padding: { top: 20 } },
          plugins: { legend: { display: false }, datalabels: { clamp: true }, tooltip: { callbacks: { label: (c) => monDep[c.dataIndex] + (monDep[c.dataIndex] === 1 ? ' departure' : ' departures') + ' · ' + c.parsed.y + '%' } } },
          scales: {
            x: { grid: { display: false }, ticks: { color: TXT2 } },
            y: { beginAtZero: true, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, callback: (v) => v + '%' }, title: { display: true, text: 'turnover %', color: '#9ca3af', font: { size: 11 } } },
          },
        },
      });
    }
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
      // linhas verticais: média actual (calculada) e budget 1.500 km/sem — mapeia km → posição na escala de faixas
      const BUDGET_KM = 1500;
      const bandCenter = (i) => (i === 0 ? 300 : i === HIST_BINS.length - 1 ? 2100 : 300 + 200 * i);
      const kmToFrac = (v) => {
        if (v <= bandCenter(0)) return 0;
        const last = HIST_BINS.length - 1;
        if (v >= bandCenter(last)) return last;
        for (let i = 0; i < last; i++) { const a = bandCenter(i), b = bandCenter(i + 1); if (v >= a && v <= b) return i + (v - a) / (b - a); }
        return 0;
      };
      const vLine = (chart, frac, color, label) => {
        const xs = chart.scales.x, ys = chart.scales.y, ctx = chart.ctx;
        const x0 = xs.getPixelForValue(0), x1 = xs.getPixelForValue(1);
        const px = x0 + frac * (x1 - x0);
        ctx.save();
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(px, ys.bottom); ctx.lineTo(px, ys.top + 12); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color; ctx.font = '700 10px ' + ((Chart.defaults.font && Chart.defaults.font.family) || 'sans-serif');
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(label, px, ys.top + 10);
        ctx.restore();
      };
      const avgLinesPlugin = {
        id: 'avgLines',
        afterDatasetsDraw(chart) {
          vLine(chart, kmToFrac(avg), NAVY, 'actual avg ' + avg.toLocaleString('en-US'));
          vLine(chart, kmToFrac(BUDGET_KM), '#EA580C', 'budget ' + BUDGET_KM.toLocaleString('en-US'));
        },
      };
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
        plugins: [avgLinesPlugin],
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
            // teto do eixo ~30% acima da faixa mais alta: dá espaço p/ os rótulos "actual avg"/"budget" no topo sem colar na barra
            y: { display: false, beginAtZero: true, grid: { display: false }, max: Math.max(...counts) > 0 ? Math.ceil(Math.max(...counts) * 1.3) : undefined },
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
      // média das semanas com valor (linha tracejada de referência)
      const valid = data.filter((v) => v != null);
      const avg = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
      new Chart(document.getElementById(canvasId), {
        type: 'line',
        data: { labels: F.labels, datasets: [
          {
            label: 'Weekly', data, borderColor: color, backgroundColor: color, borderWidth: 2, tension: 0.3,
            pointRadius: 4, pointBackgroundColor: color,
            datalabels: { align: 'top', anchor: 'end', offset: 4, color: NAVY, font: { size: 10, weight: 700 }, formatter: (v) => (v == null ? '' : v + '%') },
          },
          {
            // valor da média numa "tag" ABAIXO da linha tracejada, no início do eixo X (1º ponto)
            label: 'Average', data: F.labels.map(() => avg), borderColor: '#9ca3af', borderWidth: 1.5, borderDash: [5, 4],
            pointRadius: 0, pointHoverRadius: 0, tension: 0,
            datalabels: {
              display: (ctx) => ctx.dataIndex === 0 && avg != null,
              // abaixo da linha e deslocada pra direita (ângulo ~30°, offset com margem) pra não encostar no eixo Y
              align: 30, anchor: 'center', offset: 38,
              backgroundColor: '#6b7280', color: '#fff', borderRadius: 4, padding: { top: 2, bottom: 2, left: 5, right: 5 },
              font: { size: 10, weight: 700 }, formatter: () => 'avg ' + avg + '%',
            },
          },
        ] },
        options: {
          responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24 } },
          plugins: {
            legend: { display: false }, datalabels: { clamp: true },
            tooltip: { callbacks: { label: (c) => (c.datasetIndex === 1 ? `Average: ${avg}%` : `${c.parsed.y}% (${num[c.dataIndex]}/${den[c.dataIndex]})`) } },
          },
          scales: {
            // rótulos a 45º: com os 3 gráficos lado a lado não há largura pra datas na horizontal
            x: { grid: { display: false }, ticks: { color: TXT2, minRotation: 45, maxRotation: 45 } },
            y: { beginAtZero: true, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, callback: (v) => v + '%' }, title: { display: true, text: '%', color: '#9ca3af', font: { size: 11 } } },
          },
        },
      });
    }
    funnelChart('chartFunnel1', F.taxaEnvio, '#374151', F.enviados, F.contatos);
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
      // Elegíveis (col D) separados em: já capturados (prints, col F) e ainda não capturados
      const captured = P.prints.slice();
      const eligibleNotCaptured = P.elegiveis.map((e, i) => Math.max(0, e - (P.prints[i] || 0)));
      // valor absoluto + (% da base ativa) embaixo, para Captured e Eligible (segmentos maiores)
      const pctOfBase = (v, i) => (P.ativos[i] ? Math.round((v / P.ativos[i]) * 100) : 0);
      new Chart(document.getElementById('chartInDriveBase'), {
        type: 'bar',
        data: { labels: P.labels, datasets: [
          { label: 'Captured', data: captured, backgroundColor: '#16A34A', stack: 's', borderRadius: 3, maxBarThickness: 70,
            datalabels: { color: '#fff', font: { size: 11, weight: 700 }, textAlign: 'center', display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, formatter: (v, ctx) => v.toLocaleString('en-US') + '\n(' + pctOfBase(v, ctx.dataIndex) + '%)' } },
          { label: 'Eligible (not captured yet)', data: eligibleNotCaptured, backgroundColor: PURPLE, stack: 's', borderRadius: 3, maxBarThickness: 70,
            datalabels: { color: '#fff', font: { size: 11, weight: 700 }, textAlign: 'center', display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, formatter: (v, ctx) => v.toLocaleString('en-US') + '\n(' + pctOfBase(v, ctx.dataIndex) + '%)' } },
          { label: 'Not eligible', data: P.naoElegiveis, backgroundColor: hatch, borderColor: '#d1d5db', borderWidth: 1, stack: 's', borderRadius: 3, maxBarThickness: 70,
            datalabels: { anchor: 'end', align: 'top', offset: 2, color: NAVY, font: { size: 12, weight: 700 }, formatter: (v, ctx) => P.ativos[ctx.dataIndex].toLocaleString('en-US') } },
        ] },
        options: {
          responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24 } },
          plugins: {
            legend: { display: false }, datalabels: { clamp: true },
            tooltip: { callbacks: {
              title: (it) => P.full[it[0].dataIndex],
              label: (c) => {
                if (c.datasetIndex === 0) return 'Captured: ' + c.parsed.y.toLocaleString('en-US');
                if (c.datasetIndex === 1) return 'Eligible (not captured): ' + c.parsed.y.toLocaleString('en-US') + ' · total eligible: ' + P.elegiveis[c.dataIndex].toLocaleString('en-US');
                return 'Not eligible: ' + c.parsed.y.toLocaleString('en-US') + ' · Active base: ' + P.ativos[c.dataIndex].toLocaleString('en-US');
              },
            } },
          },
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { color: TXT2 } },
            y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, precision: 0 }, title: { display: true, text: 'active clients (cumulative)', color: '#9ca3af', font: { size: 11 } } },
          },
        },
      });

      // 3) Oportunidade capturada — prints enviados / denominador. Toggle: base ativa × elegíveis.
      // Padrão = elegíveis (denominador coluna D). % de captura recalculado por visão.
      const pctOf = (den) => P.prints.map((pr, i) => (den[i] ? Math.round((pr / den[i]) * 100) : 0));
      const CONV = {
        eligible: { pct: pctOf(P.elegiveis), den: P.elegiveis, yTitle: '% of eligible clients', desc: 'Clients who sent the proof prints (converted to inDrive) as a share of the eligible clients', denLabel: 'eligible' },
        active: { pct: pctOf(P.ativos), den: P.ativos, yTitle: '% of active base', desc: 'Clients who sent the proof prints (converted to inDrive) as a share of the total active base', denLabel: 'active base' },
      };
      // teto do eixo Y fixo (maior das duas visões) — a escala não muda ao alternar o denominador
      const convYMax = Math.min(100, Math.ceil((Math.max(...CONV.eligible.pct, ...CONV.active.pct) + 1) / 10) * 10);
      const descEl = document.getElementById('idConvDesc');
      let convChart = null;
      function renderConv(mode) {
        const C = CONV[mode];
        if (descEl) descEl.textContent = C.desc;
        if (convChart) convChart.destroy();
        convChart = new Chart(document.getElementById('chartInDriveConv'), {
          type: 'line',
          data: { labels: P.labels, datasets: [{
            data: C.pct, borderColor: '#16A34A', backgroundColor: 'rgba(22,163,74,0.07)', borderWidth: 2.5, fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: '#16A34A',
            datalabels: { align: 'top', anchor: 'end', offset: 4, color: '#16A34A', font: { size: 11, weight: 700 }, formatter: (v) => v + '%' },
          }] },
          options: {
            responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24 } },
            plugins: {
              legend: { display: false }, datalabels: { clamp: true },
              tooltip: { callbacks: {
                title: (it) => P.full[it[0].dataIndex],
                label: (c) => 'Captured: ' + c.parsed.y + '% (' + P.prints[c.dataIndex] + '/' + C.den[c.dataIndex] + ' — ' + C.denLabel + ')',
              } },
            },
            scales: {
              x: { grid: { display: false }, ticks: { color: TXT2, maxRotation: 0 } },
              y: { beginAtZero: true, max: convYMax, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, callback: (v) => v + '%' }, title: { display: true, text: C.yTitle, color: '#9ca3af', font: { size: 11 } } },
            },
          },
        });
      }
      renderConv('eligible');
      const convTg = document.getElementById('idConvToggle');
      if (convTg) convTg.querySelectorAll('.range-btn').forEach((b) => b.addEventListener('click', () => {
        convTg.querySelectorAll('.range-btn').forEach((x) => x.classList.toggle('active', x === b));
        renderConv(b.dataset.den === 'active' ? 'active' : 'eligible');
      }));
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
    const weeks = P.weeks.slice(0, -1); // não mostra a última semana (incompleta) em nenhuma visualização
    if (!weeks.length) { if (legendEl) legendEl.innerHTML = '<div style="color:var(--text-2);font-size:13px">No completed weeks yet.</div>'; return; }
    // categorias na ordem em que empilham (baixo → cima), cor por categoria
    const CATS = [
      { key: 'onTime', label: 'Paid on time', color: '#16A34A' },
      { key: 'late1', label: '1 day late', color: '#F59E0B' },
      { key: 'late2', label: '2+ days late', color: '#B45309' },
      { key: 'returned', label: 'Vehicle returned', color: '#9CA3AF' }, // cinza médio
      { key: 'recovered', label: 'Vehicle recovered', color: '#111827' }, // preto
      { key: 'pending', label: 'Pending', color: '#D1D5DB' }, // cinza claro no topo (denominador = Esperado)
    ];
    // visão "Amount in R$": 3 baldes — tudo que não é onTime/late1 é tratado como "2+ days late"
    const RS_CATS = [
      { key: 'onTime', label: 'Paid on time', color: '#16A34A' },
      { key: 'late1', label: '1 day late', color: '#F59E0B' },
      { key: 'late2plus', label: '2+ days late', color: '#B45309' },
    ];
    const catsFor = () => (mode === 'rs' ? RS_CATS : CATS);
    const sumR = (arr, f) => (arr || []).reduce((s, n) => s + (f(n) || 0), 0);
    const rsValue = (w, key) => {
      if (key === 'onTime') return sumR(w.names.onTime, (n) => n.recebido);
      if (key === 'late1') return sumR(w.names.late1, (n) => n.recebido);
      // 2+ days late absorve late2 + devolvido + recuperado + pendente (pendente usa o valor devido/esperado)
      return sumR(w.names.late2, (n) => n.recebido) + sumR(w.names.returned, (n) => n.recebido) + sumR(w.names.recovered, (n) => n.recebido) + sumR(w.names.pending, (n) => n.esperado);
    };
    const fmtRS = (v) => (v >= 1000 ? 'R$' + (v / 1000).toFixed(1).replace('.', ',') + 'k' : 'R$' + Math.round(v));
    // semanas que são a ÚLTIMA do mês (destaque cinza atrás: semanas fracas nas plataformas)
    const MONTH_END_WEEKS = ['04/05', '01/06', '29/06'];
    legendEl.innerHTML = CATS.filter((c) => c.key !== 'pending').map((c) => `<span class="it"><span class="sw" style="background:${c.color}"></span> ${c.label}</span>`).join('');
    const labels = weeks.map((w) => fmtDMY(w.date));
    const totals = weeks.map((w) => CATS.reduce((s, c) => s + w.counts[c.key], 0));
    let mode = 'pct', chart, selWeekIdx = null; // padrão: Percentage (100% bars)
    // retângulo tracejado bem sutil ao redor da barra nas últimas semanas do mês (semanas fracas nas plataformas)
    const monthEndBg = {
      id: 'monthEndMark',
      beforeDatasetsDraw(ch) {
        const ca = ch.chartArea, ctx = ch.ctx, meta = ch.getDatasetMeta(0);
        if (!meta || !meta.data.length) return;
        ctx.save();
        ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); // tom mais escuro
        const top = ca.top - 2, bottom = ca.bottom + 24; // desce até abaixo das datas do eixo X
        labels.forEach((lab, i) => {
          if (!MONTH_END_WEEKS.includes(lab) || !meta.data[i]) return;
          const bar = meta.data[i], w = (bar.width || 40) + 40; // largo o bastante p/ não cortar os rótulos laterais das barras
          ctx.strokeRect(bar.x - w / 2, top, w, bottom - top);
        });
        ctx.setLineDash([]);
        ctx.restore();
      },
    };
    // rótulos das barras: dentro do segmento se couber; se a fatia for fina, empilha o % à direita da barra
    const payBarLabels = {
      id: 'payBarLabels',
      afterDatasetsDraw(ch) {
        const ctx = ch.ctx;
        const fam = (Chart.defaults.font && Chart.defaults.font.family) || 'sans-serif';
        for (let i = 0; i < ch.data.labels.length; i++) {
          const side = []; let barRight = null;
          catsFor().forEach((c, di) => {
            const meta = ch.getDatasetMeta(di); const el = meta && meta.data[i];
            if (!el) return;
            const val = ch.data.datasets[di].data[i];
            if (!val || val <= 0) return;
            const cp = el.getCenterPoint(), h = el.height;
            barRight = el.x + el.width / 2;
            const txt = (mode === 'pct' ? Math.round(val) + '%' : (mode === 'rs' ? fmtRS(val) : String(val)));
            if (h >= 13) { // cabe dentro do segmento
              ctx.save();
              ctx.font = '700 10px ' + fam;
              ctx.fillStyle = c.key === 'pending' ? '#374151' : '#fff';
              ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              ctx.fillText(txt, cp.x, cp.y);
              ctx.restore();
            } else { // fatia fina — desenha ao lado
              side.push({ y: cp.y, txt, color: c.key === 'pending' ? '#6B7280' : c.color });
            }
          });
          if (side.length && barRight != null) {
            side.sort((a, b) => a.y - b.y);
            ctx.save();
            ctx.font = '700 9px ' + fam; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            let lastY = -1e9; const gap = 11;
            for (const s of side) {
              let y = s.y; if (y - lastY < gap) y = lastY + gap; lastY = y; // empilha p/ não sobrepor
              ctx.fillStyle = s.color; ctx.fillText(s.txt, barRight + 4, y);
            }
            ctx.restore();
          }
        }
      },
    };
    // totalizador no topo de cada barra: 100% (pct) · soma de pagamentos (abs) · soma em R$ (rs)
    const payTotals = {
      id: 'payTotals',
      afterDatasetsDraw(ch) {
        const ctx = ch.ctx, yScale = ch.scales.y, meta0 = ch.getDatasetMeta(0), ca = ch.chartArea;
        const fam = (Chart.defaults.font && Chart.defaults.font.family) || 'sans-serif';
        ctx.save();
        ctx.font = '700 12px ' + fam; ctx.fillStyle = '#111827'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        for (let i = 0; i < ch.data.labels.length; i++) {
          const bar = meta0.data[i]; if (!bar) continue;
          const sum = ch.data.datasets.reduce((s, ds) => s + (ds.data[i] || 0), 0);
          // pct: mostra o nº total de pagamentos esperados (mesmo da visão absoluta), não "100%"
          const txt = mode === 'pct' ? String(totals[i]) : (mode === 'rs' ? fmtRS(sum) : String(Math.round(sum)));
          const y = mode === 'pct' ? (ca.top - 16) : (yScale.getPixelForValue(sum) - 6);
          ctx.fillText(txt, bar.x, y);
        }
        ctx.restore();
      },
    };
    function datasetsFor() {
      return catsFor().map((c) => {
        let data;
        if (mode === 'rs') data = weeks.map((w) => Math.round(rsValue(w, c.key)));
        else { const raw = weeks.map((w) => w.counts[c.key]); data = mode === 'pct' ? raw.map((v, i) => (totals[i] ? Math.round((v / totals[i]) * 1000) / 10 : 0)) : raw; }
        return {
          label: c.label, data, backgroundColor: c.color, stack: 'w', maxBarThickness: 60,
          datalabels: { display: false }, // rótulos desenhados pelo plugin payBarLabels (dentro se couber, ao lado se fino)
        };
      });
    }
    function renderDetail() {
      if (selWeekIdx == null) { detailEl.innerHTML = ''; return; }
      const w = weeks[selWeekIdx];
      detailEl.innerHTML = `<div class="pay-detail-title">Week of ${fmtDMY(w.date)} <button type="button" id="payDetailClose">&times;</button></div>` +
        '<div class="pay-detail-grid">' + CATS.map((c) => {
          const names = (w.names && w.names[c.key]) || [];
          if (!names.length) return '';
          return `<div class="pay-detail-col"><div class="pay-detail-cat" style="color:${c.color}">${c.label} (${names.length})</div>` +
            names.map((n) => {
              const val = c.key === 'pending' ? n.esperado : n.recebido; // pago/atraso: recebido; pendente: valor devido
              const valStr = (val != null) ? ` <span style="color:var(--text-2);font-variant-numeric:tabular-nums;font-size:12px">R$ ${Number(val).toFixed(2).replace('.', ',')}</span>` : '';
              return `<div class="pay-detail-name">${n.nome} <span class="pay-detail-plate">${n.placa}</span>${valStr}</div>`;
            }).join('') + '</div>';
        }).join('') + '</div>';
      const closeBtn = document.getElementById('payDetailClose');
      if (closeBtn) closeBtn.addEventListener('click', () => { selWeekIdx = null; renderDetail(); });
    }
    function render() {
      if (chart) chart.destroy();
      chart = new Chart(document.getElementById('chartPayments'), {
        type: 'bar',
        data: { labels, datasets: datasetsFor() },
        plugins: [payBarLabels, payTotals],
        options: {
          responsive: true, maintainAspectRatio: false, layout: { padding: { top: 30, right: 20 } },
          onClick: (evt, els) => { if (!els.length) return; selWeekIdx = els[0].index; renderDetail(); },
          onHover: (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
          plugins: {
            legend: { display: false }, datalabels: { clamp: true },
            tooltip: { callbacks: {
              title: (it) => 'Week of ' + labels[it[0].dataIndex],
              label: (c) => c.dataset.label + ': ' + (mode === 'rs' ? 'R$ ' + Math.round(c.parsed.y).toLocaleString('pt-BR') : c.parsed.y + (mode === 'pct' ? '%' : '')),
              afterBody: () => 'Click for names',
            } },
          },
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { color: TXT2 } },
            y: { stacked: true, beginAtZero: true, max: mode === 'pct' ? 100 : undefined, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, precision: 0, callback: (v) => (mode === 'pct' ? v + '%' : (mode === 'rs' ? 'R$' + Math.round(v / 1000) + 'k' : v)) } },
          },
        },
      });
      renderDetail();
    }
    const paySel = document.getElementById('payViewSelect');
    if (paySel) paySel.value = 'pct'; // reflete o padrão Percentage no dropdown
    paySel.addEventListener('change', (e) => { mode = e.target.value; render(); });
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
          ? `<table class="rh-table"><thead><tr><th>Client</th><th>Plate</th><th>Event date</th><th>Ready for realloc.</th><th>Reallocation date</th><th>Reason</th><th>Details</th></tr></thead><tbody>` +
            rows.map((it) => `<tr><td>${it.cliente || '—'}</td><td class="util-plate-col">${it.placa || '—'}</td><td>${it.dataEvento}</td><td>${it.dataPronto}</td><td>${it.dataRecolocacao}</td><td>${it.motivo}</td><td class="redeploy-details">${it.detalhamento}</td></tr>`).join('') +
            '</tbody></table>'
          : '<div style="color:var(--text-2);font-size:13px">No records.</div>');
      const closeBtn = document.getElementById(closeId);
      if (closeBtn) closeBtn.addEventListener('click', () => { selIdx = null; renderDetail(); });
    }
    // média GERAL (todos os casos) num KPI fácil de ver, acima do gráfico
    if (section.overall) {
      const ovEl = document.getElementById(detailId.replace('Detail', 'Overall'));
      if (ovEl) ovEl.innerHTML =
        `<div class="redeploy-kpis">` +
        `<div class="redeploy-kpi"><div class="rk-v">${section.overall.total} <span class="rk-u">working days</span></div><div class="rk-l">Avg. time to put a car back on the road</div></div>` +
        `<div class="redeploy-kpi alt"><div class="rk-v">${section.overall.repair}</div><div class="rk-l">Avg. repair</div></div>` +
        `<div class="redeploy-kpi alt"><div class="rk-v">${section.overall.reloc}</div><div class="rk-l">Avg. relocation</div></div>` +
        `</div>`;
    }
    // total de dias do mês (reparo+recolocação) — rótulo no fim de cada barra horizontal
    const totalDays = section.labels.map((_, i) => Math.round(((section.avgRecupParaPronto[i] || 0) + (section.avgProntoParaAlocado[i] || 0)) * 10) / 10);
    // eixo Y: data do último dia do mês (fechados) e a data "as of" no mês vigente; mantém "n=X" na 2ª linha
    // (usa a data do snapshot, não new Date() — congelado mostra a data do freeze, não "hoje")
    const _cMk = asOfYear + '-' + String(asOfMonth).padStart(2, '0');
    const _dLbl = (mk) => {
      const y = +mk.slice(0, 4), m = +mk.slice(5), p = (n) => String(n).padStart(2, '0');
      return mk === _cMk ? p(asOfDay) + '/' + p(m) : p(new Date(y, m, 0).getDate()) + '/' + p(m);
    };
    const chartLabels = (section.monthKeys || []).length
      ? section.labels.map((lab, i) => [_dLbl(section.monthKeys[i]), lab[1]])
      : section.labels;
    new Chart(canvas, {
      type: 'bar',
      data: {
        labels: chartLabels,
        datasets: [
          // dois tons de roxo: escuro = tempo de reparo (evento→pronto), claro = tempo de recolocação (pronto→alocado)
          { label: 'Repair time', data: section.avgRecupParaPronto, backgroundColor: '#3A00A0', stack: 's', borderRadius: 3, maxBarThickness: 46,
            datalabels: { color: '#fff', font: { size: 11, weight: 700 }, display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, formatter: (v) => v } },
          { label: 'Relocation time', data: section.avgProntoParaAlocado, backgroundColor: '#9366FF', stack: 's', borderRadius: 3, maxBarThickness: 46,
            datalabels: { labels: {
              value: { color: '#fff', font: { size: 11, weight: 700 }, display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, formatter: (v) => v },
              total: { anchor: 'end', align: 'right', offset: 4, color: NAVY, font: { size: 12, weight: 700 }, display: (ctx) => totalDays[ctx.dataIndex] >= 0, formatter: (v, ctx) => totalDays[ctx.dataIndex] },
            } } },
        ],
      },
      options: {
        indexAxis: 'y', // barras HORIZONTAIS empilhadas
        responsive: true, maintainAspectRatio: false, layout: { padding: { right: 26 } },
        onClick: (evt, els, ch) => { const pts = ch.getElementsAtEventForMode(evt, 'index', { intersect: false, axis: 'y' }, true); if (pts.length) { selIdx = pts[0].index; renderDetail(); } }, // axis:'y' — barra horizontal: índice pelo eixo Y (senão pega o mês errado)
        onHover: (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
        plugins: {
          legend: { display: false }, datalabels: { clamp: true },
          tooltip: { callbacks: {
            title: (it) => section.labels[it[0].dataIndex][0] + ' · ' + section.total[it[0].dataIndex] + ' ' + itemNoun,
            label: (c) => c.dataset.label + ': ' + c.parsed.x + ' working days (avg)',
            afterBody: () => 'Click for the list',
          } },
        },
        scales: {
          x: { stacked: true, beginAtZero: true, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, precision: 0 }, title: { display: true, text: 'avg. working days', color: '#9ca3af', font: { size: 11 } } },
          y: { stacked: true, grid: { display: false }, ticks: { color: TXT2 } },
        },
      },
    });
  }
  function initRedeployment() {
    if (redeployReady) return;
    redeployReady = true;
    const RD = OCN.redeployment;
    const wrapEl = document.getElementById('sub-redeployment');
    if (!RD || (!RD.combined && !RD.swaps)) {
      const cardEl = wrapEl && wrapEl.querySelector('.card');
      if (cardEl) cardEl.innerHTML = '<div style="color:var(--text-2);font-size:13px">No redeployment data (import_Time tab not available).</div>';
      return;
    }
    // Recoveries + Returns num único gráfico; Car swaps continua no data mas o card fica oculto (HTML)
    renderTimeSection(RD.combined, 'chartRecoveries', 'recoveriesDetail', 'cases', 'Event');
    renderTimeSection(RD.swaps, 'chartSwaps', 'swapsDetail', 'swaps', 'Swap');
  }

  // esconde a tela de loading quando o dashboard está pronto:
  // 1) completa a barra até 100% (.done, 0.25s), 2) fade out (.hidden, 0.35s), 3) display:none de garantia
  const _ld = document.getElementById('appLoading');
  if (_ld) {
    _ld.classList.add('done');
    setTimeout(() => { _ld.classList.add('hidden'); }, 260);
    setTimeout(() => { _ld.style.display = 'none'; }, 660);
  }

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

    // KPIs — taxa exibida como % (7%), não decimal (0,07)
    const taxaPct = (O.contratos.taxaCarroMesPct != null ? O.contratos.taxaCarroMesPct : Math.round(parseFloat(String(O.contratos.taxaCarroMes).replace(',', '.')) * 100)) + '%';
    document.getElementById('ocorKpis').innerHTML = `
      <div class="kpi-card"><div class="kpi-label"><i class="ti ti-alert-triangle"></i> Total incidents</div><div class="kpi-value">${O.total}</div><div class="kpi-sub">${O.foramOficina} went to the workshop</div></div>
      <div class="kpi-card"><div class="kpi-label"><i class="ti ti-shield-half"></i> With insurance claim</div><div class="kpi-value">${O.comSinistro}</div><div class="kpi-sub">${O.comSinistroPct}% of incidents</div></div>
      <div class="kpi-card"><div class="kpi-label"><i class="ti ti-clock-hour-4"></i> Rate</div><div class="kpi-value">${taxaPct}</div><div class="kpi-sub">incidents / car-month</div></div>`;

    // Probability & contracts
    const c = O.contratos;
    document.getElementById('ocorTaxaDesc').textContent = c.taxaTexto;
    document.getElementById('ocorContratos').innerHTML = `
      <div class="mini-stat"><div class="v">${c.totalContratos}</div><div class="l">contracts (${c.ativos} active)</div></div>
      <div class="mini-stat"><div class="v">${taxaPct}</div><div class="l">incidents/car-month</div></div>
      <div class="mini-stat"><div class="v">${c.rescindidos}</div><div class="l">terminated contracts</div></div>`;

    // plugin: total no centro da rosquinha
    const centerText = (total) => ({
      id: 'centerText',
      afterDraw(chart) {
        const meta = chart.getDatasetMeta(0);
        if (!meta.data.length) return;
        const { x, y } = meta.data[0];
        const ctx = chart.ctx;
        ctx.save();
        ctx.font = '700 26px ' + ((Chart.defaults.font && Chart.defaults.font.family) || 'sans-serif');
        ctx.fillStyle = '#111827';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(total), x, y);
        ctx.restore();
      },
    });

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
      plugins: [centerText(O.total)],
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '56%',
        plugins: { legend: { display: false }, datalabels: { color: (ctx) => txtOn(ctx.dataset.backgroundColor[ctx.dataIndex]), font: { size: 13, weight: 600 }, formatter: (v) => Math.round((v / O.total) * 100) + '%' }, tooltip: { callbacks: { label: (x) => `${x.label}: ${Math.round((x.parsed / O.total) * 100)}% (${x.parsed})` } } },
      },
    });

    // Incidents per month — barras empilhadas por TIPO (mesma separação do donut);
    // toggle Accumulated (default, fecha no total histórico) × Monthly.
    const OM = O.mensal;
    const mensalCard = document.getElementById('chartOcorMensal') && document.getElementById('chartOcorMensal').closest('.card');
    if (!OM || !OM.values || !OM.values.length) {
      if (mensalCard) mensalCard.style.display = 'none';
    } else {
      const noteEl = document.getElementById('ocorMensalNote');
      if (noteEl && OM.semData > 0) noteEl.textContent = `${OM.semData} of ${O.total} incidents have no event date in the sheet and are not plotted yet.`;
      const tipos = OM.porTipo || [];
      // legenda de tipos (mesmas cores do donut)
      const legEl = document.getElementById('ocorMensalLegend');
      if (legEl) legEl.innerHTML = tipos.map((t) => `<span class="it"><span class="sw" style="background:${t.cor}"></span> ${t.label}</span>`).join('');
      const accum = (arr) => arr.reduce((a, v, i) => { a.push((i > 0 ? a[i - 1] : 0) + v); return a; }, []);
      // total da pilha por mês (para o totalizador acima da barra)
      const totalsMonthly = OM.labels.map((_, i) => tipos.reduce((s, t) => s + (t.values[i] || 0), 0));
      const totalsAcc = accum(totalsMonthly);
      // dados das 3 linhas abaixo do gráfico: carros ativos/mês, taxa de incidents (%), e nº com sinistro (insurance claim)
      const FSd = OCN.fleetStatus;
      // carros ativos/mês: valor automático (fleetStatus) com opção de override manual do admin (base do % de incidents)
      const activeBase = (OM.monthKeys || []).map((mk) => { const j = (+mk.slice(5)) - 4; return (FSd && FSd.active && j >= 0 && j < FSd.active.length) ? FSd.active[j] : null; });
      const activeOvr = {}; // period (nº do mês) -> valor manual
      const activeArr = activeBase.slice();
      const applyActiveOvr = () => { for (let i = 0; i < activeArr.length; i++) { const mn = +OM.monthKeys[i].slice(5); activeArr[i] = (activeOvr[mn] != null) ? activeOvr[mn] : activeBase[i]; } };
      const _sinByMk = {};
      (O.casos || []).forEach((c) => { if (c.monthKey) _sinByMk[c.monthKey] = (_sinByMk[c.monthKey] || 0) + (c.sinistro ? 1 : 0); });
      const sinistroMonthly = (OM.monthKeys || []).map((mk) => _sinByMk[mk] || 0);
      const sinistroAcc = accum(sinistroMonthly);
      let curSinistroArr = sinistroMonthly;
      let stackTotals = totalsAcc;
      // linhas abaixo do eixo X (mesmo padrão dos gráficos de Fleet)
      const ocorRows = {
        id: 'ocorRows',
        afterDraw(chart) {
          const ctx = chart.ctx, xScale = chart.scales.x;
          const fam = (Chart.defaults.font && Chart.defaults.font.family) || 'sans-serif';
          const y1 = chart.chartArea.bottom + 32, y2 = y1 + 18, y3 = y2 + 18;
          ctx.save(); ctx.textBaseline = 'top';
          ctx.font = '600 9px ' + fam; ctx.fillStyle = '#6b7280'; ctx.textAlign = 'left';
          ctx.fillText('Active fleet', 0, y1 + 1);
          ctx.fillText('Incident rate', 0, y2 + 1);
          ctx.fillText('With insurance claim', 0, y3 + 1);
          ctx.textAlign = 'center';
          for (let i = 0; i < (OM.labels || []).length; i++) {
            const x = xScale.getPixelForValue(i), act = activeArr[i];
            ctx.font = '700 11px ' + fam;
            ctx.fillStyle = '#111827'; ctx.fillText(act != null ? String(act) : '—', x, y1);
            if (act) { const pct = Math.round((stackTotals[i] / act) * 1000) / 10; ctx.fillStyle = '#5A00F8'; ctx.fillText(String(pct).replace('.', ',') + '%', x, y2); }
            else { ctx.fillStyle = '#111827'; ctx.fillText('—', x, y2); }
            ctx.fillStyle = '#B91C1C'; ctx.fillText(String(curSinistroArr[i] || 0), x, y3);
          }
          ctx.restore();
        },
      };
      const stackTotalPlugin = {
        id: 'ocorStackTotal',
        afterDatasetsDraw(chart) {
          const ctx = chart.ctx, yScale = chart.scales.y;
          const meta = chart.getDatasetMeta(0);
          ctx.save();
          ctx.font = '700 12px ' + ((Chart.defaults.font && Chart.defaults.font.family) || 'sans-serif');
          ctx.fillStyle = '#111827'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          for (let i = 0; i < stackTotals.length; i++) {
            const tot = stackTotals[i];
            if (!tot || !meta.data[i]) continue;
            ctx.fillText(String(tot), meta.data[i].x, yScale.getPixelForValue(tot) - 4);
          }
          ctx.restore();
        },
      };
      let ocorMensalChart = null;
      function renderOcorMensal(mode) {
        stackTotals = mode === 'monthly' ? totalsMonthly : totalsAcc;
        curSinistroArr = mode === 'monthly' ? sinistroMonthly : sinistroAcc;
        const datasets = tipos.map((t) => ({
          label: t.label, data: mode === 'monthly' ? t.values : accum(t.values),
          backgroundColor: t.cor, stack: 'occ', borderRadius: 2, maxBarThickness: 70,
          datalabels: { display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, color: txtOnBar(t.cor), font: { size: 10, weight: 700 }, formatter: (v) => v },
        }));
        if (ocorMensalChart) ocorMensalChart.destroy();
        ocorMensalChart = new Chart(document.getElementById('chartOcorMensal'), {
          type: 'bar',
          data: { labels: OM.labels, datasets },
          plugins: [stackTotalPlugin, ocorRows],
          options: {
            responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24, bottom: 74 } },
            onClick: (evt, els) => {
              if (!els.length) return;
              const mk = (OM.monthKeys || [])[els[0].index];
              const tipoLabel = (tipos[els[0].datasetIndex] || {}).label || null; // categoria clicada
              // clicar de novo no mesmo mês+tipo limpa o filtro
              renderOcorDetail((selMonth === mk && selTipo === tipoLabel) ? null : mk, (selMonth === mk && selTipo === tipoLabel) ? null : tipoLabel);
            },
            onHover: (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
            plugins: {
              legend: { display: false }, datalabels: { clamp: true },
              tooltip: { callbacks: {
                label: (x) => `${x.dataset.label}: ${x.parsed.y}`,
                footer: (items) => (mode === 'monthly' ? 'Total: ' : 'Accumulated: ') + stackTotals[items[0].dataIndex],
              } },
            },
            scales: {
              x: { stacked: true, grid: { display: false }, ticks: { color: TXT2 } },
              y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(120,120,140,0.10)' }, ticks: { color: TXT2, precision: 0 }, title: { display: true, text: mode === 'monthly' ? 'incidents / month' : 'incidents (accumulated)', color: '#9ca3af', font: { size: 11 } } },
            },
          },
        });
      }
      renderOcorMensal('monthly');
      const omTg = document.getElementById('ocorMensalToggle');
      if (omTg) omTg.querySelectorAll('.range-btn').forEach((b) => b.addEventListener('click', () => {
        omTg.querySelectorAll('.range-btn').forEach((x) => x.classList.toggle('active', x === b));
        renderOcorMensal(b.dataset.range === 'monthly' ? 'monthly' : 'acc');
      }));
      // --- editor manual da "Active fleet" (base do % de incidents) — admin ---
      const ocEditBtn = document.getElementById('ocorActiveEditBtn'), ocEditEl = document.getElementById('ocorActiveEdit');
      if (ocEditBtn && ocEditEl && OCN._meta && OCN._meta.user && (OCN._meta.user.role === 'admin' || OCN._meta.user.role === 'giga_admin')) {
        ocEditBtn.style.display = 'inline-flex';
        let ocOpen = false;
        const ocInp = 'width:80px;padding:4px 6px;border:1px solid #d1d5db;border-radius:6px;font-size:13px';
        const ocSave = async () => {
          const msg = document.getElementById('ocEditMsg'); msg.textContent = 'Saving…';
          const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); });
          const jobs = [];
          for (let i = 0; i < (OM.labels || []).length; i++) {
            const mn = +OM.monthKeys[i].slice(5), inp = document.getElementById('ocA' + i); if (!inp) continue;
            const v = inp.value === '' ? null : Number(inp.value), cur = activeOvr[mn] != null ? activeOvr[mn] : null;
            if (v == null || v === activeBase[i]) { if (cur != null) jobs.push(post('/api/ue/value/delete', { fleet: '__ocor_active__', line: 'active', period: mn }).then(() => { delete activeOvr[mn]; })); }
            else if (v !== cur && isFinite(v) && v >= 0) { jobs.push(post('/api/ue/value', { fleet: '__ocor_active__', line: 'active', period: mn, value: v }).then(() => { activeOvr[mn] = v; })); }
          }
          try { await Promise.all(jobs); applyActiveOvr(); if (ocorMensalChart) ocorMensalChart.draw(); renderOcEditor(); const m2 = document.getElementById('ocEditMsg'); if (m2) m2.textContent = 'Saved.'; }
          catch (e) { msg.textContent = 'Error saving (' + e.message + ').'; }
        };
        function renderOcEditor() {
          if (!ocOpen) { ocEditEl.innerHTML = ''; return; }
          const rows = (OM.labels || []).map((lab, i) => { const mn = +OM.monthKeys[i].slice(5); return `<tr><td>${lab}</td><td><input type="number" min="0" step="1" id="ocA${i}" value="${activeArr[i] != null ? activeArr[i] : ''}" style="${ocInp}"></td><td style="color:var(--text-2)">${activeOvr[mn] != null ? 'manual' : ''}</td></tr>`; }).join('');
          ocEditEl.innerHTML = `<table class="rh-table" style="max-width:320px;margin-top:10px"><thead><tr><th>Month</th><th>Active fleet</th><th></th></tr></thead><tbody>${rows}</tbody></table><div style="margin-top:10px;display:flex;gap:8px;align-items:center"><button class="backbtn" id="ocSave" style="display:inline-flex"><i class="ti ti-check"></i> Save</button><button class="backbtn" id="ocCancel" style="display:inline-flex">Cancel</button><span id="ocEditMsg" style="font-size:12px;color:var(--text-2)"></span></div><div style="font-size:11.5px;color:var(--text-2);margin-top:6px">The incident rate (% below the chart) is recalculated from this value. Empty / equal to automatic returns to the computed value.</div>`;
          document.getElementById('ocCancel').addEventListener('click', () => { ocOpen = false; renderOcEditor(); });
          document.getElementById('ocSave').addEventListener('click', ocSave);
        }
        ocEditBtn.addEventListener('click', () => { ocOpen = !ocOpen; renderOcEditor(); });
      }
      // carrega overrides salvos e aplica
      fetch('/api/ue/values?fleet=__ocor_active__', { credentials: 'include' }).then((r) => r.json()).then((d) => { (d.values || []).forEach((o) => { if (o.line === 'active' && o.value != null) activeOvr[o.period] = o.value; }); applyActiveOvr(); if (ocorMensalChart) ocorMensalChart.draw(); }).catch(() => {});
      renderOcorDetail(null); // tabela mostra todos os casos por padrão
    }

    // tabela de detalhamento dos casos (cronológico decrescente); filtra por mês E por tipo
    var selMonth = null, selTipo = null;
    function renderOcorDetail(monthKey, tipoLabel) {
      selMonth = monthKey; selTipo = tipoLabel || null;
      const el = document.getElementById('ocorDetail');
      if (!el) return;
      const casos = O.casos || [];
      const rows = casos.filter((k) => (!monthKey || k.monthKey === monthKey) && (!selTipo || k.tipo === selTipo));
      const MES_ABR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthLabel = (mk) => { if (!mk) return ''; const m = +mk.slice(5) - 1; return (MES_ABR[m] || mk); };
      const scope = [monthKey ? monthLabel(monthKey) : '', selTipo || ''].filter(Boolean).join(' · ');
      const titleTxt = scope ? `${scope} (${rows.length})` : `All incidents (${rows.length})`;
      el.innerHTML =
        `<div class="pay-detail-title">${titleTxt}` + ((monthKey || selTipo) ? ` <button type="button" id="ocorDetailAll">show all</button>` : '') + `</div>` +
        (rows.length
          ? `<table class="rh-table"><thead><tr><th>Date</th><th>Plate</th><th>Client</th><th>Type</th><th>Claim ID</th><th>Workshop</th><th>Details</th></tr></thead><tbody>` +
            rows.map((k) => `<tr><td>${k.data}</td><td class="util-plate-col">${k.placa}</td><td>${k.cliente}</td>` +
              `<td><span class="ocor-type"><span class="ocor-dot" style="background:${k.tipoCor}"></span>${k.tipo}</span></td>` +
              `<td>${k.sinistroId || '—'}</td><td>${k.oficina}</td><td class="redeploy-details">${k.detalhamento}</td></tr>`).join('') +
            '</tbody></table>'
          : '<div style="color:var(--text-2);font-size:13px">No incidents match this filter.</div>');
      const allBtn = document.getElementById('ocorDetailAll');
      if (allBtn) allBtn.addEventListener('click', () => renderOcorDetail(null, null));
    }

    // Sinistro por tipo (barra empilhada horizontal) — tons de roxo
    const S = O.sinistroPorTipo;
    document.getElementById('legendSinistro').innerHTML = `<span class="dl-it"><span class="dl-sw" style="background:#5A00F8"></span>With insurance claim</span><span class="dl-it"><span class="dl-sw" style="background:#E0D8F7"></span>Without insurance claim</span>`;
    new Chart(document.getElementById('chartSinistro'), {
      type: 'bar',
      data: { labels: S.labels, datasets: [
        { label: 'With insurance claim', data: S.com, backgroundColor: '#5A00F8', stack: 's', borderRadius: 3, datalabels: { display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, color: '#fff', font: { size: 11, weight: 600 }, formatter: (v) => v } },
        { label: 'Without insurance claim', data: S.sem, backgroundColor: '#E0D8F7', stack: 's', borderRadius: 3, datalabels: { display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, color: '#5A2BB0', font: { size: 11, weight: 600 }, formatter: (v) => v } },
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
      plugins: [centerText(churnTotal)],
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '56%',
        plugins: { legend: { display: false }, datalabels: { color: (ctx) => txtOn(ctx.dataset.backgroundColor[ctx.dataIndex]), font: { size: 13, weight: 600 }, formatter: (v) => Math.round((v / churnTotal) * 100) + '%' }, tooltip: { callbacks: { label: (x) => `${x.label}: ${Math.round((x.parsed / churnTotal) * 100)}% (${x.parsed})` } } },
      },
    });
  }

  // ===================== UNIT ECONOMICS THEORIC (lazy init) =====================
  // Igual à UE real na aparência (reusa .ue-table/.ue-fleet-btn), mas dividido por MODELO
  // de carro (não por frota/placa) e com valores lançados MANUALMENTE. Só admin edita.
  let uetReady = false, uetModels = [], uetSel = null, uetVals = {}, uetManual = false, uetCurrency = 'BRL';
  const UET_PERIODS = 14; // M0..M13
  const UET_RECUR = 12;    // recorrências mensais (M1..M12)
  const UET_WPM = 52 / 12; // semanas por mês (~4,333)
  // MESMA estrutura de linhas do UE real: leaf (inflow/outflow) + calc (totalizadores)
  const UET_LINES = [
    { label: 'Subscription', group: 'inflow' },
    { label: 'Late-payment interest', group: 'inflow' },
    { label: 'Traffic fines', group: 'inflow' },            // espelho do UE real (sem cálculo teórico ainda)
    { label: 'Termination fee', group: 'inflow' },
    { label: 'Initial Fee / Vehicle Sell', group: 'inflow' },
    { label: 'Security Deposit Refund', group: 'inflow' },
    { label: 'Total Inflow', group: 'totalInflow' },
    { label: 'Subrental fee', group: 'outflow' },
    { label: 'Insurance', group: 'outflow' },
    { label: 'Car Preparation', group: 'outflow' },
    { label: 'Maintenance', group: 'outflow' },
    { label: 'GPS', group: 'outflow' },
    { label: 'Sticker', group: 'outflow' },
    { label: 'Security Deposit', group: 'outflow' },
    { label: 'Vehicle Purchase', group: 'outflow' },
    { label: 'Traffic fines (out)', group: 'outflow' },     // espelho do UE real
    { label: 'Recovery cost', group: 'outflow' },
    { label: 'Repair cost', group: 'outflow' },
    { label: 'Part Replacement', group: 'outflow' },
    { label: 'Total Outflow', group: 'totalOutflow' },
    { label: 'Net monthly cashflow', group: 'net' },
    { label: 'Acc Cashflow', group: 'acc' },
  ];
  // rótulo de exibição — a chave interna da saída de multas é distinta p/ não colidir com a entrada
  const UET_DISPLAY = { 'Traffic fines (out)': 'Traffic fines' };
  // parâmetros por linha (a "caixinha" do lápis) — mesma ideia do UE real; cada linha tem sua regra
  const UET_PARAMS = {
    'Subscription': [{ k: '__sub_semanal__', label: 'Weekly subscription fee (R$)' }, { k: '__sub_juros__', label: 'Late-payment interest (%)' }],
    'Subrental fee': [{ k: '__subrental_mensal__', label: 'Monthly Subrental fee (R$)' }],
    'Insurance': [{ k: '__ins_total__', label: 'Total insurance for the year (R$)' }, { k: '__ins_parcelas__', label: 'Number of installments (from M1)' }],
    'GPS': [{ k: '__gps_m0__', label: 'Amount at M0 (R$)' }, { k: '__gps_mensal__', label: 'Monthly amount, from M1 (R$)' }],
    'Security Deposit': [{ k: '__num_alugueis__', label: 'Number of rentals (deposit = N × monthly Subrental)' }],
    'Car Preparation': [{ k: '__car_prep__', label: 'Amount at M0 (R$)' }],
    'Sticker': [{ k: '__sticker__', label: 'Amount at M0 (R$)' }],
    'Vehicle Purchase': [{ k: '__vehicle__', label: 'Purchase/buyback amount (R$) — enters at M13' }],
    'Security Deposit Refund': [{ k: '__refund_pct__', label: 'Deposit refund correction (%)' }],
  };
  // ---- MOTOR de projeção do Theoric, extraído para ser reusado pelo P&L (Finance) ----
  // Funções puras: recebem o mapa de valores de UM modelo (vals) e o id do modelo.
  function uetPar(vals, k) { const v = vals[k + '@@0']; return v == null ? 0 : Number(v); }
  // Maintenance: km/semana agenda as revisões e joga o preço de cada revisão (varia por nº) no mês
  function uetMaint(vals, model) {
    const arr = {}; const kmWeek = uetPar(vals, '__km_semana__');
    const prices = (OCN.ue && OCN.ue.revisoes && OCN.ue.revisoes[model]) || [];
    if (kmWeek > 0 && prices.length) {
      const kmMonth = kmWeek * UET_WPM;
      prices.forEach((r) => { const km = r.km || (r.n * 10000); const mo = Math.ceil(km / kmMonth); if (mo >= 1 && mo <= UET_RECUR) arr[mo] = (arr[mo] || 0) + (r.valor || 0); });
    }
    return arr;
  }
  // valor projetado (COM sinal) de uma linha na IDADE p do contrato (M0..M13), a partir dos params/sliders
  function uetCell(vals, model, line, p, maint) {
    const par = (k) => uetPar(vals, k);
    const PMAX = UET_PERIODS - 1;
    const subMonthly = par('__sub_semanal__') * UET_WPM;
    switch (line) {
      case 'Subscription': return (p >= 1 && p <= UET_RECUR && par('__sub_semanal__') > 0) ? subMonthly * (1 - par('__inadimplencia__') / 100) : null;
      case 'Late-payment interest': return (p >= 1 && p <= UET_RECUR && par('__sub_semanal__') > 0) ? subMonthly * (par('__late_pct__') / 100) * (par('__sub_juros__') / 100) : null;
      case 'Initial Fee / Vehicle Sell': return (p === PMAX && par('__vehicle__') > 0) ? par('__vehicle__') * 1.03 : null;
      case 'Security Deposit Refund': { const dep = par('__num_alugueis__') * par('__subrental_mensal__'); return (p === PMAX && dep > 0) ? dep * (1 + par('__refund_pct__') / 100) : null; }
      case 'Subrental fee': return (p >= 1 && p <= UET_RECUR && par('__subrental_mensal__') > 0) ? -par('__subrental_mensal__') : null;
      case 'Insurance': { const total = par('__ins_total__'), N = Math.round(par('__ins_parcelas__')); return (total > 0 && N >= 1 && p >= 1 && p <= Math.min(N, UET_RECUR)) ? -(total / N) : null; }
      case 'Car Preparation': return (p === 0 && par('__car_prep__') > 0) ? -par('__car_prep__') : null;
      case 'Maintenance': return (maint[p] != null) ? -maint[p] : null;
      case 'GPS': if (p === 0 && par('__gps_m0__') > 0) return -par('__gps_m0__'); return (p >= 1 && p <= UET_RECUR && par('__gps_mensal__') > 0) ? -par('__gps_mensal__') : null;
      case 'Sticker': return (p === 0 && par('__sticker__') > 0) ? -par('__sticker__') : null;
      case 'Security Deposit': { const dep = par('__num_alugueis__') * par('__subrental_mensal__'); return (p === 0 && dep > 0) ? -dep : null; }
      case 'Vehicle Purchase': return (p === PMAX && par('__vehicle__') > 0) ? -par('__vehicle__') : null;
      default: return null;
    }
  }
  // valor EFETIVO: override manual da célula (magnitude) vence a projeção
  function uetEff(vals, model, lineObj, p, maint) {
    const ov = vals[lineObj.label + '@@' + p];
    if (ov != null) return (lineObj.group === 'outflow') ? -Math.abs(Number(ov)) : Math.abs(Number(ov));
    return uetCell(vals, model, lineObj.label, p, maint);
  }

  // ===================== FINANCE — P&L projection (lazy init) =====================
  // Visão de CAIXA em USD, consolidada de: (1) Fleet Plan (coortes: modelo + mês + qtd),
  // (2) UE por veículo de cada modelo — vem do Unit Economics Theoric (fonte única da verdade),
  // (3) Assumptions (impostos, payment fee, active rate, FX). Igual ao Excel: Security Deposit
  // e Vehicle Purchase NÃO entram no COGS (ficam em OPEX/capex).
  let finReady = false, finCohorts = [], finModels = [], finModelVals = {}, finCfg = {};
  let realFleetParams = {}, cfgReal = {}, refProfiles = null; // caixinhas reais por frota + perfis de referência
  let finHc = { roles: [], people: [], plan: {} }, finSga = { rent: [], prof: [], it: [] }, finCac = { perUnit: 0, ads: [], inf: [] };
  let finEdit = false; // "Edit mode" do Finance (compartilhado por todas as abas) — começa somente leitura
  let sgaTab = 'hc', cacTab = 'comm'; // abas de 3º nível dentro de SG&A e CAC & Marketing
  let pnlNoSd = false; // P&L: excluir o sub-rental security deposit da visão
  let pnlCollapsed = new Set(['grev', 'tax', 'cogs', 'opex', 'cac', 'sga', 'hc']); // grupos recolhidos (padrão: fechados)
  let pnlVersions = [], pnlVersion = 'live';
  let pnlSimScale = 100; // simulador de frota: % das entregas do Fleet Plan
  let pnlSimApply = false; // máscara: aplica a simulação na PRÓPRIA tabela do P&L
  let dashCharts = {}, dashLine = 'Subscription'; // gráficos do Dashboard + linha do explorador
  let finActCache = {}; // cache do realizado consolidado (por ano) — o solver chama computePnl em série // versões congeladas p/ board + versão selecionada
  const FIN_MONTHS = 12; // 2026-01 .. 2026-12
  const FIN_BASE_YEAR = 2026;                 // ano-base das coortes (índice absoluto de mês)
  let finYear = FIN_BASE_YEAR;                 // ano exibido no P&L / Fleet Plan (2026 ou 2027)
  const FIN_YOFF = () => (finYear - FIN_BASE_YEAR) * 12;   // deslocamento em meses do ano exibido
  const FIN_ML = (i) => finYear + '-' + String(i + 1).padStart(2, '0');
  const FIN_REV_LINES = ['Subscription', 'Late-payment interest', 'Traffic fines', 'Termination fee', 'Initial Fee / Vehicle Sell', 'Security Deposit Refund'];
  const FIN_COGS_LINES = ['Subrental fee', 'Maintenance', 'Insurance', 'GPS', 'Car Preparation', 'Sticker', 'Traffic fines (out)', 'Recovery cost', 'Repair cost', 'Part Replacement'];
  const FIN_ASSUMP = [
    { k: '__fin_tax_fed__', label: 'Federal taxes (% of gross revenue)', def: 13.36 },
    { k: '__fin_tax_credit__', label: 'Tax input credit (% of gross revenue)', def: 8.25 },
    { k: '__fin_payfee__', label: 'Payment processing fee (% of gross revenue)', def: 1.5 },
    { k: '__fin_decomm__', label: 'Monthly decommissioning (% of active fleet)', def: 0.725 },
    { k: '__fin_13th__', label: '13th + vacation factor (× December salary)', def: 1.3333 },
    { k: '__fin_fx__', label: 'FX (R$ per US$)', def: 5.5 },
  ];
  function initFinance() {
    if (finReady) return;
    finReady = true;
    // abas de 3º nível (uma por linha de despesa) dentro de SG&A e CAC & Marketing
    document.querySelectorAll('#sgaTabs .sub3-tab').forEach((b) => b.addEventListener('click', () => { sgaTab = b.dataset.t3; renderAdmin(); }));
    document.querySelectorAll('#cacTabs .sub3-tab').forEach((b) => b.addEventListener('click', () => { cacTab = b.dataset.t3; renderCac(); }));
    const escH = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
    const fmtNum = (v) => Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
    const fmt = (v) => (v == null) ? '' : (Math.round(v) === 0 ? '-' : (v < 0 ? '(' + fmtNum(v) + ')' : fmtNum(v)));
    const fmtQty = (v) => (v == null || Math.round(v) === 0) ? '-' : Math.round(v).toLocaleString('pt-BR');
    const parseInput = (raw) => { raw = String(raw).trim(); if (raw === '') return null; raw = raw.replace(/[R$\s]/gi, '').replace(/\./g, '').replace(',', '.'); const n = Number(raw); return isFinite(n) ? n : null; };
    const isAdmin = !!(OCN._meta && OCN._meta.user && (OCN._meta.user.role === 'admin' || OCN._meta.user.role === 'giga_admin'));
    const finPar = (k) => { const v = finCfg[k + '@@0']; if (v != null) return Number(v); const d = FIN_ASSUMP.find((a) => a.k === k); return d ? d.def : 0; };
    // assumption por MÊS: override em finCfg[k@@m]; senão o valor escalar (finPar). Ex.: processing fee mês a mês.
    const finParM = (k, m) => { const v = finCfg[k + '@@' + m]; return (v != null) ? Number(v) : finPar(k); };
    // ---- padrões compartilhados por TODAS as abas do Finance ----
    const FIN_MON3 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthLbl = (m) => { const p = String(FIN_ML(m)).split('-'); const mo = parseInt(p[1], 10) - 1; return (FIN_MON3[mo] || p[1]) + '-' + (p[0] || '').slice(2); }; // 2026-02 -> feb-26
    const canEditNow = () => isAdmin && finEdit;
    // toggle "Edit mode" (mesmo componente em todas as abas do Finance)
    const editBar = (note) => (isAdmin ? `<div class="fin-editbar${finEdit ? ' on' : ''}"><label class="fin-switch"><input type="checkbox" class="fin-edit-cb"${finEdit ? ' checked' : ''}><span class="fin-slider"></span></label><span class="fin-switch-lbl">Edit mode</span>${note ? `<span class="fin-editnote">${note}</span>` : ''}</div>` : '');
    function wireEditBar(root) {
      if (!root) return;
      root.querySelectorAll('.fin-edit-cb').forEach((cb) => cb.addEventListener('change', () => { finEdit = cb.checked; renderFinanceAll(); }));
    }
    function renderFinanceAll() { renderFleetPlan(); renderHc(); renderAdmin(); renderCac(); renderAssump(); renderPnl(); }
    // tabela totalizadora (uma linha por despesa) — visual diferenciado, usada em SG&A e CAC
    function totalsTable(rows, firstCol) {
      let h = `<div class="ue-table-wrap"><table class="ue-table fin-grid fin-totals"><thead><tr><th class="ue-rowlabel">${escH(firstCol || 'Cost line')}</th>`;
      for (let m = 0; m < FIN_MONTHS; m++) h += `<th>${monthLbl(m)}</th>`;
      h += '<th class="ue-totalcol">FY-26E</th></tr></thead><tbody>';
      const tot = new Array(FIN_MONTHS).fill(0);
      rows.forEach((r) => {
        let fy = 0;
        h += `<tr class="ue-row"><td class="ue-rowlabel">${escH(r.label)}</td>`;
        for (let m = 0; m < FIN_MONTHS; m++) { const v = Number(r.arr[m]) || 0; tot[m] += v; fy += v; h += `<td class="ue-cell">${v ? fmtNum(v) : '-'}</td>`; }
        h += `<td class="ue-cell ue-totalcol">${fy ? fmtNum(fy) : '-'}</td></tr>`;
      });
      const fyT = tot.reduce((a, b) => a + b, 0);
      h += '<tr class="hc-total"><td class="ue-rowlabel">Total</td>';
      for (let m = 0; m < FIN_MONTHS; m++) h += `<td class="ue-cell">${tot[m] ? fmtNum(tot[m]) : '-'}</td>`;
      return h + `<td class="ue-cell ue-totalcol">${fyT ? fmtNum(fyT) : '-'}</td></tr></tbody></table></div>`;
    }
    // custo total de folha por mês (mesma fórmula do P&L e do resumo do Headcount)
    function hcMonthlyCost() {
      hcEnsurePeople(); hcSyncPlan();
      const th13f = finPar('__fin_13th__') || 1.3333;
      const plan = finHc.plan || {};
      const out = new Array(FIN_MONTHS).fill(0);
      for (let m = 0; m < FIN_MONTHS; m++) {
        (finHc.roles || []).forEach((r) => {
          const n = plan[r.id] ? Number(plan[r.id][m]) || 0 : 0; if (!n) return;
          out[m] += n * ((r.salary || 0) + (r.meal || 0) + (r.health || 0) + (r.salary || 0) * ((r.taxPct || 0) / 100));
          if (m === FIN_MONTHS - 1) out[m] += n * ((r.salary || 0) * th13f + (r.bonus || 0));
        });
      }
      return out;
    }
    const sumItems = (list) => { const o = new Array(FIN_MONTHS).fill(0); (list || []).forEach((it) => { for (let m = 0; m < FIN_MONTHS; m++) o[m] += Number((it.v || [])[m]) || 0; }); return o; };
    const lineOf = (label) => UET_LINES.find((l) => l.label === label);

    // ---------- cálculo do P&L a partir das coortes + UE do Theoric (mecânica do Excel) ----------
    // - Semanas pagas = nº de SEGUNDAS-FEIRAS do mês (calendário 2026); no mês de recebimento,
    //   só as segundas a partir da semana de entrega (pro-rata). Receita = semanal × semanas × ativos.
    // - Subrental é pro-rata pelo billable ratio (semanas/segundas do mês). Maintenance/Insurance/GPS
    //   seguem a idade do contrato, sem pro-rata (como no Excel).
    // - Frota ativa decai pelo decomissionamento mensal (default 0,725%/mês).
    // - Mês de entrega = M1 do UE (recorrências), e os one-offs do M0 caem junto nele.
    const FIN_MONDAYS = (() => { const a = []; for (let mo = 0; mo < 12; mo++) { let n = 0; const d = new Date(finYear, mo, 1); while (d.getMonth() === mo) { if (d.getDay() === 1) n++; d.setDate(d.getDate() + 1); } a.push(n); } return a; })(); // 2026: [4,4,5,4,4,5,4,5,4,4,5,4]
    // segundas-feiras de um mês no dia >= `fromDay` (semanas pagas a partir do recebimento)
    const mondaysOnOrAfter = (moAbs, fromDay) => { const yy = FIN_BASE_YEAR + Math.floor(moAbs / 12), mo = ((moAbs % 12) + 12) % 12; let n = 0; const d = new Date(yy, mo, 1); while (d.getMonth() === mo) { if (d.getDay() === 1 && d.getDate() >= fromDay) n++; d.setDate(d.getDate() + 1); } return n; };
    const cohMonth = (c) => (c.date ? ((parseInt(c.date.slice(0, 4), 10) - FIN_BASE_YEAR) * 12 + parseInt(c.date.slice(5, 7), 10) - 1) : (c.month || 0));
    const cohDay = (c) => (c.date ? parseInt(c.date.slice(8, 10), 10) : 1);
    // ---- PERFIS DE REFERÊNCIA: projeção com as premissas do UE REALIZADO ----
    // Por modelo, o P&L projeta com o perfil por idade (M0..M13, R$/veículo) da frota de referência:
    // Polo = Frota 1 (mais madura), Argo = Frota 2, Tera = Frota 6 — exceto Recovery/Repair do Tera,
    // que vêm da Frota 1 (a 6 acabou de começar e teria peso demais nas entregas futuras, que são
    // quase todas Tera). Caixinhas reais + ritmos históricos (R$/dia por carro) da própria frota.
    const cpar = (k, def) => { const v = cfgReal[k + '@@0']; return v != null ? Number(v) : def; };
    function buildProfiles() {
      const U = OCN.ue || {};
      const REF = { Polo: '1', Argo: '2', Tera: '6' };
      const hojeD = new Date(((U.hoje) || new Date().toISOString().slice(0, 10)) + 'T12:00:00');
      const MS = 86400000, MESd = UET_WPM * 7; // 30,33 dias por "mês" do UE
      const inad = cpar('__inadimplencia__', 0) / 100;
      const late = cpar('__late_pct__', 0) / 100;
      const termPctF = cpar('__term_pct__', 50) / 100;
      const refundF = cpar('__refund_pct__', 0.13); // já é fração
      const partCfgF = {
        pastilhas: { km: cpar('__part_pastilhas_km__', 15), rs: cpar('__part_pastilhas_rs__', 250) },
        disco: { km: cpar('__part_disco_km__', 30), rs: cpar('__part_disco_rs__', 350) },
        pneus: { km: cpar('__part_pneus_km__', 50), rs: cpar('__part_pneus_rs__', 700) },
      };
      const out = {};
      Object.entries(REF).forEach(([model, fid]) => {
        const f = (U.fleets || []).find((x) => x.id === fid);
        if (!f || !f.inicio) return;
        const P = realFleetParams[fid] || {};
        const par = (k) => { const v = P[k + '@@0']; return v != null ? Number(v) : 0; };
        const plates = f.placas || [];
        const cars = Math.max(1, f.cars || plates.length || 1);
        const dias = Math.max(30, (hojeD - new Date(f.inicio + 'T12:00:00')) / MS);
        const sumBy = (bag, fn) => plates.reduce((s, pl) => s + ((bag && bag[pl]) || []).reduce((a, x) => a + fn(x), 0), 0);
        // ritmos históricos R$/dia POR CARRO da frota de referência
        const finesInDay = sumBy((U.multas || {}).placas, (x) => x.v) / dias / cars;
        const finesOutDay = sumBy((U.multasBase || {}).placas, (x) => x.v) / dias / cars;
        const recDay = sumBy((U.judBase || {}).placas, (x) => x.recovery || 0) / dias / cars;
        const repDay = sumBy((U.judBase || {}).placas, (x) => x.repair || 0) / dias / cars;
        const termDay = sumBy((U.judBase || {}).placas, (x) => x.term || 0) / dias / cars;
        // km/dia médio (odômetros da frota de referência) — base de Maintenance e Part Replacement
        let kmS = 0, kmN = 0;
        plates.forEach((pl) => { const d = (U.frota || {}).placas && U.frota.placas[pl]; if (d && d.ok && d.odo > 0) { kmS += d.odo; kmN++; } });
        const kmDia = kmN ? (kmS / kmN) / dias : 0;
        const A = () => new Array(UET_PERIODS).fill(0);
        const prof = {};
        const fee = par('__sub_semanal__');
        if (fee > 0) {
          prof['Subscription'] = A(); prof['Late-payment interest'] = A();
          for (let p = 1; p <= 12; p++) {
            prof['Subscription'][p] = fee * UET_WPM * (1 - inad);
            prof['Late-payment interest'][p] = fee * UET_WPM * late * 0.20; // entregas novas = contrato v3+ (20%)
          }
        }
        if (finesInDay > 0) { prof['Traffic fines'] = A(); for (let p = 1; p <= 13; p++) prof['Traffic fines'][p] = finesInDay * MESd; }
        if (finesOutDay > 0) { prof['Traffic fines (out)'] = A(); for (let p = 1; p <= 13; p++) prof['Traffic fines (out)'][p] = -finesOutDay * MESd; }
        if (termDay > 0) { prof['Termination fee'] = A(); prof['Termination fee'][13] = termDay * 12 * MESd * termPctF; }
        if (recDay > 0) { prof['Recovery cost'] = A(); for (let p = 1; p <= 12; p++) prof['Recovery cost'][p] = -recDay * MESd; }
        if (repDay > 0) { prof['Repair cost'] = A(); for (let p = 1; p <= 12; p++) prof['Repair cost'][p] = -repDay * MESd; }
        const subr = par('__subrental_mensal__');
        if (subr > 0) { prof['Subrental fee'] = A(); for (let p = 2; p <= 13; p++) prof['Subrental fee'][p] = -subr; } // 12 parcelas no dia 26: M2..M13
        const insT = par('__ins_total__'), insN = par('__ins_parcelas__');
        if (insT > 0 && insN >= 1) { prof['Insurance'] = A(); for (let p = 1; p <= Math.min(insN, 13); p++) prof['Insurance'][p] = -insT / insN; }
        const gps0 = par('__gps_m0__'), gpsM = par('__gps_mensal__');
        if (gps0 > 0 || gpsM > 0) { prof['GPS'] = A(); prof['GPS'][0] = -gps0; for (let p = 1; p <= 12; p++) prof['GPS'][p] = -gpsM; }
        prof['Car Preparation'] = A(); prof['Car Preparation'][0] = -50;
        prof['Sticker'] = A(); prof['Sticker'][0] = -15;
        const dep = par('__num_alugueis__') * subr;
        if (dep > 0) {
          prof['Security Deposit'] = A(); prof['Security Deposit'][0] = -dep;
          prof['Security Deposit Refund'] = A(); prof['Security Deposit Refund'][13] = dep * (1 + refundF);
        }
        const veh = par('__vehicle__');
        if (veh > 0) { prof['Initial Fee / Vehicle Sell'] = A(); prof['Initial Fee / Vehicle Sell'][13] = veh * 1.03; }
        // Maintenance: revisões a cada 10.000 km no ritmo da frota, preço do site −25%, +33d de prazo
        const prices = (U.revisoes || {})[model] || [];
        if (kmDia > 0 && prices.length) {
          prof['Maintenance'] = A();
          for (let n = 1; n <= 30; n++) {
            const pr = prices.find((x) => x.n === n); if (!pr) break;
            // corte pela REVISÃO (dentro do contrato); o pagamento com prazo pode cair no M13
            const revMo = Math.ceil(((n * 10000) / kmDia) / MESd);
            if (revMo > 12) break;
            const payMo = Math.min(13, Math.ceil(((n * 10000) / kmDia + 33) / MESd));
            prof['Maintenance'][Math.max(1, payMo)] += -pr.valor * 0.75;
          }
        }
        // Part Replacement: cruzamentos de km das peças no ritmo da frota
        if (kmDia > 0) {
          prof['Part Replacement'] = A();
          Object.values(partCfgF).forEach((cfg) => {
            const inter = (cfg.km || 0) * 1000; if (inter <= 0 || !(cfg.rs > 0)) return;
            for (let k = 1; k <= 60; k++) {
              const mo = Math.ceil((k * inter) / kmDia / MESd);
              if (mo > 12) break;
              prof['Part Replacement'][Math.max(1, mo)] += -cfg.rs;
            }
          });
        }
        out[model] = prof;
      });
      // exceção do Tera: números de recuperação/reparo ainda verdes — usa os do Polo (Frota 1)
      if (out.Tera && out.Polo) {
        if (out.Polo['Recovery cost']) out.Tera['Recovery cost'] = out.Polo['Recovery cost'];
        if (out.Polo['Repair cost']) out.Tera['Repair cost'] = out.Polo['Repair cost'];
      }
      return Object.keys(out).length ? out : null;
    }
    // Realizado consolidado de TODAS as placas por mês calendário de 2026 (em R$; o P&L converte).
    // sub/late = matriz de pagamentos (principal/juros pelo vencimento); finesIn = multas pagas
    // (data do pagamento); maint = notas do import_rev (vencimento); finesOut = multas_consolidado
    // (nosso vencimento). Só o que tem data concreta entra — estimativas ficam com o modelo.
    function finActuals() {
      const U = OCN.ue || {};
      const z = () => new Array(FIN_MONTHS).fill(0);
      const out = { sub: z(), late: z(), finesIn: z(), maint: z(), finesOut: z(), subr: z(), ins: z(), gps: z(), prep: z(), stick: z(), rec: z(), rep: z(), parts: z(), any: false };
      const moOf = (iso) => (iso && String(iso).slice(0, 4) === String(finYear)) ? parseInt(String(iso).slice(5, 7), 10) - 1 : null;
      const hojeD = new Date(((U.hoje) || new Date().toISOString().slice(0, 10)) + 'T12:00:00');
      const curMo = hojeD.getFullYear() === finYear ? hojeD.getMonth() : (hojeD.getFullYear() > finYear ? FIN_MONTHS - 1 : 0);
      const MS = 86400000;
      Object.values(((U.pagamentos || {}).placas) || {}).forEach((ws) => ws.forEach((s) => {
        const m = moOf(s.v); if (m == null) return;
        const esp = s.e != null ? s.e : (s.r != null ? s.r : 0);
        const rec = s.r != null ? s.r : esp;
        out.sub[m] += Math.min(rec, esp); out.late[m] += Math.max(0, rec - esp); out.any = true;
      }));
      Object.values(((U.multas || {}).placas) || {}).forEach((a) => a.forEach((x) => { if (!x.pago) return; const m = moOf(x.d); if (m == null) return; out.finesIn[m] += x.v; out.any = true; }));
      Object.values(((U.revBase || {}).placas) || {}).forEach((a) => a.forEach((r) => { if (!r.valor || !r.venc) return; const m = moOf(r.venc); if (m == null) return; out.maint[m] += r.valor; out.any = true; }));
      Object.values(((U.multasBase || {}).placas) || {}).forEach((a) => a.forEach((x) => { if (!x.venc) return; const m = moOf(x.venc); if (m == null) return; out.finesOut[m] += x.v; out.any = true; }));
      // Recuperação/Reparo (import_jud): data do evento; caso sem data cai no mês vigente
      Object.values(((U.judBase || {}).placas) || {}).forEach((a) => a.forEach((c) => {
        const m = c.d ? moOf(c.d) : curMo; if (m == null) return;
        out.rec[m] += c.recovery || 0; out.rep[m] += c.repair || 0; out.any = true;
      }));
      // Reposição de peças: eventos do site × custo configurado (todas — a divisão natural/atípica
      // já é aplicada no UE por placa; no consolidado do P&L mantém-se o custo cheio conservador)
      const pc = { pastilhas: cpar('__part_pastilhas_rs__', 250), disco: cpar('__part_disco_rs__', 350), pneus: cpar('__part_pneus_rs__', 700) };
      Object.values(((U.reposicao || {}).placas) || {}).forEach((a) => a.forEach((ev) => {
        const m = moOf(ev.d); if (m == null) return;
        (ev.itens || []).forEach((it) => { if (pc[it]) { out.parts[m] += pc[it]; out.any = true; } });
      }));
      // Linhas de AGENDA com os parâmetros REAIS de cada frota (caixinhas do UE): subrental (dia 26),
      // seguro (parcelas), GPS (M0 + mensal), preparação e adesivo (M0) — frota a frota, mês calendário.
      const losses = U.losses || {};
      (U.fleets || []).forEach((f) => {
        if (!f.inicio) return;
        const P = realFleetParams[f.id] || {};
        const par = (k) => { const v = P[k + '@@0']; return v != null ? Number(v) : 0; };
        const ini = new Date(f.inicio + 'T12:00:00');
        const cars = f.cars || (f.placas || []).length || 0;
        if (!cars) return;
        const lostBefore = (d) => (f.placas || []).reduce((n, pl) => n + ((losses[pl] && new Date(losses[pl] + 'T12:00:00') <= d) ? 1 : 0), 0);
        const m0 = moOf(f.inicio);
        if (m0 != null && ini <= hojeD) { out.prep[m0] += 50 * cars; out.stick[m0] += 15 * cars; out.any = true; }
        const subr = par('__subrental_mensal__');
        if (subr > 0) for (let i = 1; i <= 12; i++) {
          const d = new Date(ini.getFullYear(), ini.getMonth() + i, 26, 12);
          if (d > hojeD || d.getFullYear() !== finYear) continue;
          out.subr[d.getMonth()] += subr * Math.max(0, cars - lostBefore(d)); out.any = true;
        }
        const insT = par('__ins_total__'), insN = par('__ins_parcelas__');
        if (insT > 0 && insN >= 1) for (let n = 1; n <= insN; n++) {
          const d = new Date(ini.getTime() + (n - 0.5) * UET_WPM * 7 * MS);
          if (d > hojeD || d.getFullYear() !== finYear) continue;
          out.ins[d.getMonth()] += (insT / insN) * cars; out.any = true; // seguro paga pelos carros TOTAIS
        }
        const gps0 = par('__gps_m0__'), gpsM = par('__gps_mensal__');
        if (gps0 > 0 && m0 != null && ini <= hojeD) { out.gps[m0] += gps0 * cars; out.any = true; }
        if (gpsM > 0) for (let n = 1; n <= 12; n++) {
          const d = new Date(ini.getTime() + (n - 0.5) * UET_WPM * 7 * MS);
          if (d > hojeD || d.getFullYear() !== finYear) continue;
          out.gps[d.getMonth()] += gpsM * Math.max(0, cars - lostBefore(d)); out.any = true;
        }
      });
      return out;
    }
    function computePnl(opts) {
      opts = opts || {};
      const fx = finPar('__fin_fx__') || 5.5;
      const taxFed = finPar('__fin_tax_fed__') / 100, taxCred = finPar('__fin_tax_credit__') / 100;
      const payFeeM = (m) => finParM('__fin_payfee__', m) / 100, decomm = finPar('__fin_decomm__') / 100;
      const WEEKLY_LINES = { 'Subscription': 1, 'Late-payment interest': 1 };   // semanal × semanas pagas
      const BILLABLE_LINES = { 'Subrental fee': 1 };                            // mensal × billable ratio
      const maints = {}; finModels.forEach((m) => { maints[m.id] = uetMaint(finModelVals[m.id] || {}, m.id); });
      const zeros = () => new Array(FIN_MONTHS).fill(0);
      const rev = {}, cogs = {}; FIN_REV_LINES.forEach((l) => rev[l] = zeros()); FIN_COGS_LINES.forEach((l) => cogs[l] = zeros());
      const delivered = zeros(), active = zeros(), secDep = zeros(), vehPur = zeros();
      const scale = opts.scale || 1;               // simulador: multiplica as entregas do Fleet Plan
      const cohorts = opts.extra ? finCohorts.concat(opts.extra) : finCohorts; // coortes sintéticas (solver)
      for (let m = 0; m < FIN_MONTHS; m++) {
        cohorts.forEach((c) => {
          const cm = cohMonth(c);
          const M = FIN_YOFF() + m;                 // mês absoluto da coluna exibida (ano-base 2026)
          if (cm > M) return;
          const qty = c.qty * scale;
          delivered[m] += qty;
          const age = M - cm;                       // 0 = mês de recebimento
          const activeN = qty * Math.pow(1 - decomm, age);
          active[m] += activeN;
          const p = age + 1;                        // idade no UE (mês de entrega = M1)
          if (p > UET_PERIODS - 1) return;          // além do M13: contrato encerrado
          const vals = finModelVals[c.model] || {}, maint = maints[c.model] || {};
          const mondays = FIN_MONDAYS[m];
          const weeks = age === 0 ? mondaysOnOrAfter(cm, cohDay(c)) : mondays; // semanas pagas a partir da data
          const billable = mondays ? weeks / mondays : 0;
          // valor por veículo na idade `age`: PERFIL DA FROTA DE REFERÊNCIA (premissas do UE real);
          // fallback para o Theoric quando o perfil não tem a linha (ex.: caixinha ainda vazia)
          const prof = refProfiles && refProfiles[c.model];
          const val = (L, age_) => {
            if (prof && prof[L]) { const pv = prof[L][age_]; return pv || null; }
            const lo = lineOf(L); return lo ? uetEff(vals, c.model, lo, age_, maint) : null;
          };
          const add = (L, bag) => {
            let v = val(L, p);
            if (v != null) {
              if (WEEKLY_LINES[L]) v = (v / UET_WPM) * weeks;      // mensal -> semanal -> × semanas pagas
              else if (BILLABLE_LINES[L]) v = v * billable;        // pro-rata no mês de entrega
              bag[L][m] += (v * activeN) / fx;
            }
            if (age === 0) {                                        // one-offs do M0 caem no mês de entrega
              const v0 = val(L, 0);
              if (v0 != null) bag[L][m] += (v0 * qty) / fx;
            }
          };
          FIN_REV_LINES.forEach((L) => add(L, rev));
          FIN_COGS_LINES.forEach((L) => add(L, cogs));
          if (age === 0) { const v0 = val('Security Deposit', 0); if (v0 != null) secDep[m] += (v0 * qty) / fx; }
          { const vp = val('Vehicle Purchase', p); if (vp != null) vehPur[m] += (vp * activeN) / fx; }
        });
      }
      // ---- MESES DECORRIDOS: troca o modelo pelo REALIZADO consolidado da frota inteira ----
      // Mesmas fontes do UE real (matriz de pagamentos, multas, import_rev, multas_consolidado),
      // agregadas por mês CALENDÁRIO. Futuro continua vindo do Theoric; multas (que o Theoric não
      // modela) seguem no ritmo histórico R$/dia.
      const hojeIso = (OCN.ue && OCN.ue.hoje) || new Date().toISOString().slice(0, 10);
      const curM = hojeIso.slice(0, 4) === String(finYear) ? parseInt(hojeIso.slice(5, 7), 10) - 1 : (parseInt(hojeIso.slice(0, 4), 10) > finYear ? FIN_MONTHS - 1 : -1);
      const ACT = finActCache[finYear] || (finActCache[finYear] = finActuals());
      let actualsThrough = null;
      if (ACT.any && !opts.noActuals) {
        // mês VIGENTE = realizado até hoje + fração restante do mês projetada pelo modelo
        // (senão agosto no dia 3 mostraria só 3 dias de receita e pareceria um buraco)
        const dimCal = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        const diaHoje = parseInt(hojeIso.slice(8, 10), 10) || 1;
        const remFrac = Math.max(0, (dimCal[curM] - diaHoje) / dimCal[curM]);
        for (let m = 0; m <= curM && m < FIN_MONTHS; m++) {
          const blend = (arr, act) => (act / fx) + (m === curM ? (arr[m] || 0) * remFrac : 0);
          rev['Subscription'][m] = blend(rev['Subscription'], ACT.sub[m]);
          rev['Late-payment interest'][m] = blend(rev['Late-payment interest'], ACT.late[m]);
          rev['Traffic fines'][m] = blend(rev['Traffic fines'], ACT.finesIn[m]);
          cogs['Maintenance'][m] = blend(cogs['Maintenance'], -ACT.maint[m]);
          cogs['Traffic fines (out)'][m] = blend(cogs['Traffic fines (out)'], -ACT.finesOut[m]);
          // linhas de agenda com os parâmetros REAIS de cada frota (subrental/seguro/GPS/prep/adesivo)
          cogs['Subrental fee'][m] = blend(cogs['Subrental fee'], -ACT.subr[m]);
          cogs['Insurance'][m] = blend(cogs['Insurance'], -ACT.ins[m]);
          cogs['GPS'][m] = blend(cogs['GPS'], -ACT.gps[m]);
          cogs['Car Preparation'][m] = blend(cogs['Car Preparation'], -ACT.prep[m]);
          cogs['Sticker'][m] = blend(cogs['Sticker'], -ACT.stick[m]);
          cogs['Recovery cost'][m] = blend(cogs['Recovery cost'], -ACT.rec[m]);
          cogs['Repair cost'][m] = blend(cogs['Repair cost'], -ACT.rep[m]);
          cogs['Part Replacement'][m] = blend(cogs['Part Replacement'], -ACT.parts[m]);
        }
        const days = Math.max(1, (new Date(hojeIso + 'T12:00:00') - new Date('2026-04-01T12:00:00')) / 86400000);
        if (days > 30) {
          const inDay = ACT.finesIn.reduce((a, b) => a + b, 0) / days;
          const outDay = ACT.finesOut.reduce((a, b) => a + b, 0) / days;
          const dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
          for (let m = curM + 1; m < FIN_MONTHS; m++) {
            rev['Traffic fines'][m] = (inDay * dim[m]) / fx;
            cogs['Traffic fines (out)'][m] = -(outDay * dim[m]) / fx;
          }
        }
        actualsThrough = curM;
      }
      // visão "sem sub-rental security deposit": zera o calção E a devolução dele (refund) — os dois
      // lados da mesma moeda; deixar só um distorceria o cashflow
      if (opts.noSd) { secDep.fill(0); if (rev['Security Deposit Refund']) rev['Security Deposit Refund'].fill(0); }
      const grossRev = zeros(), cogsTot = zeros();
      for (let m = 0; m < FIN_MONTHS; m++) {
        FIN_REV_LINES.forEach((L) => grossRev[m] += rev[L][m]);
        FIN_COGS_LINES.forEach((L) => cogsTot[m] += cogs[L][m]);
        cogsTot[m] += secDep[m] + vehPur[m]; // calção e compra do veículo entram no COGS (como no UE)
      }
      const fed = grossRev.map((v) => -v * taxFed), cred = grossRev.map((v) => v * taxCred);
      const taxes = grossRev.map((_, m) => fed[m] + cred[m]);
      const netRev = grossRev.map((v, m) => v + taxes[m]);
      const payProc = grossRev.map((v, m) => -v * payFeeM(m));
      const gm = netRev.map((v, m) => v + cogsTot[m] + payProc[m]);
      // ---- OPEX: HC payroll + Admin + CAC + security deposit (todos negativos) ----
      const th13f = finPar('__fin_13th__');
      const hcOf = (r, m) => ((finHc.plan && finHc.plan[r.id]) ? Number(finHc.plan[r.id][m]) || 0 : 0);
      const base = zeros(), meal = zeros(), health = zeros(), ptax = zeros(), th13 = zeros(), bonus = zeros();
      for (let m = 0; m < FIN_MONTHS; m++) {
        (finHc.roles || []).forEach((r) => {
          const n = hcOf(r, m);
          base[m] -= n * r.salary; meal[m] -= n * r.meal; health[m] -= n * r.health;
          ptax[m] -= n * r.salary * (r.taxPct / 100);
          if (m === FIN_MONTHS - 1) { th13[m] -= n * r.salary * th13f; bonus[m] -= n * r.bonus; } // 13º e bônus em dezembro
        });
      }
      const hcTot = zeros(); for (let m = 0; m < FIN_MONTHS; m++) hcTot[m] = base[m] + meal[m] + health[m] + ptax[m] + th13[m] + bonus[m];
      // CAC (referenciado, como no Excel): comissão = USD/carro × carros ENTREGUES no mês;
      // Ads = soma dos canais; Influenciadores = nº de perfis do mês × preço por perfil.
      const newDelivered = zeros(); cohorts.forEach((c) => { const cm = cohMonth(c) - FIN_YOFF(); if (cm >= 0 && cm < FIN_MONTHS) newDelivered[cm] += c.qty * scale; });
      const commission = zeros(), adsTot = zeros(), infTot = zeros();
      for (let m = 0; m < FIN_MONTHS; m++) {
        commission[m] = -(finCac.perUnit || 0) * newDelivered[m];
        (finCac.ads || []).forEach((a) => { adsTot[m] -= Number((a.v || [])[m]) || 0; });
        (finCac.inf || []).forEach((t) => { infTot[m] -= (Number((t.profiles || [])[m]) || 0) * (t.price || 0); });
      }
      const cacTot = zeros(); for (let m = 0; m < FIN_MONTHS; m++) cacTot[m] = commission[m] + adsTot[m] + infTot[m];
      // SG&A – Admin: soma dos itens de cada tabela (Rent & Utilities / Professional Services / IT)
      const sumItems = (list) => { const a = zeros(); (list || []).forEach((it) => { for (let m = 0; m < FIN_MONTHS; m++) a[m] -= Number((it.v || [])[m]) || 0; }); return a; };
      const rentTot = sumItems(finSga.rent), profTot = sumItems(finSga.prof), itTot = sumItems(finSga.it);
      const sga = zeros(); for (let m = 0; m < FIN_MONTHS; m++) sga[m] = hcTot[m] + rentTot[m] + profTot[m] + itTot[m];
      const opex = zeros(); for (let m = 0; m < FIN_MONTHS; m++) opex[m] = cacTot[m] + sga[m]; // #2: secDep saiu daqui (foi pro COGS)
      const netCf = gm.map((v, m) => v + opex[m]);
      const accCf = []; let a1 = 0; netCf.forEach((v) => { a1 += v; accCf.push(a1); });
      // headcount total por mês (p/ o bloco de indicadores)
      const headcount = zeros(); for (let m = 0; m < FIN_MONTHS; m++) (finHc.roles || []).forEach((r) => { headcount[m] += hcOf(r, m); });
      const payFeePct = new Array(FIN_MONTHS).fill(0).map((_, m) => finParM('__fin_payfee__', m));
      return { delivered, active, rev, cogs, secDep, grossRev, fed, cred, taxes, netRev, cogsTot, payProc, gm,
        base, meal, health, ptax, th13, bonus, hcTot, commission, adsTot, infTot, cacTot, rentTot, profTot, itTot, sga, opex, netCf, accCf, newDelivered, headcount, payFeePct, actualsThrough, vehPur };
    }

    // ---------- P&L ----------
    const PNL_GROUPS = ['grev', 'tax', 'cogs', 'opex', 'cac', 'sga', 'hc'];
    const pnlSnap = () => (pnlVersions.find((v) => v.id === pnlVersion) || {}).snapshot || null;
    let pnlActualsThrough = null; // último mês calendário coberto por dados realizados
    function renderPnl() {
      const el = document.getElementById('pnlTable'); if (!el) return;
      const snap = (pnlVersion === 'live') ? null : pnlSnap();
      const live = !snap;
      const simOn = live !== false && pnlSimApply && pnlSimScale !== 100;
      const P = snap || computePnl({ noSd: pnlNoSd, scale: simOn ? pnlSimScale / 100 : 1 });
      const sum = (a) => a.reduce((s, x) => s + (x || 0), 0);
      const gmPct = P.grossRev.map((v, m) => (v ? (P.gm[m] / v) * 100 : null));
      // árvore de linhas (grupos colapsáveis) — #1
      const N = [];
      const push = (label, arr, cls, o) => N.push(Object.assign({ label, arr, cls: cls || 'ue-leaf', ancestors: [] }, o || {}));
      // Color code por NÍVEL: L1 = resultados (Gross/Net Revenue, Gross Margin, Net cashflow),
      // L2 = blocos (COGS, Payment processing, OPEX), L3 = componentes, L4 = detalhe dentro de um L3.
      push('Gross Revenue', P.grossRev, 'pnl-l1', { group: 'grev' });
      FIN_REV_LINES.forEach((L) => push(L === 'Traffic fines (out)' ? 'Traffic fines' : L, P.rev[L] || [], 'pnl-l3', { ancestors: ['grev'] }));
      push('Taxes on sales', P.taxes, 'pnl-l2', { group: 'tax' });
      push('Federal taxes', P.fed, 'pnl-l3', { ancestors: ['tax'] });
      push('Tax input credit', P.cred, 'pnl-l3', { ancestors: ['tax'] });
      push('Net Revenue', P.netRev, 'pnl-l1');
      push('COGS', P.cogsTot, 'pnl-l2', { group: 'cogs' });
      FIN_COGS_LINES.forEach((L) => push(L === 'Traffic fines (out)' ? 'Traffic fines' : L, P.cogs[L] || [], 'pnl-l3', { ancestors: ['cogs'] }));
      push('Sub-rental security deposit', P.secDep, 'pnl-l3', { ancestors: ['cogs'] });
      push('Vehicle Purchase', P.vehPur || [], 'pnl-l3', { ancestors: ['cogs'] });
      push('Payment processing', P.payProc, 'pnl-l2');
      push('Gross Margin', P.gm, 'pnl-l1', { pct: gmPct, pctTot: sum(P.grossRev) ? (sum(P.gm) / sum(P.grossRev)) * 100 : null });
      push('OPEX', P.opex, 'pnl-l2', { group: 'opex' });
      push('CAC', P.cacTot, 'pnl-l3', { group: 'cac', ancestors: ['opex'] });
      push('Sales commission', P.commission, 'pnl-l3', { ancestors: ['opex', 'cac'] });
      push('Google/Meta Ads', P.adsTot, 'pnl-l3', { ancestors: ['opex', 'cac'] });
      push('Digital Influencers', P.infTot, 'pnl-l3', { ancestors: ['opex', 'cac'] });
      push('SG&A', P.sga, 'pnl-l3', { group: 'sga', ancestors: ['opex'] });
      push('HC Payroll', P.hcTot, 'pnl-l3', { group: 'hc', ancestors: ['opex', 'sga'] });
      push('Base salary', P.base, 'pnl-l4', { ancestors: ['opex', 'sga', 'hc'] });
      push('Meal voucher', P.meal, 'pnl-l4', { ancestors: ['opex', 'sga', 'hc'] });
      push('Healthplan', P.health, 'pnl-l4', { ancestors: ['opex', 'sga', 'hc'] });
      push('Payroll taxes', P.ptax, 'pnl-l4', { ancestors: ['opex', 'sga', 'hc'] });
      push('13th + vacation', P.th13, 'pnl-l4', { ancestors: ['opex', 'sga', 'hc'] });
      push('Annual bonus', P.bonus, 'pnl-l4', { ancestors: ['opex', 'sga', 'hc'] });
      push('Rent & Utilities', P.rentTot, 'pnl-l3', { ancestors: ['opex', 'sga'] });
      push('Professional Services', P.profTot, 'pnl-l3', { ancestors: ['opex', 'sga'] });
      push('IT', P.itTot, 'pnl-l3', { ancestors: ['opex', 'sga'] });
      push('Net cashflow', P.netCf, 'pnl-l1');
      push('Acc. Net cashflow', P.accCf, 'pnl-l1 pnl-acc', { isAcc: true });

      // faixa de frota acima dos meses: carros ativos e quantos chegaram no mês
      let html = '<thead><tr class="pnl-fleetrow"><th class="ue-rowlabel">Fleet</th>';
      for (let m = 0; m < FIN_MONTHS; m++) {
        const act = Math.round(P.active[m] || 0), nw = Math.round((P.newDelivered || [])[m] || 0);
        html += `<th title="${act} active cars · ${nw} delivered this month"><span class="pnl-fl-act">${act || '–'}</span>${nw ? `<span class="pnl-fl-new">+${nw}</span>` : ''}</th>`;
      }
      html += `<th class="ue-totalcol"><span class="pnl-fl-act">${Math.round(P.delivered[FIN_MONTHS - 1] || 0)}</span></th></tr>`;
      html += '<tr><th class="ue-rowlabel">P&amp;L (USD)</th>';
      for (let m = 0; m < FIN_MONTHS; m++) html += `<th>${monthLbl(m)}</th>`;
      html += `<th class="ue-totalcol">FY-${String(finYear).slice(2)}E</th></tr></thead><tbody>`;
      N.forEach((n) => {
        if (n.ancestors.some((a) => pnlCollapsed.has(a))) return; // dentro de grupo recolhido
        const isParent = !!n.group, collapsed = isParent && pnlCollapsed.has(n.group);
        // seta fora do fluxo (absoluta, na borda esquerda) => rótulos do mesmo nível ficam alinhados
        const pad = 20 + n.ancestors.length * 14;
        const chev = isParent ? `<span class="pnl-chev">${collapsed ? '▸' : '▾'}</span>` : '';
        let tr = `<tr class="ue-row ${n.cls}${isParent ? ' pnl-parent' : ''}"${isParent ? ` data-g="${n.group}"` : ''}>`;
        tr += `<td class="ue-rowlabel" style="padding-left:${pad}px">${chev}${escH(n.label)}</td>`;
        // #2: o % vai como um número pequeno em cinza SOB o valor (sem linha própria)
        const sub = (v) => (n.pct && v != null) ? `<span class="pnl-sub">${Math.round(v)}%</span>` : '';
        for (let m = 0; m < FIN_MONTHS; m++) tr += `<td class="ue-cell">${n.isQty ? fmtQty(n.arr[m]) : fmt(n.arr[m])}${sub(n.pct ? n.pct[m] : null)}</td>`;
        const tot = (n.isQty || n.isAcc) ? n.arr[FIN_MONTHS - 1] : sum(n.arr);
        tr += `<td class="ue-cell ue-totalcol">${n.isQty ? fmtQty(tot) : fmt(tot)}${sub(n.pctTot)}</td>`;
        html += tr + '</tr>';
      });
      html += '</tbody>';
      el.innerHTML = html;
      el.querySelectorAll('.pnl-parent').forEach((tr) => tr.addEventListener('click', () => {
        const g = tr.dataset.g; if (pnlCollapsed.has(g)) pnlCollapsed.delete(g); else pnlCollapsed.add(g); renderPnl();
      }));
      pnlActualsThrough = (P.actualsThrough != null) ? P.actualsThrough : null;
      renderPnlControls(live);
      renderPnlExtras(P, live);
    }
    function renderPnlControls(live) {
      const ctl = document.getElementById('pnlControls'); if (!ctl) return;
      const opts = ['<option value="live"' + (pnlVersion === 'live' ? ' selected' : '') + '>● Live</option>']
        .concat(pnlVersions.map((v) => `<option value="${v.id}"${pnlVersion === v.id ? ' selected' : ''}>${escH(v.name)}</option>`)).join('');
      let h = '<div class="pnl-bar">';
      // seletor de ANO (2026 · 2027) — o P&L e o Fleet Plan seguem o ano escolhido
      h += '<div class="pnl-years">' + [FIN_BASE_YEAR, FIN_BASE_YEAR + 1].map((y) =>
        `<button class="pnl-yr${finYear === y ? ' on' : ''}" data-y="${y}">${y}</button>`).join('') + '</div>';
      h += `<select id="pnlVer" class="pnl-sel" title="Version">${opts}</select>`;
      if (isAdmin && live) h += '<button id="pnlSaveVer" class="pnl-btn" title="Freeze this P&L under a name (board presentation)">＋ Version</button>';
      if (isAdmin && !live) h += '<button id="pnlDelVer" class="pnl-btn pnl-del" title="Delete this frozen version">🗑</button>';
      if (live) h += `<button id="pnlNoSdBtn" class="pnl-btn${pnlNoSd ? ' on' : ''}" title="What-if view without the sub-rental security deposit (and its refund)">No deposit</button>`;
      h += `<button id="pnlExpand" class="pnl-btn" title="${pnlCollapsed.size ? 'Expand all groups' : 'Collapse all groups'}">${pnlCollapsed.size ? '⤢' : '⤡'}</button>`;
      h += '<button id="pnlAssump" class="pnl-btn" title="Tax rates, processing fee (global and per month), FX and other assumptions">⚙ Assumptions</button>';
      h += '<button id="pnlInfo" class="pnl-btn pnl-info" title="Where each line comes from and how it updates">?</button>';
      if (!live) { const v = pnlVersions.find((x) => x.id === pnlVersion); h += `<span class="pnl-frozen">📌 Frozen${v && v.savedAt ? ' · ' + v.savedAt.slice(0, 10) : ''}${v && v.snapshot && v.snapshot.noSd ? ' · no deposit' : ''}</span>`; }
      if (pnlActualsThrough != null) h += `<span class="pnl-act">actuals → ${monthLbl(pnlActualsThrough)}</span>`;
      if (live && pnlSimApply && pnlSimScale !== 100) h += `<span class="pnl-simchip">⚠ simulated · deliveries at ${pnlSimScale}%</span>`;
      h += '</div>';
      ctl.innerHTML = h;
      ctl.querySelectorAll('.pnl-yr').forEach((b) => b.addEventListener('click', () => {
        finYear = +b.dataset.y; finActCache = {}; refProfiles = buildProfiles(); renderPnl(); renderFleetPlan(); renderCac(); renderDash();
      }));
      const ab = document.getElementById('pnlAssump'); if (ab) ab.addEventListener('click', openAssumpModal);
      const ib = document.getElementById('pnlInfo'); if (ib) ib.addEventListener('click', openPnlInfo);
      const sel = document.getElementById('pnlVer'); if (sel) sel.addEventListener('change', () => { pnlVersion = sel.value; renderPnl(); });
      const nb = document.getElementById('pnlNoSdBtn'); if (nb) nb.addEventListener('click', () => { pnlNoSd = !pnlNoSd; renderPnl(); });
      const eb = document.getElementById('pnlExpand'); if (eb) eb.addEventListener('click', () => { if (pnlCollapsed.size) pnlCollapsed.clear(); else pnlCollapsed = new Set(PNL_GROUPS); renderPnl(); });
      const sv = document.getElementById('pnlSaveVer'); if (sv) sv.addEventListener('click', savePnlVersion);
      const dv = document.getElementById('pnlDelVer'); if (dv) dv.addEventListener('click', deletePnlVersion);
    }
    // ⚙ Assumptions — premissas globais + a taxa de processamento mês a mês (substitui a aba)
    function openAssumpModal() {
      const canEdit = isAdmin;
      const ov = document.createElement('div');
      ov.className = 'ue-modal-overlay';
      ov.innerHTML =
        `<div class="ue-modal ue-modal-assump"><div class="ue-modal-title">Assumptions</div>` +
        `<div class="ue-modal-sub">Global drivers of the P&amp;L. Per-vehicle revenue and costs come from the reference fleets.</div>` +
        `<div class="asm-grid">` + FIN_ASSUMP.map((a) =>
          `<label class="asm-item"><span class="asm-lbl">${escH(a.label)}</span>` +
          `<input class="asm-in" data-k="${a.k}" type="text" inputmode="decimal" value="${finPar(a.k)}"${canEdit ? '' : ' disabled'}></label>`
        ).join('') + `</div>` +
        `<div class="asm-sec">Payment processing fee — per month (%)</div>` +
        `<div class="asm-months">` + Array.from({ length: FIN_MONTHS }, (_, m) =>
          `<label class="asm-mo"><span>${monthLbl(m)}</span><input class="asm-fee" data-m="${m}" type="text" inputmode="decimal" value="${finParM('__fin_payfee__', m)}"${canEdit ? '' : ' disabled'}></label>`
        ).join('') + `</div>` +
        `<div class="ue-modal-hint">Each month falls back to the global processing fee above; clear a month to unlink it.</div>` +
        `<div class="ue-modal-actions"><button type="button" class="ue-modal-cancel">Close</button></div></div>`;
      document.body.appendChild(ov);
      const close = () => ov.remove();
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      ov.querySelector('.ue-modal-cancel').addEventListener('click', close);
      if (!canEdit) return;
      ov.querySelectorAll('.asm-in').forEach((inp) => inp.addEventListener('change', () => saveAssump(inp.dataset.k, inp.value)));
      ov.querySelectorAll('.asm-fee').forEach((inp) => inp.addEventListener('change', () => savePnlFee(+inp.dataset.m, inp.value)));
    }
    async function saveAssump(k, raw) {
      const num = parseInput(raw);
      try {
        if (num == null) { await fetch('/api/ue/value/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ fleet: '__fin_cfg__', line: k, period: 0 }) }); delete finCfg[k + '@@0']; }
        else { await fetch('/api/ue/value', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ fleet: '__fin_cfg__', line: k, period: 0, value: num, kind: 'proj' }) }); finCfg[k + '@@0'] = num; }
      } catch (e) {}
      renderPnl();
    }
    // "?" do P&L — de onde vem cada bloco e como se atualiza
    function openPnlInfo() {
      const R = [
        ['Delivered / Active fleet', 'Fleet Plan cohorts (calendar) − monthly decommissioning', 'Manual (calendar)'],
        ['Subscription · Late-payment', 'Past: real payments matrix of every plate. Future: reference-fleet profile × active cars', 'Auto, daily'],
        ['Traffic fines (in/out)', 'Past: fines API (received) and multas_consolidado (paid). Future: historical R$/day per car', 'Auto, daily'],
        ['Termination fee', 'import_jud (total charge − fines/tolls) × recovery % slider, at contract end (M13)', 'Auto, daily'],
        ['Maintenance', 'Past: import_rev invoices by due date. Future: km pace → revisions at −25%, paid after ~33 days', 'Auto, daily'],
        ['Subrental · Insurance · GPS · Prep · Sticker', 'Real per-fleet boxes of the Unit Economics, on their own schedules (subrental on the 26th, etc.)', 'Manual (UE boxes)'],
        ['Recovery · Repair', 'import_jud (towing+recovery / damages+cleaning+others) by event date', 'Auto, daily'],
        ['Part Replacement', 'Fleet site events + ⚙ Parts panel; future from each fleet\'s km pace', 'Auto / panel'],
        ['Taxes · Payment fee', 'Assumptions tab (federal, credit, processing fee — the fee is editable per month)', 'Manual'],
        ['HC Payroll', 'SG&A → Headcount: one row per employee × the cost table', 'Manual'],
        ['SG&A (Rent · Prof · IT)', 'SG&A tabs, item by item, month by month', 'Manual'],
        ['CAC', 'Commission = USD/car × deliveries of the month · Paid media and influencers from the CAC tabs', 'Manual + Fleet Plan'],
      ];
      const ov = document.createElement('div');
      ov.className = 'ue-modal-overlay';
      ov.innerHTML =
        `<div class="ue-modal ue-modal-info"><div class="ue-modal-title">Where the P&amp;L numbers come from</div>` +
        `<div class="ue-modal-sub">Months up to today use <b>actuals</b> from the whole fleet; the current month blends actuals with the remaining days. Later months are projected from the <b>reference fleets</b> (Polo=F1, Argo=F2, Tera=F6; Tera's repair/recovery from F1). Automatic sources refresh <b>daily at 05:00 (São Paulo)</b>.</div>` +
        `<table class="ue-info-table"><thead><tr><th>Block</th><th>Source</th><th>Updates</th></tr></thead><tbody>` +
        R.map(([a, b, c]) => `<tr><td>${a}</td><td>${b}</td><td>${c}</td></tr>`).join('') +
        `</tbody></table>` +
        `<div class="ue-modal-hint">Everything is converted to USD by the FX assumption (R$ ${finPar('__fin_fx__').toFixed(2).replace('.', ',')}/US$).</div>` +
        `<div class="ue-modal-actions"><button type="button" class="ue-modal-cancel">Close</button></div></div>`;
      document.body.appendChild(ov);
      const close = () => ov.remove();
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      ov.querySelector('.ue-modal-cancel').addEventListener('click', close);
    }
    // breakeven de VERDADE: ignora os meses antes da operação começar (jan/26 não conta) e exige
    // que o acumulado tenha ficado negativo antes de virar — senão "mês 1 sem operação" parece breakeven
    function pnlBreakeven(P) {
      const firstOp = (P.delivered || []).findIndex((d) => d > 0);
      if (firstOp < 0) return null;
      let wasNeg = false;
      for (let m = firstOp; m < FIN_MONTHS; m++) {
        const v = (P.accCf || [])[m] || 0;
        if (v < 0) wasNeg = true;
        else if (wasNeg) return m;
      }
      return null;
    }
    function pnlKpis(P) {
      const sum = (a) => (a || []).reduce((s, x) => s + (x || 0), 0);
      const firstOp = (P.delivered || []).findIndex((d) => d > 0);
      const opMonths = [];
      for (let m = 0; m < FIN_MONTHS; m++) if ((P.active || [])[m] > 0) opMonths.push(m);
      const beIdx = pnlBreakeven(P);
      // pico de caixa: o ponto mais fundo do acumulado — é o funding necessário para atravessar o vale
      let peak = 0, peakM = null;
      for (let m = Math.max(0, firstOp); m < FIN_MONTHS; m++) { const v = (P.accCf || [])[m] || 0; if (v < peak) { peak = v; peakM = m; } }
      const arpu = opMonths.length ? opMonths.reduce((s, m) => s + (P.grossRev[m] / P.active[m]), 0) / opMonths.length : 0;
      const totDeliv = (P.delivered || [])[FIN_MONTHS - 1] || 0;
      const cacUnit = totDeliv ? (-sum(P.cacTot)) / totDeliv : 0;
      const gmFY = sum(P.grossRev) ? (sum(P.gm) / sum(P.grossRev)) * 100 : 0;
      const opexPct = sum(P.grossRev) ? (-sum(P.opex) / sum(P.grossRev)) * 100 : 0;
      return { beIdx, peak, peakM, arpu, cacUnit, gmFY, opexPct, netFY: sum(P.netCf), eoy: (P.accCf || [])[FIN_MONTHS - 1] || 0, totDeliv, hcDec: (P.headcount || [])[FIN_MONTHS - 1] || 0 };
    }
    // caixa de UM carro ao longo da vida (M0..M13), pelo perfil de referência — "quanto vale 1 carro a mais"
    function carLifetime(model) {
      const prof = refProfiles && refProfiles[model];
      if (!prof) return null;
      const fx = finPar('__fin_fx__') || 5.5;
      let total = 0, cum = 0, payback = null;
      for (let p = 0; p < UET_PERIODS; p++) {
        let mSum = 0;
        Object.values(prof).forEach((arr) => { mSum += arr[p] || 0; });
        total += mSum; cum += mSum;
        if (payback == null && p > 0 && cum >= 0) payback = p;
      }
      return { total: total / fx, payback };
    }
    function renderPnlExtras(P, live) {
      const ex = document.getElementById('pnlExtras'); if (!ex) return;
      const K = pnlKpis(P);
      const tile = (label, val, sub, cls) => `<div class="pnl-kpi${cls ? ' ' + cls : ''}"><div class="pnl-kpi-v">${val}</div><div class="pnl-kpi-l">${escH(label)}</div><div class="pnl-kpi-s">${escH(sub || '')}</div></div>`;
      const money = (v) => (v < 0 ? '−' : '') + 'US$ ' + fmtNum(Math.abs(v));
      let h = '';
      // ---- só o essencial: caixa + unit economics ----
      h += '<div class="fin-sub">Cash</div><div class="pnl-kpis">';
      h += tile('Breakeven month', K.beIdx != null ? monthLbl(K.beIdx) : '—', K.beIdx != null ? 'acc. cashflow turns positive' : ('not within ' + finYear), K.beIdx != null ? 'pnl-good' : 'pnl-warn');
      h += tile('Peak funding need', money(K.peak), K.peakM != null ? ('deepest at ' + monthLbl(K.peakM)) : 'no negative dip', 'pnl-warn');
      h += tile('End-of-year cash', money(K.eoy), 'acc. net cashflow, ' + monthLbl(FIN_MONTHS - 1), K.eoy >= 0 ? 'pnl-good' : 'pnl-warn');
      h += '</div>';
      h += '<div class="fin-sub">Unit economics</div><div class="pnl-kpis">';
      h += tile('Revenue / active car', money(K.arpu), 'avg per month (ARPU)');
      h += tile('CAC per unit', money(K.cacUnit), K.totDeliv + ' cars delivered (FY)');
      h += tile('Gross margin', Math.round(K.gmFY) + '%', 'FY, over gross revenue');
      h += '</div>';
      // ---- simulador de frota (só na visão live) ----
      if (live) {
        h += '<div class="fin-sub">Fleet simulator</div>';
        h += `<div class="pnl-sim"><div class="pnl-sim-top"><span class="pnl-sim-lbl">Deliveries at</span>` +
          `<input type="range" id="pnlSimScale" min="50" max="200" step="5" value="${pnlSimScale}">` +
          `<span class="pnl-sim-val" id="pnlSimVal">${pnlSimScale}%</span>` +
          `<label class="pnl-sim-mask"><input type="checkbox" id="pnlSimApply"${pnlSimApply ? ' checked' : ''}> apply to the table</label>` +
          `<button class="pnl-btn" id="pnlBeSolver" title="How many extra cars to hit a target breakeven month">🎯 Breakeven target</button>` +
          `</div><div class="pnl-kpis" id="pnlSimOut"></div></div>`;
      }
      ex.innerHTML = h;
      if (live) {
        const sl = document.getElementById('pnlSimScale');
        const paint = () => {
          document.getElementById('pnlSimVal').textContent = pnlSimScale + '%';
          const S = pnlSimScale === 100 ? P : computePnl({ noSd: pnlNoSd, scale: pnlSimScale / 100 });
          const KS = pnlKpis(S);
          const d = (a, b) => (b - a);
          document.getElementById('pnlSimOut').innerHTML =
            tile('Breakeven', KS.beIdx != null ? monthLbl(KS.beIdx) : '—', K.beIdx != null && KS.beIdx != null ? (KS.beIdx === K.beIdx ? 'same as plan' : ((KS.beIdx < K.beIdx ? 'earlier' : 'later') + ' by ' + Math.abs(KS.beIdx - K.beIdx) + ' mo')) : '', KS.beIdx != null ? 'pnl-good' : 'pnl-warn') +
            tile('Peak funding', money(KS.peak), fmt(d(K.peak, KS.peak)) + ' vs plan', 'pnl-warn') +
            tile('End-of-year cash', money(KS.eoy), fmt(d(K.eoy, KS.eoy)) + ' vs plan', KS.eoy >= 0 ? 'pnl-good' : 'pnl-warn') +
            tile('Cars delivered', Math.round(KS.totDeliv), (pnlSimScale >= 100 ? '+' : '') + Math.round(KS.totDeliv - K.totDeliv) + ' vs plan');
        };
        if (sl) { sl.addEventListener('input', () => { pnlSimScale = +sl.value; paint(); }); paint(); }
        const ap = document.getElementById('pnlSimApply');
        if (ap) ap.addEventListener('change', () => { pnlSimApply = ap.checked; renderPnl(); });
        const bs = document.getElementById('pnlBeSolver');
        if (bs) bs.addEventListener('click', openBeSolver);
      }
    }
    // 🎯 solver: quantos carros A MAIS (numa data escolhida) para o breakeven bater no mês-alvo
    function openBeSolver() {
      const monthOpts = (sel) => Array.from({ length: FIN_MONTHS }, (_, m) => `<option value="${m}"${m === sel ? ' selected' : ''}>${monthLbl(m)}</option>`).join('');
      const modelOpts = ['Tera', 'Polo', 'Argo'].map((mo, i) => `<option value="${mo}"${i === 0 ? ' selected' : ''}>${mo}</option>`).join('');
      const curM = pnlActualsThrough != null ? pnlActualsThrough : 0;
      const ov = document.createElement('div');
      ov.className = 'ue-modal-overlay';
      ov.innerHTML =
        `<div class="ue-modal"><div class="ue-modal-title">🎯 Breakeven target</div>` +
        `<div class="ue-modal-sub">How many EXTRA cars (on top of the Fleet Plan) we would need to receive for the accumulated cashflow to turn positive by the target month.</div>` +
        `<div class="ue-modal-field"><label>Target breakeven month</label><select id="beTarget" class="pnl-sel">${monthOpts(FIN_MONTHS - 1)}</select></div>` +
        `<div class="ue-modal-field"><label>Extra cars delivered in</label><select id="beWhen" class="pnl-sel">${monthOpts(Math.min(curM + 1, FIN_MONTHS - 1))}</select></div>` +
        `<div class="ue-modal-field"><label>Model</label><select id="beModel" class="pnl-sel">${modelOpts}</select></div>` +
        `<div class="be-result" id="beResult">Pick the target and press Solve.</div>` +
        `<div class="ue-modal-actions"><button type="button" class="ue-modal-cancel">Close</button><button type="button" class="ue-modal-save" id="beRun">Solve</button></div></div>`;
      document.body.appendChild(ov);
      const close = () => ov.remove();
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      ov.querySelector('.ue-modal-cancel').addEventListener('click', close);
      ov.querySelector('#beRun').addEventListener('click', () => {
        const target = +ov.querySelector('#beTarget').value;
        const when = +ov.querySelector('#beWhen').value;
        const model = ov.querySelector('#beModel').value;
        const out = ov.querySelector('#beResult');
        const iso = finYear + '-' + String(when + 1).padStart(2, '0') + '-01';
        const beWith = (extra) => pnlBreakeven(computePnl({ noSd: pnlNoSd, extra: extra > 0 ? [{ id: '_sim', model, date: iso, qty: extra }] : null }));
        const base = beWith(0);
        if (base != null && base <= target) { out.innerHTML = `Already there: the plan breaks even at <b>${monthLbl(base)}</b> without extra cars.`; return; }
        // busca: passos crescentes até 3000 carros (checa monotonicidade na prática)
        let found = null;
        for (const e of [5, 10, 15, 20, 30, 40, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000]) {
          const be = beWith(e);
          if (be != null && be <= target) { found = e; break; }
        }
        if (found == null) { out.innerHTML = `Not achievable by ${monthLbl(target)} — even <b>+3.000 ${model}s</b> delivered in ${monthLbl(when)} don't turn the accumulated cash positive in time. The constraint is per-car economics/time, not volume.`; return; }
        // refina para o mínimo dentro do intervalo encontrado
        let lo = 0, hi = found;
        while (hi - lo > 1) { const mid = Math.ceil((lo + hi) / 2); const be = beWith(mid); if (be != null && be <= target) hi = mid; else lo = mid; }
        const be = beWith(hi);
        out.innerHTML = `<b>+${hi} ${model}${hi > 1 ? 's' : ''}</b> delivered in <b>${monthLbl(when)}</b> → breakeven at <b>${monthLbl(be)}</b>` + (base != null ? ` (plan alone: ${monthLbl(base)})` : ' (plan alone: no breakeven this year)');
      });
    }
    async function savePnlFee(m, raw) {
      const num = parseInput(raw);
      try {
        if (num == null && m !== 0) { await fetch('/api/ue/value/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ fleet: '__fin_cfg__', line: '__fin_payfee__', period: m }) }); delete finCfg['__fin_payfee__@@' + m]; }
        else { const v = num == null ? 0 : num; await fetch('/api/ue/value', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ fleet: '__fin_cfg__', line: '__fin_payfee__', period: m, value: v, kind: 'proj' }) }); finCfg['__fin_payfee__@@' + m] = v; }
      } catch (e) {}
      renderPnl(); renderAssump();
    }
    async function loadPnlVersions() {
      try { const r = await fetch('/api/finance/pnl-versions', { credentials: 'include' }); const d = await r.json(); pnlVersions = (d && d.versions) || []; } catch (e) { pnlVersions = []; }
    }
    async function savePnlVersion() {
      const name = window.prompt('Name this frozen version (e.g. the presentation date):', 'Board ' + (OCN.atualizadoEm || '').slice(0, 10));
      if (!name) return;
      const snap = computePnl({ noSd: pnlNoSd }); snap.noSd = pnlNoSd;
      try { const r = await fetch('/api/finance/pnl-versions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name, snapshot: snap }) }); const d = await r.json(); if (d && d.versions) { pnlVersions = d.versions; if (d.saved) pnlVersion = d.saved; } } catch (e) {}
      renderPnl();
    }
    async function deletePnlVersion() {
      const v = pnlVersions.find((x) => x.id === pnlVersion); if (!v) return;
      if (!window.confirm('Delete the frozen version "' + v.name + '"?')) return;
      try { const r = await fetch('/api/finance/pnl-versions/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ id: v.id }) }); const d = await r.json(); if (d && d.versions) pnlVersions = d.versions; } catch (e) {}
      pnlVersion = 'live'; renderPnl();
    }

    // ---------- Fleet Plan (coortes dinâmicas) ----------
    async function saveCohorts() {
      try {
        const r = await fetch('/api/finance/cohorts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ cohorts: finCohorts }) });
        const d = await r.json().catch(() => ({}));
        if (d && d.cohorts) finCohorts = d.cohorts;
      } catch (e) {}
      renderFleetPlan(); renderCac(); renderPnl(); // CAC re-renderiza: a comissão referencia as entregas
    }
    // ---------- Fleet Plan: CALENDÁRIO do ano (clica no dia p/ adicionar/remover carros) ----------
    // Uma coorte = um lote (data + modelo + qtd). O nº da frota (F1..) segue a ordem cronológica.
    let finSelDay = null; // dia ISO selecionado no editor
    const FIN_MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function renderFleetPlan() {
      const el = document.getElementById('fleetPlanWrap'); if (!el) return;
      const byDay = {}; // ISO -> { model: qty }
      finCohorts.forEach((c) => { const d = c.date || (finYear + '-01-01'); (byDay[d] = byDay[d] || {})[c.model] = ((byDay[d][c.model]) || 0) + c.qty; });
      const dayTot = (d) => Object.values(byDay[d] || {}).reduce((s, x) => s + x, 0);
      const modelColor = (id) => ((finModels.find((x) => x.id === id) || {}).color) || '#5A00F8';
      const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
      let cal = '<div class="fin-cal">';
      for (let mo = 0; mo < 12; mo++) {
        const first = new Date(finYear, mo, 1).getDay();
        const days = new Date(finYear, mo + 1, 0).getDate();
        let monthTot = 0, cells = '';
        for (let i = 0; i < first; i++) cells += '<div class="fc-day fc-empty"></div>';
        for (let dd = 1; dd <= days; dd++) {
          const iso = finYear + '-' + String(mo + 1).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
          const tot = dayTot(iso); monthTot += tot;
          const dots = (byDay[iso] ? Object.keys(byDay[iso]) : []).map((id) => `<span class="fc-dot" style="background:${modelColor(id)}"></span>`).join('');
          cells += `<div class="fc-day${tot ? ' fc-has' : ''}${iso === finSelDay ? ' fc-sel' : ''}" data-iso="${iso}"><span class="fc-n">${dd}</span>${tot ? `<span class="fc-qty">${tot}</span>` : ''}<span class="fc-dots">${dots}</span></div>`;
        }
        cal += `<div class="fc-month"><div class="fc-mh">${FIN_MN[mo]}${monthTot ? ` · <b>${monthTot}</b>` : ''}</div><div class="fc-wd">${WD.map((w) => `<span>${w}</span>`).join('')}</div><div class="fc-grid">${cells}</div></div>`;
      }
      cal += '</div>';
      let editor = '';
      if (finSelDay && canEditNow()) {
        editor = `<div class="fin-dayedit"><div class="sub2-title">${finSelDay} — vehicles received</div><div class="fin-dayrow">`;
        finModels.forEach((m) => {
          const q = (byDay[finSelDay] && byDay[finSelDay][m.id]) || 0;
          editor += `<label class="fin-dm"><span class="uet-dot" style="background:${m.color || '#5A00F8'}"></span>${escH(m.name)}<input class="fin-dq" type="number" min="0" step="1" data-model="${escH(m.id)}" value="${q || ''}" placeholder="0"></label>`;
        });
        editor += '</div><div class="fin-note">How many of each model arrive on this day (0 removes). A cohort = a batch on a day; F-numbers follow arrival order.</div></div>';
      } else if (canEditNow()) {
        editor = '<div class="fin-note">Click a day on the calendar to add or remove vehicles.</div>';
      }
      // evolução da frota por mês (saiu do P&L p/ cá): entregas do mês, acumulado entregue e ativos
      // (já com o decomissionamento mensal) — mesma matemática do P&L, então os números batem.
      const FP = computePnl();
      let evo = '<div class="sub2-title" style="margin-top:18px">Fleet evolution</div>';
      evo += '<div class="ue-table-wrap"><table class="ue-table fin-grid fin-totals"><thead><tr><th class="ue-rowlabel">Fleet</th>';
      for (let m = 0; m < FIN_MONTHS; m++) evo += `<th>${monthLbl(m)}</th>`;
      evo += '<th class="ue-totalcol">FY-26E</th></tr></thead><tbody>';
      const evoRow = (label, arr, isStock, cls) => {
        let s = `<tr class="ue-row${cls ? ' ' + cls : ''}"><td class="ue-rowlabel">${escH(label)}</td>`;
        for (let m = 0; m < FIN_MONTHS; m++) s += `<td class="ue-cell">${fmtQty(arr[m])}</td>`;
        const tot = isStock ? arr[FIN_MONTHS - 1] : arr.reduce((a, b) => a + (b || 0), 0);
        return s + `<td class="ue-cell ue-totalcol">${fmtQty(tot)}</td></tr>`;
      };
      evo += evoRow('New deliveries', FP.newDelivered, false);
      evo += evoRow('Total delivered fleet', FP.delivered, true);
      evo += evoRow('Total active fleet', FP.active, true, 'hc-total');
      evo += '</tbody></table></div><div class="fin-note">Active fleet already discounts the monthly decommissioning rate from Assumptions.</div>';

      const sorted = finCohorts.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      let list = '<div class="sub2-title" style="margin-top:18px">Cohorts (chronological)</div><div class="ue-table-wrap"><table class="ue-table"><thead><tr><th class="ue-rowlabel">Cohort</th><th>Date</th><th>Model</th><th class="ue-totalcol">Vehicles</th></tr></thead><tbody>';
      sorted.forEach((c, i) => {
        const mn = (finModels.find((x) => x.id === c.model) || {}).name || c.model;
        list += `<tr class="ue-row ue-leaf"><td class="ue-rowlabel">F${i + 1}</td><td>${c.date || '-'}</td><td>${escH(mn)}</td><td class="ue-cell ue-totalcol">${c.qty}</td></tr>`;
      });
      const totQ = finCohorts.reduce((s, c) => s + c.qty, 0);
      list += `<tr><td colspan="3" style="font-weight:700">Total</td><td class="ue-cell ue-totalcol" style="font-weight:700">${totQ}</td></tr></tbody></table></div>`;
      if (!finCohorts.length) list = '<div class="fin-note">No cohorts yet — click a day to add vehicles.</div>';
      el.innerHTML = editBar() + cal + editor + evo + list;
      wireEditBar(el);
      if (!canEditNow()) return;
      el.querySelectorAll('.fc-day[data-iso]').forEach((d) => d.addEventListener('click', () => { finSelDay = (finSelDay === d.dataset.iso ? null : d.dataset.iso); renderFleetPlan(); }));
      el.querySelectorAll('.fin-dq').forEach((inp) => inp.addEventListener('change', () => {
        const model = inp.dataset.model, qty = Math.max(0, Math.round(Number(inp.value) || 0));
        const idx = finCohorts.findIndex((c) => c.date === finSelDay && c.model === model);
        if (qty === 0) { if (idx >= 0) finCohorts.splice(idx, 1); }
        else if (idx >= 0) finCohorts[idx].qty = qty;
        else finCohorts.push({ id: 'c' + Date.now() + '_' + model, model, date: finSelDay, qty });
        saveCohorts();
      }));
    }

    // ---------- Assumptions ----------
    function renderAssump() {
      const el = document.getElementById('finAssumpWrap'); if (!el) return;
      const canEdit = canEditNow();
      let h = editBar();
      h += '<table class="rh-table fin-table" style="max-width:560px"><thead><tr><th>Assumption</th><th>Value</th></tr></thead><tbody>';
      FIN_ASSUMP.forEach((a) => {
        h += `<tr><td>${escH(a.label)}</td><td><input class="fin-ass" data-k="${a.k}" type="text" inputmode="decimal" value="${finPar(a.k)}"${canEdit ? '' : ' disabled'}></td></tr>`;
      });
      h += '</tbody></table><div class="fin-note">These drive the P&amp;L. Per-vehicle costs/revenue come from each model\'s Unit Economics Theoric.</div>';
      el.innerHTML = h;
      wireEditBar(el);
      if (!canEdit) return;
      el.querySelectorAll('.fin-ass').forEach((inp) => inp.addEventListener('change', async () => {
        const k = inp.dataset.k, num = parseInput(inp.value);
        try {
          if (num == null) { await fetch('/api/ue/value/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ fleet: '__fin_cfg__', line: k, period: 0 }) }); delete finCfg[k + '@@0']; }
          else { await fetch('/api/ue/value', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ fleet: '__fin_cfg__', line: k, period: 0, value: num, kind: 'proj' }) }); finCfg[k + '@@0'] = num; }
        } catch (e) {}
        renderAssump(); renderPnl();
      }));
    }

    // ---------- Headcount (cargos + plano mensal) ----------
    async function saveHc() {
      hcSyncPlan();
      try { const r = await fetch('/api/finance/hc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ hc: finHc }) }); const d = await r.json().catch(() => ({})); if (d && d.hc) finHc = d.hc; } catch (e) {}
      renderHc(); renderAdmin(); renderPnl();   // renderAdmin: atualiza o totalizador de SG&A
    }
    // HC model: `people` (1 row per employee, active timeline of 0 / 0.5 / 1) is the source of truth;
    // `plan` (aggregate headcount per role per month) is DERIVED from it and drives the P&L + summary.
    function hcExpandPlan(P) {
      const emps = []; let running = [];
      for (let m = 0; m < FIN_MONTHS; m++) {
        const t = Number((P || [])[m]) || 0;
        const full = Math.floor(t + 1e-9);
        const hasHalf = (t - full) > 0.4;
        const desired = full + (hasHalf ? 1 : 0);
        while (running.length > desired) running.pop();
        while (running.length < desired) { const e = { active: new Array(FIN_MONTHS).fill(0) }; emps.push(e); running.push(e); }
        running.forEach((e) => { e.active[m] = 1; });
        if (hasHalf) { const st = running.filter((e) => e.active.slice(0, m).every((v) => v === 0)); (st.length ? st[st.length - 1] : running[running.length - 1]).active[m] = 0.5; }
      }
      return emps.map((e) => e.active);
    }
    function hcEnsurePeople() {
      if (Array.isArray(finHc.people) && finHc.people.length) return;
      const people = [];
      (finHc.roles || []).forEach((r) => {
        hcExpandPlan((finHc.plan || {})[r.id]).forEach((active, idx) => people.push({ id: 'p' + r.id + '_' + idx, roleId: r.id, name: '', active }));
      });
      finHc.people = people;
    }
    function hcSyncPlan() {
      const plan = {};
      (finHc.roles || []).forEach((r) => { plan[r.id] = new Array(FIN_MONTHS).fill(0); });
      (finHc.people || []).forEach((p) => { if (!plan[p.roleId]) plan[p.roleId] = new Array(FIN_MONTHS).fill(0); for (let m = 0; m < FIN_MONTHS; m++) plan[p.roleId][m] += Number((p.active || [])[m]) || 0; });
      finHc.plan = plan;
    }
    function renderHc() {
      const el = document.getElementById('finHcWrap'); if (!el) return;
      const canEdit = canEditNow();
      const dis = canEdit ? '' : ' disabled';
      hcEnsurePeople(); hcSyncPlan();
      const roles = finHc.roles || [];
      const plan = finHc.plan || {};
      const th13f = finPar('__fin_13th__') || 1.3333;
      const hcOf = (r, m) => (plan[r.id] ? Number(plan[r.id][m]) || 0 : 0);
      const zeros = () => new Array(FIN_MONTHS).fill(0);
      const monthCols = () => { let s = ''; for (let m = 0; m < FIN_MONTHS; m++) s += `<th>${monthLbl(m)}</th>`; return s; };
      let h = editBar();

      // ---- Cost summary (spend per period, per cost type) — mirrors the P&L HC payroll lines ----
      const cSal = zeros(), cMeal = zeros(), cHealth = zeros(), cTax = zeros(), c13 = zeros(), cBonus = zeros(), head = zeros();
      for (let m = 0; m < FIN_MONTHS; m++) {
        roles.forEach((r) => {
          const n = hcOf(r, m); if (!n) return;
          head[m] += n;
          cSal[m] += n * (r.salary || 0);
          cMeal[m] += n * (r.meal || 0);
          cHealth[m] += n * (r.health || 0);
          cTax[m] += n * (r.salary || 0) * ((r.taxPct || 0) / 100);
          if (m === FIN_MONTHS - 1) { c13[m] += n * (r.salary || 0) * th13f; cBonus[m] += n * (r.bonus || 0); }
        });
      }
      const cTotal = zeros(); for (let m = 0; m < FIN_MONTHS; m++) cTotal[m] = cSal[m] + cMeal[m] + cHealth[m] + cTax[m] + c13[m] + cBonus[m];
      const money = (v) => (Math.round(v) === 0 ? '-' : fmtNum(v));
      const sumRow = (label, arr, cls) => { let s = `<tr class="${cls || ''}"><td class="ue-rowlabel">${label}</td>`; for (let m = 0; m < FIN_MONTHS; m++) s += `<td class="ue-cell ue-calc">${money(arr[m])}</td>`; return s + '</tr>'; };

      h += '<div class="fin-sub">Total spend per period (USD)</div>';
      h += '<div class="ue-table-wrap"><table class="ue-table hc-summary"><thead><tr><th class="ue-rowlabel">Cost type</th>' + monthCols() + '</tr></thead><tbody>';
      h += sumRow('Salaries', cSal) + sumRow('Meal voucher', cMeal) + sumRow('Health plan', cHealth) +
        sumRow('Payroll taxes', cTax) + sumRow('13th + vacation', c13) + sumRow('Bonus', cBonus) + sumRow('Total', cTotal, 'hc-total');
      h += '</tbody></table></div>';

      // ---- Table 1: headcount by EMPLOYEE & period (one row per person, visual presence bar) ----
      h += '<div class="fin-sub">Headcount by employee &amp; period</div>';
      h += '<div class="ue-table-wrap"><table class="ue-table hc-people"><thead><tr><th class="ue-rowlabel">Role</th><th>Name</th>' + monthCols() + '<th></th></tr></thead><tbody>';
      (finHc.people || []).forEach((p, i) => {
        h += `<tr class="ue-row ue-leaf"><td class="ue-rowlabel"><select class="hc-role" data-i="${i}"${dis}>` +
          roles.map((r) => `<option value="${r.id}"${r.id === p.roleId ? ' selected' : ''}>${escH(r.name)}</option>`).join('') + '</select></td>';
        h += `<td class="ue-cell"><input class="hc-pname" data-i="${i}" value="${escH(p.name || '')}"${dis} placeholder="—"></td>`;
        for (let m = 0; m < FIN_MONTHS; m++) {
          const v = Number((p.active || [])[m]) || 0;
          const prev = m === 0 ? 0 : (Number((p.active || [])[m - 1]) || 0);
          const isHire = (m === 0 || prev === 0);                    // 0.5 no início do vínculo = contratação (preenche à direita); no fim = demissão (à esquerda)
          const cls = v === 1 ? 'full' : (v === 0.5 ? (isHire ? 'halfR' : 'halfL') : 'off');
          const tip = v ? (v === 0.5 ? (isHire ? 'Half month — mid-month hire' : 'Half month — mid-month exit') : 'Active') : 'Inactive';
          h += `<td class="ue-cell hc-segcell"><button type="button" class="hc-seg hc-seg-${cls}" data-i="${i}" data-m="${m}"${dis ? ' disabled' : ''} title="${tip}"></button></td>`;
        }
        h += `<td class="ue-cell">${canEdit ? `<button class="fin-del hc-delp" data-i="${i}" title="Remove employee">✕</button>` : ''}</td></tr>`;
      });
      h += '<tr class="hc-total"><td class="ue-rowlabel">Total employees</td><td class="ue-cell"></td>';
      for (let m = 0; m < FIN_MONTHS; m++) { const v = head[m]; h += `<td class="ue-cell ue-calc">${v ? v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '-'}</td>`; }
      h += '<td class="ue-cell"></td></tr></tbody></table></div>';
      if (!(finHc.people || []).length) h += '<div class="fin-note">No employees yet — add roles below, then add employees and mark when each was active.</div>';
      if (canEdit) h += '<button class="ue-fleet-btn uet-add" id="finAddEmp" style="margin-top:10px">+ Add employee</button>';

      // ---- Table 2 (support): salaries & other costs per person, by role ----
      h += '<div class="fin-sub">Salaries &amp; costs per person <span class="fin-sub-tag">support table</span></div>';
      h += '<div class="ue-table-wrap"><table class="ue-table hc-support"><thead><tr><th class="ue-rowlabel">Role</th>' +
        '<th>Salary/mo</th><th>Meal/mo</th><th>Health/mo</th><th>Tax %</th><th>Bonus (Dec)</th><th></th></tr></thead><tbody>';
      roles.forEach((r, i) => {
        h += `<tr class="ue-row ue-leaf"><td class="ue-rowlabel"><input class="hc-f hc-rolename" data-i="${i}" data-f="name" value="${escH(r.name)}"${dis}></td>`;
        ['salary', 'meal', 'health', 'taxPct', 'bonus'].forEach((f) => { h += `<td class="ue-cell"><input class="hc-f hc-n" type="number" min="0" step="any" data-i="${i}" data-f="${f}" value="${r[f]}"${dis}></td>`; });
        h += `<td class="ue-cell">${canEdit ? `<button class="fin-del hc-delrole" data-i="${i}" title="Remove role">✕</button>` : ''}</td></tr>`;
      });
      h += '</tbody></table></div>';
      if (canEdit) h += '<button class="ue-fleet-btn uet-add" id="finAddRole" style="margin-top:10px">+ Add role</button>';
      h += '<div class="fin-note">One row per employee — click a month to toggle presence: <b>off → active → ½ → off</b>. A ½ charges half the cost that month; it fills the <b>right</b> half at the start of a contract (mid-month hire) and the <b>left</b> half at the end (mid-month exit). Costs per person come from the support table (USD). 13th + vacation and the annual bonus hit December.</div>';
      el.innerHTML = h;
      wireEditBar(el);
      if (!canEdit) return;
      // support table: role name + cost fields
      el.querySelectorAll('.hc-f').forEach((inp) => inp.addEventListener('change', () => {
        const r = finHc.roles[+inp.dataset.i]; if (!r) return; const f = inp.dataset.f;
        r[f] = (f === 'name') ? inp.value : Math.max(0, Number(inp.value) || 0);
        saveHc();
      }));
      // employee row: role dropdown, name, presence segments, delete
      el.querySelectorAll('.hc-role').forEach((s) => s.addEventListener('change', () => { const p = finHc.people[+s.dataset.i]; if (p) p.roleId = s.value; saveHc(); }));
      el.querySelectorAll('.hc-pname').forEach((inp) => inp.addEventListener('change', () => { const p = finHc.people[+inp.dataset.i]; if (p) p.name = inp.value; saveHc(); }));
      el.querySelectorAll('.hc-seg').forEach((b) => b.addEventListener('click', () => {
        const p = finHc.people[+b.dataset.i]; if (!p) return; const m = +b.dataset.m;
        const cur = Number((p.active || [])[m]) || 0;
        if (!Array.isArray(p.active)) p.active = new Array(FIN_MONTHS).fill(0);
        p.active[m] = cur === 0 ? 1 : (cur === 1 ? 0.5 : 0);
        saveHc();
      }));
      el.querySelectorAll('.hc-delp').forEach((b) => b.addEventListener('click', () => { finHc.people.splice(+b.dataset.i, 1); saveHc(); }));
      el.querySelectorAll('.hc-delrole').forEach((b) => b.addEventListener('click', () => {
        const r = finHc.roles[+b.dataset.i]; if (!r) return;
        finHc.people = (finHc.people || []).filter((p) => p.roleId !== r.id);
        finHc.roles.splice(+b.dataset.i, 1); saveHc();
      }));
      const addE = document.getElementById('finAddEmp');
      if (addE) addE.addEventListener('click', () => { finHc.people = finHc.people || []; finHc.people.push({ id: 'e' + Date.now(), roleId: (finHc.roles[0] || {}).id || '', name: '', active: new Array(FIN_MONTHS).fill(0) }); saveHc(); });
      const addR = document.getElementById('finAddRole');
      if (addR) addR.addEventListener('click', () => { finHc.roles.push({ id: 'r' + Date.now(), name: 'New role', salary: 0, meal: 0, health: 0, taxPct: 0, bonus: 0 }); saveHc(); });
    }


    // ---------- editor genérico: uma TABELA POR VARIÁVEL (itens de detalhe × 12 meses) ----------
    // itens editáveis (rótulo + valores mensais positivos), com FY, remover e adicionar — como no Excel.
    function itemsTable(title, items, onChange, opts) {
      opts = opts || {};
      const canEdit = canEditNow();
      const dis = canEdit ? '' : ' disabled';
      let h = `<div class="sub2-title" style="margin-top:18px">${escH(title)}</div>`;
      h += '<div class="ue-table-wrap"><table class="ue-table fin-grid"><thead><tr><th class="ue-rowlabel">' + escH(opts.itemLabel || 'Item') + '</th>';
      if (opts.priceCol) h += '<th class="fin-pricecol">Price/mo</th>';
      for (let m = 0; m < FIN_MONTHS; m++) h += `<th>${monthLbl(m)}</th>`;
      // a coluna de ação só existe em modo de edição — senão sobra uma coluna vazia na ponta
      h += '<th class="ue-totalcol">FY-26E</th>' + (canEdit ? '<th class="fin-actcol"></th>' : '') + '</tr></thead><tbody>';
      items.forEach((it, i) => {
        let tot = 0;
        const vals = opts.priceCol ? it.profiles : it.v;
        h += `<tr class="ue-row ue-leaf"><td class="ue-rowlabel"><input class="hc-f itx-label" data-i="${i}" value="${escH(it.label)}"${dis}></td>`;
        if (opts.priceCol) h += `<td class="ue-cell fin-pricecol"><input class="hc-f hc-n itx-price" type="number" min="0" step="any" data-i="${i}" value="${it.price}"${dis}></td>`;
        for (let m = 0; m < FIN_MONTHS; m++) {
          const n = Number((vals || [])[m]) || 0;
          tot += opts.priceCol ? n * (it.price || 0) : n;
          h += `<td class="ue-cell"><input class="hc-f hc-n itx-v" type="number" min="0" step="any" data-i="${i}" data-m="${m}" value="${n || ''}" placeholder="-"${dis}></td>`;
        }
        h += `<td class="ue-cell ue-totalcol">${tot ? fmtNum(tot) : '-'}</td>`;
        h += (canEdit ? `<td class="ue-cell fin-actcol"><button class="fin-del itx-del" data-i="${i}">✕</button></td>` : '') + '</tr>';
      });
      h += '</tbody></table></div>';
      if (canEdit) h += `<button class="ue-fleet-btn uet-add itx-add" style="margin-top:8px">+ Add item</button>`;
      const box = document.createElement('div');
      box.innerHTML = h;
      if (canEdit) {
        box.querySelectorAll('.itx-label').forEach((inp) => inp.addEventListener('change', () => { const it = items[+inp.dataset.i]; if (it) { it.label = inp.value; onChange(); } }));
        box.querySelectorAll('.itx-price').forEach((inp) => inp.addEventListener('change', () => { const it = items[+inp.dataset.i]; if (it) { it.price = Math.max(0, Number(inp.value) || 0); onChange(); } }));
        box.querySelectorAll('.itx-v').forEach((inp) => inp.addEventListener('change', () => {
          const it = items[+inp.dataset.i]; if (!it) return;
          const key = opts.priceCol ? 'profiles' : 'v';
          if (!Array.isArray(it[key])) it[key] = new Array(FIN_MONTHS).fill(0);
          it[key][+inp.dataset.m] = Math.max(0, Number(inp.value) || 0);
          onChange();
        }));
        box.querySelectorAll('.itx-del').forEach((b) => b.addEventListener('click', () => { items.splice(+b.dataset.i, 1); onChange(); }));
        const add = box.querySelector('.itx-add');
        if (add) add.addEventListener('click', () => {
          items.push(opts.priceCol ? { label: 'New item', price: 0, profiles: new Array(FIN_MONTHS).fill(0) } : { label: 'New item', v: new Array(FIN_MONTHS).fill(0) });
          onChange();
        });
      }
      return box;
    }

    // ---------- SG&A – Admin: Rent & Utilities / Professional Services / IT (uma tabela cada) ----------
    async function saveSga() {
      try { const r = await fetch('/api/finance/sga', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ sga: finSga }) }); const d = await r.json().catch(() => ({})); if (d && d.sga) finSga = d.sga; } catch (e) {}
      renderAdmin(); renderPnl();
    }
    // SG&A tem uma aba por linha de despesa: Headcount (payroll) + Rent & Utilities + Prof. Services + IT
    const SGA_TABS = {
      rent: { title: 'Rent & Utilities', get items() { return finSga.rent; } },
      prof: { title: 'Professional Services', get items() { return finSga.prof; } },
      it: { title: 'IT', get items() { return finSga.it; } },
    };
    function renderAdmin() {
      const el = document.getElementById('finAdminWrap'); if (!el) return;
      // totalizador de SG&A (uma linha por despesa) acima das abas
      const tot = document.getElementById('sgaTotals');
      if (tot) tot.innerHTML = totalsTable([
        { label: 'Headcount', arr: hcMonthlyCost() },
        { label: 'Rent & Utilities', arr: sumItems(finSga.rent) },
        { label: 'Professional Services', arr: sumItems(finSga.prof) },
        { label: 'IT', arr: sumItems(finSga.it) },
      ], 'SG&A cost line');
      document.querySelectorAll('#sgaTabs .sub3-tab').forEach((b) => b.classList.toggle('active', b.dataset.t3 === sgaTab));
      const hcWrap = document.getElementById('finHcWrap');
      const isHc = sgaTab === 'hc';
      if (hcWrap) hcWrap.style.display = isHc ? '' : 'none';
      el.style.display = isHc ? 'none' : '';
      if (isHc) { el.innerHTML = ''; return; }   // conteúdo do Headcount é pintado por renderHc()
      const t = SGA_TABS[sgaTab] || SGA_TABS.rent;
      el.innerHTML = editBar();
      el.appendChild(itemsTable(t.title, t.items, saveSga));
      const note = document.createElement('div');
      note.className = 'fin-note';
      note.innerHTML = 'Amounts are positive (USD) and enter the P&amp;L as costs, item by item.';
      el.appendChild(note);
      wireEditBar(el);
    }

    // ---------- CAC & Marketing: comissão (referenciada) + Ads + influenciadores ----------
    async function saveCac() {
      try { const r = await fetch('/api/finance/cac', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ cac: finCac }) }); const d = await r.json().catch(() => ({})); if (d && d.cac) finCac = d.cac; } catch (e) {}
      renderCac(); renderPnl();
    }
    function renderCac() {
      const el = document.getElementById('finCacWrap'); if (!el) return;
      // comissão: valor por carro × entregas do mês (referenciado ao Fleet Plan, como no Excel)
      const newDelivered = new Array(FIN_MONTHS).fill(0);
      finCohorts.forEach((c) => { const cm = cohMonth(c) - FIN_YOFF(); if (cm >= 0 && cm < FIN_MONTHS) newDelivered[cm] += c.qty; });
      const per = finCac.perUnit || 0;
      const infTot = new Array(FIN_MONTHS).fill(0);
      (finCac.inf || []).forEach((it) => { for (let m = 0; m < FIN_MONTHS; m++) infTot[m] += (Number((it.profiles || [])[m]) || 0) * (it.price || 0); });
      // totalizador de CAC (uma linha por custo) acima das abas
      const tot = document.getElementById('cacTotals');
      if (tot) tot.innerHTML = totalsTable([
        { label: 'Sales Commission', arr: newDelivered.map((n) => n * per) },
        { label: 'Paid Media', arr: sumItems(finCac.ads) },
        { label: 'Digital Influencers', arr: infTot },
      ], 'CAC cost line');
      document.querySelectorAll('#cacTabs .sub3-tab').forEach((b) => b.classList.toggle('active', b.dataset.t3 === cacTab));
      el.innerHTML = editBar();
      if (cacTab === 'ads') {
        el.appendChild(itemsTable('Paid Media (Google/Meta Ads)', finCac.ads, saveCac));
        wireEditBar(el);
        return;
      }
      if (cacTab === 'inf') {
        el.appendChild(itemsTable('Digital Influencers — active profiles × price per profile', finCac.inf, saveCac, { priceCol: true, itemLabel: 'Tier' }));
        const n = document.createElement('div');
        n.className = 'fin-note';
        n.innerHTML = 'Influencer cost = active profiles in the month × price per profile.';
        el.appendChild(n);
        wireEditBar(el);
        return;
      }
      const head = document.createElement('div');
      let h = `<div class="sub2-title">Sales Commission</div>` +
        `<div class="fin-note" style="margin:6px 0 10px">USD per delivered vehicle: <input class="hc-f hc-n" id="cacPerUnit" type="number" min="0" step="any" value="${per}"${canEditNow() ? '' : ' disabled'}> × vehicles delivered in the month (from the Fleet Plan)</div>`;
      h += '<div class="ue-table-wrap"><table class="ue-table fin-grid"><thead><tr><th class="ue-rowlabel">Line</th>';
      for (let m = 0; m < FIN_MONTHS; m++) h += `<th>${monthLbl(m)}</th>`;
      h += '<th class="ue-totalcol">FY-26E</th></tr></thead><tbody>';
      const rowH = (label, arr) => { let s = `<tr class="ue-row ue-leaf"><td class="ue-rowlabel">${label}</td>`; let t = 0; for (let m = 0; m < FIN_MONTHS; m++) { t += arr[m]; s += `<td class="ue-cell">${arr[m] ? fmtNum(arr[m]) : '-'}</td>`; } return s + `<td class="ue-cell ue-totalcol">${t ? fmtNum(t) : '-'}</td></tr>`; };
      h += rowH('Vehicles delivered', newDelivered);
      h += rowH('Commission (USD)', newDelivered.map((n) => n * per));
      h += '</tbody></table></div>';
      head.innerHTML = h;
      el.appendChild(head);
      const pu = head.querySelector('#cacPerUnit');
      if (pu && canEditNow()) pu.addEventListener('change', () => { finCac.perUnit = Math.max(0, Number(pu.value) || 0); saveCac(); });
      const note = document.createElement('div');
      note.className = 'fin-note';
      note.innerHTML = 'Commission is referenced to the Fleet Plan: USD per vehicle × vehicles delivered in the month.';
      el.appendChild(note);
      wireEditBar(el);
    }

    // ---------- DASHBOARD: realizado + projetado vs plano (gráficos) ----------
    // Paleta validada (dataviz): Actual #5A00F8 · Forecast #A78BFA · Plan #EB6834.
    // "Plan" = o mesmo motor SEM o override de realizado (o modelo puro das frotas de referência).
    const DC = { act: '#5A00F8', for: '#A78BFA', plan: '#EB6834', grid: 'rgba(120,120,140,0.10)', txt: '#6b7280' };
    function renderDash() {
      if (!document.getElementById('dashRev')) return;
      const PA = computePnl({});                    // realidade: actuals + forecast
      const PP = computePnl({ noActuals: true });   // plano: modelo puro
      const curM = PA.actualsThrough != null ? PA.actualsThrough : -1;
      const labels = Array.from({ length: FIN_MONTHS }, (_, m) => monthLbl(m));
      const seg = (arr) => ({ a: arr.map((v, m) => (m <= curM ? v : null)), f: arr.map((v, m) => (m > curM ? v : (m === curM ? v : null))) });
      const kill = (id) => { if (dashCharts[id]) { dashCharts[id].destroy(); delete dashCharts[id]; } };
      const sparse = (arr) => { // rótulos diretos SÓ no pico e no último valor (regra da skill)
        const idx = new Set();
        let mx = 0, mi = -1; arr.forEach((v, i) => { if (v != null && Math.abs(v) > mx) { mx = Math.abs(v); mi = i; } });
        if (mi >= 0) idx.add(mi);
        for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) { idx.add(i); break; }
        return idx;
      };
      const mkBars = (id, arr, planArr) => {
        kill(id);
        const s = seg(arr);
        const lb = sparse(arr);
        dashCharts[id] = new Chart(document.getElementById(id), {
          data: { labels, datasets: [
            { type: 'bar', label: 'Actual', data: s.a, backgroundColor: DC.act, borderRadius: 4, maxBarThickness: 26,
              datalabels: { display: (c) => lb.has(c.dataIndex) && c.dataset.data[c.dataIndex] != null, anchor: 'end', align: 'top', color: '#374151', font: { size: 10, weight: 700 }, formatter: (v) => fmtQty(v) } },
            { type: 'bar', label: 'Forecast', data: s.f, backgroundColor: DC.for, borderRadius: 4, maxBarThickness: 26,
              datalabels: { display: (c) => lb.has(c.dataIndex) && c.dataset.data[c.dataIndex] != null, anchor: 'end', align: 'top', color: '#374151', font: { size: 10, weight: 700 }, formatter: (v) => fmtQty(v) } },
            { type: 'line', label: 'Plan', data: planArr, borderColor: DC.plan, borderWidth: 2, borderDash: [6, 4], pointRadius: 0, pointHoverRadius: 5, tension: 0.25, datalabels: { display: false } },
          ] },
          options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 16 } },
            plugins: { legend: { position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, font: { size: 10.5 }, color: DC.txt } },
              tooltip: { callbacks: { label: (c) => c.dataset.label + ': US$ ' + fmtQty(c.parsed.y) } } },
            scales: { x: { stacked: true, grid: { display: false }, ticks: { color: DC.txt, font: { size: 9.5 } } },
              y: { grid: { color: DC.grid }, ticks: { color: DC.txt, font: { size: 9.5 }, callback: (v) => fmtQty(v) } } } },
        });
      };
      mkBars('dashRev', PA.grossRev, PP.grossRev);
      mkBars('dashCogs', PA.cogsTot.map((v) => -v), PP.cogsTot.map((v) => -v));
      mkBars('dashNet', PA.netCf, PP.netCf);
      // acumulado: linha (sólida no realizado, tracejada no projetado) + plano; a linha do zero é o breakeven
      kill('dashAcc');
      dashCharts.dashAcc = new Chart(document.getElementById('dashAcc'), {
        type: 'line',
        data: { labels, datasets: [
          { label: 'Actual + Forecast', data: PA.accCf, borderColor: DC.act, backgroundColor: DC.act, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, tension: 0.25,
            segment: { borderDash: (c) => (c.p1DataIndex > curM ? [5, 4] : undefined) }, datalabels: { display: false } },
          { label: 'Plan', data: PP.accCf, borderColor: DC.plan, borderWidth: 2, borderDash: [6, 4], pointRadius: 0, pointHoverRadius: 5, tension: 0.25, datalabels: { display: false } },
        ] },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, font: { size: 10.5 }, color: DC.txt } },
            tooltip: { callbacks: { label: (c) => c.dataset.label + ': US$ ' + fmtQty(c.parsed.y) } } },
          scales: { x: { grid: { display: false }, ticks: { color: DC.txt, font: { size: 9.5 } } },
            y: { grid: { color: (c) => (c.tick.value === 0 ? '#9ca3af' : DC.grid), lineWidth: (c) => (c.tick.value === 0 ? 1.6 : 1) }, ticks: { color: DC.txt, font: { size: 9.5 }, callback: (v) => fmtQty(v) } } } },
      });
      // explorador de linhas: qualquer linha de receita/custo/OPEX, mesma leitura
      const sel = document.getElementById('dashLineSel');
      const series = (name, PX) => {
        if (PX.rev[name]) return PX.rev[name];
        if (PX.cogs[name]) return PX.cogs[name].map((v) => -v);
        if (name === 'CAC') return PX.cacTot.map((v) => -v);
        if (name === 'SG&A') return PX.sga.map((v) => -v);
        if (name === 'OPEX') return PX.opex.map((v) => -v);
        if (name === 'HC Payroll') return PX.hcTot.map((v) => -v);
        return new Array(FIN_MONTHS).fill(0);
      };
      const lineNames = [...FIN_REV_LINES, ...FIN_COGS_LINES, 'CAC', 'SG&A', 'HC Payroll', 'OPEX'];
      if (sel && !sel.options.length) {
        sel.innerHTML = lineNames.map((n) => `<option value="${escH(n)}"${n === dashLine ? ' selected' : ''}>${escH(n === 'Traffic fines (out)' ? 'Traffic fines (cost)' : n)}</option>`).join('');
        sel.addEventListener('change', () => { dashLine = sel.value; renderDash(); });
      }
      mkBars('dashLineCv', series(dashLine, PA), series(dashLine, PP));
      // filtros: ano + chip de realizado
      const ft = document.getElementById('dashFilters');
      if (ft) {
        ft.innerHTML = '<div class="pnl-years">' + [FIN_BASE_YEAR, FIN_BASE_YEAR + 1].map((y) => `<button class="pnl-yr${finYear === y ? ' on' : ''}" data-y="${y}">${y}</button>`).join('') + '</div>' +
          (curM >= 0 ? `<span class="pnl-act">solid/dark = actual through ${monthLbl(curM)} · light = forecast · dashed orange = plan</span>` : '');
        ft.querySelectorAll('.pnl-yr').forEach((b) => b.addEventListener('click', () => {
          finYear = +b.dataset.y; finActCache = {}; refProfiles = buildProfiles(); renderDash(); renderPnl(); renderFleetPlan(); renderCac();
        }));
      }
    }

    (async () => {
      const getVals = async (fleet) => { const o = {}; try { const r = await fetch('/api/ue/values?fleet=' + encodeURIComponent(fleet), { credentials: 'include' }); const d = await r.json(); (d.values || []).forEach((v) => { o[v.line + '@@' + v.period] = v.value; }); } catch (e) {} return o; };
      try { const r = await fetch('/api/theoric/models', { credentials: 'include' }); const d = await r.json(); finModels = d.models || []; } catch (e) { finModels = []; }
      try { const r = await fetch('/api/finance/cohorts', { credentials: 'include' }); const d = await r.json(); finCohorts = d.cohorts || []; } catch (e) { finCohorts = []; }
      try { const r = await fetch('/api/finance/hc', { credentials: 'include' }); const d = await r.json(); finHc = (d && d.hc) || { roles: [], people: [], plan: {} }; } catch (e) { finHc = { roles: [], people: [], plan: {} }; }
      hcEnsurePeople(); hcSyncPlan();
      finCfg = await getVals('__fin_cfg__');
      try { const r = await fetch('/api/finance/sga', { credentials: 'include' }); const d = await r.json(); finSga = (d && d.sga) || finSga; } catch (e) {}
      try { const r = await fetch('/api/finance/cac', { credentials: 'include' }); const d = await r.json(); finCac = (d && d.cac) || finCac; } catch (e) {}
      for (const m of finModels) finModelVals[m.id] = await getVals('__theoric_' + m.id + '__');
      // caixinhas reais das frotas + config global do UE — base dos perfis de referência e dos realizados
      cfgReal = await getVals('__cfg__');
      const realFleets = ((OCN.ue || {}).fleets) || [];
      await Promise.all(realFleets.map(async (f) => { realFleetParams[f.id] = await getVals(f.id); }));
      refProfiles = buildProfiles();
      await loadPnlVersions();
      renderFleetPlan(); renderHc(); renderAdmin(); renderCac(); renderAssump(); renderPnl();
      const dashTab = document.querySelector('.sub-tab[data-sub="findash"]');
      if (dashTab) dashTab.addEventListener('click', () => setTimeout(renderDash, 60));
    })();
  }

  function initUnitTheoric() {
    if (uetReady) return;
    uetReady = true;
    const escH = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
    // formatação: milhar com ponto, SEM casas decimais, negativos entre parênteses, 0 vira "-"
    const fmtNum = (v) => Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
    const ueFmt = (v) => (v === null || v === undefined) ? '' : (Math.round(v) === 0 ? '-' : (v < 0 ? '(' + fmtNum(v) + ')' : fmtNum(v)));
    const isAdmin = !!(OCN._meta && OCN._meta.user && (OCN._meta.user.role === 'admin' || OCN._meta.user.role === 'giga_admin'));
    const fleetsEl = document.getElementById('uetFleets');
    const ctrlEl = document.getElementById('uetControls');
    const tableEl = document.getElementById('uetTable');
    if (!fleetsEl || !tableEl) return;
    const fkey = (id) => '__theoric_' + id + '__';
    const isLeaf = (g) => g === 'inflow' || g === 'outflow';
    const PMAX = UET_PERIODS - 1; // 13 = M13 (lançamentos pontuais pós-contrato)
    const par = (k) => { const v = uetVals[k + '@@0']; return v == null ? 0 : Number(v); }; // param/slider escalar
    const cotacao = () => { const c = par('__cotacao__'); return c > 0 ? c : 5.5; }; // câmbio R$/US$ (default 5,5)
    const conv = (v) => (v == null ? null : (uetCurrency === 'USD' ? v / cotacao() : v)); // R$ -> moeda de exibição
    const parseInput = (raw) => { raw = String(raw).trim(); if (raw === '') return null; raw = raw.replace(/[R$\s]/gi, '').replace(/\./g, '').replace(',', '.'); const n = Number(raw); return isFinite(n) ? n : null; };

    // usam o motor extraído acima (mesma lógica), agora compartilhado com o P&L do Finance
    const maintByMonth = () => uetMaint(uetVals, uetSel);
    const cellValue = (line, p, maint) => uetCell(uetVals, uetSel, line, p, maint);
    function computeAll() {
      const maint = maintByMonth(); const cells = {}; const ti = [], to = [], net = [], acc = []; let a = 0;
      for (let p = 0; p < UET_PERIODS; p++) {
        let inf = 0, ouf = 0;
        UET_LINES.forEach((l) => {
          if (!isLeaf(l.group)) return;
          const v = uetEff(uetVals, uetSel, l, p, maint); // override manual vence a projeção
          cells[l.label + '@@' + p] = v;
          if (v == null) return;
          if (l.group === 'inflow') inf += v; else ouf += v;
        });
        ti[p] = inf; to[p] = ouf; net[p] = inf + ouf; a += net[p]; acc[p] = a;
      }
      return { cells, totalInflow: ti, totalOutflow: to, net, acc };
    }
    async function saveParam(key, val) {
      const k = key + '@@0';
      try {
        if (val === '' || val == null || !isFinite(Number(val))) {
          await fetch('/api/ue/value/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ fleet: fkey(uetSel), line: key, period: 0 }) });
          delete uetVals[k];
        } else {
          await fetch('/api/ue/value', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ fleet: fkey(uetSel), line: key, period: 0, value: Number(val), kind: 'proj' }) });
          uetVals[k] = Number(val);
        }
      } catch (e) {}
    }

    function renderFleets() {
      let h = uetModels.map((m) => {
        const cfg = (OCN.modelos && OCN.modelos[m.id]) || null;
        const visual = cfg && cfg.foto ? `<img class="uet-photo" src="${escH(cfg.foto)}" alt="">` : `<span class="uet-dot" style="background:${escH(m.color || '#5A00F8')}"></span>`;
        return `<button class="ue-fleet-btn${m.id === uetSel ? ' active' : ''}" data-id="${escH(m.id)}">${visual}<span class="n">${escH(m.name)}</span></button>`;
      }).join('');
      if (isAdmin) h += '<button class="ue-fleet-btn uet-add" id="uetAdd">+ Add model</button>';
      fleetsEl.innerHTML = h;
      fleetsEl.querySelectorAll('.ue-fleet-btn[data-id]').forEach((b) => b.addEventListener('click', async () => { uetSel = b.dataset.id; renderFleets(); await loadValues(uetSel); }));
      const addBtn = document.getElementById('uetAdd');
      if (addBtn) addBtn.addEventListener('click', addModel);
    }
    async function addModel() {
      const name = (window.prompt('New model name:') || '').trim();
      if (!name) return;
      try {
        const r = await fetch('/api/theoric/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.ok) { alert(d.error || ('HTTP ' + r.status)); return; }
        uetModels = d.models; uetSel = d.added.id; renderFleets(); await loadValues(uetSel);
      } catch (e) { alert('Error: ' + e.message); }
    }
    async function loadValues(id) {
      uetVals = {};
      try { const r = await fetch('/api/ue/values?fleet=' + encodeURIComponent(fkey(id)), { credentials: 'include' }); const d = await r.json(); (d.values || []).forEach((v) => { uetVals[v.line + '@@' + v.period] = v.value; }); }
      catch (e) {}
      renderControls(); renderTable();
    }
    // cabeçalho: toggle "Manual mode" + sliders (inadimplência, % late payment, km/semana), ativos só no modo manual
    function renderControls() {
      if (!ctrlEl) return;
      if (!isAdmin) { ctrlEl.innerHTML = ''; return; }
      const en = uetManual;
      const cot = cotacao();
      const sl = (id, label, key, min, max, step, sfx) => `<div class="uet-ctrl"><label>${label}: <b id="${id}_v">${par(key)}${sfx}</b></label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${par(key)}"${en ? '' : ' disabled'}></div>`;
      ctrlEl.innerHTML =
        `<label class="ue-switch"><input type="checkbox" id="uetManual"${uetManual ? ' checked' : ''}/><span>Manual mode</span></label>` +
        `<div class="ue-cur-toggle"><button class="ue-cur-btn${uetCurrency === 'BRL' ? ' active' : ''}" data-c="BRL">R$</button><button class="ue-cur-btn${uetCurrency === 'USD' ? ' active' : ''}" data-c="USD">US$</button></div>` +
        sl('uetInad', 'Default rate', '__inadimplencia__', 0, 100, 1, '%') +
        sl('uetLate', 'Late payment', '__late_pct__', 0, 100, 1, '%') +
        sl('uetKm', 'Avg. km/week', '__km_semana__', 0, 3000, 25, ' km') +
        `<div class="uet-ctrl"><label>FX R$/US$: <b id="uetCot_v">${cot.toFixed(2).replace('.', ',')}</b></label><input type="range" id="uetCot" min="3" max="8" step="0.05" value="${cot}"${en ? '' : ' disabled'}></div>`;
      document.getElementById('uetManual').addEventListener('change', (e) => { uetManual = e.target.checked; renderControls(); renderTable(); });
      ctrlEl.querySelectorAll('.ue-cur-btn').forEach((b) => b.addEventListener('click', () => { uetCurrency = b.dataset.c; renderControls(); renderTable(); }));
      [['uetInad', '__inadimplencia__', '%'], ['uetLate', '__late_pct__', '%'], ['uetKm', '__km_semana__', ' km']].forEach(([id, key, sfx]) => {
        const inp = document.getElementById(id); if (!inp) return;
        inp.addEventListener('input', () => { const el = document.getElementById(id + '_v'); if (el) el.textContent = inp.value + sfx; });
        inp.addEventListener('change', async () => { await saveParam(key, inp.value); renderTable(); });
      });
      const cotInp = document.getElementById('uetCot');
      if (cotInp) {
        cotInp.addEventListener('input', () => { const el = document.getElementById('uetCot_v'); if (el) el.textContent = Number(cotInp.value).toFixed(2).replace('.', ','); });
        cotInp.addEventListener('change', async () => { await saveParam('__cotacao__', cotInp.value); renderTable(); });
      }
    }
    // caixinha (modal) dos parâmetros de uma linha — igual ao UE real (lápis → campos daquela linha)
    function openParamModal(line) {
      if (!uetManual || !isAdmin) return;
      const fields = UET_PARAMS[line]; if (!fields) return;
      const ov = document.createElement('div'); ov.className = 'modal-overlay show';
      ov.innerHTML = '<div class="modal"><h3>' + escH(line) + '</h3>' +
        fields.map((f) => `<label style="display:block;font-size:12px;color:var(--text-2);margin:8px 0 2px">${escH(f.label)}</label><input class="uet-pin" data-k="${f.k}" type="text" inputmode="decimal" value="${uetVals[f.k + '@@0'] == null ? '' : uetVals[f.k + '@@0']}">`).join('') +
        '<div class="row" style="margin-top:14px"><button class="uet-mcancel" type="button">Cancel</button><button class="primary uet-msave" type="button">Save</button></div></div>';
      document.body.appendChild(ov);
      const close = () => ov.remove();
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      ov.querySelector('.uet-mcancel').addEventListener('click', close);
      ov.querySelector('.uet-msave').addEventListener('click', async () => {
        for (const inp of ov.querySelectorAll('.uet-pin')) { const num = parseInput(inp.value); await saveParam(inp.dataset.k, num == null ? '' : num); }
        close(); renderTable();
      });
      const first = ov.querySelector('.uet-pin'); if (first) { first.focus(); first.select(); }
    }
    function renderTable() {
      const A = computeAll();
      const gmap = { totalInflow: A.totalInflow, totalOutflow: A.totalOutflow, net: A.net, acc: A.acc };
      let html = '<thead><tr><th class="ue-rowlabel">Line</th>';
      for (let p = 0; p < UET_PERIODS; p++) html += '<th>M' + p + '</th>';
      html += '<th class="ue-totalcol">Total</th></tr></thead><tbody>';
      UET_LINES.forEach((l) => {
        const leaf = isLeaf(l.group);
        const pencil = leaf && UET_PARAMS[l.label] && uetManual && isAdmin;
        const disp = UET_DISPLAY[l.label] || l.label;
        const label = pencil ? `<span class="ue-param-label" data-pline="${escH(l.label)}">${escH(disp)} <span class="ue-pencil">✎</span></span>` : escH(disp);
        html += `<tr class="ue-row ue-${l.group} ${leaf ? 'ue-leaf' : 'ue-calc'}"><td class="ue-rowlabel">${label}</td>`;
        let rowTot = 0;
        for (let p = 0; p < UET_PERIODS; p++) {
          if (leaf) { const v = A.cells[l.label + '@@' + p]; if (v != null) rowTot += v; html += `<td class="ue-cell${uetManual && isAdmin ? ' ue-editable' : ''}" data-line="${escH(l.label)}" data-period="${p}">${v == null ? '' : ueFmt(conv(v))}</td>`; }
          else html += `<td class="ue-cell ue-computed">${ueFmt(conv(gmap[l.group][p]))}</td>`;
        }
        let tot;
        if (leaf) tot = rowTot;
        else if (l.group === 'acc') tot = gmap.acc[UET_PERIODS - 1];
        else tot = gmap[l.group].reduce((s, x) => s + (x || 0), 0);
        html += `<td class="ue-cell ue-totalcol">${ueFmt(conv(tot))}</td></tr>`;
      });
      html += '</tbody>';
      tableEl.innerHTML = html;
      if (uetManual && isAdmin) {
        tableEl.querySelectorAll('.ue-param-label').forEach((el) => el.addEventListener('click', () => openParamModal(el.dataset.pline)));
        tableEl.querySelectorAll('td.ue-editable').forEach((td) => td.addEventListener('click', () => editCell(td)));
      }
    }
    // override manual de uma célula específica (modo manual): sobrescreve a projeção; vazio volta ao projetado
    function editCell(td) {
      if (td.querySelector('input')) return;
      const line = td.dataset.line, p = parseInt(td.dataset.period, 10);
      const ov = uetVals[line + '@@' + p];
      const comp = cellValue(line, p, maintByMonth());
      const cur = ov != null ? ov : (comp != null ? Math.abs(comp) : '');
      td.innerHTML = `<input class="uet-in" type="text" inputmode="decimal" value="${cur}">`;
      const inp = td.querySelector('input'); inp.focus(); inp.select();
      let done = false;
      const finish = async (save) => {
        if (done) return; done = true;
        if (save) {
          const raw = inp.value.trim();
          if (raw === '') { if (ov != null) await saveCellOverride(line, p, ''); }
          else {
            const num = parseInput(raw);
            const compMag = comp != null ? Math.abs(comp) : null;
            // não cria override redundante se o valor digitado é igual ao projetado e não havia override
            if (num != null && !(ov == null && compMag != null && Math.abs(num - compMag) < 0.005)) await saveCellOverride(line, p, num);
          }
        }
        renderTable();
      };
      inp.addEventListener('blur', () => finish(true));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } else if (e.key === 'Escape') { finish(false); } });
    }
    async function saveCellOverride(line, p, val) {
      const k = line + '@@' + p;
      try {
        if (val === '' || val == null) {
          await fetch('/api/ue/value/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ fleet: fkey(uetSel), line, period: p }) });
          delete uetVals[k];
        } else {
          await fetch('/api/ue/value', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ fleet: fkey(uetSel), line, period: p, value: Number(val), kind: 'proj' }) });
          uetVals[k] = Number(val);
        }
      } catch (e) {}
    }
    (async () => {
      try { const r = await fetch('/api/theoric/models', { credentials: 'include' }); const d = await r.json(); uetModels = d.models || []; }
      catch (e) { uetModels = []; }
      if (!uetSel && uetModels.length) uetSel = uetModels[0].id;
      renderFleets();
      if (uetSel) await loadValues(uetSel);
    })();
  }

  // ===================== UNIT ECONOMICS (lazy init) =====================
  let unitReady = false;
  function initUnit() {
    if (unitReady) return;
    unitReady = true;
    const U = OCN.ue;
    const isAdmin = !!(OCN._meta && OCN._meta.user && (OCN._meta.user.role === 'admin' || OCN._meta.user.role === 'giga_admin'));
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
    let cleanView = false;  // visão limpa: só o total (real+proj), sem os comparativos do orçado
    let inadimplencia = 0;  // taxa de inadimplência % (slider, global) — desconta a projeção do Subscription
    let latePct = 0;        // % das semanas pagas COM atraso (slider, global) — projeta o Late-payment interest
    let termPct = 50;       // % da cobrança de rescisão (import_jud) que esperamos receber (slider, global)
    // Reposição de peças: a cada quantos MIL km trocar + custo por troca (painel ⚙, global)
    let partCfg = { pastilhas: { km: 15, rs: 250 }, disco: { km: 30, rs: 350 }, pneus: { km: 50, rs: 700 } };
    let curIni = null;            // início da frota selecionada (Date) — base do eixo de meses
    let lossMonthByPlate = {};    // placa → mês do UE em que deu perda total (corta Subrental/GPS dali em diante)
    let activeFracArr = [];       // fração de carros ativos (sem perda total) por mês — aplica no agregado
    const ORCADO_FX = 5.0;  // câmbio em que o orçado (USD, planilha) foi construído — só para exibi-lo em R$
    let params = {}; // parâmetros por frota: subrental, seguro, GPS, nº aluguéis, compra
    const LINE_PARAMS = {
      // só a semanalidade: a taxa de juros vem da VERSÃO DO CONTRATO de cada placa (5% v1/v2, 20% v3+)
      'Subscription': [{ k: '__sub_semanal__', label: 'Weekly subscription fee (R$)' }],
      'Subrental fee': [{ k: '__subrental_mensal__', label: 'Monthly Subrental fee (R$)' }],
      'Insurance': [{ k: '__ins_total__', label: 'Total insurance for the year (R$)' }, { k: '__ins_parcelas__', label: 'Number of installments (from M1)' }],
      'GPS': [{ k: '__gps_m0__', label: 'Amount at M0 (R$)' }, { k: '__gps_mensal__', label: 'Monthly amount, from M1 (R$)' }],
      'Security Deposit': [{ k: '__num_alugueis__', label: 'Number of rentals (deposit = N × monthly Subrental)' }],
      'Vehicle Purchase': [{ k: '__vehicle__', label: 'Purchase/buyback amount (R$) — enters at M13' }],
      'Deposit Refund': [{ k: '__refund_pct__', label: 'Deposit refund adjustment (% p.a.)' }],
    };
    // rótulo de exibição ≠ chave interna (que segue a planilha).
    // 'Traffic fines (out)' é a linha de SAÍDA — chave distinta da de entrada (senão colidiriam nas
    // entradas manuais/params), mas ambas aparecem como "Traffic fines" na tela.
    const DISPLAY_LABEL = { 'Deposit Refund': 'Security Deposit Refund', 'Car Preparation (wash + delivery)': 'Car Preparation', 'Traffic fines (out)': 'Traffic fines' };
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
    // "All fleets" vem PRIMEIRO, antes das frotas individuais
    fleetsEl.innerHTML =
      `<button class="ue-fleet-btn" data-id="all"><span class="n">All fleets</span><span class="m">${totalCarsAll} cars</span></button>` +
      U.fleets
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

    // nº de segundas-feiras (dia de pagamento) dentro da janela do mês m do UE (mês = 4,333 semanas do início).
    // `from` (opcional) conta só as segundas AINDA POR VIR a partir dessa data — usado para projetar o
    // pedaço que falta do mês vigente (o realizado já cobre as semanas vencidas).
    function mondaysInMonth(ini, m, from) {
      const MS = 86400000, len = SEMANAS_MES * 7 * MS;
      const start = new Date(ini.getTime() + (m - 1) * len);
      const end = new Date(ini.getTime() + m * len);
      let d = new Date(start.getTime() + (((1 - start.getDay()) % 7 + 7) % 7) * MS); // primeira segunda ≥ start
      let n = 0;
      while (d < end) { if (!from || d > from) n++; d = new Date(d.getTime() + 7 * MS); }
      return n;
    }
    // mês vigente (parcial) do eixo do UE — é o que recebe realizado + projeção do que falta
    function currentMonthIdx() { return Math.min(PMAX, Math.ceil(elapsed)); }
    // Versão do contrato do motorista atual -> taxas. v1/v2: juros de atraso 5% e prêmio de multa 10%;
    // v3 em diante: 20% nos dois. Na visão de frota usa-se a média das placas (mix de versões).
    const VER_JUROS = (v) => (v >= 3 ? 20 : 5);
    const VER_PREMIO = (v) => (v >= 3 ? 0.20 : 0.10);
    function contratoPlates(f) { return plateView ? [plateView] : ((f && f.placas) || []); }
    function avgByVersion(f, fn, fallback) {
      const ct = U.contratos || {};
      const pls = contratoPlates(f).filter((pl) => ct[pl]);
      if (!pls.length) return fallback;
      return pls.reduce((s, pl) => s + fn(ct[pl]), 0) / pls.length;
    }
    // taxa média de juros de atraso (%) da frota/placa em contexto — substitui o antigo campo manual
    let jurosPct = 5;
    // Subrental: 12 parcelas no dia 26, a 1ª no mês SEGUINTE ao da retirada. Devolve quantas
    // parcelas caem no período `p` do UE (normalmente 0 ou 1) — datas reais, respeitando o calendário.
    function subrentalMonthsAt(p) {
      if (!curIni) return 0;
      let n = 0;
      for (let i = 1; i <= 12; i++) {
        const d = new Date(curIni.getFullYear(), curIni.getMonth() + i, 26, 12, 0, 0);
        let mo = Math.ceil(((d - curIni) / 86400000) / (SEMANAS_MES * 7));
        if (mo < 1) mo = 1;
        if (mo === p) n++;
      }
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
      const base = U.revBase && U.revBase.placas;
      if (!prices.length || !curIni || elapsed <= 0) return;
      const DESC = 0.75;                                     // desconto de 25% sobre o preço de tabela do site
      const prazo = (U.revBase && U.revBase.prazoMedioDias) || 33; // dias médios entre a revisão e o vencimento
      const priceOf = (n) => { const r = prices.find((x) => x.n === n); return r ? r.valor : 0; };
      const kmOf = (n) => { const r = prices.find((x) => x.n === n); return (r && r.km) ? r.km : n * REVISAO_KM; };
      const plates = plateView ? [plateView] : (f.placas || []);
      for (let p = 0; p <= PMAX; p++) { maintRealRS[p] = 0; maintProjRS[p] = 0; }
      const MS = 86400000;
      const moOf = (date) => { let mo = Math.ceil(((date - curIni) / MS) / (SEMANAS_MES * 7)); return mo < 1 ? 1 : mo; };
      // km/dia médio da frota — usado para estimar quando cada placa atinge a próxima revisão
      let kmSum = 0, kmN = 0;
      (f.placas || []).forEach((pl) => { const d = fr && fr[pl]; if (d && d.ok && d.odo > 0) { kmSum += d.odo; kmN++; } });
      const diasCorridos = Math.max(1, (hoje - curIni) / MS);
      const kmDiaFrota = kmN ? (kmSum / kmN) / diasCorridos : 0;
      plates.forEach((pl) => {
        const d = fr && fr[pl];
        const rows = (base && base[pl]) || [];
        const feitas = {};                                    // revisões já na base (por número)
        // 1) o que está na base: com valor+vencimento = REALIZADO (custo e data conhecidos);
        //    sem esses dados = revisão ocorreu, mas o pagamento ainda vai sair (projetado).
        rows.forEach((r) => {
          feitas[r.n] = true;
          if (r.valor && r.venc) {
            // valor conhecido: já venceu = realizado; vencimento futuro = MESMO mês, porém projetado
            const dv = new Date(r.venc + 'T12:00:00');
            const mo = Math.min(moOf(dv), PMAX);
            if (dv <= hoje) maintRealRS[mo] += r.valor; else maintProjRS[mo] += r.valor;
          } else if (r.data) {
            // revisão feita e ainda não paga: data estimada = revisão + prazo médio. Se essa data já
            // passou (atrasada), o pagamento não cabe no passado — joga para o mês vigente + 1.
            const pagoEm = new Date(new Date(r.data + 'T12:00:00').getTime() + prazo * MS);
            const mo = pagoEm < hoje ? currentMonthIdx() + 1 : moOf(pagoEm);
            maintProjRS[Math.min(Math.max(mo, 1), PMAX)] += priceOf(r.n) * DESC;
          }
        });
        if (lossMonthByPlate[pl] != null) return;             // perda total: sem revisões futuras
        // 2) revisões que NÃO estão na base — inclusive as que já venceram (carro passou dos 10.000 km
        //    sem registro). Estima-se a data pelo ritmo de km e soma-se o prazo médio de pagamento.
        const odo = d && d.ok && d.odo > 0 ? d.odo : 0;
        const kmDia = odo && diasCorridos > 0 ? odo / diasCorridos : kmDiaFrota;
        if (kmDia <= 0) return;
        for (let n = 1; n <= 200; n++) {
          if (feitas[n]) continue;
          const alvo = kmOf(n);
          // o corte é pela REVISÃO (tem que acontecer dentro do contrato, M1..M12);
          // o PAGAMENTO (revisão + prazo médio) pode passar do fim — cai no M13 (acerto pós-contrato)
          const diasAteRev = Math.max(0, (alvo - odo) / kmDia);
          const revMo = moOf(new Date(hoje.getTime() + diasAteRev * MS));
          if (revMo > U.periods) break;
          const payMo = Math.min(PMAX, moOf(new Date(hoje.getTime() + (diasAteRev * MS) + prazo * MS)));
          maintProjRS[Math.max(payMo, 1)] += priceOf(n) * DESC;
        }
      });
      // ÷ carros ATIVOS do mês (mesma regra das demais linhas por carro); placa = sem divisão
      if (!plateView) for (let p = 0; p <= PMAX; p++) { maintRealRS[p] /= activeCarsAt(p); maintProjRS[p] /= activeCarsAt(p); }
      maintReady = true;
    }
    // Multas de trânsito — RECEITA (o que cobramos do cliente). Espelha a linha de despesa:
    //  - multa já PAGA -> realizada no mês do pagamento;
    //  - multa em ABERTO -> recebível projetado em (infração + prazo médio de recebimento),
    //    multiplicado pela taxa histórica de recebimento (medida em coortes já maduras).
    //    Se a data estimada já passou, cai no mês vigente;
    //  - infrações que ainda vão acontecer -> ritmo histórico por dia, só na fatia do mês que
    //    vem de infrações POSTERIORES a hoje (as anteriores já estão na base: sem dupla contagem).
    let finesRealRS = [], finesProjRS = [], finesReady = false;
    function computeFines(f) {
      finesRealRS = []; finesProjRS = []; finesReady = false;
      const mul = U.multas && U.multas.placas;
      const ini = f.inicio ? new Date(f.inicio + 'T12:00:00') : null;
      if (!mul || !ini) return;
      const MS = 86400000;
      const lag = (U.multas && U.multas.prazoRecebimentoDias) || 42;
      // Sem corte de inadimplência aqui: a multa é repassada ao cliente (cobramos o líquido + 10% do
      // bruto e pagamos o líquido + 5% à LM, margem ~7%), então o recebível é projetado INTEGRAL.
      // Aplicar a taxa histórica de recebimento só na receita invertia o sinal do balanço — a multa
      // não paga hoje continua devida pelo cliente, não é perda. `taxaRecebimento` segue medida no
      // servidor (84,8% em coortes maduras) para quem quiser acompanhar o risco de cobrança.
      const taxa = 1;
      const moOf = (d) => { const m = Math.ceil(((d - ini) / MS) / (SEMANAS_MES * 7)); return m < 1 ? 1 : m; };
      const plates = plateView ? [plateView] : (f.placas || []);
      for (let p = 0; p <= PMAX; p++) { finesRealRS[p] = 0; finesProjRS[p] = 0; }
      let total = 0;
      plates.forEach((pl) => (mul[pl] || []).forEach((x) => {
        total += x.v;
        const dt = new Date(x.d + 'T12:00:00');
        if (x.pago) {
          const mo = Math.min(moOf(dt), PMAX);
          finesRealRS[mo] += x.v;
        } else {
          const quando = new Date(dt.getTime() + lag * MS);
          const mo = Math.min(Math.max(quando < hoje ? currentMonthIdx() : moOf(quando), 1), PMAX);
          finesProjRS[mo] += x.v * taxa;
        }
      }));
      // infrações futuras: ritmo histórico (valor cobrado/dia), ajustado pelo prêmio da VERSÃO DE
      // CONTRATO vigente. O histórico embute o prêmio antigo (10% na maioria); as placas que já
      // migraram para a v3+ cobram 20%, então escala-se pela razão entre o prêmio médio de hoje e
      // o histórico. Aproximação: o prêmio incide sobre o bruto e a base aqui é o total cobrado.
      const dias = Math.max(1, (hoje - ini) / MS);
      const premioHoje = avgByVersion(f, VER_PREMIO, 0.10);
      const premioHist = (U.multas && U.multas.premioMedioHist) || 0.10;
      const escala = premioHist > 0 ? (1 + premioHoje) / (1 + premioHist) : 1;
      const perDay = (total / dias) * taxa * escala;
      for (let p = 1; p <= PMAX; p++) {
        const winStart = new Date(ini.getTime() + (p - 1) * SEMANAS_MES * 7 * MS);
        const winEnd = new Date(ini.getTime() + p * SEMANAS_MES * 7 * MS);
        const infIni = new Date(winStart.getTime() - lag * MS);
        const infFim = new Date(winEnd.getTime() - lag * MS);
        const novos = Math.max(0, (infFim - Math.max(infIni, hoje)) / MS);
        finesProjRS[p] += novos * perDay;
      }
      if (!plateView) for (let p = 0; p <= PMAX; p++) { finesRealRS[p] /= activeCarsAt(p); finesProjRS[p] /= activeCarsAt(p); }
      finesReady = true;
    }
    // Multas A PAGAR (aba multas_consolidado): quanto a OCN desembolsa com a LM.
    //  - multa com vencimento (W): entra no mês do vencimento — realizada se já venceu, projetada se é futuro;
    //  - multa sem vencimento: estimada em (chegada do e-mail + prazo médio de 44 dias). Se essa data já
    //    passou, o pagamento vai para o MÊS VIGENTE como projetado (não dá para pagar no passado);
    //  - multas AINDA NÃO conhecidas: as infrações continuam ocorrendo. Projeta-se pelo ritmo histórico
    //    (R$/dia da própria frota) só para a parcela do mês que vem de infrações POSTERIORES a hoje —
    //    as anteriores já estão na base, então não há dupla contagem.
    let finesOutRealRS = [], finesOutProjRS = [], finesOutReady = false;
    function computeFinesOut(f) {
      finesOutRealRS = []; finesOutProjRS = []; finesOutReady = false;
      const base = U.multasBase && U.multasBase.placas;
      if (!base || !curIni) return;
      const prazo = (U.multasBase && U.multasBase.prazoMedioDias) || 44;
      const MS = 86400000;
      const moOf = (d) => { const m = Math.ceil(((d - curIni) / MS) / (SEMANAS_MES * 7)); return m < 1 ? 1 : m; };
      const plates = plateView ? [plateView] : (f.placas || []);
      for (let p = 0; p <= PMAX; p++) { finesOutRealRS[p] = 0; finesOutProjRS[p] = 0; }
      let total = 0;
      plates.forEach((pl) => (base[pl] || []).forEach((x) => {
        total += x.v;
        let quando = null, venceu = false;
        if (x.venc) { quando = new Date(x.venc + 'T12:00:00'); venceu = quando <= hoje; }
        else if (x.email) { quando = new Date(new Date(x.email + 'T12:00:00').getTime() + prazo * MS); }
        if (!quando) return;
        let mo = quando < hoje && !venceu ? currentMonthIdx() : moOf(quando); // atrasada -> mês vigente
        mo = Math.min(Math.max(mo, 1), PMAX);
        if (venceu) finesOutRealRS[mo] += x.v; else finesOutProjRS[mo] += x.v;
      }));
      // ritmo histórico de multas (R$/dia) para projetar as infrações que ainda vão acontecer
      const diasCorridos = Math.max(1, (hoje - curIni) / MS);
      const perDay = total / diasCorridos;
      for (let p = 1; p <= PMAX; p++) {
        const winStart = new Date(curIni.getTime() + (p - 1) * SEMANAS_MES * 7 * MS);
        const winEnd = new Date(curIni.getTime() + p * SEMANAS_MES * 7 * MS);
        // pagamentos deste mês vêm de infrações ocorridas ~`prazo` dias antes; só conta o trecho futuro
        const infIni = new Date(winStart.getTime() - prazo * MS);
        const infFim = new Date(winEnd.getTime() - prazo * MS);
        const novos = Math.max(0, (infFim - Math.max(infIni, hoje)) / MS);
        finesOutProjRS[p] += novos * perDay;
      }
      if (!plateView) for (let p = 0; p <= PMAX; p++) { finesOutRealRS[p] /= activeCarsAt(p); finesOutProjRS[p] /= activeCarsAt(p); }
      finesOutReady = true;
    }
    // JUDICIAL (aba import_jud): custos de recuperação (guincho+recuperação) e reparo (avarias+
    // higienização+outros) por caso, na data do evento (col U). Caso SEM data -> mês vigente,
    // projetado. Futuro: ritmo histórico R$/dia da frota (casos novos vão acontecer no mesmo passo).
    // Termination fee (K−N−O) é ENTRADA no M13, × slider de % esperado de recebimento.
    let judRecRealRS = [], judRecProjRS = [], judRepRealRS = [], judRepProjRS = [], judTermRS = 0, judReady = false;
    function computeJud(f) {
      judRecRealRS = []; judRecProjRS = []; judRepRealRS = []; judRepProjRS = []; judTermRS = 0; judReady = false;
      const base = U.judBase && U.judBase.placas;
      if (!base || !curIni) return;
      const MS = 86400000;
      const moOf = (d) => { const m = Math.ceil(((d - curIni) / MS) / (SEMANAS_MES * 7)); return m < 1 ? 1 : m; };
      const plates = plateView ? [plateView] : (f.placas || []);
      for (let p = 0; p <= PMAX; p++) { judRecRealRS[p] = 0; judRecProjRS[p] = 0; judRepRealRS[p] = 0; judRepProjRS[p] = 0; }
      let totRec = 0, totRep = 0, totTerm = 0;
      plates.forEach((pl) => (base[pl] || []).forEach((c) => {
        totRec += c.recovery; totRep += c.repair; totTerm += c.term;
        const cur = currentMonthIdx();
        const mo = c.d ? Math.min(moOf(new Date(c.d + 'T12:00:00')), PMAX) : cur; // sem data -> mês vigente
        const realized = !!c.d && new Date(c.d + 'T12:00:00') <= hoje;
        if (realized) { judRecRealRS[mo] += c.recovery; judRepRealRS[mo] += c.repair; }
        else { judRecProjRS[mo] += c.recovery; judRepProjRS[mo] += c.repair; }
      }));
      // casos futuros: ritmo histórico R$/dia até o fim do contrato (M1..M12; rescisões não param hoje)
      const dias = Math.max(1, (hoje - curIni) / MS);
      const recDay = totRec / dias, repDay = totRep / dias, termDay = totTerm / dias;
      let futureDays = 0;
      for (let p = 1; p <= U.periods; p++) {
        const winStart = new Date(curIni.getTime() + (p - 1) * SEMANAS_MES * 7 * MS);
        const winEnd = new Date(curIni.getTime() + p * SEMANAS_MES * 7 * MS);
        const novos = Math.max(0, (winEnd - Math.max(winStart, hoje)) / MS);
        judRecProjRS[p] += novos * recDay;
        judRepProjRS[p] += novos * repDay;
        futureDays += novos;
      }
      // rescisão: conhecidos + acúmulo futuro, tudo no M13, escalado pelo slider de recebimento
      judTermRS = (totTerm + futureDays * termDay) * (termPct / 100);
      if (!plateView) {
        for (let p = 0; p <= PMAX; p++) { judRecRealRS[p] /= activeCarsAt(p); judRecProjRS[p] /= activeCarsAt(p); judRepRealRS[p] /= activeCarsAt(p); judRepProjRS[p] /= activeCarsAt(p); }
        judTermRS /= activeCarsAt(PMAX);
      }
      judReady = true;
    }
    // REPOSIÇÃO DE PEÇAS (site ocn-frota, categoria itens_reposicao): realizado = eventos de troca
    // (pastilhas/disco/pneus, classificados pelo texto) na data do evento × custo configurado.
    // Projetado = próximos cruzamentos de km de cada peça, pela quilometragem média da placa.
    let partsRealRS = [], partsProjRS = [], partsReady = false;
    function computeParts(f) {
      partsRealRS = []; partsProjRS = []; partsReady = false;
      const rep = U.reposicao && U.reposicao.placas;
      const fr = U.frota && U.frota.placas;
      if (!curIni || elapsed <= 0) return;
      const MS = 86400000;
      const moOf = (d) => { const m = Math.ceil(((d - curIni) / MS) / (SEMANAS_MES * 7)); return m < 1 ? 1 : m; };
      const plates = plateView ? [plateView] : (f.placas || []);
      for (let p = 0; p <= PMAX; p++) { partsRealRS[p] = 0; partsProjRS[p] = 0; }
      // km/dia médio da frota (fallback p/ placas sem odômetro confiável)
      let kmSum = 0, kmN = 0;
      (f.placas || []).forEach((pl) => { const d = fr && fr[pl]; if (d && d.ok && d.odo > 0) { kmSum += d.odo; kmN++; } });
      const diasCorridos = Math.max(1, (hoje - curIni) / MS);
      const kmDiaFrota = kmN ? (kmSum / kmN) / diasCorridos : 0;
      plates.forEach((pl) => {
        // realizado: só as trocas NATURAIS entram como custo nosso — as atípicas são pagas pelo
        // cliente. A API externa não expõe a classificação do buscador, então replica-se a MESMA
        // regra de desgaste (km mínimo desde a troca anterior; 1ª troca = km do hodômetro),
        // estimando o km na data do evento pelo ritmo da placa. Sem como estimar -> conta (conservador).
        const PART_MIN = {                                     // regra do buscador (ocorrencias-tree.js)
          pastilhas: { Polo: 15000, Tera: 15000, padrao: 20000 },
          disco: { Polo: 45000, Tera: 45000, padrao: 60000 },
          pneus: { padrao: 40000 },
        };
        const dPl = fr && fr[pl];
        const kmDiaPl = dPl && dPl.ok && dPl.odo > 0 ? dPl.odo / diasCorridos : kmDiaFrota;
        const evs = ((rep && rep[pl]) || []).slice().sort((a, b) => (a.d < b.d ? -1 : 1));
        const lastKm = {};
        evs.forEach((ev) => {
          const mo = Math.min(moOf(new Date(ev.d + 'T12:00:00')), PMAX);
          const diasEv = Math.max(0, (new Date(ev.d + 'T12:00:00') - curIni) / MS);
          const kmEv = kmDiaPl > 0 ? kmDiaPl * diasEv : null;
          ev.itens.forEach((it) => {
            const cfg = partCfg[it]; if (!cfg) return;
            const minTab = PART_MIN[it] || {};
            const min = minTab[model] != null ? minTab[model] : minTab.padrao;
            let natural = true;
            if (kmEv != null && min != null) {
              const desde = lastKm[it] != null ? kmEv - lastKm[it] : kmEv;
              natural = desde >= min;
            }
            if (kmEv != null) lastKm[it] = kmEv;
            if (natural) partsRealRS[mo] += cfg.rs;
          });
        });
        if (lossMonthByPlate[pl] != null) return;
        // projetado: cruzamentos futuros de km por peça (a partir do odômetro atual)
        const d = fr && fr[pl];
        const odo = d && d.ok && d.odo > 0 ? d.odo : kmDiaFrota * diasCorridos; // sem odômetro: estima
        const kmDia = d && d.ok && d.odo > 0 ? d.odo / diasCorridos : kmDiaFrota;
        if (kmDia <= 0) return;
        Object.values(partCfg).forEach((cfg) => {
          const intervalo = (cfg.km || 0) * 1000;
          if (intervalo <= 0 || !(cfg.rs > 0)) return;
          for (let k = Math.floor(odo / intervalo) + 1; k <= 60; k++) {
            const diasAte = (k * intervalo - odo) / kmDia;
            const quando = new Date(hoje.getTime() + diasAte * MS);
            const mo = moOf(quando);
            if (mo > U.periods) break;      // dentro do contrato
            partsProjRS[Math.max(mo, 1)] += cfg.rs;
          }
        });
      });
      if (!plateView) for (let p = 0; p <= PMAX; p++) { partsRealRS[p] /= activeCarsAt(p); partsProjRS[p] /= activeCarsAt(p); }
      partsReady = true;
    }
    // Subscription por dados reais (matriz de pagamentos por placa): receita do mês = Σ do VALOR REAL
    // recebido (s.r, já com juros) das semanas cujo vencimento cai no mês. Fallback p/ semanalidade×(1+juros)
    // se a API não trouxer o valor. Agregado = soma ÷ nº de placas ativas; visão por placa = sem divisão.
    let subsRS = [], subsJurosRS = [], subsReady = false;
    function computeSubs(f) {
      subsRS = []; subsJurosRS = []; subsReady = false;
      const fee = par('__sub_semanal__');
      const pag = U.pagamentos && U.pagamentos.placas;
      const ini = f.inicio ? new Date(f.inicio + 'T12:00:00') : null;
      if (!(fee > 0) || !pag || !ini) return;
      jurosPct = avgByVersion(f, VER_JUROS, 5); // taxa média conforme a versão do contrato das placas
      const plates = plateView ? [plateView] : (f.placas || []);
      for (let p = 0; p <= PMAX; p++) { subsRS[p] = 0; subsJurosRS[p] = 0; }
      plates.forEach((pl) => (pag[pl] || []).forEach((s) => {
        const venc = new Date(s.v + 'T12:00:00');
        let mo = Math.ceil(((venc - ini) / 86400000) / (SEMANAS_MES * 7));
        if (mo < 1) mo = 1;
        if (mo > U.periods) return;
        // separa principal (esperado) do juro de atraso (recebido − esperado); fallback = semanalidade×(1+juros)
        let principal, jr;
        if (s.r != null) { const esp = (s.e != null ? s.e : s.r); principal = Math.min(s.r, esp); jr = Math.max(0, s.r - esp); }
        else { principal = fee; jr = fee * (s.a ? jurosPct / 100 : 0); }
        subsRS[mo] += principal; subsJurosRS[mo] += jr;
      }));
      // ÷ carros ATIVOS do mês (perda total sai do denominador a partir do incidente); placa = sem divisão
      if (!plateView) for (let p = 0; p <= PMAX; p++) { subsRS[p] /= activeCarsAt(p); subsJurosRS[p] /= activeCarsAt(p); }
      subsReady = true;
    }

    // valor NATIVO da linha num período: { rs } para valores em R$ (manuais/derivados) ou { usd } para
    // valores fixos em dólar. Sem câmbio aqui — a conversão para a moeda de exibição acontece no effSplit.
    // Recorrências mensais param no M12; o M13 só recebe os lançamentos pontuais pós-contrato.
    function effNative(line, period) {
      if (line === 'Subscription' && par('__sub_semanal__') > 0) {
        // só o PRINCIPAL (esperado); o juro de atraso vai na linha "Late-payment interest"
        if (period === 0 || period === PMAX) return { rs: 0, perActive: true };
        // projeção de uma semana: semanalidade × (1 − inadimplência do slider); placa com perda total não paga
        const wk = par('__sub_semanal__') * (1 - inadimplencia / 100) * plateCut(period);
        if (periodStatus(period) === 'real') {
          if (!subsReady) return null;
          const real = subsRS[period] || 0;
          // mês VIGENTE: soma o que já foi recebido + projeção das segundas que ainda faltam nesta janela
          if (period === currentMonthIdx() && curIni) {
            return { rs: real, rsProj: mondaysInMonth(curIni, period, hoje) * wk, perActive: true };
          }
          return { rs: real, perActive: true };
        }
        if (!curIni) return null;
        return { rs: mondaysInMonth(curIni, period) * wk, perActive: true };
      }
      if (line === 'Late-payment interest' && par('__sub_semanal__') > 0) {
        // realizado = juro efetivo (recebido − esperado). Projetado = semanas × semanalidade
        // × % de semanas pagas em atraso (slider) × % de juros da caixinha da linha.
        if (period === 0 || period === PMAX) return { rs: 0, perActive: true };
        const wkJuros = par('__sub_semanal__') * (latePct / 100) * (jurosPct / 100) * plateCut(period);
        if (periodStatus(period) === 'real') {
          if (!subsReady) return null;
          const real = subsJurosRS[period] || 0;
          if (period === currentMonthIdx() && curIni) {
            return { rs: real, rsProj: mondaysInMonth(curIni, period, hoje) * wkJuros, perActive: true };
          }
          return { rs: real, perActive: true };
        }
        if (!curIni) return null;
        return { rs: mondaysInMonth(curIni, period) * wkJuros, perActive: true };
      }
      // Multas (entrada): realizado = pagas no mês; projetado = recebível em aberto + infrações futuras.
      // Vai até o M13 (o contrato acaba, mas ainda há multa a receber depois do último mês).
      if (line === 'Traffic fines') {
        if (period === 0 || !finesReady) return period === 0 ? { rs: 0, perActive: true } : null;
        return { rs: finesRealRS[period] || 0, rsProj: (finesProjRS[period] || 0) * plateCut(period), perActive: true };
      }
      // Multas (saída): o que pagamos à LM — realizado (já venceu) + projetado (a vencer/estimado)
      if (line === 'Traffic fines (out)') {
        if (period === 0 || !finesOutReady) return period === 0 ? { rs: 0, perActive: true } : null;
        return { rs: -(finesOutRealRS[period] || 0), rsProj: -(finesOutProjRS[period] || 0), perActive: true };
      }
      // Rescisão (import_jud): entrada única no M13 = cobranças × % esperado de recebimento (slider)
      if (line === 'Termination fee') {
        if (!judReady) return null;
        return period === PMAX ? { rs: 0, rsProj: judTermRS, perActive: true } : { rs: 0, perActive: true };
      }
      if (line === 'Recovery cost') {
        if (period === 0 || !judReady) return period === 0 ? { rs: 0, perActive: true } : null;
        return { rs: -(judRecRealRS[period] || 0), rsProj: -(judRecProjRS[period] || 0), perActive: true };
      }
      if (line === 'Repair cost') {
        if (period === 0 || !judReady) return period === 0 ? { rs: 0, perActive: true } : null;
        return { rs: -(judRepRealRS[period] || 0), rsProj: -(judRepProjRS[period] || 0), perActive: true };
      }
      if (line === 'Part Replacement') {
        if (period === 0 || !partsReady) return period === 0 ? { rs: 0, perActive: true } : null;
        return { rs: -(partsRealRS[period] || 0), rsProj: -(partsProjRS[period] || 0), perActive: true };
      }
      if (line === 'Subrental fee' && par('__subrental_mensal__') > 0) {
        // 12 parcelas mensais, SEMPRE no dia 26, começando no mês seguinte ao da retirada do carro.
        // Ex.: retirada 01/04 -> 1ª parcela 26/05 (cai no M2) e a 12ª em 26/04 do ano seguinte (M13).
        // O usuário preenche só a mensalidade; as datas saem do calendário real.
        if (!curIni) return null;
        const n = subrentalMonthsAt(period);
        return { rs: n ? -par('__subrental_mensal__') * n * plateCut(period) : 0, perActive: true };
      }
      if (line === 'Maintenance' && maintReady) {
        if (period === 0) return { rs: 0, perActive: true };
        // Realizado e projetado convivem no mesmo mês: uma nota já emitida com vencimento FUTURO é
        // custo comprometido (realizado), enquanto as revisões ainda sem pagamento entram projetadas.
        // Vai até o M13: revisão feita perto do fim do contrato é paga (prazo médio) depois dele.
        return { rs: -(maintRealRS[period] || 0), rsProj: -(maintProjRS[period] || 0), perActive: true };
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
        const rp = par('__refund_pct__') > 0 ? par('__refund_pct__') / 100 : refundPct; // caixinha da linha vence o global
        return { rs: period === PMAX ? secDepMag() * (1 + rp) : 0 }; // devolução corrigida, no M13
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
      // célula híbrida: realizado (câmbio fixo) + projetado (câmbio futuro) no MESMO mês — acontece no
      // mês vigente (semanas já pagas + as que faltam) e na Maintenance (nota emitida com venc. futuro).
      if (v.rsProj != null) {
        return { real: toDisplay({ rs: v.rs || 0 }, ORCADO_FX), proj: toDisplay({ rs: v.rsProj }, cotacao), status: v.rs ? 'real' : st, perActive: !!v.perActive };
      }
      return st === 'real'
        ? { real: toDisplay(v, ORCADO_FX), proj: 0, status: 'real', perActive: !!v.perActive }
        : { real: 0, proj: toDisplay(v, cotacao), status: 'proj', perActive: !!v.perActive };
    }
    // all-mode: contexto por frota — cada frota tem params/entradas/eixo de meses/perdas/pagamentos próprios
    function applyCtx(c) {
      model = c.f.model; params = c.params; entered = c.entered; curIni = c.ini; ctxCars = c.f.cars || 0;
      elapsed = c.elapsed; realizedFull = c.realizedFull; lossMonthByPlate = c.lossMonthByPlate; activeFracArr = c.activeFracArr;
      subsRS = c.subsRS || []; subsJurosRS = c.subsJurosRS || []; subsReady = !!c.subsReady;
      maintRealRS = c.maintRealRS || []; maintProjRS = c.maintProjRS || []; maintReady = !!c.maintReady;
      finesRealRS = c.finesRealRS || []; finesProjRS = c.finesProjRS || []; finesReady = !!c.finesReady;
      finesOutRealRS = c.finesOutRealRS || []; finesOutProjRS = c.finesOutProjRS || []; finesOutReady = !!c.finesOutReady;
      judRecRealRS = c.judRecRealRS || []; judRecProjRS = c.judRecProjRS || []; judRepRealRS = c.judRepRealRS || []; judRepProjRS = c.judRepProjRS || []; judTermRS = c.judTermRS || 0; judReady = !!c.judReady;
      partsRealRS = c.partsRealRS || []; partsProjRS = c.partsProjRS || []; partsReady = !!c.partsReady;
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
        // modo limpo: um número só (realizado + projetado somados) e, quando há mistura,
        // uma barrinha proporcional abaixo mostrando quanto de cada — sem poluir com o orçado.
        if (cleanView) {
          const tot = (e.real || 0) + (e.proj || 0);
          if (!e.real && !e.proj) return `<span class="ue-main ue-${e.status}">-</span>`;
          const mixed = e.real && e.proj;
          const kind = mixed ? 'mix' : (e.real ? 'real' : 'proj');
          s += `<span class="ue-main ue-${kind}">${ueFmt(tot)}</span>`;
          if (mixed) {
            const pr = Math.max(0, Math.min(100, Math.abs(e.real) / (Math.abs(e.real) + Math.abs(e.proj)) * 100));
            s += `<span class="ue-mixbar" title="realized ${ueFmt(e.real)} + projected ${ueFmt(e.proj)}"><i style="width:${pr.toFixed(1)}%"></i></span>`;
          }
          return s;
        }
        if (e.real) s += `<span class="ue-main ue-real">${ueFmt(e.real)}</span>`;
        if (e.proj) s += `<span class="ue-main ue-proj">${ueFmt(e.proj)}</span>`;
        if (!e.real && !e.proj) s += `<span class="ue-main ue-${e.status}">-</span>`;
      }
      if (orc != null && !cleanView) s += `<span class="ue-orc">${ueFmt(orc)}</span>`;
      // lacuna sem NADA (linha não se aplica ao período, ex.: Sticker fora do M0) vira "-" (= zero)
      if (!s) s = '<span class="ue-main ue-empty">-</span>';
      return s;
    }
    function cellVal(t) { // totalizador (computado) ou coluna Total
      let s = '';
      if (t && t.hasMain) s += `<span class="ue-main ue-${t.kind}">${ueFmt(t.eff)}</span>`;
      if (t && t.orc != null && !cleanView) s += `<span class="ue-orc">${ueFmt(t.orc)}</span>`;
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
      return `<div class="ue-slider"><div class="ue-sl-top"><label>${label}</label><span class="ue-sl-val" id="${id}Val"></span></div>` +
        `<input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"${isAdmin ? '' : ' disabled'}/></div>`;
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

    // "?" — origem e atualização de cada linha (referência rápida p/ quem consome a tabela)
    function openInfoModal() {
      const ROWS = [
        ['Subscription', 'Payments matrix (billing panel API) + weekly fee (✎ box)', 'Auto, daily'],
        ['Late-payment interest', 'Same matrix (actual interest) + contract version (v1/v2 5% · v3+ 20%) + late % slider', 'Auto, daily'],
        ['Traffic fines (inflow)', 'Fines API (billing panel) — what clients pay us', 'Auto, daily'],
        ['Termination fee', 'Sheet import_jud (total charge − fines/tolls) + recovery % slider · lands in M13', 'Auto, daily'],
        ['Initial Fee / Vehicle Sell', '✎ box (103% of purchase) · M13', 'Manual'],
        ['Security Deposit Refund', 'Derived: deposit × (1 + % p.a. field) · M13', 'Manual'],
        ['Subrental fee', '✎ monthly amount; 12 installments always on the 26th (M2–M13)', 'Manual'],
        ['Insurance', '✎ boxes (total / installments)', 'Manual'],
        ['Car Preparation / Sticker', 'Fixed at M0 (−50 / −15 R$)', 'Static'],
        ['Maintenance', 'Sheet import_rev (real invoices by due date) + revisions site prices −25% + fleet API odometer', 'Auto, daily'],
        ['GPS / Security Deposit / Vehicle Purchase', '✎ boxes', 'Manual'],
        ['Traffic fines (outflow)', 'Sheet multas_consolidado (amount we pay LM, by our due date)', 'Auto, daily'],
        ['Recovery / Repair cost', 'Sheet import_jud (towing+recovery / damages+cleaning+others, by event date)', 'Auto, daily'],
        ['Part Replacement', 'Fleet site events (natural wear only) + ⚙ Parts panel (intervals & costs)', 'Auto, daily / panel'],
      ];
      const ov = document.createElement('div');
      ov.className = 'ue-modal-overlay';
      ov.innerHTML =
        `<div class="ue-modal ue-modal-info"><div class="ue-modal-title">Where each line comes from</div>` +
        `<div class="ue-modal-sub">Automatic sources refresh <b>daily at 05:00 (São Paulo)</b>, on every deploy, and via the ↻ Refresh button. Manual boxes/sliders save instantly to the database.</div>` +
        `<table class="ue-info-table"><thead><tr><th>Line</th><th>Source</th><th>Updates</th></tr></thead><tbody>` +
        ROWS.map(([l, o, u]) => `<tr><td>${l}</td><td>${o}</td><td>${u}</td></tr>`).join('') +
        `</tbody></table>` +
        `<div class="ue-modal-hint">Realized values render in black (fixed FX), projections in purple (future FX slider), budget in grey. The current month combines realized + the remaining projection.</div>` +
        `<div class="ue-modal-actions"><button type="button" class="ue-modal-cancel">Close</button></div></div>`;
      document.body.appendChild(ov);
      const close = () => ov.remove();
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      ov.querySelector('.ue-modal-cancel').addEventListener('click', close);
    }

    // painel ⚙ Parts: a cada quantos MIL km trocar cada peça + custo por troca (global, persiste em __cfg__)
    function openPartsModal(f) {
      const PARTS = [['pastilhas', 'Brake pads', '🟣'], ['disco', 'Brake discs', '⚙️'], ['pneus', 'Tires', '🛞']];
      const ov = document.createElement('div');
      ov.className = 'ue-modal-overlay';
      ov.innerHTML =
        `<div class="ue-modal ue-modal-parts"><div class="ue-modal-title">Part Replacement — intervals &amp; costs</div>` +
        `<div class="ue-modal-sub">One card per part: how often it wears out and what one replacement costs us.</div>` +
        PARTS.map(([k, lbl, ic]) =>
          `<div class="ue-part-group">` +
            `<div class="ue-part-title"><span class="ue-part-ic">${ic}</span>${lbl}</div>` +
            `<div class="ue-part-row">` +
              `<label class="ue-part-field"><span class="ue-part-lbl">Replace every</span>` +
                `<span class="ue-part-inwrap"><input type="text" inputmode="decimal" data-k="${k}" data-f="km" value="${partCfg[k].km}"/><b>× 1.000 km</b></span></label>` +
              `<label class="ue-part-field"><span class="ue-part-lbl">Cost per replacement</span>` +
                `<span class="ue-part-inwrap"><b>R$</b><input type="text" inputmode="decimal" data-k="${k}" data-f="rs" value="${partCfg[k].rs}"/></span></label>` +
            `</div>` +
          `</div>`
        ).join('') +
        `<div class="ue-modal-hint">Realized costs come from the fleet site events (only natural wear — atypical ones are charged to the client); projections use each plate's average km pace and these intervals.</div>` +
        `<div class="ue-modal-actions"><button type="button" class="ue-modal-cancel">Cancel</button><button type="button" class="ue-modal-save">Save</button></div></div>`;
      document.body.appendChild(ov);
      const close = () => ov.remove();
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      ov.querySelector('.ue-modal-cancel').addEventListener('click', close);
      ov.querySelector('.ue-modal-save').addEventListener('click', async () => {
        const ops = [];
        ov.querySelectorAll('input[data-k]').forEach((inp) => {
          const val = parseFloat(String(inp.value).trim().replace(/\./g, '').replace(',', '.'));
          if (!isFinite(val) || val < 0) return;
          partCfg[inp.dataset.k][inp.dataset.f] = val;
          ops.push({ k: '__part_' + inp.dataset.k + '_' + inp.dataset.f + '__', value: val });
        });
        if (isAdmin) for (const o of ops) {
          try { await fetch('/api/ue/value', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fleet: '__cfg__', line: o.k, period: 0, value: o.value, kind: 'real' }) }); } catch (e) {}
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
      // barra do contrato: início ——[quanto já correu]—— início + 52 semanas (só com data de início;
      // em "All fleets" cada frota tem um começo diferente, então a barra não aparece)
      let contractBar = '';
      if (ini && !allMode) {
        const totalWeeks = U.periods * SEMANAS_MES;                      // 12 × 4,3333 = 52
        const wkNow = Math.max(0, (hoje - ini) / (7 * 86400000));
        const pct = Math.max(0, Math.min(100, (wkNow / totalWeeks) * 100));
        const endIso = new Date(ini.getTime() + totalWeeks * 7 * 86400000).toISOString().slice(0, 10);
        const done = pct >= 100;
        // marcas de virada de mês do CALENDÁRIO ao longo da barra (1º dia de cada mês dentro do contrato)
        const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
        const totalMs = totalWeeks * 7 * 86400000;
        let ticks = '';
        const cur = new Date(ini.getFullYear(), ini.getMonth() + 1, 1); // próxima virada de mês
        while (cur.getTime() - ini.getTime() < totalMs) {
          const at = ((cur.getTime() - ini.getTime()) / totalMs) * 100;
          ticks += `<span class="ue-contract-tick" style="left:${at.toFixed(2)}%"><i></i><b>${MESES[cur.getMonth()]}</b></span>`;
          cur.setMonth(cur.getMonth() + 1);
        }
        contractBar =
          `<div class="ue-contract">` +
            `<span class="ue-contract-date">${fmtDate(f.inicio)}</span>` +
            `<div class="ue-contract-track" title="${Math.floor(wkNow)} of ${Math.round(totalWeeks)} weeks elapsed">` +
              `<div class="ue-contract-fill${done ? ' done' : ''}" style="width:${pct.toFixed(1)}%"></div>` +
              ticks +
              `<span class="ue-contract-lbl">week ${Math.min(Math.floor(wkNow), Math.round(totalWeeks))} of ${Math.round(totalWeeks)} · ${Math.round(pct)}%</span>` +
            `</div>` +
            `<span class="ue-contract-date">${fmtDate(endIso)}</span>` +
          `</div>`;
      }
      document.getElementById('ueHead').innerHTML =
        `<div class="ue-headrow">` +
          `<div class="ue-fleet-head">` +
            (foto ? `<div class="ue-car-photo"><img src="${foto}" alt="${f.modelLabel}"/></div>` : '') +
            `<div><div class="ue-fleet-title">${f.label} — ${f.modelLabel}</div>` +
            `<div class="ue-fleet-sub">${f.cars} cars · ${U.periods}-month contract</div>` +
            `<div class="ue-fleet-sub">${subInfo}</div></div>` +
          `</div>` +
          `<div class="ue-head-actions">` +
            // moeda + Clean view empilhados (o Clean fica logo abaixo das bandeiras)
            `<div class="ue-actstack">` +
              `<div class="ue-cur-toggle" id="ueCurToggle">` +
                `<button class="ue-cur-btn${currency === 'BRL' ? ' active' : ''}" data-c="BRL" title="Reais (R$)"><svg viewBox="0 0 20 14" class="ue-flag"><rect width="20" height="14" rx="2" fill="#009C3B"/><path d="M10 2.2 17.5 7 10 11.8 2.5 7Z" fill="#FFDF00"/><circle cx="10" cy="7" r="2.7" fill="#002776"/></svg></button>` +
                `<button class="ue-cur-btn${currency === 'USD' ? ' active' : ''}" data-c="USD" title="US Dollars (US$)"><svg viewBox="0 0 20 14" class="ue-flag"><rect width="20" height="14" rx="2" fill="#fff"/><g fill="#B22234"><rect y="0" width="20" height="2"/><rect y="4" width="20" height="2"/><rect y="8" width="20" height="2"/><rect y="12" width="20" height="2"/></g><rect width="9" height="6" fill="#3C3B6E"/></svg></button>` +
              `</div>` +
              `<button class="ue-clean2${cleanView ? ' on' : ''}" id="ueClean" title="Hide the budget comparison and show one combined number per month">✨ Clean view</button>` +
            `</div>` +
            `<button class="ue-tool-btn" id="ueParts" title="Replacement intervals and cost per part">⚙ Parts</button>` +
            (isAdmin ? `<label class="ue-switch"><input type="checkbox" id="ueManual"${manualMode ? ' checked' : ''}/><span>Manual mode</span></label>` : '') +
            `<button class="ue-tool-btn" id="ueRefresh" title="Re-fetches the spreadsheet data">↻ Refresh</button>` +
            `<button class="ue-tool-btn ue-info-btn" id="ueInfo" title="Where each line comes from and how it updates">?</button>` +
          `</div>` +
        `</div>` +
        contractBar +
        `<div class="ue-sliders">` +
          slider('ueCotacao', 'future FX (R$/US$)', 3, 8, 0.05, cotacao) +
          slider('ueInad', 'delinquency rate (%)', 0, 50, 1, inadimplencia) +
          slider('ueLate', 'late-payment rate (%)', 0, 100, 1, latePct) +
          slider('ueTermPct', 'termination fee recovery (%)', 0, 100, 1, termPct) +
        `</div>`;
      const infoBtn = document.getElementById('ueInfo');
      if (infoBtn) infoBtn.addEventListener('click', openInfoModal);
      const partsBtn = document.getElementById('ueParts');
      if (partsBtn) partsBtn.addEventListener('click', () => openPartsModal(f));
      const cleanBtn = document.getElementById('ueClean');
      if (cleanBtn) cleanBtn.addEventListener('click', () => { cleanView = !cleanView; loadFleet(); });
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
      wireSlider('ueLate', (v) => { latePct = v; }, () => latePct + '%', () => latePct, '__late_pct__', '__cfg__', f);
      wireSlider('ueTermPct', (v) => { termPct = v; }, () => termPct + '%', () => termPct, '__term_pct__', '__cfg__', f);
      renderTable(f);
      renderPlates(f);
    }

    function renderTable(f) {
      const orc = U.orcado[f.model];
      const tbl = document.getElementById('ueTable');
      if (!orc) { tbl.innerHTML = '<tbody><tr><td>No budget for ' + f.modelLabel + '</td></tr></tbody>'; return; }
      // injeta a linha de juros de atraso logo após Subscription (entra no Total Inflow; principal fica na Subscription)
      const subIdx = orc.lines.findIndex((l) => l.label === 'Subscription');
      let lines = subIdx < 0 ? orc.lines
        : [...orc.lines.slice(0, subIdx + 1),
           { label: 'Late-payment interest', group: 'inflow', values: [] },
           { label: 'Traffic fines', group: 'inflow', values: [] },
           { label: 'Termination fee', group: 'inflow', values: [] },
           ...orc.lines.slice(subIdx + 1)];
      // saídas extras no fim do bloco de outflow: multas (repasse), recuperação/reparo (import_jud)
      // e reposição de peças (site da frota)
      const lastOut = lines.map((l) => l.group).lastIndexOf('outflow');
      if (lastOut >= 0) {
        lines = [...lines.slice(0, lastOut + 1),
          { label: 'Traffic fines (out)', group: 'outflow', values: [] },
          { label: 'Recovery cost', group: 'outflow', values: [] },
          { label: 'Repair cost', group: 'outflow', values: [] },
          { label: 'Part Replacement', group: 'outflow', values: [] },
          ...lines.slice(lastOut + 1)];
      }
      // Subscription/Maintenance dependem da frota E da visão (placa/agregado); all-mode pré-computa por frota
      if (allMode && fleetCtx) {
        if (plateView) {
          const c = fleetCtx.find((x) => (x.f.placas || []).includes(plateView));
          if (c) { applyCtx(c); computeSubs(c.f); computeMaint(c.f); computeFines(c.f); computeFinesOut(c.f); computeJud(c.f); computeParts(c.f); }
        } else {
          fleetCtx.forEach((c) => {
            applyCtx(c); computeSubs(c.f); computeMaint(c.f); computeFines(c.f); computeFinesOut(c.f); computeJud(c.f); computeParts(c.f);
            c.subsRS = subsRS; c.subsJurosRS = subsJurosRS; c.subsReady = subsReady;
            c.maintRealRS = maintRealRS; c.maintProjRS = maintProjRS; c.maintReady = maintReady;
            c.finesRealRS = finesRealRS; c.finesProjRS = finesProjRS; c.finesReady = finesReady;
            c.finesOutRealRS = finesOutRealRS; c.finesOutProjRS = finesOutProjRS; c.finesOutReady = finesOutReady;
            c.judRecRealRS = judRecRealRS; c.judRecProjRS = judRecProjRS; c.judRepRealRS = judRepRealRS; c.judRepProjRS = judRepProjRS; c.judTermRS = judTermRS; c.judReady = judReady;
            c.partsRealRS = partsRealRS; c.partsProjRS = partsProjRS; c.partsReady = partsReady;
          });
        }
      } else {
        computeSubs(f);
        computeMaint(f);
        computeFines(f);
        computeFinesOut(f);
        computeJud(f);
        computeParts(f);
      }
      const T = computeTotals(lines);
      const gmap = { totalInflow: T.totalInflow, totalOutflow: T.totalOutflow, net: T.net, acc: T.acc };
      const editable = isAdmin && manualMode && !allMode; // no all-mode não há frota única p/ salvar edições
      let html = '<thead><tr><th class="ue-rowlabel">Line</th><th>M0</th>';
      for (let p = 1; p <= PMAX; p++) html += `<th>M${p}</th>`;
      html += '<th class="ue-totalcol">Total</th></tr></thead><tbody>';
      lines.forEach((l) => {
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
          const lp = get('__late_pct__'); if (lp != null) latePct = lp;
          const tp = get('__term_pct__'); if (tp != null) termPct = tp;
          ['pastilhas', 'disco', 'pneus'].forEach((it) => {
            const km = get('__part_' + it + '_km__'); if (km != null) partCfg[it].km = km;
            const rs = get('__part_' + it + '_rs__'); if (rs != null) partCfg[it].rs = rs;
          });
          const rp = get('__refund_pct__'); if (rp != null) refundPct = rp;
        }
      } catch (e) { /* usa defaults */ }
      loadFleet();
    })();
  }
  }
})();

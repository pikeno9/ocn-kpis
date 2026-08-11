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
    const ur = document.getElementById('userRole'); if (ur) ur.textContent = (meta.user.role || '').replace(/_/g, ' ');
    // avatar: as fotos de perfil vêm do Portal OCN e vivem em /avatars/<login-sem-domínio>.webp.
    // Quem não tem foto cai nas iniciais — o onerror troca a imagem pelo fallback sozinho.
    const av = document.getElementById('profAv');
    if (av) {
      const login = String(meta.user.login || '').split('@')[0].toLowerCase();
      const nome = meta.user.name || login;
      const iniciais = nome.split(/[\s.]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
      const img = new Image();
      img.alt = nome;
      img.onload = () => { av.innerHTML = ''; av.appendChild(img); };
      img.onerror = () => { av.textContent = iniciais || '?'; };
      img.src = '/avatar/' + login + '?t=' + Date.now();   // t= evita cache velho depois de trocar
      av.textContent = iniciais || '?'; // fallback imediato enquanto a foto carrega
    }
  }
  // ---------- trocar a foto de perfil ----------
  // O recorte e o redimensionamento acontecem AQUI, antes de subir: a imagem vira um quadrado
  // de 480px em webp (~20 KB). Sem isso um JPEG de celular subiria com vários MB para um
  // avatar de 36px, e a foto fica guardada no banco, não no disco.
  const AVATAR_PX = 480;
  function fotoParaWebp(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('could not read the file'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('not a valid image'));
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = AVATAR_PX; c.height = AVATAR_PX;
          const ctx = c.getContext('2d');
          const lado = Math.min(img.width, img.height);
          // recorte centrado na horizontal; na vertical puxa um pouco para cima, onde fica o rosto
          const sx = (img.width - lado) / 2;
          const sy = Math.max(0, (img.height - lado) * 0.12);
          ctx.drawImage(img, sx, sy, lado, lado, 0, 0, AVATAR_PX, AVATAR_PX);
          let out = c.toDataURL('image/webp', 0.9);
          if (!/^data:image\/webp/.test(out)) out = c.toDataURL('image/jpeg', 0.9); // navegador sem webp
          resolve(out);
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  const btnPic = document.getElementById('btnChangePic'), profFile = document.getElementById('profFile');
  if (btnPic && profFile) {
    btnPic.addEventListener('click', () => profFile.click());
    profFile.addEventListener('change', async () => {
      const f = profFile.files && profFile.files[0];
      profFile.value = '';                       // permite reenviar o mesmo arquivo depois
      if (!f) return;
      try {
        const image = await fotoParaWebp(f);
        const r = await fetch('/api/perfil/avatar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ image }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.ok) throw new Error(d.error || ('HTTP ' + r.status));
        const av = document.getElementById('profAv');
        if (av) { av.innerHTML = ''; const i = new Image(); i.src = image; av.appendChild(i); }
      } catch (e) { alert('Could not change the photo: ' + e.message); }
    });
  }
  // menu do perfil (avatar → trocar senha / sair)
  const profBtn = document.getElementById('profBtn'), profPop = document.getElementById('profPop');
  if (profBtn && profPop) {
    const closeProf = () => { profPop.hidden = true; profBtn.classList.remove('open'); document.removeEventListener('click', outProf); };
    const outProf = (e) => { if (!document.getElementById('appProf').contains(e.target)) closeProf(); };
    profBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (profPop.hidden) { profPop.hidden = false; profBtn.classList.add('open'); setTimeout(() => document.addEventListener('click', outProf), 0); }
      else closeProf();
    });
    profPop.addEventListener('click', () => closeProf()); // qualquer item fecha o menu
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
      // trilho de % do P&L: alturas foram medidas com a seção oculta (tudo 0) — re-mede ao abrir
      if (tab.dataset.sub === 'pnl' && window.__pnlVaLayout) window.__pnlVaLayout();
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

  // ---------- MULTAS: ritmo por carro, corrigido pela MATURAÇÃO da base ----------
  // Uma infração só entra em multas_consolidado quando o e-mail do órgão chega. Medido NESTA base
  // (292 multas): média 20 dias, p90 27, máximo 42. Dividir o total conhecido por TODOS os dias
  // desde o início da frota conta dias cujas multas ainda não chegaram — e subestima o ritmo em
  // TODAS as frotas, não só nas novas (medido: −15% na frota 1, −47% na frota 6). A janela de
  // observação aqui para no último dia já maduro (hoje − FINES_LAG_D).
  // Frota recém-aberta ainda tem exposição fina e estimativa ruidosa (a frota 6 tem 6 multas onde
  // o ritmo médio preveria 22), então o ritmo próprio é MISTURADO com o das demais por
  // credibilidade — peso = exposição / (exposição + K). Isso substitui um corte seco por idade:
  // a frota passa a usar dados próprios à medida que eles ganham massa, sem degrau.
  const FINES_LAG_D = 27;   // p90 medido do atraso infração -> e-mail
  const FINES_CRED_K = 50;  // carro-meses em que o ritmo próprio pesa 50%
  let _finesRates = null;
  function finesRatesByFleet() {
    if (_finesRates) return _finesRates;
    const U = OCN.ue || {};
    const MB = U.multasBase || {}, base = MB.placas || {}, MS = 86400000, MESd = UET_WPM * 7;
    const hoje = new Date(((U.hoje) || new Date().toISOString().slice(0, 10)) + 'T12:00:00');
    const cut = new Date(hoje.getTime() - FINES_LAG_D * MS);
    const desc = MB.descontoMedio || 0.8;
    const ctv = U.contratos || {};
    const premOf = (pl) => ((ctv[pl] || 1) >= 3 ? 0.20 : 0.10);
    // bruto = o que se cobra do cliente (antes do prêmio); líquido × 1,05 = o que se paga à LM
    const grossOf = (x) => (x.bruto > 0 ? x.bruto : (x.liq > 0 ? x.liq / desc : (x.v || 0) / 1.05 / desc));
    const netOf = (x) => (x.liq > 0 ? x.liq : (x.v || 0) / 1.05) * 1.05;
    const per = {}; let poolG = 0, poolN = 0, poolD = 0;
    (U.fleets || []).forEach((f) => {
      if (!f.inicio) return;
      const plates = f.placas || [];
      const cars = Math.max(1, f.cars || plates.length || 1);
      const carDays = Math.max(0, (cut - new Date(f.inicio + 'T12:00:00')) / MS) * cars;
      let g = 0, n = 0;
      plates.forEach((pl) => (base[pl] || []).forEach((x) => {
        if (!x.inf || new Date(x.inf + 'T12:00:00') > cut) return;   // ainda não maduro
        g += grossOf(x); n += netOf(x);
      }));
      // prêmio médio DA PRÓPRIA frota: o ritmo emprestado das outras é de valor bruto, e o prêmio
      // (10% v1/v2, 20% v3+) depende da versão de contrato das placas desta frota, não das delas
      const prem = plates.length ? plates.reduce((s, pl) => s + (1 + premOf(pl)), 0) / plates.length : 1.10;
      per[f.id] = { g, n, carDays, prem };
      poolG += g; poolN += n; poolD += carDays;
    });
    const pg = poolD ? poolG / poolD : 0, pn = poolD ? poolN / poolD : 0;
    // prêmio médio de TODAS as placas — usado quando a projeção é da operação inteira, não de uma frota
    const allPl = (U.fleets || []).reduce((a, f) => a.concat(f.placas || []), []);
    const poolPrem = allPl.length ? allPl.reduce((s, pl) => s + (1 + premOf(pl)), 0) / allPl.length : 1.10;
    const out = { __pool: { gross: pg, net: pn, prem: poolPrem } };
    Object.entries(per).forEach(([id, v]) => {
      const expo = v.carDays / MESd;                       // exposição madura em carro-meses
      const w = expo / (expo + FINES_CRED_K);              // credibilidade do dado próprio
      const og = v.carDays ? v.g / v.carDays : pg, on = v.carDays ? v.n / v.carDays : pn;
      out[id] = {
        gross: w * og + (1 - w) * pg,                      // R$/carro/dia (bruto, sem prêmio)
        net: w * on + (1 - w) * pn,                        // R$/carro/dia (o que sai para a LM)
        prem: v.prem, w, expo, ownGross: og, poolGross: pg,
      };
    });
    _finesRates = out;
    return out;
  }

  // ---------- InDrive: benefício por placa, recebido em LEVAS (uma data + uma lista de placas) ----------
  // Fonte única: alimenta a linha "Initial Fee / Vehicle Sell" no UE real e no P&L (que tem um
  // botão para tirar o efeito da conta, igual ao "No deposit").
  let indriveData = { value: 0, batches: [] }, indriveLoaded = false;
  async function loadIndrive() {
    if (indriveLoaded) return indriveData;
    indriveLoaded = true;
    try {
      const r = await fetch('/api/indrive', { credentials: 'include', cache: 'no-store' });
      if (r.ok) { const d = await r.json(); if (d && d.indrive) indriveData = { value: Number(d.indrive.value) || 0, batches: d.indrive.batches || [] }; }
    } catch (e) { /* segue sem InDrive */ }
    return indriveData;
  }
  const indriveOn = () => indriveData.value > 0 && indriveData.batches.length > 0;
  // TIR (IRR) dos fluxos M0..Mn — taxa POR PERÍODO (o "mês" de 4,333 semanas do UE).
  // O fluxo do UE não é convencional (troca de sinal mais de uma vez: M0 negativo, meses positivos,
  // M13 com compra/venda do veículo), então bracketar direto nas pontas falha. Varremos o VPL numa
  // grade de taxas, pegamos o PRIMEIRO intervalo com troca de sinal e refinamos por bissecção —
  // é a menor raiz ≥ −99%, que é a que faz sentido econômico. null = nenhuma raiz na faixa.
  function irrOf(flows) {
    const f = (flows || []).map((v) => Number(v) || 0);
    if (f.length < 2) return null;
    if (!f.some((v) => v > 0) || !f.some((v) => v < 0)) return null; // sem entrada ou sem saída: não existe TIR
    const npv = (r) => f.reduce((s, v, i) => s + v / Math.pow(1 + r, i), 0);
    const LO = -0.99, HI = 10, N = 600, step = (HI - LO) / N;
    let a = LO, fa = npv(a);
    for (let i = 1; i <= N; i++) {
      const b = LO + i * step, fb = npv(b);
      if (isFinite(fa) && isFinite(fb) && fa * fb <= 0) {
        let lo = a, hi = b, flo = fa;
        for (let k = 0; k < 120; k++) {
          const mid = (lo + hi) / 2, fm = npv(mid);
          if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; }
        }
        const r = (lo + hi) / 2;
        return isFinite(r) ? r : null;
      }
      a = b; fa = fb;
    }
    return null;
  }

  // toggle de moeda com bandeirinhas — mesmo markup no UE real e no Teórico
  const CUR_FLAGS = (cur) =>
    `<button class="ue-cur-btn${cur === 'BRL' ? ' active' : ''}" data-c="BRL" title="Reais (R$)"><svg viewBox="0 0 20 14" class="ue-flag"><rect width="20" height="14" rx="2" fill="#009C3B"/><path d="M10 2.2 17.5 7 10 11.8 2.5 7Z" fill="#FFDF00"/><circle cx="10" cy="7" r="2.7" fill="#002776"/></svg></button>` +
    `<button class="ue-cur-btn${cur === 'USD' ? ' active' : ''}" data-c="USD" title="US Dollars (US$)"><svg viewBox="0 0 20 14" class="ue-flag"><rect width="20" height="14" rx="2" fill="#fff"/><g fill="#B22234"><rect y="0" width="20" height="2"/><rect y="4" width="20" height="2"/><rect y="8" width="20" height="2"/><rect y="12" width="20" height="2"/></g><rect width="9" height="6" fill="#3C3B6E"/></svg></button>`;

  // MESMA estrutura de linhas do UE real: leaf (inflow/outflow) + calc (totalizadores)
  const UET_LINES = [
    { label: 'Subscription', group: 'inflow' },
    { label: 'Late-payment interest', group: 'inflow' },
    { label: 'Traffic fines', group: 'inflow' },            // espelho do UE real (sem cálculo teórico ainda)
    { label: 'Termination fee', group: 'inflow' },
    { label: 'Vehicle Sell', group: 'inflow' },
    { label: 'InDrive bonus', group: 'inflow' },       // espelho (o teórico não modela o InDrive)
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
      case 'Vehicle Sell': return (p === PMAX && par('__vehicle__') > 0) ? par('__vehicle__') * 1.03 : null;
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
  // Headcount / SG&A / CAC agora têm um jogo de dados POR ANO (finXxxByYear). `finHc`/`finSga`/`finCac`
  // continuam sendo o objeto de sempre — todo o código que já lê `finHc.roles`, `finSga.rent` etc.
  // funciona sem mudar nada — mas passam a ser só um PONTEIRO para `finXxxByYear[finYear]`, trocado
  // por `setFinYear()`/`withYear()` sempre que o ano muda. Sem isso, 2027 usava silenciosamente os
  // mesmos custos/comissões de 2026 (não havia como digitar números diferentes para o ano seguinte).
  const emptyHc = () => ({ roles: [], people: [], plan: {} });
  const emptySga = () => ({ rent: [], prof: [], it: [] });
  const emptyCac = () => ({ perUnit: 0, recPerUnit: 0, ads: [], inf: [] });
  let finHcByYear = {}, finSgaByYear = {}, finCacByYear = {};
  let finHc = emptyHc(), finSga = emptySga(), finCac = emptyCac();
  let finEdit = false; // "Edit mode" do Finance (compartilhado por todas as abas) — começa somente leitura
  let sgaTab = 'hc', cacTab = 'comm'; // abas de 3º nível dentro de SG&A e CAC & Marketing
  let pnlNoSd = false; // P&L: excluir o sub-rental security deposit da visão
  let pnlNoIdr = false; // P&L: tirar o efeito da InDrive da conta (mesma mecânica do "No deposit")
  let pnlCur = 'USD';   // moeda de EXIBIÇÃO do P&L (o motor calcula em R$ e divide pelo câmbio)
  let pnlShowProj = true; // false = só realizado, igual ao "Actuals only" do UE
  // padrão: Gross Revenue e OPEX abertos (é o que se olha primeiro); o resto fechado
  let pnlCollapsed = new Set(['tax', 'cogs', 'cac', 'sga', 'hc']);
  let pnlVersions = [], pnlVersion = 'live';
  let pnlScenarios = [];   // cenários salvos: máscaras de premissas recalculadas ao vivo
  let pnlSimScale = 100; // simulador de frota: % das entregas do Fleet Plan
  let pnlSimApply = false; // máscara: aplica a simulação na PRÓPRIA tabela do P&L
  let dashCharts = {}, dashLine = 'Gross Revenue'; // gráficos do Dashboard + totalizador escolhido
  let dashSpan = 'y0';   // 'y0' = ano-base · 'y1' = ano seguinte · 'both' = os dois emendados
  let dashDrill = null;  // linha de DETALHE aberta no hero (clique numa barra dos mixes); null = totalizador
  let finActCache = {}; // cache do realizado consolidado (por ano) — o solver chama computePnl em série // versões congeladas p/ board + versão selecionada
  const FIN_MONTHS = 12; // 2026-01 .. 2026-12
  const FIN_BASE_YEAR = 2026;                 // ano-base das coortes (índice absoluto de mês)
  let finYear = FIN_BASE_YEAR;                 // ano exibido no P&L / Fleet Plan (2026 ou 2027)
  const FIN_YOFF = () => (finYear - FIN_BASE_YEAR) * 12;   // deslocamento em meses do ano exibido
  const FIN_ML = (i) => finYear + '-' + String(i + 1).padStart(2, '0');
  const FIN_REV_LINES = ['Subscription', 'Late-payment interest', 'Traffic fines', 'Termination fee', 'Vehicle Sell', 'InDrive bonus', 'Security Deposit Refund'];
  const FIN_COGS_LINES = ['Subrental fee', 'Maintenance', 'Insurance', 'GPS', 'Car Preparation', 'Sticker', 'Traffic fines (out)', 'Recovery cost', 'Repair cost', 'Part Replacement'];
  const FIN_ASSUMP = [
    { k: '__fin_tax_fed__', label: 'Federal taxes (% of gross revenue)', def: 13.36 },
    { k: '__fin_tax_credit__', label: 'Tax input credit (% of gross revenue)', def: 8.25 },
    { k: '__fin_tax_fin__', label: 'Tax on financial income (% — security-deposit interest)', def: 4.65 },
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
    // Roda `fn` como se o ano exibido fosse `y` — troca finYear E os dados de HC/SG&A/CAC daquele
    // ano, chama fn, desfaz tudo no finally. Usado sempre que o motor precisa olhar OUTRO ano sem
    // sair da tela atual (o carry-in do caixa, o solver de breakeven, o Dashboard "2026+27").
    // Sem trocar também finHc/finSga/finCac, essas chamadas recalculavam o ano vizinho com os custos
    // do ano CORRENTE — um bug que só existiria depois que o ano virou multi-dado (este commit).
    function withYear(y, fn) {
      const kY = finYear, kHc = finHc, kSga = finSga, kCac = finCac;
      finYear = y;
      finHc = finHcByYear[y] || (finHcByYear[y] = emptyHc());
      finSga = finSgaByYear[y] || (finSgaByYear[y] = emptySga());
      finCac = finCacByYear[y] || (finCacByYear[y] = emptyCac());
      try { return fn(); } finally { finYear = kY; finHc = kHc; finSga = kSga; finCac = kCac; }
    }
    // Troca PERSISTENTE do ano exibido (o clique no botão 2026/2027) — ao contrário de withYear,
    // não desfaz no final: o resto da tela passa a operar sobre o ano novo até o próximo clique.
    // Repinta TUDO que depende de ano — inclusive Fleet Plan/Headcount/SG&A/CAC, que antes eram
    // os mesmos 12 números para os dois anos e não precisavam disso.
    function setFinYear(y) {
      if (finYear === y) return;
      finYear = y;
      finHc = finHcByYear[y] || (finHcByYear[y] = emptyHc());
      finSga = finSgaByYear[y] || (finSgaByYear[y] = emptySga());
      finCac = finCacByYear[y] || (finCacByYear[y] = emptyCac());
      finSelDay = null;
      finActCache = {};
      refProfiles = buildProfiles();
      hcEnsurePeople(); hcSyncPlan();
      renderFleetPlan(); renderHc(); renderAdmin(); renderCac(); renderPnl(); renderDash(); renderCosts();
    }
    // seletor de ano — mesmo visual do P&L, reaproveitado no cabeçalho de Fleet Plan/SG&A/CAC
    function renderFinYearSwitcher(elId) {
      const el = document.getElementById(elId); if (!el) return;
      el.innerHTML = '<div class="pnl-years">' + [FIN_BASE_YEAR, FIN_BASE_YEAR + 1].map((y) =>
        `<button class="pnl-yr${finYear === y ? ' on' : ''}" data-y="${y}">${y}</button>`).join('') + '</div>';
      el.querySelectorAll('.pnl-yr').forEach((b) => b.addEventListener('click', () => setFinYear(+b.dataset.y)));
    }
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
    // moeda de exibição do Finance (P&L, CAC, SG&A, Dashboard compartilham o mesmo estado pnlCur).
    // O motor calcula em USD; BRL é só multiplicar pelo câmbio na hora de mostrar. As ENTRADAS
    // continuam sempre em USD — converter campo editável convidaria a salvar R$ como US$.
    const finCS = () => (pnlCur === 'BRL' ? 'R$' : 'US$');
    const finCurK = () => (pnlCur === 'BRL' ? (finPar('__fin_fx__') || 5.5) : 1);
    const finCurFlags = () => `<div class="fin-curbar"><div class="ue-cur-toggle">${CUR_FLAGS(pnlCur)}</div></div>`;
    function wireCurFlags(root, rerender) {
      root.querySelectorAll('.ue-cur-btn').forEach((b) => b.addEventListener('click', () => {
        pnlCur = b.dataset.c === 'BRL' ? 'BRL' : 'USD';
        rerender();
      }));
    }
    // toggle "Edit mode" (mesmo componente em todas as abas do Finance)
    const editBar = (note) => (isAdmin ? `<div class="fin-editbar${finEdit ? ' on' : ''}"><label class="fin-switch"><input type="checkbox" class="fin-edit-cb"${finEdit ? ' checked' : ''}><span class="fin-slider"></span></label><span class="fin-switch-lbl">Edit mode</span>${note ? `<span class="fin-editnote">${note}</span>` : ''}</div>` : '');
    function wireEditBar(root) {
      if (!root) return;
      root.querySelectorAll('.fin-edit-cb').forEach((cb) => cb.addEventListener('change', () => { finEdit = cb.checked; renderFinanceAll(); }));
    }
    function renderFinanceAll() { renderFleetPlan(); renderHc(); renderAdmin(); renderCac(); renderAssump(); renderPnl(); renderCosts(); }
    // tabela totalizadora (uma linha por despesa) — visual diferenciado, usada em SG&A e CAC
    function totalsTable(rows, firstCol) {
      let h = `<div class="ue-table-wrap"><table class="ue-table fin-grid fin-totals"><thead><tr><th class="ue-rowlabel">${escH(firstCol || 'Cost line')}</th>`;
      for (let m = 0; m < FIN_MONTHS; m++) h += `<th>${monthLbl(m)}</th>`;
      h += `<th class="ue-totalcol">FY-${String(finYear).slice(2)}E</th></tr></thead><tbody>`;
      const K = finCurK();   // moeda de exibição — os arrays chegam sempre em USD
      const tot = new Array(FIN_MONTHS).fill(0);
      rows.forEach((r) => {
        let fy = 0;
        h += `<tr class="ue-row"><td class="ue-rowlabel">${escH(r.label)}</td>`;
        for (let m = 0; m < FIN_MONTHS; m++) { const v = (Number(r.arr[m]) || 0) * K; tot[m] += v; fy += v; h += `<td class="ue-cell">${v ? fmtNum(v) : '-'}</td>`; }
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
    // Segundas-feiras (dia de cobrança) de cada mês do ano EXIBIDO. Era uma const avaliada uma
    // única vez no boot, que congelava o calendário de 2026: ao virar para 2027 o modelo continuava
    // usando 2026 e errava mai/27 e jun/27 numa semana cheia cada (2026: 4,4,5,4,4,5... · 2027:
    // 4,4,5,4,5,4...). Agora é função do ano — o total do ano é 52 nos dois, o erro era de mês.
    const MONDAYS_OF = (y) => { const a = []; for (let mo = 0; mo < 12; mo++) { let n = 0; const d = new Date(y, mo, 1); while (d.getMonth() === mo) { if (d.getDay() === 1) n++; d.setDate(d.getDate() + 1); } a.push(n); } return a; };
    // segundas-feiras de um mês no dia >= `fromDay` (semanas pagas a partir do recebimento)
    const mondaysOnOrAfter = (moAbs, fromDay) => { const yy = FIN_BASE_YEAR + Math.floor(moAbs / 12), mo = ((moAbs % 12) + 12) % 12; let n = 0; const d = new Date(yy, mo, 1); while (d.getMonth() === mo) { if (d.getDay() === 1 && d.getDate() >= fromDay) n++; d.setDate(d.getDate() + 1); } return n; };
    const cohMonth = (c) => (c.date ? ((parseInt(c.date.slice(0, 4), 10) - FIN_BASE_YEAR) * 12 + parseInt(c.date.slice(5, 7), 10) - 1) : (c.month || 0));
    const cohDay = (c) => (c.date ? parseInt(c.date.slice(8, 10), 10) : 1);
    // pro-rata do subrental: fração do mês de ENTRADA em que ficamos com o carro
    // (retirada 05/04 → (30−5)/30). A 1ª parcela paga essa fração; o complemento fecha na 13ª.
    const proSub = (c) => {
      const moAbs = cohMonth(c);
      const y = FIN_BASE_YEAR + Math.floor(moAbs / 12), mo = ((moAbs % 12) + 12) % 12;
      const dim = new Date(y, mo + 1, 0).getDate();
      return Math.max(0, Math.min(1, (dim - cohDay(c)) / dim));
    };
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
        // ritmos históricos R$/dia POR CARRO da frota de referência.
        // Multas seguem a REGRA DO CONTRATO (a mesma do UE real): cobramos o BRUTO + prêmio
        // (10% v1/v2, 20% v3+) e pagamos o LÍQUIDO + 5% à LM. Usar o "total cobrado" da API aqui
        // reproduzia o repasse atual, que aplica o prêmio sobre o valor JÁ descontado e deixava a
        // margem em ~7% em vez dos ~30% que o contrato prevê.
        // O ritmo vem de finesRatesByFleet(): janela madura + mistura com as outras frotas por
        // credibilidade. Dividir pelo total de dias corridos (como era aqui) subestimava a frota de
        // referência do Tera em ~3,8x, porque ela mal começou e quase nenhuma multa dela chegou.
        const FR = finesRatesByFleet()[fid] || finesRatesByFleet().__pool;
        const finesInDay = (FR.gross || 0) * (FR.prem || 1.10);
        const finesOutDay = FR.net || 0;
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
        if (veh > 0) { prof['Vehicle Sell'] = A(); prof['Vehicle Sell'][13] = veh * 1.03; }
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
      // A janela vai até o FIM do mês vigente, não até hoje: a parcela do dia 26 é agenda certa, e
      // cortá-la em `hoje` fazia agosto (visto no dia 10) mostrar só a fração do modelo — a "queda"
      // do subrental em agosto era isso, não um evento real.
      const endCur = new Date(hojeD.getFullYear(), hojeD.getMonth() + 1, 0, 23, 59, 0);
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
        if (subr > 0) {
          // mesma regra do UE/modelo: 1ª parcela PRO-RATA dos dias com o carro no mês de entrada;
          // o complemento fecha os 12 meses numa 13ª cobrança, um mês depois da última parcela
          const dimIni = new Date(ini.getFullYear(), ini.getMonth() + 1, 0).getDate();
          const proR = Math.max(0, Math.min(1, (dimIni - ini.getDate()) / dimIni));
          for (let i = 1; i <= 13; i++) {
            const d = new Date(ini.getFullYear(), ini.getMonth() + i, 26, 12);
            if (d > endCur || d.getFullYear() !== finYear) continue;
            const frac = i === 1 ? proR : (i === 13 ? 1 - proR : 1);
            out.subr[d.getMonth()] += subr * frac * Math.max(0, cars - lostBefore(d)); out.any = true;
          }
        }
        const insT = par('__ins_total__'), insN = par('__ins_parcelas__');
        if (insT > 0 && insN >= 1) for (let n = 1; n <= insN; n++) {
          const d = new Date(ini.getTime() + (n - 0.5) * UET_WPM * 7 * MS);
          if (d > endCur || d.getFullYear() !== finYear) continue;
          out.ins[d.getMonth()] += (insT / insN) * cars; out.any = true; // seguro paga pelos carros TOTAIS
        }
        const gps0 = par('__gps_m0__'), gpsM = par('__gps_mensal__');
        if (gps0 > 0 && m0 != null && ini <= hojeD) { out.gps[m0] += gps0 * cars; out.any = true; }
        if (gpsM > 0) for (let n = 1; n <= 12; n++) {
          const d = new Date(ini.getTime() + (n - 0.5) * UET_WPM * 7 * MS);
          if (d > endCur || d.getFullYear() !== finYear) continue;
          out.gps[d.getMonth()] += gpsM * Math.max(0, cars - lostBefore(d)); out.any = true;
        }
      });
      return out;
    }
    // Carros RECUPERADOS por mês calendário do ano exibido (matriz de cobranças: contratos
    // encerrados por "Recuperação" na semana). É a base da comissão de reentrega do CAC.
    // Carros que voltam para a nossa mão e podem ser reentregues: tanto os RECUPERADOS
    // (contrato encerrado por recuperação) quanto os DEVOLVIDOS (rescisão pelo motorista).
    // Os dois viram carro na rua de novo, então os dois pagam comissão de reentrega — antes
    // só os recuperados contavam e a devolução ficava de fora da conta.
    function redeliverableByMonth() {
      const z = new Array(FIN_MONTHS).fill(0);
      (((OCN.payments || {}).weeks) || []).forEach((w) => {
        if (!w.date || String(w.date).slice(0, 4) !== String(finYear)) return;
        const m = parseInt(String(w.date).slice(5, 7), 10) - 1;
        if (m >= 0 && m < FIN_MONTHS) z[m] += ((w.counts && w.counts.recovered) || 0) + ((w.counts && w.counts.returned) || 0);
      });
      return z;
    }
    function computePnl(opts) {
      opts = opts || {};
      const fx = finPar('__fin_fx__') || 5.5;
      const taxFed = finPar('__fin_tax_fed__') / 100, taxCred = finPar('__fin_tax_credit__') / 100;
      const payFeeM = (m) => finParM('__fin_payfee__', m) / 100, decomm = finPar('__fin_decomm__') / 100;
      const FIN_MONDAYS = MONDAYS_OF(finYear);   // calendário do ano EXIBIDO (não do ano-base)
      const WEEKLY_LINES = { 'Subscription': 1, 'Late-payment interest': 1 };   // semanal × semanas pagas
      const BILLABLE_LINES = { 'Subrental fee': 1 };                            // mensal × billable ratio
      const maints = {}; finModels.forEach((m) => { maints[m.id] = uetMaint(finModelVals[m.id] || {}, m.id); });
      const zeros = () => new Array(FIN_MONTHS).fill(0);
      const rev = {}, cogs = {}; FIN_REV_LINES.forEach((l) => rev[l] = zeros()); FIN_COGS_LINES.forEach((l) => cogs[l] = zeros());
      const delivered = zeros(), active = zeros(), secDep = zeros(), vehPur = zeros(), refundPrin = zeros(), ptLost = zeros(), ended = zeros();
      // Simulador de frota: o multiplicador vale só para as entregas que ainda NÃO aconteceram.
      // Carro já entregue é fato consumado — mexer nele reescreveria o passado e mudaria meses que
      // a tabela mostra como realizados.
      const scale = opts.scale || 1;
      const hojeCoh = (OCN.ue && OCN.ue.hoje) || new Date().toISOString().slice(0, 10);
      const scaleOf = (c) => ((scale !== 1 && c.date && c.date <= hojeCoh) ? 1 : scale);
      const cohorts = opts.extra ? finCohorts.concat(opts.extra) : finCohorts; // coortes sintéticas (solver)
      // PERDA TOTAL: o carro sai da frota no mês do sinistro (U.losses: placa -> data, da aba de
      // clientes). A subtração para quando a coorte da placa completaria as 52 semanas — senão o
      // carro seria descontado duas vezes (uma pelo sinistro, outra pela saída por idade).
      // Receitas/custos da placa NÃO mudam aqui: o realizado dela continua entrando normalmente;
      // o que muda é só a contagem de frota, que alimenta as projeções por carro (multas etc.).
      const UPT = OCN.ue || {};
      const ptMonthAbs = (iso) => (parseInt(String(iso).slice(0, 4), 10) - FIN_BASE_YEAR) * 12 + parseInt(String(iso).slice(5, 7), 10) - 1;
      const ptCases = Object.entries(UPT.losses || {}).map(([pl, dIso]) => {
        const f = (UPT.fleets || []).find((x) => (x.placas || []).includes(pl));
        return { from: ptMonthAbs(dIso), until: (f && f.inicio) ? ptMonthAbs(f.inicio) + 12 : Infinity };
      });
      const ptLostAt = (Mabs) => ptCases.reduce((n, c) => n + ((Mabs >= c.from && Mabs < c.until) ? 1 : 0), 0);
      for (let m = 0; m < FIN_MONTHS; m++) {
        cohorts.forEach((c) => {
          const cm = cohMonth(c);
          const M = FIN_YOFF() + m;                 // mês absoluto da coluna exibida (ano-base 2026)
          if (cm > M) return;
          const qty = c.qty * scaleOf(c);
          delivered[m] += qty;
          const age = M - cm;                       // 0 = mês de recebimento
          const activeN = qty * Math.pow(1 - decomm, age);
          // O carro SAI da frota ao completar as 52 semanas do contrato (age 12 = o 13º mês de
          // vida, quando ele é vendido/devolvido). Os eventos do M13 — venda, refund, termination,
          // 13ª parcela do subrental — continuam acontecendo; só a CONTAGEM de frota é que para,
          // e com ela as projeções por carro (multas etc.). Antes o carro ficava ativo para sempre.
          if (age < 12) active[m] += activeN; else ended[m] += activeN;
          const p = age + 1;                        // idade no UE (mês de entrega = M1)
          if (p > UET_PERIODS - 1) {
            // "M14": a 13ª cobrança do subrental (complemento do pro-rata) cai um mês depois do
            // fim do contrato, no dia 26 — aqui ela entra na data real de calendário
            if (age === 13) {
              const sv = (refProfiles && refProfiles[c.model] && refProfiles[c.model]['Subrental fee'])
                ? refProfiles[c.model]['Subrental fee'][2]
                : (() => { const lo = lineOf('Subrental fee'); return lo ? uetEff(finModelVals[c.model] || {}, c.model, lo, 2, maints[c.model] || {}) : null; })();
              if (sv) cogs['Subrental fee'][m] += (sv * (1 - proSub(c)) * activeN) / fx;
            }
            return;                                   // além do M13: contrato encerrado
          }
          const vals = finModelVals[c.model] || {}, maint = maints[c.model] || {};
          const mondays = FIN_MONDAYS[m];
          const weeks = age === 0 ? mondaysOnOrAfter(cm, cohDay(c)) : mondays; // semanas pagas a partir da data
          const billable = mondays ? weeks / mondays : 0;
          // valor por veículo na idade `age`: PERFIL DA FROTA DE REFERÊNCIA (premissas do UE real);
          // fallback para o Theoric quando o perfil não tem a linha (ex.: caixinha ainda vazia)
          // Orçado (Budget): ignora os perfis das frotas de referência e usa SÓ o UE Teórico do modelo
          // — é a projeção "de origem", com o padrão por carro que definimos, sem realizado nenhum.
          const prof = (!opts.budget && refProfiles) ? refProfiles[c.model] : null;
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
          // 1ª parcela do subrental (mês seguinte à entrega): reduz para o PRO-RATA dos dias
          // com o carro no mês de entrada — o add() acima somou a parcela cheia
          if (age === 1) {
            const sv = val('Subrental fee', 2);
            if (sv) cogs['Subrental fee'][m] += (sv * (proSub(c) - 1) * activeN) / fx;
          }
          if (age === 0) { const v0 = val('Security Deposit', 0); if (v0 != null) secDep[m] += (v0 * qty) / fx; }
          { const vp = val('Vehicle Purchase', p); if (vp != null) vehPur[m] += (vp * activeN) / fx; }
          // principal do calção que volta neste mês (base do imposto: só o JURO é receita nova)
          if (p === 13) { const d0 = val('Security Deposit', 0); if (d0 != null) refundPrin[m] += (-d0 * activeN) / fx; }
        });
        ptLost[m] = ptLostAt(FIN_YOFF() + m);
        active[m] = Math.max(0, active[m] - ptLost[m]); // perda total sai da contagem
      }
      // ---- MESES DECORRIDOS: troca o modelo pelo REALIZADO consolidado da frota inteira ----
      // Mesmas fontes do UE real (matriz de pagamentos, multas, import_rev, multas_consolidado),
      // agregadas por mês CALENDÁRIO. Futuro continua vindo do Theoric; multas (que o Theoric não
      // modela) seguem no ritmo histórico R$/dia.
      const hojeIso = (OCN.ue && OCN.ue.hoje) || new Date().toISOString().slice(0, 10);
      const curM = hojeIso.slice(0, 4) === String(finYear) ? parseInt(hojeIso.slice(5, 7), 10) - 1 : (parseInt(hojeIso.slice(0, 4), 10) > finYear ? FIN_MONTHS - 1 : -1);
      const ACT = finActCache[finYear] || (finActCache[finYear] = finActuals());
      let actualsThrough = null;
      if (ACT.any && !opts.noActuals && !opts.budget) {
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
          // Linhas de AGENDA (subrental/seguro/GPS/prep/adesivo): a agenda do finActuals já cobre o
          // mês vigente INTEIRO (inclusive a parcela do dia 26 que ainda não chegou), então aqui o
          // valor entra seco, sem o complemento pro-rata do modelo — que servia para linhas que
          // pingam ao longo do mês e, numa linha de parcela única, só somava em dobro.
          cogs['Subrental fee'][m] = -ACT.subr[m] / fx;
          cogs['Insurance'][m] = -ACT.ins[m] / fx;
          cogs['GPS'][m] = -ACT.gps[m] / fx;
          cogs['Car Preparation'][m] = -ACT.prep[m] / fx;
          cogs['Sticker'][m] = -ACT.stick[m] / fx;
          cogs['Recovery cost'][m] = blend(cogs['Recovery cost'], -ACT.rec[m]);
          cogs['Repair cost'][m] = blend(cogs['Repair cost'], -ACT.rep[m]);
          cogs['Part Replacement'][m] = blend(cogs['Part Replacement'], -ACT.parts[m]);
        }
        // Multas dos meses FUTUROS: o Theoric não modela essa linha, então ela vem do ritmo
        // histórico observado — mas POR CARRO, multiplicado pela frota ativa de cada mês.
        // Antes era o R$/dia da operação inteira dividido pelos dias corridos, um número fixo que
        // congelava as multas no tamanho de frota de hoje: com a frota indo de 415 para 757 carros,
        // novembro projetava o mesmo que setembro (só variava 30/31 dias). Some-se a isso a
        // maturação (multa leva ~20 dias para chegar), e a linha saía subestimada duas vezes.
        {
          const FRp = finesRatesByFleet().__pool;
          const dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
          for (let m = curM + 1; m < FIN_MONTHS; m++) {
            const carDays = (active[m] || 0) * dim[m];
            rev['Traffic fines'][m] = (FRp.gross * FRp.prem * carDays) / fx;
            cogs['Traffic fines (out)'][m] = -(FRp.net * carDays) / fx;
          }
        }
        actualsThrough = curM;
      }
      // ---- InDrive: benefício por placa, em levas com data. Entra no Initial Fee do mês da leva.
      // Fica FORA do orçado (é um evento concreto, não fazia parte da projeção original) e sai da
      // conta quando o botão "InDrive" do P&L está desligado.
      let indriveTot = 0;
      if (!opts.noIndrive && !opts.budget && indriveOn()) {
        indriveData.batches.forEach((b) => {
          if (String(b.date).slice(0, 4) !== String(finYear)) return;
          const m = parseInt(String(b.date).slice(5, 7), 10) - 1;
          if (!(m >= 0 && m < FIN_MONTHS)) return;
          const v = ((b.plates || []).length * indriveData.value) / fx;
          rev['InDrive bonus'][m] += v;
          indriveTot += v;
        });
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
      // ---- Federal tax sobre MARGEM nas linhas de giro/repasse, não sobre o valor cheio ----
      // Vehicle Sell: tributa (venda − compra), já que os dois acontecem no mesmo mês da placa.
      // Traffic fines: tributa só o spread (recebido do cliente − pago à LM).
      // Subscription a partir de 2027 (nova legislação da bitributação na sublocação): tributa só a
      // diferença entre o que o motorista paga e o que pagamos à locadora (Subscription − Subrental
      // fee). Até 2026 a assinatura continua tributada cheia, como hoje.
      // Security Deposit Refund: o juro do caução é RENDIMENTO FINANCEIRO — sai da base geral e
      // paga alíquota própria (4,65% por padrão, editável no ⚙ Assumptions), sem gerar crédito.
      // Mês com margem negativa não gera imposto (trava em zero) — também não gera crédito.
      const netSubLaw = finYear >= 2027;
      const taxBase = zeros(), finIncome = zeros();
      for (let m = 0; m < FIN_MONTHS; m++) {
        const sell = (rev['Vehicle Sell'] && rev['Vehicle Sell'][m]) || 0;
        const ref = (rev['Security Deposit Refund'] && rev['Security Deposit Refund'][m]) || 0;
        const fin = (rev['Traffic fines'] && rev['Traffic fines'][m]) || 0;
        const finOut = (cogs['Traffic fines (out)'] && cogs['Traffic fines (out)'][m]) || 0; // negativo
        const sub = (rev['Subscription'] && rev['Subscription'][m]) || 0;
        const subr = (cogs['Subrental fee'] && cogs['Subrental fee'][m]) || 0; // negativo
        finIncome[m] = Math.max(0, ref - refundPrin[m]); // juro do caução (devolução − principal)
        taxBase[m] = grossRev[m]
          - sell + Math.max(0, sell + (vehPur[m] || 0))
          - ref
          - fin + Math.max(0, fin + finOut)
          + (netSubLaw ? -sub + Math.max(0, sub + subr) : 0);
      }
      // o CRÉDITO segue a MESMA base do imposto: crédito sobre a receita cheia com o federal na
      // margem fazia "Taxes on sales" virar POSITIVO nos meses de venda de veículo (crédito de
      // ~R$66k/carro sobre uma margem de ~R$2k) — imposto não pode ser fonte de receita.
      const taxFin = finPar('__fin_tax_fin__') / 100;
      const fed = taxBase.map((v, m) => -Math.max(0, v) * taxFed - finIncome[m] * taxFin);
      const cred = taxBase.map((v) => Math.max(0, v) * taxCred);
      const taxes = grossRev.map((_, m) => fed[m] + cred[m]);
      const netRev = grossRev.map((v, m) => v + taxes[m]);
      const payProc = grossRev.map((v, m) => -v * payFeeM(m));
      const gm = netRev.map((v, m) => v + cogsTot[m] + payProc[m]);
      // Receita do NEGÓCIO PRINCIPAL (aluguel): base do % da Gross Margin. Venda do carro, bônus
      // InDrive e devolução do caução são eventos com margem própria (≈0 no caso da venda) — dentro
      // da base eles só diluíam o percentual e escondiam a saúde da operação recorrente.
      const coreRev = netRev.map((v, m) => v
        - ((rev['Vehicle Sell'] && rev['Vehicle Sell'][m]) || 0)
        - ((rev['InDrive bonus'] && rev['InDrive bonus'][m]) || 0)
        - ((rev['Security Deposit Refund'] && rev['Security Deposit Refund'][m]) || 0));
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
      const newDelivered = zeros(); cohorts.forEach((c) => { const cm = cohMonth(c) - FIN_YOFF(); if (cm >= 0 && cm < FIN_MONTHS) newDelivered[cm] += c.qty * scaleOf(c); });
      // carro recuperado OU devolvido que volta para a rua paga comissão de reentrega (tabela própria no CAC)
      const recovered = redeliverableByMonth();
      const commission = zeros(), adsTot = zeros(), infTot = zeros();
      for (let m = 0; m < FIN_MONTHS; m++) {
        commission[m] = -(finCac.perUnit || 0) * newDelivered[m] - (finCac.recPerUnit || 0) * recovered[m];
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
      // ---- caixa ACUMULADO: continua de onde o ano anterior parou ----
      // 2027 não é uma operação nova, é a continuação de 2026: zerar o acumulado em janeiro
      // mostrava a empresa "nascendo" com caixa zero e escondia o buraco que vem de trás.
      // O ano-base (2026) começa em zero; os seguintes herdam o fechamento do anterior
      // (recursivo, e a recursão para sozinha ao chegar no ano-base).
      let carryIn = 0;
      if (finYear > FIN_BASE_YEAR) carryIn = withYear(finYear - 1, () => (computePnl(opts).accCf || [])[FIN_MONTHS - 1] || 0);
      const accCf = []; let a1 = carryIn; netCf.forEach((v) => { a1 += v; accCf.push(a1); });
      // headcount total por mês (p/ o bloco de indicadores)
      const headcount = zeros(); for (let m = 0; m < FIN_MONTHS; m++) (finHc.roles || []).forEach((r) => { headcount[m] += hcOf(r, m); });
      const payFeePct = new Array(FIN_MONTHS).fill(0).map((_, m) => finParM('__fin_payfee__', m));
      return { delivered, active, ptLost, ended, rev, cogs, secDep, grossRev, fed, cred, taxes, netRev, coreRev, cogsTot, payProc, gm,
        base, meal, health, ptax, th13, bonus, hcTot, commission, adsTot, infTot, cacTot, rentTot, profTot, itTot, sga, opex, netCf, accCf, newDelivered, headcount, payFeePct, actualsThrough, vehPur, indriveTot, carryIn, recovered };
    }

    // ---------- P&L ----------
    const PNL_GROUPS = ['grev', 'tax', 'cogs', 'opex', 'cac', 'sga', 'hc'];
    const pnlSnap = () => (pnlVersions.find((v) => v.id === pnlVersion) || {}).snapshot || null;
    let pnlActualsThrough = null; // último mês calendário coberto por dados realizados
    // Trilho de análise vertical: divs posicionadas na altura de cada linha da tabela (medida no
    // DOM real), num irmão do wrap — fora da tabela e do scroll horizontal, como pedido. Se a
    // seção estiver oculta (alturas = 0), guarda a lista e re-mede no clique da sub-aba P&L.
    let pnlVaCache = null;
    function renderPnlVA(vaList) {
      if (vaList) pnlVaCache = vaList;
      const va = document.getElementById('pnlVA'), tbl = document.getElementById('pnlTable');
      if (!va || !tbl || !pnlVaCache) return;
      if (!tbl.offsetHeight) { va.innerHTML = ''; return; }
      const trs = tbl.querySelectorAll('tbody tr');
      let h = '';
      // faixa de peso: quanto mais a linha representa da categoria, mais forte o roxo. Escala de
      // intensidade (não de bom/ruim) — a mesma linha pode ser receita ou custo.
      const vaTier = (p) => (p >= 60 ? 5 : p >= 35 ? 4 : p >= 15 ? 3 : p >= 5 ? 2 : 1);
      pnlVaCache.forEach((v, i) => {
        const tr = trs[i]; if (!tr) return;
        const cls = 'pnl-va-c' + (v.l1 ? ' l1' : (v.pct != null ? ' t' + vaTier(v.pct) : ''));
        h += `<div class="${cls}" style="top:${tr.offsetTop}px;height:${tr.offsetHeight}px">${v.pct != null ? v.pct + '%' : ''}</div>`;
      });
      va.style.height = tbl.offsetHeight + 'px';
      va.innerHTML = h;
    }
    window.__pnlVaLayout = () => renderPnlVA(null);
    function renderPnl() {
      const el = document.getElementById('pnlTable'); if (!el) return;
      // 4 modos: Live (realizado + projeção), Budget (orçado: só UE Teórico, sem realizado),
      // CENÁRIO (máscara de premissas, recalculada ao vivo) e versão congelada (snapshot salvo).
      // Só o Live aceita o simulador de frota e os botões de what-if.
      const budget = pnlVersion === 'budget';
      const scen = pnlScenarios.find((x) => x.id === pnlVersion) || null;
      const snap = (pnlVersion === 'live' || budget || scen) ? null : pnlSnap();
      const live = !snap && !budget && !scen;
      const simOn = live && pnlSimApply && pnlSimScale !== 100;
      // baseOpts = as opções que geraram P; guardadas p/ quem precisa recalcular em cima da MESMA
      // base (ex.: o cartão "+1 car today"). Fica null nas versões congeladas — lá não há motor.
      const baseOpts = snap ? null : { budget, noSd: pnlNoSd, noIndrive: pnlNoIdr, scale: simOn ? pnlSimScale / 100 : 1 };
      const P = snap || computePnl(baseOpts);
      const sum = (a) => a.reduce((s, x) => s + (x || 0), 0);
      // ---- moeda de exibição: o motor calcula em R$ e divide pelo câmbio, então voltar para BRL
      // é só multiplicar de novo. Um fator único aplicado na formatação mantém tabela, painel de
      // indicadores e simulador sempre na mesma moeda.
      const curK = pnlCur === 'BRL' ? (finPar('__fin_fx__') || 5.5) : 1;
      const cs = pnlCur === 'BRL' ? 'R$' : 'US$';
      const fmtC = (v) => (v == null) ? '' : fmt(v * curK);
      const money = (v) => (v < 0 ? '−' : '') + cs + ' ' + fmtNum(Math.abs(v) * curK);
      // ---- "Actuals only": zera os meses ainda não realizados em TODA a cadeia, para o total não
      // continuar somando o que a visão está escondendo (mesma regra do UE).
      const actThru = (P.actualsThrough != null) ? P.actualsThrough : -1;
      const cut = (arr, isAcc) => {
        if (pnlShowProj || !arr) return arr;
        if (actThru < 0) return arr.map(() => 0);
        return arr.map((v, m) => (m <= actThru ? v : (isAcc ? arr[actThru] : 0)));
      };
      // % da margem sobre a receita do NEGÓCIO PRINCIPAL (sem venda de carro, InDrive e refund do
      // caução) — versões congeladas antigas não têm coreRev e caem na receita bruta de antes
      const gmBase = P.coreRev || P.grossRev;
      const gmPct = gmBase.map((v, m) => (v ? (P.gm[m] / v) * 100 : null));
      // árvore de linhas (grupos colapsáveis) — #1
      let N = [];
      const push = (label, arr, cls, o) => N.push(Object.assign({ label, arr: cut(arr, !!(o && o.isAcc)), cls: cls || 'ue-leaf', ancestors: [] }, o || {}));
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
      push('Gross Margin', P.gm, 'pnl-l1', { pct: gmPct, pctTot: sum(gmBase) ? (sum(P.gm) / sum(gmBase)) * 100 : null });
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
      push('Net cashflow', P.netCf, 'pnl-l1', { signColor: true });
      push('Acc. Net cashflow', P.accCf, 'pnl-l1 pnl-acc', { isAcc: true, signColor: true });

      // ---- ordem por REPRESENTATIVIDADE dentro de cada categoria ----
      // As linhas de dentro de um grupo são reordenadas pelo total do ANO (maior primeiro), para a
      // leitura começar pelo que pesa. O nível de cima NÃO é mexido: ali a ordem é a do próprio
      // demonstrativo (Gross Revenue → Taxes → Net Revenue → COGS → Margin → OPEX → cashflow), e
      // embaralhar isso quebraria a conta. Subscription e Subrental fee ficam sempre em primeiro na
      // sua categoria — são a espinha da operação, é por onde se começa a ler mesmo quando um mês
      // atípico deixaria outra linha maior. A árvore é preservada: cada pai continua imediatamente
      // seguido da própria subárvore, então os grupos colapsáveis seguem funcionando.
      const PIN_FIRST = { 'Subscription': 1, 'Subrental fee': 1 };
      const fyAbs = (n) => Math.abs((n.isQty || n.isAcc) ? (n.arr[FIN_MONTHS - 1] || 0) : sum(n.arr));
      const kidsOf = new Map();
      N.forEach((n) => {
        const pk = n.ancestors.length ? n.ancestors[n.ancestors.length - 1] : null;
        if (!kidsOf.has(pk)) kidsOf.set(pk, []);
        kidsOf.get(pk).push(n);
      });
      const ordered = [];
      const emit = (list, doSort) => {
        (doSort ? list.slice().sort((a, b) => (PIN_FIRST[b.label] || 0) - (PIN_FIRST[a.label] || 0) || fyAbs(b) - fyAbs(a)) : list)
          .forEach((n) => { ordered.push(n); if (n.group && kidsOf.has(n.group)) emit(kidsOf.get(n.group), true); });
      };
      emit(kidsOf.get(null) || [], false);
      N = ordered;

      // faixa de frota acima dos meses: carros ativos e quantos chegaram no mês
      let html = '<thead><tr class="pnl-fleetrow"><th class="ue-rowlabel">Fleet</th>';
      for (let m = 0; m < FIN_MONTHS; m++) {
        const act = Math.round(P.active[m] || 0), nw = Math.round((P.newDelivered || [])[m] || 0);
        html += `<th title="${act} active cars · ${nw} delivered this month"><span class="pnl-fl-act">${act || '–'}</span>${nw ? `<span class="pnl-fl-new">+${nw}</span>` : ''}</th>`;
      }
      html += `<th class="ue-totalcol"><span class="pnl-fl-act">${Math.round(P.delivered[FIN_MONTHS - 1] || 0)}</span></th></tr>`;
      // segundas-feiras do mês: é o multiplicador das linhas semanais (assinatura e juros), então
      // um mês de 5 segundas rende ~25% mais que um de 4. Fica discreto, só para explicar degraus.
      const MON = MONDAYS_OF(finYear);
      html += '<tr class="pnl-monrow"><th class="ue-rowlabel" title="Mondays in the month — the billing day. Weekly lines are multiplied by this.">Mondays</th>';
      for (let m = 0; m < FIN_MONTHS; m++) html += `<th>${MON[m]}</th>`;
      html += `<th class="ue-totalcol">${MON.reduce((a, b) => a + b, 0)}</th></tr>`;
      html += `<tr><th class="ue-rowlabel">P&amp;L (${cs === 'R$' ? 'BRL' : 'USD'})</th>`;
      for (let m = 0; m < FIN_MONTHS; m++) html += `<th>${monthLbl(m)}</th>`;
      html += `<th class="ue-totalcol">FY-${String(finYear).slice(2)}E</th></tr></thead><tbody>`;
      // Análise VERTICAL (trilho fora da tabela): FY da linha ÷ FY da categoria mais próxima.
      // O grupo de impostos fica de fora — federal negativo + crédito positivo dariam percentuais
      // acima de 100% que confundem mais do que explicam.
      const groupFY = {};
      N.forEach((n) => { if (n.group) groupFY[n.group] = (n.isQty || n.isAcc) ? n.arr[FIN_MONTHS - 1] : sum(n.arr); });
      const vaList = [];
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
        // cashflow: verde/vermelho suave conforme o sinal, para a linha "contar a história" de longe
        const sgn = (v) => (n.signColor && v != null && Math.round(v * curK) !== 0) ? (v < 0 ? ' pnl-neg' : ' pnl-pos') : '';
        for (let m = 0; m < FIN_MONTHS; m++) tr += `<td class="ue-cell${sgn(n.arr[m])}">${n.isQty ? fmtQty(n.arr[m]) : fmtC(n.arr[m])}${sub(n.pct ? n.pct[m] : null)}</td>`;
        const tot = (n.isQty || n.isAcc) ? n.arr[FIN_MONTHS - 1] : sum(n.arr);
        tr += `<td class="ue-cell ue-totalcol${sgn(tot)}">${n.isQty ? fmtQty(tot) : fmtC(tot)}${sub(n.pctTot)}</td>`;
        html += tr + '</tr>';
        const nearest = n.ancestors.length ? n.ancestors[n.ancestors.length - 1] : null;
        let vaPct = null;
        if (n.group && !nearest) vaPct = 100;
        else if (nearest && nearest !== 'tax' && groupFY[nearest]) vaPct = Math.round((tot / groupFY[nearest]) * 100);
        vaList.push({ pct: vaPct, l1: !!n.group && !nearest });
      });
      html += '</tbody>';
      el.innerHTML = html;
      renderPnlVA(vaList);
      el.querySelectorAll('.pnl-parent').forEach((tr) => tr.addEventListener('click', () => {
        const g = tr.dataset.g; if (pnlCollapsed.has(g)) pnlCollapsed.delete(g); else pnlCollapsed.add(g); renderPnl();
      }));
      pnlActualsThrough = (P.actualsThrough != null) ? P.actualsThrough : null;
      renderPnlControls(live);
      renderPnlExtras(P, live, baseOpts);
    }
    // ---------- seletor de versão do P&L (dropdown próprio, não o <select> nativo) ----------
    // Agrupa Live · Budget · Cenários · Congeladas e mostra o que cada um É, não só o nome.
    function verPicker() {
      const scen = pnlScenarios.find((x) => x.id === pnlVersion);
      const frozen = pnlVersions.find((x) => x.id === pnlVersion);
      const cur = pnlVersion === 'live' ? { ic: '●', cls: 'live', name: 'Live', sub: 'actuals + forecast' }
        : pnlVersion === 'budget' ? { ic: '◆', cls: 'budget', name: 'Budget', sub: 'Theoric UE per car' }
        : scen ? { ic: '◇', cls: 'scen', name: scen.name, sub: 'scenario' }
        : { ic: '📌', cls: 'frozen', name: (frozen && frozen.name) || '—', sub: 'frozen' };
      return `<div class="pnl-vp" id="pnlVp">` +
        `<button type="button" class="pnl-vp-btn ${cur.cls}" id="pnlVpBtn">` +
          `<span class="pnl-vp-ic">${cur.ic}</span>` +
          `<span class="pnl-vp-txt"><b>${escH(cur.name)}</b><i>${escH(cur.sub)}</i></span>` +
          `<span class="pnl-vp-car">▾</span></button>` +
        `<div class="pnl-vp-pop" id="pnlVpPop" hidden></div></div>`;
    }
    function wireVerPicker() {
      const btn = document.getElementById('pnlVpBtn'), pop = document.getElementById('pnlVpPop');
      if (!btn || !pop) return;
      const groups = [
        { t: '', items: [{ id: 'live', ic: '●', cls: 'live', n: 'Live', s: 'actuals + forecast' },
                         { id: 'budget', ic: '◆', cls: 'budget', n: 'Budget', s: 'Fleet Plan × Theoric UE, no actuals' }] },
        { t: 'Scenarios', items: pnlScenarios.map((v) => ({ id: v.id, ic: '◇', cls: 'scen', n: v.name, s: scenSummary(v) || 'same as Live' })) },
        { t: 'Frozen', items: pnlVersions.map((v) => ({ id: v.id, ic: '📌', cls: 'frozen', n: v.name, s: (v.savedAt || '').slice(0, 10) })) },
      ].filter((g) => g.items.length);
      pop.innerHTML = groups.map((g) => (g.t ? `<div class="pnl-vp-h">${g.t}</div>` : '') + g.items.map((i) =>
        `<button type="button" class="pnl-vp-o${pnlVersion === i.id ? ' on' : ''}" data-v="${escH(i.id)}">` +
        `<span class="pnl-vp-ic ${i.cls}">${i.ic}</span><span class="pnl-vp-txt"><b>${escH(i.n)}</b><i>${escH(i.s)}</i></span></button>`).join('')).join('');
      const close = () => { pop.hidden = true; btn.classList.remove('open'); document.removeEventListener('click', out); };
      const out = (e) => { if (!document.getElementById('pnlVp').contains(e.target)) close(); };
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (pop.hidden) { pop.hidden = false; btn.classList.add('open'); setTimeout(() => document.addEventListener('click', out), 0); } else close();
      });
      pop.querySelectorAll('.pnl-vp-o').forEach((b) => b.addEventListener('click', () => { close(); selectVersion(b.dataset.v); }));
    }

    // ---------- CENÁRIOS: memória das MESMAS entradas que o Live edita ----------
    // Um cenário não tem painel próprio de premissas. Ao selecioná-lo, as entradas globais
    // (finCfg / finSga / finCac / finCohorts / finHc) são trocadas pela cópia dele — daí em
    // diante o ⚙ Assumptions, as abas de SG&A e CAC e o Fleet Plan editam O CENÁRIO, e cada
    // gravação vai para o documento dele em vez dos endpoints do Live.
    let scenActive = null;   // cenário selecionado (objeto) ou null quando estamos no Live
    let finLiveSnap = null;  // cópia das entradas do Live, guardada enquanto um cenário está ativo
    const clone = (o) => JSON.parse(JSON.stringify(o == null ? null : o));
    // `sga`/`cac`/`hc` no snapshot do cenário são os dicionários POR ANO inteiros — um cenário
    // vale para os dois anos ao mesmo tempo, cada um com a própria máscara.
    const finInputs = () => ({ cfg: clone(finCfg), sga: clone(finSgaByYear), cac: clone(finCacByYear), cohorts: clone(finCohorts), hc: clone(finHcByYear) });
    // Cenário salvo ANTES do multi-ano guarda o objeto de um ano só (`{rent,prof,it}`). Lido como
    // dicionário por ano ele não teria a chave 2026 e o cenário abriria com tudo em branco — então
    // o formato antigo é reconhecido aqui e vira o ano-base.
    const asByYear = (v, isOld, empty) => {
      const d = clone(v) || {};
      const out = isOld(d) ? { [FIN_BASE_YEAR]: d } : d;
      if (!out[finYear]) out[finYear] = empty();
      return out;
    };
    function setFinInputs(d) {
      if (!d) return;
      if (d.cfg) finCfg = clone(d.cfg);
      if (d.sga) { finSgaByYear = asByYear(d.sga, (v) => Array.isArray(v.rent), emptySga); finSga = finSgaByYear[finYear]; }
      if (d.cac) { finCacByYear = asByYear(d.cac, (v) => Array.isArray(v.ads), emptyCac); finCac = finCacByYear[finYear]; }
      if (d.cohorts) finCohorts = clone(d.cohorts);
      if (d.hc) { finHcByYear = asByYear(d.hc, (v) => Array.isArray(v.roles), emptyHc); finHc = finHcByYear[finYear]; }
    }
    // troca de versão: entra/sai do cenário trocando as entradas em memória
    function selectVersion(v) {
      const next = pnlScenarios.find((x) => x.id === v) || null;
      if (next && !scenActive) finLiveSnap = finInputs();          // guarda o Live uma vez só
      if (next) {
        if (!next.data || !next.data.cfg) next.data = clone(finLiveSnap || finInputs()); // cenário novo nasce igual ao Live
        setFinInputs(next.data);
      } else if (scenActive && finLiveSnap) {
        setFinInputs(finLiveSnap); finLiveSnap = null;             // volta ao Live
      }
      scenActive = next;
      pnlVersion = v;
      finActCache = {};
      renderPnl(); renderFleetPlan(); renderCac(); renderAdmin(); renderAssump(); renderHc(); renderCosts();
    }
    // grava o cenário ativo (chamado por todos os saves do Finance no lugar dos endpoints do Live)
    let scenTimer = null;
    function persistScen() {
      if (!scenActive) return false;
      scenActive.data = finInputs();
      clearTimeout(scenTimer);
      scenTimer = setTimeout(async () => {
        try {
          const r = await fetch('/api/finance/scenarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ id: scenActive.id, data: scenActive.data }) });
          const d = await r.json().catch(() => ({}));
          if (d && d.scenarios) {
            const keep = scenActive.id;
            pnlScenarios = d.scenarios;
            scenActive = pnlScenarios.find((x) => x.id === keep) || scenActive;
          }
        } catch (e) { /* mantém em memória; a próxima gravação tenta de novo */ }
      }, 400);
      return true;
    }
    // resumo do que este cenário tem de diferente do Live — vira o chip ao lado do seletor
    function scenSummary(s) {
      if (!s || !s.data || !s.data.cfg) return '';
      const live = (scenActive && s.id === scenActive.id) ? finLiveSnap : null;
      if (!live) return 'saved ' + String(s.savedAt || '').slice(0, 10);
      const out = [];
      const LBL = { __fin_fx__: 'FX', __fin_tax_fed__: 'federal tax', __fin_tax_credit__: 'tax credit', __fin_decomm__: 'decommissioning', __fin_13th__: '13th' };
      Object.keys(Object.assign({}, live.cfg, s.data.cfg)).forEach((k) => {
        if (String(live.cfg[k]) === String(s.data.cfg[k])) return;
        const base = String(k).split('@@')[0];
        const nm = LBL[base] || (base === '__fin_payfee__' ? 'processing fee' : base.replace(/^__fin_|__$/g, '').replace(/_/g, ' '));
        if (!out.includes(nm)) out.push(nm);
      });
      const tot = (o) => JSON.stringify(o || {}).length;
      if (tot(live.sga) !== tot(s.data.sga)) out.push('SG&A');
      if (tot(live.cac) !== tot(s.data.cac)) out.push('CAC');
      if ((live.cohorts || []).length !== (s.data.cohorts || []).length ||
          (live.cohorts || []).reduce((a, c) => a + c.qty, 0) !== (s.data.cohorts || []).reduce((a, c) => a + c.qty, 0)) out.push('fleet plan');
      if (tot(live.hc) !== tot(s.data.hc)) out.push('headcount');
      return out.length ? 'changed: ' + out.slice(0, 4).join(', ') + (out.length > 4 ? '…' : '') : 'same as Live';
    }
    // criar cenário = só dar um nome. Ele nasce com uma cópia do Live e passa a ser editado
    // pelos MESMOS controles (⚙ Assumptions, abas de SG&A/CAC, Fleet Plan).
    async function newScenario() {
      const name = (window.prompt('Name this scenario (it starts as a copy of Live, and you edit it with the normal controls):', '') || '').trim();
      if (!name) return;
      try {
        const r = await fetch('/api/finance/scenarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name, data: finInputs() }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.ok) throw new Error(d.error || ('HTTP ' + r.status));
        pnlScenarios = d.scenarios;
        selectVersion(d.saved);
      } catch (e) { alert('Could not create: ' + e.message); }
    }
    async function renameScenario(scen) {
      if (!scen) return;
      const name = (window.prompt('Rename the scenario:', scen.name) || '').trim();
      if (!name || name === scen.name) return;
      try {
        const r = await fetch('/api/finance/scenarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ id: scen.id, name }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.ok) throw new Error(d.error || ('HTTP ' + r.status));
        pnlScenarios = d.scenarios;
        scenActive = pnlScenarios.find((x) => x.id === scen.id) || scenActive;
        renderPnl();
      } catch (e) { alert('Could not rename: ' + e.message); }
    }
    async function deleteScenario(scen) {
      if (!scen) return;
      if (!window.confirm('Delete the scenario "' + scen.name + '"? Its assumptions are lost; Live is untouched.')) return;
      try {
        const r = await fetch('/api/finance/scenarios/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ id: scen.id }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.ok) throw new Error(d.error || ('HTTP ' + r.status));
        pnlScenarios = d.scenarios;
        selectVersion('live');
      } catch (e) { alert('Could not delete: ' + e.message); }
    }
    function renderPnlControls(live) {
      const ctl = document.getElementById('pnlControls'); if (!ctl) return;
      const budget = pnlVersion === 'budget';
      const scen = pnlScenarios.find((x) => x.id === pnlVersion) || null;
      let h = '<div class="pnl-bar">';
      // seletor de ANO (2026 · 2027) — o P&L e o Fleet Plan seguem o ano escolhido
      h += '<div class="pnl-years">' + [FIN_BASE_YEAR, FIN_BASE_YEAR + 1].map((y) =>
        `<button class="pnl-yr${finYear === y ? ' on' : ''}" data-y="${y}">${y}</button>`).join('') + '</div>';
      // moeda de exibição (mesmo componente de bandeiras do UE) + esconder projetado
      h += `<div class="ue-cur-toggle pnl-cur" id="pnlCurToggle">${CUR_FLAGS(pnlCur === 'BRL' ? 'BRL' : 'USD')}</div>`;
      h += `<button id="pnlProjBtn" class="ue-projbtn${pnlShowProj ? '' : ' off'}" title="${pnlShowProj ? 'Hide everything that is still a projection and show actuals only' : 'Bring the projections back'}">` +
        `<span class="ue-projbtn-dot"></span><span>${pnlShowProj ? 'Forecast' : 'Actuals'}</span></button>`;
      h += verPicker();
      if (isAdmin && live) h += '<button id="pnlSaveVer" class="pnl-btn pnl-freeze" title="Save these numbers under a name — a read-only snapshot for the board">Freeze</button>';
      if (isAdmin && !scen) h += '<button id="pnlNewScen" class="pnl-btn pnl-scen-new" title="Create a scenario: a copy of Live that you edit with the normal controls">＋ Scenario</button>';
      if (isAdmin && scen) h += '<button id="pnlRenScen" class="pnl-btn" title="Rename this scenario">Rename</button>';
      if (isAdmin && !live && !budget && !scen) h += '<button id="pnlDelVer" class="pnl-btn pnl-del" title="Delete this frozen version">🗑</button>';
      if (isAdmin && scen) h += '<button id="pnlDelScen" class="pnl-btn pnl-del" title="Delete this scenario">🗑</button>';
      if (live) h += `<button id="pnlNoSdBtn" class="pnl-btn${pnlNoSd ? ' on' : ''}" title="What-if view without the sub-rental security deposit (and its refund)">No dep.</button>`;
      if (live && indriveOn()) h += `<button id="pnlIdrBtn" class="idr-btn idr-btn-sm${pnlNoIdr ? ' off' : ' on'}" title="${pnlNoIdr ? 'InDrive is OUT of the P&L — click to bring it back' : 'Click to remove the InDrive benefit from the P&L'}"><span class="idr-mark">iD</span><span class="idr-txt">InDrive</span><span class="idr-state">${pnlNoIdr ? 'off' : 'on'}</span></button>`;
      h += `<button id="pnlExpand" class="pnl-btn" title="${pnlCollapsed.size ? 'Expand all groups' : 'Collapse all groups'}">${pnlCollapsed.size ? '⤢' : '⤡'}</button>`;
      h += '<button id="pnlAssump" class="pnl-btn pnl-ico" title="Tax rates, processing fee (global and per month), FX and other assumptions">⚙</button>';
      h += '<button id="pnlInfo" class="pnl-btn pnl-info" title="Where each line comes from and how it updates">?</button>';
      if (budget) h += `<span class="pnl-budge">◆ Budget · per-car standard from the Theoric UE · no actuals</span>`;
      else if (scen) h += `<span class="pnl-scenchip">◇ Editing this scenario — ⚙ Assumptions, SG&amp;A, CAC and Fleet Plan all write here · ${escH(scenSummary(scen))}</span>`;
      else if (!live) { const v = pnlVersions.find((x) => x.id === pnlVersion); h += `<span class="pnl-frozen">📌 Frozen${v && v.savedAt ? ' · ' + v.savedAt.slice(0, 10) : ''}${v && v.snapshot && v.snapshot.noSd ? ' · no deposit' : ''}</span>`; }
      // o chip "actuals →" saiu da barra: agora fica ao lado do título da seção, onde antes
      // estava "(USD)" — a moeda passou a ser escolhida pelas bandeiras, então o rótulo fixo saiu.
      const actEl = document.getElementById('pnlActTitle');
      if (actEl) actEl.innerHTML = (pnlActualsThrough != null)
        ? `<span class="pnl-act">actuals → ${monthLbl(pnlActualsThrough)}</span>` : '';
      if (live && pnlSimApply && pnlSimScale !== 100) h += `<span class="pnl-simchip">⚠ simulated · deliveries at ${pnlSimScale}%</span>`;
      h += '</div>';
      ctl.innerHTML = h;
      ctl.querySelectorAll('.pnl-yr').forEach((b) => b.addEventListener('click', () => setFinYear(+b.dataset.y)));
      const ab = document.getElementById('pnlAssump'); if (ab) ab.addEventListener('click', openAssumpModal);
      const ib = document.getElementById('pnlInfo'); if (ib) ib.addEventListener('click', openPnlInfo);
      // bandeirinhas: o data-c do CUR_FLAGS é BRL/USD, o mesmo vocabulário do estado
      ctl.querySelectorAll('#pnlCurToggle .ue-cur-btn').forEach((b) => b.addEventListener('click', () => {
        pnlCur = b.dataset.c === 'BRL' ? 'BRL' : 'USD'; renderPnl();
      }));
      const pb2 = document.getElementById('pnlProjBtn');
      if (pb2) pb2.addEventListener('click', () => { pnlShowProj = !pnlShowProj; renderPnl(); });
      wireVerPicker();
      const ns = document.getElementById('pnlNewScen'); if (ns) ns.addEventListener('click', newScenario);
      const rs = document.getElementById('pnlRenScen'); if (rs) rs.addEventListener('click', () => renameScenario(scen));
      const ds = document.getElementById('pnlDelScen'); if (ds) ds.addEventListener('click', () => deleteScenario(scen));
      const nb = document.getElementById('pnlNoSdBtn'); if (nb) nb.addEventListener('click', () => { pnlNoSd = !pnlNoSd; renderPnl(); });
      const idb = document.getElementById('pnlIdrBtn'); if (idb) idb.addEventListener('click', () => { pnlNoIdr = !pnlNoIdr; renderPnl(); });
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
      // cenário ativo: grava no documento DELE, não na config global do Live
      if (scenActive) { if (num == null) delete finCfg[k + '@@0']; else finCfg[k + '@@0'] = num; persistScen(); renderPnl(); renderAssump(); return; }
      try {
        if (num == null) { await fetch('/api/ue/value/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ fleet: '__fin_cfg__', line: k, period: 0 }) }); delete finCfg[k + '@@0']; }
        else { await fetch('/api/ue/value', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ fleet: '__fin_cfg__', line: k, period: 0, value: num, kind: 'proj' }) }); finCfg[k + '@@0'] = num; }
      } catch (e) {}
      renderPnl();
    }
    // "?" do P&L — de onde vem cada bloco e como se atualiza
    // "?" do P&L — reescrito como um guia navegável em vez de uma tabela apertada.
    // Estrutura: linha do tempo de como o mês é montado (realizado → mês vigente → projeção),
    // depois as linhas agrupadas por família, cada uma expansível com a explicação longa.
    function openPnlInfo() {
      const FAM_DOT = { rev: '#5A00F8', cogs: '#EB6834', opex: '#0891B2', eng: '#15803D' };
      const GROUPS = [
        { id: 'rev', name: 'Revenue', dot: FAM_DOT.rev, rows: [
          { t: 'Subscription · Late-payment interest', src: 'Payments matrix + reference fleets', upd: 'auto',
            d: 'Months already lived use the REAL payments matrix of every plate (principal and interest separated). Future months multiply the reference-fleet profile per car by the active fleet. Interest follows each plate’s contract version: 5% on v1/v2, 20% from v3.' },
          { t: 'Traffic fines (in)', src: 'Fines API + contract rule', upd: 'auto',
            d: 'Cash the clients actually paid, on the payment date. The projection applies the contract rule — GROSS fine × (1 + premium), 10% on v1/v2 and 20% from v3 — over the same universe of fines as the outflow line, so the two sides always talk about the same infractions. The future is a pace per CAR multiplied by the active fleet of each month: it used to be a single fleet-wide amount per day, which froze the line at today’s fleet size and made november project the same as september while the fleet nearly doubled. See "How the fines pace is measured" below.' },
          { t: 'Termination fee', src: 'import_jud + recovery % slider', upd: 'auto',
            d: 'Total charged on early terminations (import_jud, column K minus fines/tolls) × the recovery % slider of the UE. Lands at contract end (M13 of each cohort).' },
          { t: 'Vehicle sell', src: '✎ box', upd: 'manual',
            d: 'Sale at 103% of the purchase price, at M13 of each cohort. Federal tax hits only the margin over the purchase (sell − purchase), since both land in the same month for a given plate.' },
          { t: 'InDrive bonus', src: 'iD panel', upd: 'manual',
            d: 'Value per plate on the month of each batch date — the iD button on the P&L bar removes it from the whole statement.' },
          { t: 'Security deposit refund', src: 'Derived from the deposit', upd: 'manual',
            d: 'The sub-rental deposit going back at M13, corrected by the % p.a. field. The "No deposit" button removes deposit AND refund together — they are two sides of the same coin.' },
        ]},
        { id: 'cogs', name: 'COGS', dot: FAM_DOT.cogs, rows: [
          { t: 'Maintenance', src: 'import_rev + km pace', upd: 'auto',
            d: 'Past: real invoices by due date. Future: each fleet’s km pace schedules the next revisions, priced from the revisions site with the 25% discount, paid ~33 days later — which is why the line reaches M13.' },
          { t: 'Traffic fines (out)', src: 'multas_consolidado', upd: 'auto',
            d: 'What we pay LM: the NET fine (with discount, ~80% of gross) × 1.05, on our due date. The margin of the fines business comes from this asymmetry: we charge over the gross, we pay over the net — about 26% on the current numbers. Like the inflow line, the future scales with the active fleet.' },
          { t: 'Subrental · Insurance · GPS · Prep · Sticker', src: 'UE boxes per fleet', upd: 'manual',
            d: 'The real per-fleet boxes of the Unit Economics, each on its own schedule — sub-rental always on the 26th (12 installments from the month after delivery), insurance split in N installments, GPS at M0 + monthly, preparation and sticker at M0.' },
          { t: 'Recovery · Repair cost', src: 'import_jud', upd: 'auto',
            d: 'Towing + recovery on one line, damages + cleaning + others on the other, by event date. Tera’s projection borrows Fleet 1’s history while its own numbers mature.' },
          { t: 'Part Replacement', src: 'Fleet site + ⚙ Parts panel', upd: 'auto',
            d: 'Real events from the fleet site (natural wear only — atypical damage is charged to the client). Future replacements come from each plate’s km pace against the intervals and costs set in the ⚙ Parts panel.' },
        ]},
        { id: 'opex', name: 'OPEX', dot: FAM_DOT.opex, rows: [
          { t: 'HC Payroll', src: 'SG&A → Headcount', upd: 'manual',
            d: 'One row per employee × the cost table: base salary, meal, health, payroll taxes, and the 13th + bonus landing in december. The Dashboard’s HC Payroll view opens each of these components.' },
          { t: 'SG&A (Rent · Professional services · IT)', src: 'SG&A tabs', upd: 'manual',
            d: 'Item by item, month by month, exactly as filled in the three admin tables.' },
          { t: 'CAC', src: 'CAC tabs + Fleet Plan', upd: 'mixed',
            d: 'Commission = USD per car × vehicles delivered in the month (referenced to the Fleet Plan, so scaling deliveries scales commission). Paid media and influencers come from their own tabs.' },
        ]},
        { id: 'eng', name: 'Engine & globals', dot: FAM_DOT.eng, rows: [
          { t: 'Fleet (delivered / active)', src: 'Fleet Plan cohorts', upd: 'manual',
            d: 'Each cohort enters on its calendar date (pro-rata in the delivery month) and decays by the monthly decommissioning rate. Every per-car line multiplies by this active count. A car LEAVES the count when its 52 contract weeks are over — the M13 events (sale, refund, termination, last sub-rental charge) still happen, but the car no longer scales the per-car projections — and a total-loss car leaves in the month of the write-off, while its own realized revenue and costs keep flowing normally.' },
          { t: 'Actuals override', src: 'All revenue/cost sources', upd: 'auto',
            d: 'Months up to today replace the model with consolidated ACTUALS of the whole fleet. The current month is a blend: what already happened plus the model for the remaining days — so early in the month revenue does not look like a cliff.' },
          { t: 'How the fines pace is measured', src: 'measured on 292 fines', upd: 'auto',
            d: 'A fine only exists for us when the agency e-mail arrives — measured on this base: 20 days on average, 27 at the 90th percentile, 42 at most. So the historical pace stops counting at the last matured day; dividing by every day since a fleet started counts days whose fines had not arrived yet and understated every fleet, from 15% on the oldest to 47% on the newest. A young fleet also has too thin a sample to trust (fleet 6 shows 6 fines where the pooled pace predicts 22), so its own pace is blended with the pooled one by credibility — weight = exposure / (exposure + 50 car-months) — which avoids a hard cutoff by age. Only the gross value is borrowed; each fleet keeps its own contract premium. This matters most for Tera cohorts, whose reference fleet went from R$43.77 to R$137.16 per car-month.' },
          { t: 'Taxes · Payment processing', src: '⚙ Assumptions', upd: 'manual',
            d: 'Federal tax as % of revenue, but pass-through lines pay only over their MARGIN: vehicle sell over (sell − purchase), the deposit refund over the interest alone, and traffic fines over the spread between what clients pay us and what we pay LM. The processing fee has a global value and can be overridden month by month.' },
          { t: 'FX and the year link', src: '⚙ Assumptions', upd: 'manual',
            d: 'Everything is computed in R$ and shown in USD at the FX assumption. 2027 is a continuation, not a restart: its accumulated cash opens with 2026’s closing balance.' },
          { t: 'Versions: Live · Budget · Scenarios · Frozen', src: 'Version picker', upd: 'mixed',
            d: 'Live = actuals + forecast. Budget = Fleet Plan × Theoric UE per car, no actuals — the grey dotted line of the Dashboard. A Scenario is an editable copy of Live’s inputs (assumptions, SG&A, CAC, fleet plan, headcount) recomputed on fresh data. Frozen = an immutable snapshot for the board.' },
        ]},
      ];
      const BADGE = { auto: ['Auto · daily 05:00', 'pi-b-auto'], manual: ['Manual', 'pi-b-man'], mixed: ['Mixed', 'pi-b-mix'] };
      const ov = document.createElement('div');
      ov.className = 'ue-modal-overlay';
      ov.innerHTML =
        `<div class="ue-modal pnl-infox">` +
          `<div class="pi-head"><div><div class="ue-modal-title" style="margin:0">Where the P&amp;L numbers come from</div>` +
            `<div class="ue-modal-sub" style="margin:4px 0 0">Click a line to read how it is built. Reference fleets: Polo = Fleet 1 · Argo = Fleet 2 · Tera = Fleet 6.</div></div>` +
            `<button type="button" class="pi-close" title="Close">✕</button></div>` +
          // linha do tempo: como um mês vira número
          `<div class="pi-tl">` +
            `<div class="pi-tl-seg past"><b>Past months</b><span>consolidated actuals of the whole fleet</span></div>` +
            `<div class="pi-tl-seg now"><b>Current month</b><span>actuals so far + model for the remaining days</span></div>` +
            `<div class="pi-tl-seg fut"><b>Future</b><span>reference fleets × active cars, in USD at the FX assumption</span></div>` +
          `</div>` +
          GROUPS.map((g) =>
            `<div class="pi-g"><div class="pi-g-h"><i style="background:${g.dot}"></i>${escH(g.name)}</div>` +
            g.rows.map((r, i) => {
              const [bl, bc] = BADGE[r.upd];
              return `<div class="pi-row" data-k="${g.id}${i}">` +
                `<div class="pi-row-top"><span class="pi-row-t">${escH(r.t)}</span>` +
                  `<span class="pi-row-src">${escH(r.src)}</span>` +
                  `<span class="pi-b ${bc}">${bl}</span><span class="pi-chev">▸</span></div>` +
                `<div class="pi-row-d" hidden>${escH(r.d)}</div></div>`;
            }).join('') + `</div>`).join('') +
        `</div>`;
      document.body.appendChild(ov);
      const close = () => ov.remove();
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      ov.querySelector('.pi-close').addEventListener('click', close);
      ov.querySelectorAll('.pi-row').forEach((row) => row.addEventListener('click', () => {
        const d = row.querySelector('.pi-row-d');
        const open = d.hidden;
        d.hidden = !open;
        row.classList.toggle('open', open);
      }));
    }
    // PAYBACK: mês em que o caixa ACUMULADO vira positivo (devolveu tudo o que foi investido).
    // Não é o que a página mostra como breakeven — fica aqui porque o gráfico de caixa acumulado
    // cruza o zero exatamente nesse ponto e o rótulo precisa ser honesto.
    function pnlPayback(P) {
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
    // BREAKEVEN OPERACIONAL: o mês a partir do qual a operação passa a GERAR caixa de forma
    // recorrente — net cashflow positivo em BE_STREAK meses seguidos. Um mês positivo isolado não
    // conta (dezembro tem 13º, abril teve venda de veículo etc.); a exigência de sequência é o que
    // separa "teve um mês bom" de "a recorrência virou".
    const BE_STREAK = 2;
    function pnlBreakeven(P) {
      const firstOp = (P.delivered || []).findIndex((d) => d > 0);
      if (firstOp < 0) return null;
      const cf = P.netCf || [];
      for (let m = Math.max(0, firstOp); m + BE_STREAK - 1 < FIN_MONTHS; m++) {
        let ok = true;
        for (let k = 0; k < BE_STREAK; k++) if (!((cf[m + k] || 0) > 0)) { ok = false; break; }
        if (ok) return m;
      }
      return null;
    }
    // O breakeven não precisa acontecer no ano exibido. Se não vier neste, roda o ano SEGUINTE
    // e devolve em que mês de lá ele cai — antes o painel só sabia dizer "not in 2026" e parava aí.
    // Atenção: a sequência pode ATRAVESSAR a virada do ano (dez positivo + jan positivo). Por isso
    // a busca no ano seguinte também olha o último mês deste ano.
    // rótulo de mês independente do finYear corrente (o hero pode citar o ano seguinte)
    const MON3_OF = (m) => FIN_MON3[m] || String(m + 1);
    // caixa acumulado no fim do ano SEGUINTE — recalcula com as mesmas opções
    function nextYearEoy(baseOpts) {
      if (!baseOpts || finYear >= FIN_BASE_YEAR + 1) return null;
      try { return withYear(finYear + 1, () => (computePnl(baseOpts).accCf || [])[FIN_MONTHS - 1] || 0); }
      catch (e) { return null; }
    }
    function pnlBreakevenAhead(P, baseOpts) {
      const here = pnlBreakeven(P);
      if (here != null) return { year: finYear, m: here };
      if (!baseOpts || finYear >= FIN_BASE_YEAR + 1) return null;
      const keep = finYear;
      try {
        return withYear(keep + 1, () => {
          const nx = computePnl(baseOpts);
          // sequência a cavalo na virada: dezembro deste ano + janeiro do seguinte
          const cfHere = P.netCf || [], cfNext = nx.netCf || [];
          if ((cfHere[FIN_MONTHS - 1] || 0) > 0 && (cfNext[0] || 0) > 0) return { year: keep, m: FIN_MONTHS - 1, cross: true };
          const m = pnlBreakeven(nx);
          return m == null ? null : { year: keep + 1, m, eoy: (nx.accCf || [])[FIN_MONTHS - 1] || 0 };
        });
      } catch (e) { return null; }
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
      const gmFY = sum(P.coreRev || P.grossRev) ? (sum(P.gm) / sum(P.coreRev || P.grossRev)) * 100 : 0;
      const opexPct = sum(P.grossRev) ? (-sum(P.opex) / sum(P.grossRev)) * 100 : 0;
      return { beIdx, pbIdx: pnlPayback(P), peak, peakM, arpu, cacUnit, gmFY, opexPct, netFY: sum(P.netCf), eoy: (P.accCf || [])[FIN_MONTHS - 1] || 0, totDeliv, hcDec: (P.headcount || [])[FIN_MONTHS - 1] || 0 };
    }
    // caixa de UM carro ao longo da vida (M0..M13), pelo perfil de referência — "quanto vale 1 carro a mais"
    function carLifetime(model) {
      const fx = finPar('__fin_fx__') || 5.5;
      const vals = finModelVals[model] || {};
      const maint = uetMaint(vals, model);
      const prof = refProfiles && refProfiles[model];
      // MESMA regra do computePnl, linha a linha: perfil da frota de referência quando ele tem
      // aquela linha, senão o UE Teórico. Usar o perfil inteiro (sem fallback) dava um fluxo
      // truncado — só as linhas que a frota real já tem — e o payback nunca fechava.
      const val = (L, p) => {
        if (prof && prof[L]) return prof[L][p] || 0;
        const lo = lineOf(L);
        return lo ? (uetEff(vals, model, lo, p, maint) || 0) : 0;
      };
      const LINES = FIN_REV_LINES.concat(FIN_COGS_LINES).concat(['Security Deposit', 'Vehicle Purchase']);
      const mesA = [];
      for (let p = 0; p < UET_PERIODS; p++) { let v = 0; LINES.forEach((L) => { v += val(L, p); }); mesA.push(v); }
      if (!mesA.some((v) => Math.abs(v) > 0.01)) return null;
      let total = 0, cum = 0, payback = null;
      const m0 = mesA[0] || 0;                       // buraco de entrada (calção + preparação + adesivo + GPS)
      for (let p = 0; p < UET_PERIODS; p++) {
        total += mesA[p]; cum += mesA[p];
        if (payback == null && p > 0 && cum >= 0) payback = p;
      }
      const pos = mesA.slice(1).filter((v) => v > 0);
      const mediaMes = pos.length ? pos.reduce((a, b) => a + b, 0) / pos.length : 0;
      return { total: total / fx, payback, m0: m0 / fx, mediaMes: mediaMes / fx };
    }
    // Caixa MARGINAL de 1 carro entregue HOJE: quanto o caixa acumulado de dezembro muda ao
    // colocar uma coorte extra de 1 carro na data de hoje. Responde "vale a pena mais um carro
    // agora?" melhor que o ARPU (que era média de receita, sem custo nem tempo).
    const MARG_MODEL = 'Tera'; // modelo padrão da frota nova
    function marginalCarEoy(P, baseOpts, model) {
      if (!baseOpts) return null;                                  // versão congelada: não dá p/ recalcular
      const hojeIso = (OCN.ue && OCN.ue.hoje) || new Date().toISOString().slice(0, 10);
      // "hoje" só existe no ano exibido; nos outros anos entra no 1º dia do ano projetado
      const iso = hojeIso.slice(0, 4) === String(finYear) ? hojeIso : (finYear + '-01-01');
      const extra = (baseOpts.extra || []).concat([{ id: '_marg', model, date: iso, qty: 1 }]);
      const S = computePnl({ ...baseOpts, extra });
      const eoy = (a) => (a || [])[FIN_MONTHS - 1] || 0;
      return { delta: eoy(S.accCf) - eoy(P.accCf), when: iso };
    }
    function renderPnlExtras(P, live, baseOpts) {
      const ex = document.getElementById('pnlExtras'); if (!ex) return;
      const K = pnlKpis(P);
      const tile = (label, val, sub, cls) => `<div class="pnl-kpi${cls ? ' ' + cls : ''}"><div class="pnl-kpi-v">${val}</div><div class="pnl-kpi-l">${escH(label)}</div><div class="pnl-kpi-s">${escH(sub || '')}</div></div>`;
      const curK = pnlCur === 'BRL' ? (finPar('__fin_fx__') || 5.5) : 1;
      const cs = pnlCur === 'BRL' ? 'R$' : 'US$';
      const money = (v) => (v < 0 ? '−' : '') + cs + ' ' + fmtNum(Math.abs(v) * curK);
      // ---- painel enxuto: 1 destaque (breakeven) + métricas em faixa, sem repetir big numbers ----
      const beOk = K.beIdx != null;
      let h = '<div class="pnl-panel">';
      // se não vira neste ano, procura no seguinte em vez de só dizer "not in 2026"
      const beAhead = beOk ? null : pnlBreakevenAhead(P, baseOpts);
      const beLbl = beOk ? monthLbl(K.beIdx)
        : (beAhead ? MON3_OF(beAhead.m) + '-' + String(beAhead.year).slice(2) : 'not in ' + finYear + '/' + (finYear + 1));
      const beSub = beOk ? BE_STREAK + ' months in a row generating cash, from here on'
        : (beAhead ? 'not in ' + finYear + ' — the operation turns cash-positive in ' + beAhead.year
                   : 'net cashflow never strings ' + BE_STREAK + ' positive months through ' + (finYear + 1));
      h += '<div class="pnl-hero' + (beOk ? ' ok' : (beAhead ? ' next' : ' pend')) + '">' +
        '<span class="pnl-hero-cap">Breakeven</span>' +
        '<span class="pnl-hero-v">' + beLbl + '</span>' +
        '<span class="pnl-hero-s">' + beSub + '</span>' +
      '</div>';
      const row = (lbl, val, sub, tone) => '<div class="pnl-m ' + (tone || '') + '"><span class="pnl-m-l">' + lbl + '</span><b class="pnl-m-v">' + val + '</b><span class="pnl-m-s">' + sub + '</span></div>';
      h += '<div class="pnl-mrow">' +
        row('Peak funding', money(K.peak), K.peakM != null ? 'deepest at ' + monthLbl(K.peakM) : 'no dip', 'warn') +
        row('Cash payback', K.pbIdx != null ? monthLbl(K.pbIdx) : '—', 'accumulated cash back to zero', K.pbIdx != null ? 'good' : '') +
        (() => {
          // Quanto tempo UM carro leva para cobrir o próprio M0 (calção + preparação + adesivo +
          // GPS de entrada). É a peça que explica o caixa da empresa: enquanto a frota cresce, cada
          // entrega abre um buraco novo que só fecha depois desse prazo.
          const cl = carLifetime(MARG_MODEL) || carLifetime((finModels[0] || {}).id);
          if (!cl || cl.payback == null) return row('Car payback', '—', 'not reached inside the contract');
          return row('Car payback', cl.payback + (cl.payback === 1 ? ' month' : ' months'),
            'to cover the ' + money(Math.abs(cl.m0)) + ' entry cost of one car', cl.payback <= 6 ? 'good' : 'warn');
        })() +
        (() => {
          // "End-of-year cash" repetia o Peak funding sempre que o pior mês era dezembro (é o caso
          // enquanto o caixa só afunda). Mostra o fechamento do ano SEGUINTE, que é informação nova.
          const nx = nextYearEoy(baseOpts);
          return nx == null
            ? row('Cash at ' + monthLbl(FIN_MONTHS - 1), money(K.eoy), 'end of ' + finYear, K.eoy >= 0 ? 'good' : 'warn')
            : row('Cash end of ' + (finYear + 1), money(nx), 'one year past this view', nx >= 0 ? 'good' : 'warn');
        })() +
        (() => {
          const mg = marginalCarEoy(P, baseOpts, MARG_MODEL);
          if (!mg) return row('+1 car today', '—', 'frozen version');
          return row('+1 car today', money(mg.delta), MARG_MODEL + ' → EoY cash', mg.delta >= 0 ? 'good' : 'warn');
        })() +
        row('CAC', money(K.cacUnit), K.totDeliv + ' cars (FY)') +
        row('Gross margin', Math.round(K.gmFY) + '%', 'over rental revenue (ex. car sale / InDrive / deposit refund)', K.gmFY >= 0 ? 'good' : 'warn') +
      '</div></div>';
      ex.innerHTML = h;
      // ---- simulador de frota: fica logo ABAIXO da tabela (container próprio) ----
      const simEl = document.getElementById('pnlSim');
      if (simEl) simEl.innerHTML = !live ? '' :
        '<div class="pnl-sim">' +
          '<div class="pnl-sim-top">' +
            '<div class="pnl-sim-head"><span class="pnl-sim-lbl">Fleet simulator</span></div>' +
            '<input type="range" id="pnlSimScale" min="25" max="400" step="5" value="' + pnlSimScale + '">' +
            '<span class="pnl-sim-val" id="pnlSimVal">' + pnlSimScale + '%</span>' +
            '<label class="pnl-sim-mask"><input type="checkbox" id="pnlSimApply"' + (pnlSimApply ? ' checked' : '') + '><span>apply to the table</span></label>' +
            '<button class="pnl-target" id="pnlBeSolver" title="How many extra cars to hit a target breakeven month">' +
              '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="1.1" fill="currentColor"/></svg>' +
              'Breakeven target</button>' +
          '</div><div class="pnl-simcards" id="pnlSimOut"></div></div>';
      if (live) {
        const money2 = money; // usado dentro do paint
        const sl = document.getElementById('pnlSimScale');
        const paint = () => {
          document.getElementById('pnlSimVal').textContent = pnlSimScale + '%';
          const S = pnlSimScale === 100 ? P : computePnl({ noSd: pnlNoSd, scale: pnlSimScale / 100 });
          const KS = pnlKpis(S);
          const d = (a, b) => (b - a);
          const sc = (lbl, val, delta, tone) => '<div class="pnl-sc ' + (tone || '') + '"><span class="pnl-sc-l">' + lbl + '</span><b class="pnl-sc-v">' + val + '</b><span class="pnl-sc-d">' + delta + '</span></div>';
          document.getElementById('pnlSimOut').innerHTML =
            sc('Breakeven (op.)', KS.beIdx != null ? monthLbl(KS.beIdx) : '—', K.beIdx != null && KS.beIdx != null ? (KS.beIdx === K.beIdx ? 'same as current' : ((KS.beIdx < K.beIdx ? '▲ ' : '▼ ') + Math.abs(KS.beIdx - K.beIdx) + ' mo ' + (KS.beIdx < K.beIdx ? 'earlier' : 'later'))) : 'vs current', KS.beIdx != null ? 'good' : 'warn') +
            sc('Peak funding', money(KS.peak), fmt(d(K.peak, KS.peak)) + ' vs current', 'warn') +
            sc('End-of-year cash', money(KS.eoy), fmt(d(K.eoy, KS.eoy)) + ' vs current', KS.eoy >= 0 ? 'good' : 'warn') +
            sc('Cars delivered', Math.round(KS.totDeliv), (KS.totDeliv >= K.totDeliv ? '+' : '') + Math.round(KS.totDeliv - K.totDeliv) + ' vs current', 'neutral');
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
        `<div class="ue-modal ue-modal-be"><div class="ue-modal-title">Breakeven target</div>` +
        `<div class="ue-modal-sub" style="margin:-10px 0 16px">Extra cars needed for the operation to string ${BE_STREAK} cash-positive months by the target.</div>` +
        `<div class="be-fields">` +
          `<label class="be-f"><span>Breakeven by</span><div class="be-selwrap"><select id="beTarget">${monthOpts(FIN_MONTHS - 1)}</select></div></label>` +
          `<label class="be-f"><span>Delivered in</span><div class="be-selwrap"><select id="beWhen">${monthOpts(Math.min(curM + 1, FIN_MONTHS - 1))}</select></div></label>` +
          `<label class="be-f"><span>Model</span><div class="be-selwrap"><select id="beModel">${modelOpts}</select></div></label>` +
        `</div>` +
        `<div class="be-result" id="beResult"></div>` +
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
        // resultado minimalista: número grande + o mês ao lado, em corpo menor
        const card = (big, unit, side, tone) => `<div class="be-out${tone ? ' ' + tone : ''}"><b class="be-out-n">${big}</b><span class="be-out-u">${unit}</span><span class="be-out-s">${side}</span></div>`;
        const base = beWith(0);
        if (base != null && base <= target) { out.innerHTML = card('0', 'extra cars', 'already breaks even in ' + monthLbl(base), 'ok'); return; }
        // busca: passos crescentes até 3000 carros (checa monotonicidade na prática)
        let found = null;
        for (const e of [5, 10, 15, 20, 30, 40, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000]) {
          const be = beWith(e);
          if (be != null && be <= target) { found = e; break; }
        }
        if (found == null) { out.innerHTML = card('∞', 'not reachable', 'volume alone cannot get there by ' + monthLbl(target), 'warn'); return; }
        // refina para o mínimo dentro do intervalo encontrado
        let lo = 0, hi = found;
        while (hi - lo > 1) { const mid = Math.ceil((lo + hi) / 2); const be = beWith(mid); if (be != null && be <= target) hi = mid; else lo = mid; }
        const be = beWith(hi);
        out.innerHTML = card('+' + hi, model + (hi > 1 ? 's' : '') + ' in ' + monthLbl(when), 'breakeven ' + monthLbl(be), 'ok');
      });
    }
    async function savePnlFee(m, raw) {
      const num = parseInput(raw);
      if (scenActive) { finCfg['__fin_payfee__@@' + m] = (num == null ? 0 : num); persistScen(); renderPnl(); renderAssump(); return; }
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
      if (scenActive) { persistScen(); return; }
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
      renderFinYearSwitcher('fleetPlanYear');
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
      evo += `<th class="ue-totalcol">FY-${String(finYear).slice(2)}E</th></tr></thead><tbody>`;
      const evoRow = (label, arr, isStock, cls) => {
        let s = `<tr class="ue-row${cls ? ' ' + cls : ''}"><td class="ue-rowlabel">${escH(label)}</td>`;
        for (let m = 0; m < FIN_MONTHS; m++) s += `<td class="ue-cell">${fmtQty(arr[m])}</td>`;
        const tot = isStock ? arr[FIN_MONTHS - 1] : arr.reduce((a, b) => a + (b || 0), 0);
        return s + `<td class="ue-cell ue-totalcol">${fmtQty(tot)}</td></tr>`;
      };
      evo += evoRow('New deliveries', FP.newDelivered, false);
      evo += evoRow('Total delivered fleet', FP.delivered, true);
      // as duas saídas que explicam por que a frota ativa fica abaixo da entregue — sem elas a
      // tabela não fechava com a faixa "Fleet" do P&L (em 2027 é o fim de contrato que zera tudo)
      evo += evoRow('Contract ended (52 weeks)', FP.ended || [], true);
      evo += evoRow('Total Loss', FP.ptLost || [], true);
      evo += evoRow('Total active fleet', FP.active, true, 'hc-total');
      evo += '</tbody></table></div><div class="fin-note">Active fleet = delivered − contracts ended at 52 weeks − total losses − the monthly decommissioning rate from Assumptions. It is the same count shown in the P&amp;L’s Fleet row.</div>';

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
      if (scenActive) { persistScen(); return; }
      hcSyncPlan();
      // manda só o ano ativo — o servidor mantém o outro ano como já estava guardado
      try {
        const r = await fetch('/api/finance/hc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ hc: { [finYear]: finHc } }) });
        const d = await r.json().catch(() => ({}));
        // MESCLA (não substitui): a resposta traz os anos gravados, e trocar o dicionário inteiro
        // apagaria da memória um ano ainda não persistido — que voltaria em branco no próximo clique.
        if (d && d.hc) { Object.assign(finHcByYear, d.hc); finHc = finHcByYear[finYear] || (finHcByYear[finYear] = emptyHc()); }
      } catch (e) {}
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
      h += `<th class="ue-totalcol">FY-${String(finYear).slice(2)}E</th>` + (canEdit ? '<th class="fin-actcol"></th>' : '') + '</tr></thead><tbody>';
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
      if (scenActive) { persistScen(); return; }
      try {
        const r = await fetch('/api/finance/sga', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ sga: { [finYear]: finSga } }) });
        const d = await r.json().catch(() => ({}));
        if (d && d.sga) { Object.assign(finSgaByYear, d.sga); finSga = finSgaByYear[finYear] || (finSgaByYear[finYear] = emptySga()); }
      } catch (e) {}
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
      renderFinYearSwitcher('sgaYear');
      // totalizador de SG&A (uma linha por despesa) acima das abas
      const tot = document.getElementById('sgaTotals');
      if (tot) tot.innerHTML = finCurFlags() + totalsTable([
        { label: 'Headcount', arr: hcMonthlyCost() },
        { label: 'Rent & Utilities', arr: sumItems(finSga.rent) },
        { label: 'Professional Services', arr: sumItems(finSga.prof) },
        { label: 'IT', arr: sumItems(finSga.it) },
      ], 'SG&A cost line (' + finCS() + ')');
      if (tot) wireCurFlags(tot, () => { renderAdmin(); renderHc(); renderPnl(); renderCac(); });
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
      if (scenActive) { persistScen(); return; }
      try {
        const r = await fetch('/api/finance/cac', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ cac: { [finYear]: finCac } }) });
        const d = await r.json().catch(() => ({}));
        if (d && d.cac) { Object.assign(finCacByYear, d.cac); finCac = finCacByYear[finYear] || (finCacByYear[finYear] = emptyCac()); }
      } catch (e) {}
      renderCac(); renderPnl();
    }
    function renderCac() {
      const el = document.getElementById('finCacWrap'); if (!el) return;
      renderFinYearSwitcher('cacYear');
      // comissão: valor por carro × entregas do mês (referenciado ao Fleet Plan, como no Excel)
      const newDelivered = new Array(FIN_MONTHS).fill(0);
      finCohorts.forEach((c) => { const cm = cohMonth(c) - FIN_YOFF(); if (cm >= 0 && cm < FIN_MONTHS) newDelivered[cm] += c.qty; });
      const per = finCac.perUnit || 0;
      const recovered = redeliverableByMonth();
      const recPer = finCac.recPerUnit || 0;
      const infTot = new Array(FIN_MONTHS).fill(0);
      (finCac.inf || []).forEach((it) => { for (let m = 0; m < FIN_MONTHS; m++) infTot[m] += (Number((it.profiles || [])[m]) || 0) * (it.price || 0); });
      // totalizador de CAC (uma linha por custo) acima das abas
      const tot = document.getElementById('cacTotals');
      if (tot) tot.innerHTML = finCurFlags() + totalsTable([
        { label: 'Sales Commission', arr: newDelivered.map((n, m) => n * per + recovered[m] * recPer) },
        { label: 'Paid Media', arr: sumItems(finCac.ads) },
        { label: 'Digital Influencers', arr: infTot },
      ], 'CAC cost line (' + finCS() + ')');
      if (tot) wireCurFlags(tot, () => { renderCac(); renderPnl(); });
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
      h += `<th class="ue-totalcol">FY-${String(finYear).slice(2)}E</th></tr></thead><tbody>`;
      const rowH = (label, arr) => { let s = `<tr class="ue-row ue-leaf"><td class="ue-rowlabel">${label}</td>`; let t = 0; for (let m = 0; m < FIN_MONTHS; m++) { t += arr[m]; s += `<td class="ue-cell">${arr[m] ? fmtNum(arr[m]) : '-'}</td>`; } return s + `<td class="ue-cell ue-totalcol">${t ? fmtNum(t) : '-'}</td></tr>`; };
      const KC = finCurK();
      h += rowH('Vehicles delivered', newDelivered);
      h += rowH('Commission (' + finCS() + ')', newDelivered.map((n2) => n2 * per * KC));
      h += '</tbody></table></div>';
      // ---- comissão de REENTREGA: carro recuperado que volta para a rua ----
      h += `<div class="sub2-title" style="margin-top:20px">Redelivery Commission — recovered/returned cars</div>` +
        `<div class="fin-note" style="margin:6px 0 10px">USD per redelivered car: <input class="hc-f hc-n" id="cacRecUnit" type="number" min="0" step="any" value="${recPer}"${canEditNow() ? '' : ' disabled'}> × cars that came back in the month — repossessed or returned by the driver (from the billing matrix). The result adds to Sales Commission above.</div>`;
      h += '<div class="ue-table-wrap"><table class="ue-table fin-grid"><thead><tr><th class="ue-rowlabel">Line</th>';
      for (let m = 0; m < FIN_MONTHS; m++) h += `<th>${monthLbl(m)}</th>`;
      h += `<th class="ue-totalcol">FY-${String(finYear).slice(2)}E</th></tr></thead><tbody>`;
      h += rowH('Recovered/Returned cars', recovered);
      h += rowH('Commission (' + finCS() + ')', recovered.map((c2) => c2 * recPer * KC));
      h += '</tbody></table></div>';
      head.innerHTML = h;
      el.appendChild(head);
      const pu = head.querySelector('#cacPerUnit');
      if (pu && canEditNow()) pu.addEventListener('change', () => { finCac.perUnit = Math.max(0, Number(pu.value) || 0); saveCac(); });
      const ru = head.querySelector('#cacRecUnit');
      if (ru && canEditNow()) ru.addEventListener('change', () => { finCac.recPerUnit = Math.max(0, Number(ru.value) || 0); saveCac(); });
      const note = document.createElement('div');
      note.className = 'fin-note';
      note.innerHTML = 'Commission is referenced to the Fleet Plan: USD per vehicle × vehicles delivered in the month.';
      el.appendChild(note);
      wireEditBar(el);
    }

    // ---------- DASHBOARD: realizado + projetado vs plano (gráficos) ----------
    // Paleta validada (dataviz): Actual #5A00F8 · Forecast #A78BFA · Plan #EB6834.
    // "Plan" = o ORÇADO: Fleet Plan × UE Teórico por carro, sem nenhum realizado — a projeção que
    // tínhamos de origem. É a mesma coisa que a opção "◆ Budget" do seletor de versão do P&L.
    // O "plano" tem SEMPRE a mesma cor (cinza-azulado pontilhado) em todos os gráficos — assim ele é
    // reconhecível de imediato, independente da linha escolhida.
    const DC = { act: '#5A00F8', for: '#A78BFA', plan: '#94A3B8', grid: 'rgba(120,120,140,0.10)', txt: '#6b7280' };
    // color-code por FAMÍLIA da linha (receita = roxo, COGS = laranja, OPEX = azul-petróleo).
    // Hues validados com o script da skill de dataviz (separação para daltonismo OK).
    // 4 famílias validadas com o script da skill de dataviz (todas as checagens passam;
    // pior par adjacente ΔE 15,9 em deuteranopia). O preenchimento do realizado é forte
    // de propósito — é ele que separa visualmente o que já aconteceu do que é projeção.
    const DASH_FAM = {
      rev: { name: 'Revenue', color: '#5A00F8', fill: 'rgba(90,0,248,.20)' },
      cogs: { name: 'COGS', color: '#EB6834', fill: 'rgba(235,104,52,.22)' },
      opex: { name: 'OPEX', color: '#0891B2', fill: 'rgba(8,145,178,.22)' },
      res: { name: 'Totals & results', color: '#15803D', fill: 'rgba(21,128,61,.20)' },
    };
    // O seletor do gráfico principal traz SÓ TOTALIZADORES. As linhas de detalhe deixaram de
    // disputar espaço com eles: elas aparecem nos dois cartões de baixo, que mudam conforme o
    // totalizador escolhido (mix, valor por carro, % sobre receita...). Assim escolher "COGS"
    // responde "quanto" no gráfico grande e "de quê" e "por carro" logo abaixo.
    // `neg: true` = a linha vem negativa no motor e é invertida p/ o gráfico ler "quanto gastamos".
    const DASH_TOTALS = {
      'Gross Revenue': { k: 'grossRev', fam: 'rev' },
      'COGS': { k: 'cogsTot', fam: 'cogs', neg: true },
      'Gross Margin': { k: 'gm', fam: 'res' },
      'OPEX': { k: 'opex', fam: 'opex', neg: true },
      'HC Payroll': { k: 'hcTot', fam: 'opex', neg: true },
      'Net cashflow': { k: 'netCf', fam: 'res' },
      'Combinations': { combo: true, fam: 'res' },
    };
    const DASH_FAMILY = (n) => DASH_FAM[(DASH_TOTALS[n] || {}).fam || 'res'];
    const DASH_LINES = Object.keys(DASH_TOTALS);
    const DASH_LABEL = (n) => n;
    // paleta de séries para os gráficos de composição (mix). Ordem fixa, nunca ciclada:
    // as 4 famílias validadas + 4 apoios da mesma escala, todas em pares adjacentes distinguíveis.
    const DASH_MIX = ['#5A00F8', '#EB6834', '#0891B2', '#15803D', '#A78BFA', '#F59E0B', '#0E7490', '#DB2777'];
    // linhas de DETALHE que não são chave direta de rev/cogs no P&L — cada uma sabe se extrair.
    // É o que faz o drill-down funcionar: clicar numa barra de qualquer mix abre a série no hero.
    const DASH_EXTRA = {
      'Security deposit': (PX) => (PX.secDep || []).map((v) => -v),
      'Vehicle purchase': (PX) => (PX.vehPur || []).map((v) => -v),
      'Rent & utilities': (PX) => (PX.rentTot || []).map((v) => -v),
      'Professional services': (PX) => (PX.profTot || []).map((v) => -v),
      'IT': (PX) => (PX.itTot || []).map((v) => -v),
      'HC payroll': (PX) => (PX.hcTot || []).map((v) => -v),
      'Base salary': (PX) => (PX.base || []).map((v) => -v),
      'Meal allowance': (PX) => (PX.meal || []).map((v) => -v),
      'Health plan': (PX) => (PX.health || []).map((v) => -v),
      'Payroll taxes': (PX) => (PX.ptax || []).map((v) => -v),
      '13th salary': (PX) => (PX.th13 || []).map((v) => -v),
      'Bonus': (PX) => (PX.bonus || []).map((v) => -v),
    };
    // família (cor) de uma linha de detalhe — receita roxa, COGS laranja, o resto é OPEX
    const DASH_DETAIL_FAM = (k) => (FIN_REV_LINES.includes(k) ? DASH_FAM.rev
      : (FIN_COGS_LINES.includes(k) || k === 'Security deposit' || k === 'Vehicle purchase') ? DASH_FAM.cogs : DASH_FAM.opex);
    const DRILL_LABEL = (k) => (k === 'Traffic fines (out)' ? 'Traffic fines' : k);
    // valores da linha no P&L (custos vêm positivos p/ o gráfico ler "quanto gastamos")
    function dashSeries(name, PX) {
      const t = DASH_TOTALS[name];
      if (t && t.k) { const a = PX[t.k] || []; return t.neg ? a.map((v) => -v) : a.slice(); }
      if (PX.rev && PX.rev[name]) return PX.rev[name];
      if (PX.cogs && PX.cogs[name]) return PX.cogs[name].map((v) => -v);
      if (name === 'CAC') return PX.cacTot.map((v) => -v);
      if (name === 'SG&A') return PX.sga.map((v) => -v);
      if (name === 'OPEX') return PX.opex.map((v) => -v);
      if (name === 'HC Payroll') return PX.hcTot.map((v) => -v);
      if (DASH_EXTRA[name]) return DASH_EXTRA[name](PX);
      return new Array(FIN_MONTHS).fill(0);
    }
    // ---- fábricas de gráfico dos cartões de baixo ----------------------------------------
    // Todas partilham a mesma gramática do hero: sólido = realizado, pontilhado = projeção,
    // cinza pontilhado = orçado. Eixo único sempre (nunca dois eixos y no mesmo gráfico).
    const DASH_AXES = (fmt) => ({
      x: { grid: { display: false }, ticks: { color: DC.txt, font: { size: 9.5 } } },
      y: { grid: { color: (c) => (c.tick.value === 0 ? '#9ca3af' : DC.grid), lineWidth: (c) => (c.tick.value === 0 ? 1.4 : 1) },
        ticks: { color: DC.txt, font: { size: 9.5 }, callback: (v) => (fmt ? fmt(v) : fmtQty(v)) } },
    });
    const DASH_TIP = (fmt) => ({ backgroundColor: '#1b0040', padding: 9, cornerRadius: 8, bodyFont: { size: 11 },
      callbacks: { label: (c) => (c.parsed.y == null ? null : c.dataset.label + ': ' + (fmt ? fmt(c.parsed.y) : finCS() + ' ' + fmtQty(c.parsed.y))) } });
    // legenda em HTML (fora do canvas): a nativa desenhava o quadradinho com a COR DE FUNDO do
    // dataset — no "Actual", que é área translúcida, saía um retângulo quase invisível e o
    // tracejado da projeção não aparecia. Aqui cada item mostra o traço real da série.
    const dashLegend = (items) => '<div class="dash-leg">' + items.map((it) =>
      `<span class="dash-leg-i"><i class="dash-leg-s${it.dash ? ' dash' : ''}" style="--c:${it.color}"></i>${escH(it.label)}</span>`).join('') + '</div>';

    // Junta dois anos num P&L só, para o dashboard poder mostrar 24 meses de uma vez.
    // Funciona porque o accCf de 2027 já carrega o fechamento de 2026 — emendar os dois dá
    // uma curva contínua, sem degrau nem reinício.
    function concatPnl(A, B) {
      const out = {};
      Object.keys(A).forEach((k) => {
        const a = A[k], b = B[k];
        if (Array.isArray(a) && Array.isArray(b)) out[k] = a.concat(b);
        else if (a && b && typeof a === 'object' && !Array.isArray(a)) {
          out[k] = {}; Object.keys(a).forEach((l) => { out[k][l] = Array.isArray(a[l]) ? a[l].concat(b[l] || []) : a[l]; });
        } else out[k] = a;
      });
      return out;
    }
    // Um gráfico de composição com 12 séries é ilegível. Mantém as N maiores do ano e junta o
    // resto num "Other" — as pequenas continuam visíveis no cartão de ranking ao lado.
    function topSeries(series, n) {
      const fy = (a) => a.reduce((x, y) => x + (y || 0), 0);
      const ranked = series.map((x) => ({ ...x, fy: Math.abs(fy(x.data)) })).filter((x) => x.fy > 0.5).sort((a, b) => b.fy - a.fy);
      if (ranked.length <= n + 1) return ranked;
      const keep = ranked.slice(0, n), rest = ranked.slice(n);
      const other = rest[0].data.map((_, i) => rest.reduce((s, r) => s + (r.data[i] || 0), 0));
      return keep.concat([{ label: 'Other (' + rest.length + ')', data: other, rest: rest.map((r) => r.label) }]);
    }
    // ranking anual das linhas — é aqui que as pequenas ficam legíveis (e clicáveis, via `key`)
    function rankRows(series, colors) {
      const fy = (a) => a.reduce((x, y) => x + (y || 0), 0);
      return series.map((x, i) => ({ label: x.label, key: x.key, v: fy(x.data) })).filter((x) => Math.abs(x.v) > 0.5)
        .sort((a, b) => b.v - a.v).map((r, i) => ({ ...r, color: colors[i % colors.length] }));
    }
    // multiplica só o que é DINHEIRO num P&L calculado (contagens/percentuais ficam como estão)
    const PNL_QTY_KEYS = { delivered: 1, active: 1, newDelivered: 1, headcount: 1, payFeePct: 1, actualsThrough: 1, recovered: 1 };
    function moneyScale(P, k) {
      if (!P || k === 1) return P;
      const out = {};
      Object.entries(P).forEach(([key, v]) => {
        if (PNL_QTY_KEYS[key]) { out[key] = v; return; }
        if (Array.isArray(v)) out[key] = v.map((x) => (typeof x === 'number' ? x * k : x));
        else if (v && typeof v === 'object') { const o = {}; Object.entries(v).forEach(([l, a]) => { o[l] = Array.isArray(a) ? a.map((x) => x * k) : a; }); out[key] = o; }
        else out[key] = (typeof v === 'number') ? v * k : v;
      });
      return out;
    }
    function renderDash() {
      if (!document.getElementById('dashLineCv')) return;
      // span de anos: um ano só ou os dois emendados (24 colunas) — mesma troca de finYear +
      // dados do ano usada em toda a Finance (withYear), só com o nome local de sempre
      const anoDe = withYear;
      const Y0 = FIN_BASE_YEAR, Y1 = FIN_BASE_YEAR + 1;
      const spanYear = dashSpan === 'y1' ? Y1 : Y0;
      let PA, PP, labels;
      if (dashSpan === 'both') {
        const a0 = anoDe(Y0, () => computePnl({})), a1 = anoDe(Y1, () => computePnl({}));
        const p0 = anoDe(Y0, () => computePnl({ budget: true })), p1 = anoDe(Y1, () => computePnl({ budget: true }));
        PA = concatPnl(a0, a1); PP = concatPnl(p0, p1);
        PA.actualsThrough = a0.actualsThrough;   // realizado só existe no 1º ano
        labels = anoDe(Y0, () => Array.from({ length: FIN_MONTHS }, (_, m) => monthLbl(m)))
          .concat(anoDe(Y1, () => Array.from({ length: FIN_MONTHS }, (_, m) => monthLbl(m))));
      } else {
        PA = anoDe(spanYear, () => computePnl({}));
        PP = anoDe(spanYear, () => computePnl({ budget: true }));
        labels = anoDe(spanYear, () => Array.from({ length: FIN_MONTHS }, (_, m) => monthLbl(m)));
      }
      // moeda: os gráficos inteiros seguem as bandeiras (mesmo estado do P&L)
      const KD = finCurK();
      PA = moneyScale(PA, KD); PP = moneyScale(PP, KD);
      const NM = labels.length;                    // 12 ou 24 colunas
      const curM = PA.actualsThrough != null ? PA.actualsThrough : -1;
      const kill = (id) => { if (dashCharts[id]) { dashCharts[id].destroy(); delete dashCharts[id]; } };
      const combo = dashLine === 'Combinations';
      // drill: uma linha de detalhe (clicada num mix) toma o lugar do totalizador no hero;
      // os cartões de baixo continuam os do totalizador, então dá para pular de linha em linha.
      const drill = (!combo && dashDrill) ? dashDrill : null;
      const fam = drill ? DASH_DETAIL_FAM(drill) : DASH_FAMILY(dashLine);
      const sum = (a) => (a || []).reduce((s, x) => s + (x || 0), 0);
      const zz = () => new Array(NM).fill(0);
      const divv = (a, b) => a.map((v, m) => (b[m] ? v / b[m] : null));   // per-car, % etc: sem dividir por zero
      const cum = (a) => { let s = 0; return a.map((v) => (s += (v || 0))); };
      const LAST = NM - 1;
      const pctFmt = (v) => Math.round(v) + '%';

      // ---------- gráfico principal ----------
      kill('dashLineCv');
      let heroLegend;
      if (combo) {
        // visão combinada: as três forças do P&L na mesma escala + o caixa que sobra delas
        const mk = (label, arr, color, fill) => ({ label, data: arr, borderColor: color, backgroundColor: fill || 'transparent',
          borderWidth: 2.4, pointRadius: 0, pointHoverRadius: 5, tension: 0.3, fill: fill ? 'origin' : false });
        dashCharts.dashLineCv = new Chart(document.getElementById('dashLineCv'), {
          type: 'line',
          data: { labels, datasets: [
            mk('Gross Revenue', PA.grossRev, DASH_FAM.rev.color, DASH_FAM.rev.fill),
            mk('COGS', PA.cogsTot.map((v) => -v), DASH_FAM.cogs.color),
            mk('OPEX', PA.opex.map((v) => -v), DASH_FAM.opex.color),
            mk('Net cashflow', PA.netCf, DASH_FAM.res.color),
          ] },
          options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { display: false }, datalabels: { display: false }, tooltip: DASH_TIP() },
            scales: DASH_AXES() },
        });
        heroLegend = dashLegend([
          { label: 'Gross Revenue', color: DASH_FAM.rev.color },
          { label: 'COGS', color: DASH_FAM.cogs.color },
          { label: 'OPEX', color: DASH_FAM.opex.color },
          { label: 'Net cashflow', color: DASH_FAM.res.color },
        ]);
      } else {
        const heroKey = drill || dashLine;
        const serie = dashSeries(heroKey, PA);
        const real = serie.map((v, m) => (m <= curM ? v : null));
        const proj = serie.map((v, m) => (m >= curM ? v : null)); // repete o corte: sem buraco
        dashCharts.dashLineCv = new Chart(document.getElementById('dashLineCv'), {
          type: 'line',
          data: { labels, datasets: [
            { label: 'Actual', data: real, borderColor: fam.color, backgroundColor: fam.fill, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, tension: 0.3, fill: 'origin' },
            { label: 'Forecast', data: proj, borderColor: fam.color, borderWidth: 2.5, borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 5, tension: 0.3 },
            { label: 'Budget', data: dashSeries(heroKey, PP), borderColor: DC.plan, borderWidth: 2, borderDash: [2, 3], pointRadius: 0, pointHoverRadius: 5, tension: 0.3 },
          ] },
          options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { display: false }, datalabels: { display: false }, tooltip: DASH_TIP() },
            scales: DASH_AXES() },
        });
        heroLegend = dashLegend([
          { label: 'Actual', color: fam.color },
          { label: 'Forecast', color: fam.color, dash: true },
          { label: 'Budget', color: DC.plan, dash: true },
        ]);
      }
      const legEl = document.getElementById('dashLegend'); if (legEl) legEl.innerHTML = heroLegend;

      // ---------- cabeçalho do hero ----------
      const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      const ht = document.getElementById('dashHeroTitle');
      if (ht) {
        // no drill o título ganha um "←" para voltar ao totalizador
        ht.innerHTML = drill
          ? `<button type="button" class="dash-back" id="dashBack" title="Back to ${escH(dashLine)}">←</button>${escH(DRILL_LABEL(drill))}`
          : escH(DASH_LABEL(dashLine));
        const bk = document.getElementById('dashBack');
        if (bk) bk.addEventListener('click', () => { dashDrill = null; renderDash(); });
      }
      const dot = document.getElementById('dashDot'); if (dot) { dot.style.backgroundColor = fam.color; dot.style.color = fam.color; }
      const st = document.getElementById('dashHeroStats');
      if (combo) {
        setTxt('dashHeroSub', 'how the three blocks move together and what is left as cash · actual through ' + (curM >= 0 ? monthLbl(curM) : '—'));
        const gmPct = sum(PA.coreRev || PA.grossRev) ? (sum(PA.gm) / sum(PA.coreRev || PA.grossRev)) * 100 : 0;
        if (st) st.innerHTML =
          '<div class="dash-stat"><span>Revenue (FY)</span><b>' + finCS() + ' ' + fmtQty(sum(PA.grossRev)) + '</b></div>' +
          '<div class="dash-stat"><span>COGS (FY)</span><b>' + finCS() + ' ' + fmtQty(-sum(PA.cogsTot)) + '</b></div>' +
          '<div class="dash-stat"><span>OPEX (FY)</span><b>' + finCS() + ' ' + fmtQty(-sum(PA.opex)) + '</b></div>' +
          '<div class="dash-stat ' + (gmPct >= 0 ? 'up' : 'down') + '"><span>Gross margin</span><b>' + Math.round(gmPct) + '%</b></div>';
      } else {
        const heroKey = drill || dashLine;
        const serie = dashSeries(heroKey, PA);
        const actSum = sum(serie.slice(0, curM + 1)), fyA = sum(serie), fyP = sum(dashSeries(heroKey, PP));
        const diff = fyP ? ((fyA - fyP) / Math.abs(fyP)) * 100 : null;
        setTxt('dashHeroSub', (drill ? 'part of ' + dashLine + ' · ' : fam.name + ' · ') + 'solid = actual through ' + (curM >= 0 ? monthLbl(curM) : '—') + ' · dotted = forecast · grey = budget (Theoric UE per car)');
        if (st) st.innerHTML =
          '<div class="dash-stat"><span>Actual to date</span><b>' + finCS() + ' ' + fmtQty(actSum) + '</b></div>' +
          '<div class="dash-stat"><span>Full year (A+F)</span><b>' + finCS() + ' ' + fmtQty(fyA) + '</b></div>' +
          '<div class="dash-stat"><span>Budget</span><b>' + finCS() + ' ' + fmtQty(fyP) + '</b></div>' +
          '<div class="dash-stat ' + (diff == null ? '' : (diff >= 0 ? 'up' : 'down')) + '"><span>vs budget</span><b>' +
          (diff == null ? '—' : (diff >= 0 ? '+' : '') + Math.round(diff) + '%') + '</b></div>';
      }

      // ---------- cartões de baixo: mudam com o totalizador escolhido ----------
      // cada builder devolve { title, sub, legend?, draw(id) }
      // clicar num segmento com `key` abre aquela linha no gráfico principal (drill-down)
      const stacked = (series, top) => (id) => {
        const live = topSeries(series, top || 5);
        dashCharts[id] = new Chart(document.getElementById(id), {
          type: 'bar',
          data: { labels, datasets: live.map((s, i) => ({ label: s.label, data: s.data, backgroundColor: DASH_MIX[i % DASH_MIX.length], borderRadius: 3, borderSkipped: false })) },
          options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            onClick: (e, els) => { const s = els.length && live[els[0].datasetIndex]; if (s && s.key) { dashDrill = s.key; renderDash(); } },
            onHover: (e, els) => { const s = els.length && live[els[0].datasetIndex]; e.native.target.style.cursor = (s && s.key) ? 'pointer' : 'default'; },
            plugins: { legend: { display: false }, datalabels: { display: false }, tooltip: DASH_TIP() },
            scales: { x: { stacked: true, grid: { display: false }, ticks: { color: DC.txt, font: { size: 9.5 } } },
              y: { stacked: true, grid: { color: DC.grid }, ticks: { color: DC.txt, font: { size: 9.5 }, callback: (v) => fmtQty(v) } } } },
        });
        return dashLegend(live.map((s, i) => ({ label: s.label + (s.rest ? '' : ''), color: DASH_MIX[i % DASH_MIX.length] })));
      };
      const lines = (series, fmt) => (id) => {
        dashCharts[id] = new Chart(document.getElementById(id), {
          type: 'line',
          data: { labels, datasets: series.map((s) => ({ label: s.label, data: s.data, borderColor: s.color,
            backgroundColor: s.fill || 'transparent', borderWidth: s.w || 2.4, borderDash: s.dash ? [5, 4] : undefined,
            pointRadius: 0, pointHoverRadius: 5, tension: 0.3, fill: s.fill ? 'origin' : false, spanGaps: true })) },
          options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { display: false }, datalabels: { display: false }, tooltip: DASH_TIP(fmt) },
            scales: DASH_AXES(fmt && ((v) => fmt(v))) },
        });
        return dashLegend(series.map((s) => ({ label: s.label, color: s.color, dash: !!s.dash })));
      };
      const bars = (data, color, fmt) => (id) => {
        dashCharts[id] = new Chart(document.getElementById(id), {
          type: 'bar',
          data: { labels, datasets: [{ label: 'Value', data, backgroundColor: data.map((v, m) => (m <= curM ? color : color + '66')), borderRadius: 3, borderSkipped: false }] },
          options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, datalabels: { display: false }, tooltip: DASH_TIP(fmt) },
            scales: DASH_AXES(fmt && ((v) => fmt(v))) },
        });
        return dashLegend([{ label: 'Actual', color }, { label: 'Forecast', color: color + '66' }]);
      };
      const hbars = (rows) => (id) => {
        dashCharts[id] = new Chart(document.getElementById(id), {
          type: 'bar',
          data: { labels: rows.map((r) => r.label), datasets: [{ data: rows.map((r) => r.v), backgroundColor: rows.map((r) => r.color), borderRadius: 3, borderSkipped: false }] },
          options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            onClick: (e, els) => { const r = els.length && rows[els[0].index]; if (r && r.key) { dashDrill = r.key; renderDash(); } },
            onHover: (e, els) => { const r = els.length && rows[els[0].index]; e.native.target.style.cursor = (r && r.key) ? 'pointer' : 'default'; },
            plugins: { legend: { display: false }, datalabels: { display: false },
              tooltip: { backgroundColor: '#1b0040', padding: 9, cornerRadius: 8, bodyFont: { size: 11 },
                callbacks: { label: (c) => '' + finCS() + ' ' + fmtQty(c.parsed.x) } } },
            scales: { x: { grid: { color: DC.grid }, ticks: { color: DC.txt, font: { size: 9.5 }, callback: (v) => fmtQty(v) } },
              y: { grid: { display: false }, ticks: { color: DC.txt, font: { size: 10 } } } } },
        });
        return '';
      };

      // `key` = nome real da linha no motor — é ele que o clique manda para o hero
      const revSeries = (P) => FIN_REV_LINES.map((L) => ({ label: DRILL_LABEL(L), key: L, data: (P.rev[L] || zz()).slice() }));
      const cogsSeries = (P) => FIN_COGS_LINES.map((L) => ({ label: DRILL_LABEL(L), key: L, data: (P.cogs[L] || zz()).map((v) => -v) }))
        .concat([{ label: 'Security deposit', key: 'Security deposit', data: (P.secDep || zz()).map((v) => -v) },
                 { label: 'Vehicle purchase', key: 'Vehicle purchase', data: (P.vehPur || zz()).map((v) => -v) }]);

      let cards;
      if (dashLine === 'Gross Revenue') {
        cards = [
          { title: 'Revenue mix', sub: 'top lines by the year; the rest grouped as "Other" · click a block to open it above', draw: stacked(revSeries(PA), 4) },
          { title: 'Every revenue line, full year', sub: 'the small ones, readable · click a bar to open it above', draw: hbars(rankRows(revSeries(PA), DASH_MIX)) },
          { title: 'Revenue per active car', sub: 'gross revenue ÷ active fleet · actual vs budget', draw: lines([
            { label: 'Actual + forecast', data: divv(PA.grossRev, PA.active), color: DASH_FAM.rev.color, fill: DASH_FAM.rev.fill },
            { label: 'Budget', data: divv(PP.grossRev, PP.active), color: DC.plan, dash: true, w: 2 },
          ]) },
        ];
      } else if (dashLine === 'COGS') {
        cards = [
          { title: 'Cost mix', sub: 'top blocks by the year; the rest grouped as "Other" · click a block to open it above', draw: stacked(cogsSeries(PA), 4) },
          { title: 'Every cost line, full year', sub: 'the small ones, readable · click a bar to open it above', draw: hbars(rankRows(cogsSeries(PA), DASH_MIX)) },
          { title: 'Cost per active car', sub: 'total COGS ÷ active fleet · actual vs budget', draw: lines([
            { label: 'Actual + forecast', data: divv(PA.cogsTot.map((v) => -v), PA.active), color: DASH_FAM.cogs.color, fill: DASH_FAM.cogs.fill },
            { label: 'Budget', data: divv(PP.cogsTot.map((v) => -v), PP.active), color: DC.plan, dash: true, w: 2 },
          ]) },
        ];
      } else if (dashLine === 'Gross Margin') {
        cards = [
          { title: 'Revenue vs COGS', sub: 'the gap between the two lines is the gross margin', draw: lines([
            { label: 'Net revenue', data: PA.netRev, color: DASH_FAM.rev.color, fill: DASH_FAM.rev.fill },
            { label: 'COGS + processing', data: PA.cogsTot.map((v, m) => -(v + PA.payProc[m])), color: DASH_FAM.cogs.color },
          ]) },
          { title: 'Margin over revenue', sub: '% of gross revenue that survives the direct costs', draw: lines([
            { label: 'Actual + forecast', data: divv(PA.gm, PA.grossRev).map((v) => (v == null ? null : v * 100)), color: DASH_FAM.res.color, fill: DASH_FAM.res.fill },
            { label: 'Budget', data: divv(PP.gm, PP.grossRev).map((v) => (v == null ? null : v * 100)), color: DC.plan, dash: true, w: 2 },
          ], pctFmt) },
        ];
      } else if (dashLine === 'OPEX') {
        cards = [
          { title: 'OPEX mix', sub: 'acquisition, people and the running of the company · click a block to open it above', draw: stacked([
            { label: 'CAC', key: 'CAC', data: PA.cacTot.map((v) => -v) },
            { label: 'HC payroll', key: 'HC payroll', data: PA.hcTot.map((v) => -v) },
            { label: 'Rent & utilities', key: 'Rent & utilities', data: PA.rentTot.map((v) => -v) },
            { label: 'Professional services', key: 'Professional services', data: PA.profTot.map((v) => -v) },
            { label: 'IT', key: 'IT', data: PA.itTot.map((v) => -v) },
          ]) },
          { title: 'OPEX over revenue', sub: 'how much of each dollar of revenue the structure eats', draw: lines([
            { label: 'Actual + forecast', data: divv(PA.opex.map((v) => -v), PA.grossRev).map((v) => (v == null ? null : v * 100)), color: DASH_FAM.opex.color, fill: DASH_FAM.opex.fill },
            { label: 'Budget', data: divv(PP.opex.map((v) => -v), PP.grossRev).map((v) => (v == null ? null : v * 100)), color: DC.plan, dash: true, w: 2 },
          ], pctFmt) },
        ];
      } else if (dashLine === 'HC Payroll') {
        // as variáveis DENTRO da folha: salário, benefícios, encargos e os pontuais de dezembro
        const hcSeries = (P) => [
          { label: 'Base salary', key: 'Base salary', data: (P.base || zz()).map((v) => -v) },
          { label: 'Payroll taxes', key: 'Payroll taxes', data: (P.ptax || zz()).map((v) => -v) },
          { label: 'Meal allowance', key: 'Meal allowance', data: (P.meal || zz()).map((v) => -v) },
          { label: 'Health plan', key: 'Health plan', data: (P.health || zz()).map((v) => -v) },
          { label: '13th salary', key: '13th salary', data: (P.th13 || zz()).map((v) => -v) },
          { label: 'Bonus', key: 'Bonus', data: (P.bonus || zz()).map((v) => -v) },
        ];
        cards = [
          { title: 'Payroll mix', sub: 'salary, taxes, benefits and the december one-offs · click a block to open it above', draw: stacked(hcSeries(PA), 5) },
          { title: 'Headcount', sub: 'people on the payroll at the end of each month', draw: bars(PA.headcount, DASH_FAM.opex.color, (v) => Math.round(v) + ' people') },
          { title: 'Cost per head', sub: 'payroll ÷ headcount — salary, meal, health, taxes and 13th', draw: lines([
            { label: 'Actual + forecast', data: divv(PA.hcTot.map((v) => -v), PA.headcount), color: DASH_FAM.opex.color, fill: DASH_FAM.opex.fill },
          ]) },
        ];
      } else if (dashLine === 'Net cashflow') {
        cards = [
          { title: 'Accumulated cash', sub: (PA.carryIn && dashSpan !== 'both' ? 'carried over from ' + (spanYear - 1) + ': ' + finCS() + ' ' + fmtQty(PA.carryIn) + ' · ' : '') + 'crossing the zero line = cash payback', draw: lines([
            { label: 'Actual + forecast', data: PA.accCf, color: DASH_FAM.res.color, fill: DASH_FAM.res.fill },
            { label: 'Budget', data: PP.accCf, color: DC.plan, dash: true, w: 2 },
          ]) },
          { title: 'Monthly net cashflow', sub: 'what each month adds to (or takes from) the box', draw: bars(PA.netCf, DASH_FAM.res.color) },
        ];
      } else {
        // ---- Combinations: o que estas duas premissas fazem com o caixa ----
        const PnoSd = moneyScale(dashSpan === 'both'
          ? concatPnl(anoDe(Y0, () => computePnl({ noSd: true })), anoDe(Y1, () => computePnl({ noSd: true })))
          : anoDe(spanYear, () => computePnl({ noSd: true })), KD);       // sem calção nem devolução
        const insBack = cum((PA.cogs['Insurance'] || zz()).map((v) => -v)); // seguro é custo: devolver ao caixa
        const accNoIns = PA.accCf.map((v, m) => v + insBack[m]);
        const fy = (a) => sum(a);
        const blocks = [
          { label: 'Insurance', v: -fy(PA.cogs['Insurance'] || zz()), color: '#EB6834' },
          { label: 'Security deposit (net)', v: -fy(PA.secDep || zz()) - fy(PA.rev['Security Deposit Refund'] || zz()), color: '#DB2777' },
          { label: 'Subrental fee', v: -fy(PA.cogs['Subrental fee'] || zz()), color: '#94A3B8' },
          { label: 'Maintenance', v: -fy(PA.cogs['Maintenance'] || zz()), color: '#94A3B8' },
          { label: 'GPS', v: -fy(PA.cogs['GPS'] || zz()), color: '#94A3B8' },
          { label: 'Traffic fines', v: -fy(PA.cogs['Traffic fines (out)'] || zz()), color: '#94A3B8' },
        ].filter((b) => Math.abs(b.v) > 1).sort((a, b) => b.v - a.v);
        const dSd = (PnoSd.accCf[LAST] || 0) - (PA.accCf[LAST] || 0);
        const dIns = (accNoIns[LAST] || 0) - (PA.accCf[LAST] || 0);
        cards = [
          { title: 'Security deposit & insurance — cash impact',
            sub: 'end-of-year cash moves ' + finCS() + ' ' + fmtQty(dSd) + ' without the deposit and ' + finCS() + ' ' + fmtQty(dIns) + ' without insurance',
            draw: lines([
              { label: 'As modelled', data: PA.accCf, color: DASH_FAM.res.color, fill: DASH_FAM.res.fill },
              { label: 'Without the deposit', data: PnoSd.accCf, color: '#DB2777', w: 2 },
              { label: 'Without insurance', data: accNoIns, color: '#EB6834', w: 2 },
            ]) },
          { title: 'Weight of each cost block', sub: 'full year · deposit shown net of its refund', draw: hbars(blocks) },
        ];
      }

      // pinta os cartões
      const grid = document.getElementById('dashGrid');
      if (grid) {
        ['dashC0', 'dashC1', 'dashC2'].forEach(kill); // até 3 cartões por totalizador
        grid.innerHTML = cards.map((c, i) =>
          `<div class="dash-card"><div class="dash-title">${escH(c.title)}</div><div class="dash-sub">${escH(c.sub)}</div>` +
          `<div class="dash-legwrap" id="dashL${i}"></div><div class="dash-box"><canvas id="dashC${i}"></canvas></div></div>`).join('');
        cards.forEach((c, i) => { const leg = c.draw('dashC' + i); const el = document.getElementById('dashL' + i); if (el) el.innerHTML = leg || ''; });
      }

      // ---------- seletor de totalizador ----------
      // seletor de totalizador (dropdown próprio, com o nome grande e o que ele mede embaixo)
      const pick = document.getElementById('dashPick');
      if (pick) {
        const sub2 = { 'Gross Revenue': 'everything we invoice', 'COGS': 'what the fleet costs to run',
          'Gross Margin': 'what survives the direct costs', 'OPEX': 'structure, people and acquisition',
          'HC Payroll': 'the people line, in detail', 'Net cashflow': 'what actually hits the box',
          'Combinations': 'correlations and what-ifs' };
        pick.innerHTML =
          '<button type="button" class="dash-pk-btn" id="dashPkBtn">' +
            '<span class="dash-pk-dot" style="background:' + fam.color + '"></span>' +
            '<span class="dash-pk-txt"><b>' + escH(DASH_LABEL(dashLine)) + '</b><i>' + escH(sub2[dashLine] || '') + '</i></span>' +
            '<span class="dash-pk-car">▾</span></button>' +
          '<div class="dash-pk-pop" id="dashPkPop" hidden>' + DASH_LINES.map((nm) =>
            '<button type="button" class="dash-pk-o' + (nm === dashLine ? ' on' : '') + '" data-v="' + escH(nm) + '">' +
            '<span class="dash-pk-dot" style="background:' + DASH_FAMILY(nm).color + '"></span>' +
            '<span class="dash-pk-txt"><b>' + escH(DASH_LABEL(nm)) + '</b><i>' + escH(sub2[nm] || '') + '</i></span></button>').join('') + '</div>';
        const pb = document.getElementById('dashPkBtn'), pp = document.getElementById('dashPkPop');
        const closeP = () => { pp.hidden = true; pb.classList.remove('open'); document.removeEventListener('click', outP); };
        const outP = (e) => { if (!pick.contains(e.target)) closeP(); };
        pb.addEventListener('click', (e) => { e.stopPropagation(); if (pp.hidden) { pp.hidden = false; pb.classList.add('open'); setTimeout(() => document.addEventListener('click', outP), 0); } else closeP(); });
        pp.querySelectorAll('.dash-pk-o').forEach((b) => b.addEventListener('click', () => { dashLine = b.dataset.v; dashDrill = null; closeP(); renderDash(); }));
      }
      // filtros: ano-base · ano seguinte · os dois emendados
      const ft = document.getElementById('dashFilters');
      if (ft) {
        const SPANS = [['y0', String(Y0)], ['y1', String(Y1)], ['both', Y0 + ' + ' + String(Y1).slice(2)]];
        ft.innerHTML = '<div class="pnl-years">' + SPANS.map(([k, lbl]) =>
          '<button class="pnl-yr' + (dashSpan === k ? ' on' : '') + '" data-s="' + k + '">' + lbl + '</button>').join('') + '</div>' +
          '<div class="ue-cur-toggle dash-cur">' + CUR_FLAGS(pnlCur) + '</div>';
        ft.querySelectorAll('.pnl-yr').forEach((b) => b.addEventListener('click', () => { dashSpan = b.dataset.s; renderDash(); }));
        wireCurFlags(ft, () => { renderDash(); renderPnl(); });
      }
    }

    // ===================== COSTS — mergulho nas linhas de custo de veículo =====================
    // Cada linha do COGS aberta em: peso (sobre COGS, sobre a receita, por carro-mês, por carro no
    // contrato), ELASTICIDADE frota (o custo acompanha os carros ou é fixo?), perfil de INCIDÊNCIA
    // na vida do contrato (pesa na entrega ou dilui nos 12 meses?) e um what-if de %.
    const COSTS_MAIN = '__main__';   // item "Main" do picker: visão geral do COGS (Pareto + drill por frota)
    let costsSel = COSTS_MAIN, costsCharts = {}, costsWhatifPct = 0;
    // filtros da aba: visão (forecast × só realizado), mês isolado e frota isolada — e a barra
    // clicada no Pareto (drill). Frota isolada implica realizado: projeção é do PLANO, não da frota.
    let costsMonth = null, costsFleet = null, costsDrillSel = null, costsInsAvg = null;
    let costsMonthInit = false;   // a aba abre no MÊS VIGENTE; depois disso a escolha é do usuário
    // paleta das frotas: matizes bem separados no círculo cromático, para pilhas vizinhas nunca
    // se confundirem (roxo · verde · âmbar · azul · rosa · teal · vermelho · lima)
    const FLEET_PALETTE = ['#6D28D9', '#059669', '#F59E0B', '#2563EB', '#DB2777', '#0891B2', '#DC2626', '#65A30D'];
    const FLEET_COLOR = (id) => { const n = parseInt(String(id).replace(/\D/g, ''), 10); return FLEET_PALETTE[isFinite(n) && n > 0 ? (n - 1) % FLEET_PALETTE.length : 0]; };
    const COSTS_LIST = ['Subrental fee', 'Maintenance', 'Insurance', 'Recovery cost', 'Repair cost', 'Traffic fines (out)', 'Part Replacement', 'GPS', 'Car Preparation', 'Sticker'];
    // uma cor por linha de custo — a página inteira (picker, cartões, gráficos, what-if) veste a
    // cor da linha selecionada, e o ranking mostra cada linha na sua própria cor
    const COSTS_COLOR = {
      [COSTS_MAIN]: '#1F2937',
      'Subrental fee': '#5A00F8', 'Maintenance': '#0891B2', 'Insurance': '#2563EB',
      'Recovery cost': '#EB6834', 'Repair cost': '#DC2626', 'Traffic fines (out)': '#D97706',
      'Part Replacement': '#7C3AED', 'GPS': '#0D9488', 'Car Preparation': '#DB2777', 'Sticker': '#64748B',
    };
    // rótulo de tela: o motor precisa da chave técnica ('Traffic fines (out)'), a tela não
    const COSTS_DISP = { 'Traffic fines (out)': 'Traffic fines', 'Car Preparation': 'Car preparation', 'Part Replacement': 'Part replacement' };
    const COSTS_LABEL = (L) => (L === COSTS_MAIN ? 'Main — COGS overview' : (COSTS_DISP[L] || L));
    // padrões de gráfico: sem grade de fundo, fontes discretas, moeda fora dos números
    const CC_FONT = { size: 10.5 };
    const CC_GRID = { x: { grid: { display: false }, border: { display: false }, ticks: { font: CC_FONT, color: '#6B7280' } },
      y: { grid: { display: false }, border: { display: false }, beginAtZero: true, ticks: { font: CC_FONT, color: '#6B7280' } } };
    const CC_LEG = { boxWidth: 11, boxHeight: 11, font: { size: 10.5 }, color: '#4B5563', usePointStyle: true, pointStyle: 'circle' };
    const ccNum = (v) => Math.round(v).toLocaleString('pt-BR');
    const ccK = (v) => (Math.abs(v) >= 1000 ? Math.round(v / 1000).toLocaleString('pt-BR') + 'k' : ccNum(v));
    const costsTint = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
    // hachura diagonal para marcar PROJEÇÃO nas barras — o Chart.js não tem padrão listrado nativo
    // e barra não aceita borderDash, então o preenchimento vira um CanvasPattern.
    function costsStripe(hex) {
      const c = document.createElement('canvas'); c.width = 8; c.height = 8;
      const x = c.getContext('2d');
      x.fillStyle = costsTint(hex, .18); x.fillRect(0, 0, 8, 8);
      x.strokeStyle = costsTint(hex, .8); x.lineWidth = 2.2;
      [[-2, 10, 10, -2], [2, 14, 14, 2], [-6, 6, 6, -6]].forEach(([a, b, d, e]) => { x.beginPath(); x.moveTo(a, b); x.lineTo(d, e); x.stroke(); });
      return x.createPattern(c, 'repeat');
    }
    // textos longos saem da página e viram caixas de ajuda (botões "?")
    const COSTS_HELP = {
      pareto: { t: 'Pareto — where the COGS money goes', d: 'Every vehicle cost line sorted biggest first (each in its own colour), with the cumulative share on the right axis. Where the curve crosses the dashed 80% guide tells you how few lines concentrate almost all the cost — those are the ones worth negotiating; everything after the crossing is operational noise. CLICK any bar to open that line below, month by month and split by fleet.' },
      share: { t: 'Share of COGS by month', d: 'Each month as 100%: how much of that month\'s vehicle cost each line represents — the five biggest lines in their own colours, the rest grouped as grey "Others". Months ahead of today are the PROJECTION and render lighter (the tooltip also says "projected"). Watch for a line quietly growing its slice as the fleet ramps: absolute values always grow with more cars, but the SHARE only grows when the line outpaces the others.' },
      u_ret: { t: 'Return per car — vs its budget', d: 'One thin bar per plate: everything the car has brought in since delivery (subscriptions received, interest, fines charged to the client) minus everything it has cost (sub-rental, insurance accrued to date, GPS, preparation, sticker, maintenance, fines paid, recovery, repair, parts). Security deposit and its refund are OUT — they are cash parked, not result — and so are the car purchase/sale and termination fees. The dashed line is each car\'s BUDGET at its current age: what its fleet\'s contractual economics (weekly fee, rent, insurance, GPS) plus the pooled event rates (fines, maintenance, recovery, repair, parts by car age) say it should have accumulated by now. GREEN bars are at or above budget, RED are below. Cars of different fleets have different ages, so bars are not directly comparable to each other — always compare each bar to the dashed line at its position.' },
      u_delta: { t: 'Delta vs budget per car', d: 'The same data as the chart above, reduced to one number per car: realized return minus the budget for its age. Positive (green, up) = the car is ahead of plan; negative (red, down) = behind. This is the chart to scan for problem cars — the deepest red bars are the plates bleeding most against expectation, whatever their age.' },
      drill: { t: 'Monthly by fleet', d: 'The line you clicked on the Pareto, month by month, stacked by REAL fleet — each fleet in its own colour. This is realized data only (schedules and imported bases per plate); the projection lives in the plan and has no fleet concept. The big number is the average cost per active car per month across the fleets shown, computed over the realized window.' },
      ins: { t: 'Is the insurance paying for itself?', d: 'ACCRUED, NOT PAID. The premium is disbursed in about four installments at the start of each fleet, but it covers the full 12 months of the contract. Comparing the cash of a period against the claims of that same period mismatches the two: a fleet that started in june carries almost all of its cash in 2026 while half of its coverage runs into 2027. So each fleet\'s premium is spread pro-rata, day by day, across its 365 days of coverage, and every month is charged only the risk it actually ran. The footer shows both numbers side by side. CLAIMS are the fleet-site occurrences flagged with a sinistro in the period — collisions, window damage and total loss; mechanical failures never trigger it. BREAK-EVEN PER CLAIM is the accrued premium divided by the number of claims: how much each occurrence would have to cost us out of pocket for "having insurance" and "not having it" to come out the same. The SAVING compares the two worlds: claims × the average cost you type (we have no workshop quote per occurrence, so it is your input) against the accrued premium. Green means insurance saved money, red means it cost more than the damage would have.' },
      filters: { t: 'View filters', d: 'Everything in this tab is built from the fleets that exist TODAY — realized up to the current month, then each fleet carried to the end of its own 12-month contract. No new fleet enters the projection, so the numbers answer what the current operation costs rather than what a bigger fleet would cost. The calendar picks the period: FULL YEAR is realized plus that projection, YEAR TO DATE stops at the current month, and a single month isolates it (the current month shows its realized value alone). The fleet selector narrows everything to one real fleet.' },
      rank: { t: 'Where it sits in COGS', d: 'Full-year total of every vehicle cost line, biggest first, each in its own colour — the selected one at full strength. It answers "how much does this line matter" before any deeper look.' },
      age: { t: 'When it hits a car’s life', d: 'The per-car cost over the contract (theoric profile): M0 is the delivery month, M1–M12 the recurring months, M13 the closing month. FRONT-LOAD INDEX = the share of a car’s lifetime cost that falls in the first four months (M0–M3) divided by the 25% that a cost spread evenly across the 12 recurring months would put there. So 1.0 = evenly spread; 4.0 = everything at delivery (hurts the cash exactly while the fleet ramps); below 1.0 = back-loaded, lands at the end of the contract. AVERAGE MONTH OF SPEND is the profile’s center of mass — a cost spread evenly over M2–M13 averages M7.5.' },
      monthly: { t: 'Absolute monthly — vs fleet', d: 'Bars = the line month by month in the display currency, orange line = active cars (right axis), and for Recovery/Repair a dotted line adds the underlying events. Context view: it mostly confirms the cost is riding the fleet ramp. Months up to today are consolidated actuals; ahead is the projection.' },
      percar: { t: 'Per car — vs the year’s average', d: 'The monthly cost divided by the active fleet, against the dashed line of the YEAR’S AVERAGE per car. Months above the average light up in full colour — that is where we spent more than normal per car and it is worth asking why. FLEET-LINK (ELASTICITY) is the slope of ln(cost) vs ln(fleet) across the year: 1.0 = 10% more cars → 10% more cost (proportional); near 0 = a fixed cost that dilutes as the fleet grows.' },
      whatif: { t: 'What-if', d: 'Moves the selected line by a percentage and shows the first-order effect on the year: the line itself, its share of revenue, Gross Margin and Net cashflow. Taxes and credits are not recomputed — and in 2027 the sublease tax netting would also move with the Subrental line.' },
    };
    let costsAvgHelp = null;   // explicação do "avg per car · month" — muda conforme a linha
    function costsHelpOpen(k) {
      const h = (k === 'avg') ? costsAvgHelp : COSTS_HELP[k]; if (!h) return;
      const ov = document.createElement('div');
      ov.className = 'ue-modal-overlay';
      ov.innerHTML = `<div class="ue-modal costs-helpbox"><div class="ue-modal-title">${escH(h.t)}</div>` +
        `<div class="costs-help-d">${escH(h.d)}</div>` +
        `<div class="ue-modal-actions"><button type="button" class="ue-modal-cancel">Close</button></div></div>`;
      document.body.appendChild(ov);
      const close = () => ov.remove();
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      ov.querySelector('.ue-modal-cancel').addEventListener('click', close);
    }
    const COSTS_INFO = {
      [COSTS_MAIN]: 'The whole COGS at once: Pareto of every line, the monthly mix of the four biggest, and a sandbox to move them together.',
      'Subrental fee': 'Monthly rent per car paid to LM on the 26th — 1st installment pro-rata of the arrival month, a 13th charge closes the 12 months. The single biggest cost of the operation.',
      'Maintenance': 'Revisions every 10.000 km at each fleet’s real km pace, priced from the revisions site with the 25% discount and paid ~33 days later.',
      'Insurance': 'Per-fleet total split into N installments — from each fleet’s UE boxes.',
      'Recovery cost': 'Towing + recovery per judicial case (import_jud). Directly tied to how many cars are repossessed — the dotted line in the chart.',
      'Repair cost': 'Damages + cleaning + others per judicial case (import_jud) when a car comes back.',
      'Traffic fines (out)': 'NET fine × 1.05 paid to LM. Scales with the fleet; the margin of the fines business lives on the revenue side.',
      'Part Replacement': 'Brake pads, discs and tires by each plate’s km pace × the ⚙ Parts panel costs (natural wear only).',
      'GPS': 'Install at M0 plus a monthly fee per active car.',
      'Car Preparation': 'Flat R$50 per car, in the delivery month.',
      'Sticker': 'Flat R$15 per car, in the delivery month.',
    };
    // ---- custos REALIZADOS por frota REAL, mês calendário do ano exibido (USD) ----
    // Alimenta o filtro de frota, a visão "Actuals" e o drill do Pareto (empilhado por frota).
    // Linhas de agenda (subrental/seguro/GPS/prep/adesivo) calculadas dos parâmetros reais de cada
    // frota; as demais vêm das bases reais (import_rev, multas_consolidado, import_jud, reposição),
    // placa a placa. TUDO cortado no mês vigente — frota isolada é uma visão do que já aconteceu;
    // projeção é do PLANO (coortes), que não tem conceito de frota.
    let _costsRF = null, _costsRFyear = null;
    function costsRealByFleet() {
      if (_costsRF && _costsRFyear === finYear) return _costsRF;
      const U = OCN.ue || {}, MS = 86400000;
      const fx = finPar('__fin_fx__') || 5.5;
      const hojeD = new Date(((U.hoje) || new Date().toISOString().slice(0, 10)) + 'T12:00:00');
      const curM = hojeD.getFullYear() === finYear ? hojeD.getMonth() : (hojeD.getFullYear() > finYear ? FIN_MONTHS - 1 : -1);
      const losses = U.losses || {};
      const moOf = (iso) => (iso && String(iso).slice(0, 4) === String(finYear)) ? parseInt(String(iso).slice(5, 7), 10) - 1 : null;
      const pc = { pastilhas: cpar('__part_pastilhas_rs__', 250), disco: cpar('__part_disco_rs__', 350), pneus: cpar('__part_pneus_rs__', 700) };
      const out = { fleets: [], curM };
      (U.fleets || []).forEach((f) => {
        if (!f.inicio) return;
        const plates = f.placas || [];
        const cars = Math.max(1, f.cars || plates.length || 1);
        const ini = new Date(f.inicio + 'T12:00:00');
        const FP2 = realFleetParams[f.id] || {};
        const par = (k) => { const v = FP2[k + '@@0']; return v != null ? Number(v) : 0; };
        const z = () => new Array(FIN_MONTHS).fill(0);
        const L = {}; COSTS_LIST.forEach((k) => { L[k] = z(); });
        const lostBefore = (d) => plates.reduce((n, pl) => n + ((losses[pl] && new Date(losses[pl] + 'T12:00:00') <= d) ? 1 : 0), 0);
        const m0 = moOf(f.inicio);
        const carsAt = (m) => Math.max(0, cars - lostBefore(new Date(finYear, m + 1, 0, 12)));
        // A agenda cobre o ANO INTEIRO: as parcelas futuras destas frotas são compromisso firmado,
        // não previsão de crescimento. O que separa realizado de projetado é `curM`, não este corte.
        const add = (line, m, vRS) => { if (m != null && m >= 0 && m < FIN_MONTHS) L[line][m] += vRS / fx; };
        if (m0 != null && ini <= hojeD) { add('Car Preparation', m0, 50 * cars); add('Sticker', m0, 15 * cars); }
        const subr = par('__subrental_mensal__');
        if (subr > 0) {
          const dimIni = new Date(ini.getFullYear(), ini.getMonth() + 1, 0).getDate();
          const proR = Math.max(0, Math.min(1, (dimIni - ini.getDate()) / dimIni));
          for (let i = 1; i <= 13; i++) {
            const d = new Date(ini.getFullYear(), ini.getMonth() + i, 26, 12);
            if (d.getFullYear() !== finYear) continue;
            const frac = i === 1 ? proR : (i === 13 ? 1 - proR : 1);
            add('Subrental fee', d.getMonth(), subr * frac * Math.max(0, cars - lostBefore(d)));
          }
        }
        const insT = par('__ins_total__'), insN = par('__ins_parcelas__');
        if (insT > 0 && insN >= 1) for (let n = 1; n <= insN; n++) {
          const d = new Date(ini.getTime() + (n - 0.5) * UET_WPM * 7 * MS);
          if (d.getFullYear() !== finYear) continue;
          add('Insurance', d.getMonth(), (insT / insN) * cars);
        }
        const gps0 = par('__gps_m0__'), gpsM = par('__gps_mensal__');
        if (gps0 > 0 && m0 != null && ini <= hojeD) add('GPS', m0, gps0 * cars);
        if (gpsM > 0) for (let n = 1; n <= 12; n++) {
          const d = new Date(ini.getTime() + (n - 0.5) * UET_WPM * 7 * MS);
          if (d.getFullYear() !== finYear) continue;
          add('GPS', d.getMonth(), gpsM * Math.max(0, cars - lostBefore(d)));
        }
        plates.forEach((pl) => {
          ((((U.revBase || {}).placas) || {})[pl] || []).forEach((r) => { if (r.valor && r.venc) add('Maintenance', moOf(r.venc), r.valor); });
          ((((U.multasBase || {}).placas) || {})[pl] || []).forEach((x) => { if (x.venc) add('Traffic fines (out)', moOf(x.venc), x.v); });
          ((((U.judBase || {}).placas) || {})[pl] || []).forEach((c) => {
            const m = c.d ? moOf(c.d) : (curM >= 0 ? curM : null);
            add('Recovery cost', m, c.recovery || 0); add('Repair cost', m, c.repair || 0);
          });
          ((((U.reposicao || {}).placas) || {})[pl] || []).forEach((ev) => { (ev.itens || []).forEach((it) => { if (pc[it]) add('Part Replacement', moOf(ev.d), pc[it]); }); });
        });
        // ---- PROJEÇÃO das linhas de EVENTO, só para as frotas de HOJE ----
        // Nenhuma frota nova entra na conta: cada frota existente é levada até o fim do PRÓPRIO
        // contrato, com o perfil por idade do carro do modelo dela e o ritmo de multas medido.
        // As linhas de agenda (subrental/seguro/GPS) já vêm do calendário de parcelas acima.
        const prof = (refProfiles && refProfiles[f.model]) || null;
        const FRf = finesRatesByFleet()[f.id] || finesRatesByFleet().__pool || { net: 0 };
        for (let m = curM + 1; m < FIN_MONTHS; m++) {
          if (m0 == null || m < m0) continue;
          const p = m - m0 + 1;                       // idade no UE: mês de entrega = M1
          if (p > 13) continue;
          const c = carsAt(m);
          if (prof) ['Maintenance', 'Recovery cost', 'Repair cost', 'Part Replacement'].forEach((k) => {
            const pr = prof[k]; if (pr && pr[p]) add(k, m, Math.abs(pr[p]) * c);
          });
          add('Traffic fines (out)', m, (FRf.net || 0) * new Date(finYear, m + 1, 0).getDate() * c);
        }
        // ---- carros da frota por mês, PRO-RATA no mês de entrada ----
        // Uma frota que chega dia 19 não expõe o mês inteiro; contar o mês cheio inflava o
        // denominador do custo por carro·mês.
        const held = (m) => {                       // fração do mês m em que a frota teve os carros
          if (m0 == null || m < m0) return 0;
          if (m > m0) return 1;
          const dim = new Date(finYear, m + 1, 0).getDate();
          return Math.max(0, Math.min(1, (dim - ini.getDate() + 1) / dim));
        };
        const carsArr = new Array(FIN_MONTHS).fill(0);
        for (let m = 0; m < FIN_MONTHS; m++) {
          if (m0 == null || m < m0 || m > m0 + 11) continue;   // vive os 12 meses do contrato
          carsArr[m] = carsAt(m) * held(m);
        }
        // ---- custo APROPRIADO (competência) por mês ----
        // As linhas de AGENDA nascem desalinhadas da posse: o subrental é cobrado no mês SEGUINTE
        // (e a 1ª parcela é pro-rata), o seguro é pago adiantado mas cobre 12 meses. Dividir esse
        // caixa pelos carro-meses de posse subestima o custo por carro — medido: US$193/carro/mês
        // de subrental onde o aluguel real é US$300. Aqui cada mês recebe o custo que ele de fato
        // gerou. As demais linhas nascem do evento, então competência = caixa.
        const A = {}; COSTS_LIST.forEach((k) => { A[k] = L[k].slice(); });
        if (subr > 0) {
          A['Subrental fee'] = new Array(FIN_MONTHS).fill(0);
          for (let m = 0; m < FIN_MONTHS; m++) {
            if (m0 == null || m < m0 || m > m0 + 11) continue;   // 12 meses de contrato
            A['Subrental fee'][m] = (subr * carsAt(m) * held(m)) / fx;
          }
        }
        if (insT > 0) {
          A.Insurance = new Array(FIN_MONTHS).fill(0);
          const fimCob = new Date(ini.getTime() + 365 * MS);
          for (let m = 0; m < FIN_MONTHS; m++) {
            const a2 = new Date(finYear, m, 1, 12), b2 = new Date(finYear, m + 1, 1, 12);
            const ov = Math.max(0, Math.min(b2.getTime(), fimCob.getTime()) - Math.max(a2.getTime(), ini.getTime())) / MS;
            if (ov > 0) A.Insurance[m] = (insT * cars) * (ov / 365) / fx;
          }
        }
        if (gpsM > 0) {
          A.GPS = new Array(FIN_MONTHS).fill(0);
          for (let m = 0; m < FIN_MONTHS; m++) {
            if (m0 == null || m < m0 || m > m0 + 11) continue;
            A.GPS[m] = (gpsM * carsAt(m) * held(m)) / fx;
          }
          if (gps0 > 0 && m0 != null) A.GPS[m0] += (gps0 * cars) / fx;   // instalação é do M0 mesmo
        }
        out.fleets.push({ id: f.id, arr: L, accr: A, cars: carsArr });
      });
      _costsRF = out; _costsRFyear = finYear;
      return out;
    }
    // "Main": Pareto do COGS inteiro (clicável) + drill mensal por frota da barra escolhida
    const perName = (m) => (m == null ? 'full year' : (m === 'ytd' ? 'year to date' : monthLbl(m)));
    // ---- CUSTO MÉDIO POR CARRO·MÊS ----
    // Sempre acumulado do INÍCIO ATÉ HOJE (não do período escolhido no calendário): a pergunta
    // "quanto um carro custa por mês" não muda porque estou olhando agosto.
    //   numerador  = tudo o que a linha custou desde o início (competência: o subrental é cobrado
    //                no mês seguinte, então o caixa sozinho subestimaria)
    //   denominador= soma dos meses que CADA carro passou conosco (frota entra em datas diferentes)
    // Nas linhas de EVENTO a amostra realizada é curta demais para virar média — uma frota de 4
    // meses ainda não fez a 1ª revisão dos 10.000 km, e um mês sem sinistro não significa que
    // recuperação custe zero. Para essas, a média vem do perfil PROJETADO por idade do carro
    // (M0..M13, das frotas de referência), dividido pelos 12 meses de contrato.
    const AVG_REALIZED = { 'Subrental fee': 1, 'Insurance': 1, 'GPS': 1, 'Car Preparation': 1, 'Sticker': 1 };
    // O SEGURO é a exceção: aqui a média usa o DESEMBOLSO de fato (tudo que já saiu do caixa com
    // seguro, somando todas as frotas), não o prêmio rateado pela cobertura. É a leitura pedida —
    // "quanto de seguro já saiu ÷ quanto tempo de carro tivemos" — e responde uma pergunta
    // diferente da apropriação: o peso do seguro no caixa por carro que rodou até aqui.
    const AVG_CASH = { Insurance: 1 };
    function costsAgeProfile(line) {
      const per = new Array(UET_PERIODS).fill(0); let ok = false;
      const qty = {};
      finCohorts.forEach((c) => { qty[c.model] = (qty[c.model] || 0) + c.qty; });
      const tq = Math.max(1, Object.values(qty).reduce((a, b) => a + b, 0));
      Object.entries(qty).forEach(([mod, q]) => {
        const pr = refProfiles && refProfiles[mod] && refProfiles[mod][line];
        if (!pr) return;
        for (let p = 0; p < UET_PERIODS; p++) per[p] += Math.abs(pr[p] || 0) * (q / tq);
        ok = true;
      });
      return { per, ok, tot: per.reduce((a, b) => a + b, 0) };
    }
    // Linhas cujo custo mensal por carro é um PARÂMETRO conhecido: a média sai direto dele,
    // ponderada pelos carros. Derivá-la de acumulado ÷ carro-meses dava um número abaixo do
    // aluguel de qualquer frota — basta uma frota sem a caixinha preenchida para ela entrar com
    // carros no denominador e zero no numerador e puxar a média para baixo.
    const AVG_PARAM = { 'Subrental fee': ['__subrental_mensal__'], GPS: ['__gps_mensal__'] };
    function costsAvgPerCarMonth(line, RF, fleets) {
      const keys = AVG_PARAM[line];
      if (keys) {
        let s = 0, n = 0; const vals = [];
        fleets.forEach((f) => {
          const FP2 = realFleetParams[f.id] || {};
          const v = keys.reduce((a, k) => a + (FP2[k + '@@0'] != null ? Number(FP2[k + '@@0']) : 0), 0);
          if (!(v > 0)) return;                       // frota sem a caixinha fica FORA da média
          const meta = ((OCN.ue || {}).fleets || []).find((x) => x.id === f.id);
          const c = meta ? (meta.cars || (meta.placas || []).length || 0) : 0;
          if (!c) return;
          s += v * c; n += c; vals.push(f.id);
        });
        const fx = finPar('__fin_fx__') || 5.5;
        return { v: n > 0 ? (s / n) / fx : null, proj: false, cash: false, param: true, nFleets: vals.length, cars: n, cm: null, tot: null };
      }
      if (AVG_REALIZED[line]) {
        const cash = !!AVG_CASH[line];
        let c = 0, cm = 0;
        fleets.forEach((f) => {
          const src = cash ? f.arr : (f.accr || f.arr);
          for (let m = 0; m <= RF.curM; m++) { c += (src[line] || [])[m] || 0; cm += f.cars[m] || 0; }
        });
        return { v: cm > 0 ? c / cm : null, proj: false, cash, cm, tot: c };
      }
      const A = costsAgeProfile(line);
      const fx = finPar('__fin_fx__') || 5.5;
      return { v: A.ok ? (A.tot / fx) / 12 : null, proj: true, cash: false, cm: null, tot: null };
    }
    function renderCostsMain(P, H) {
      const { S, K, cs, money, lineOfL, sumOf, mSel } = H;
      const mk = (id, cfg) => { if (costsCharts[id]) { costsCharts[id].destroy(); delete costsCharts[id]; } const c = document.getElementById(id); if (!c) return; costsCharts[id] = new Chart(c.getContext('2d'), cfg); };
      const rows = COSTS_LIST.map((L) => ({ L, v: sumOf(L) })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v);
      const tot = rows.reduce((a, r) => a + r.v, 0) || 1;
      let acc = 0;
      const cum = rows.map((r) => { acc += r.v; return Math.round((acc / tot) * 100); });
      // Pareto CLICÁVEL: barras (cada linha na sua cor) + curva acumulada + guia dos 80%.
      // Clique numa barra abre o drill por frota logo abaixo.
      mk('ccPareto', { data: { labels: rows.map((r) => COSTS_LABEL(r.L)), datasets: [
          // order MAIOR desenha ANTES (atrás): as barras vão para trás e a curva fica por cima
          { type: 'bar', label: 'Total', order: 3, data: rows.map((r) => Math.round(r.v * K)), backgroundColor: rows.map((r) => COSTS_COLOR[r.L]), yAxisID: 'y', borderRadius: 5, maxBarThickness: 54,
            datalabels: { display: (c) => c.dataset.data[c.dataIndex] > 0, anchor: 'end', align: 'top', offset: 2, color: '#4B5563', font: { size: 10.5, weight: 700 }, formatter: ccK } },
          { type: 'line', label: 'cumulative %', order: 1, data: cum, yAxisID: 'y2', borderColor: '#111827', borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: '#111827', pointBorderWidth: 2, tension: .25,
            datalabels: { display: true, align: 'top', offset: 7, color: '#111827', font: { size: 10.5, weight: 800 },
              backgroundColor: 'rgba(255,255,255,.88)', borderRadius: 4, padding: { top: 2, bottom: 1, left: 4, right: 4 }, formatter: (v) => v + '%' } },
          { type: 'line', label: '80% guide', order: 2, data: rows.map(() => 80), yAxisID: 'y2', borderColor: '#B91C1C', borderDash: [5, 4], borderWidth: 1.2, pointRadius: 0, datalabels: { display: false } },
        ] },
        options: { responsive: true, maintainAspectRatio: false,
          // o rótulo da barra mais alta é desenhado ACIMA dela: sem folga no topo ele saía cortado
          layout: { padding: { top: 26 } },
          interaction: { mode: 'index', intersect: false },
          onClick: (e, els) => { if (els && els.length) { costsDrillSel = rows[els[0].index].L; renderCosts(); } },
          onHover: (e, els) => { e.native.target.style.cursor = els && els.length ? 'pointer' : 'default'; },
          plugins: { legend: { position: 'bottom', align: 'end', labels: CC_LEG },
            tooltip: { padding: 10, titleFont: { size: 12 }, bodyFont: { size: 11.5 }, displayColors: false,
              filter: (item) => item.datasetIndex !== 2,          // a guia dos 80% não é informação de hover
              callbacks: { label: (c) => (c.datasetIndex === 0
                ? ccNum(c.parsed.y) + '  ·  ' + (tot ? (rows[c.dataIndex].v / tot * 100).toFixed(1) : 0) + '% of COGS'
                : 'cumulative: ' + c.parsed.y + '%'),
                afterBody: (items) => (items && items.length ? 'click to open by fleet' : '') } } },
          scales: { y: { grid: { display: false }, border: { display: false }, beginAtZero: true, grace: '10%', ticks: { font: CC_FONT, color: '#6B7280', callback: ccK } },
            y2: { position: 'right', min: 0, max: 112, grid: { display: false }, border: { display: false }, ticks: { font: CC_FONT, color: '#6B7280', callback: (v) => (v <= 100 ? v + '%' : '') } },
            x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 10.5 }, color: '#374151' } } } } });
      // ---- drill da barra clicada: mensal EMPILHADO POR FROTA (realizado) + custo médio/carro ----
      const RF = costsRealByFleet();
      const drillL = (costsDrillSel && COSTS_LIST.includes(costsDrillSel)) ? costsDrillSel : (rows[0] ? rows[0].L : COSTS_LIST[0]);
      const rfF = costsFleet != null ? RF.fleets.filter((f) => f.id === costsFleet) : RF.fleets;
      const DC = COSTS_COLOR[drillL];
      // PROJEÇÃO nos meses à frente: só faz sentido no ano inteiro + Forecast e sem frota isolada.
      // Ela vem do PLANO (coortes), que não tem conceito de frota — por isso entra como uma série
      // única hachurada em vez de fingir uma divisão por frota que os dados não têm.
      const showProj = H.mSel == null && RF.curM >= 0 && RF.curM < FIN_MONTHS - 1;
      const planLine = H.lineOfL(drillL);
      const projArr = showProj ? planLine.map((v, m) => (m > RF.curM ? Math.round(v * K) : null)) : null;
      const projTot = showProj ? planLine.reduce((s, v, m) => s + (m > RF.curM ? (v || 0) : 0), 0) : 0;
      document.getElementById('ccDrillT').innerHTML = `<span class="costs-pk-dot" style="background:${DC}"></span>${escH(COSTS_LABEL(drillL))} — monthly by fleet${showProj ? ' · realized + forecast' : ' · realized'}`;
      const MONL = Array.from({ length: FIN_MONTHS }, (_, m) => monthLbl(m));
      mk('ccDrill', { type: 'bar', data: { labels: MONL, datasets: rfF.map((f) => (
          { label: 'Fleet ' + f.id, fleetId: f.id, data: (f.arr[drillL] || []).map((v, m) => (RF.curM >= 0 && m <= RF.curM ? Math.round(v * K) : null)), backgroundColor: FLEET_COLOR(f.id), stack: 's', maxBarThickness: 40, borderRadius: 2 }
        )).concat(showProj ? [{ label: 'Projected', proj: true, data: projArr, backgroundColor: costsStripe(DC), borderColor: costsTint(DC, .55), borderWidth: 1, stack: 's', maxBarThickness: 40, borderRadius: 2 }] : []) },
        // total de cada mês acima da pilha (o datalabels não soma stacks sozinho)
        plugins: [{ id: 'stackTot', afterDatasetsDraw(ch) {
          const { ctx } = ch; const tots = {}; let top = {};
          ch.data.datasets.forEach((ds, di) => {
            const meta = ch.getDatasetMeta(di); if (meta.hidden) return;
            meta.data.forEach((el, i) => { const v = ds.data[i]; if (v == null) return; tots[i] = (tots[i] || 0) + v; top[i] = Math.min(top[i] == null ? Infinity : top[i], el.y); });
          });
          ctx.save(); ctx.font = '700 10.5px ' + getComputedStyle(document.body).fontFamily; ctx.fillStyle = '#374151'; ctx.textAlign = 'center';
          Object.keys(tots).forEach((i) => { if (tots[i] > 0) ctx.fillText(ccK(tots[i]), ch.getDatasetMeta(0).data[i].x, top[i] - 6); });
          ctx.restore();
        } }],
        options: { responsive: true, maintainAspectRatio: false,
          layout: { padding: { top: 18 } },
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'bottom', align: 'start', labels: Object.assign({}, CC_LEG, { padding: 14, filter: (item, data) => !data.datasets[item.datasetIndex].legendHide }) },
            // VALOR dentro da fatia (abreviado), e só quando a fatia tem altura para não apertar
            datalabels: { display: (c) => { const el = c.chart.getDatasetMeta(c.datasetIndex).data[c.dataIndex]; return c.dataset.data[c.dataIndex] > 0 && el && Math.abs(el.base - el.y) > 20; },
              // na barra hachurada o branco some — ali o rótulo vai em cinza-escuro
              color: (c) => (c.dataset.proj ? '#374151' : '#fff'), font: { size: 9.5, weight: 800 }, formatter: ccK },
            tooltip: { padding: 10, titleFont: { size: 12 }, bodyFont: { size: 11.5 },
              callbacks: { label: (c) => c.dataset.label + ': ' + ccNum(c.parsed.y),
                footer: (items) => 'total: ' + ccNum(items.reduce((a, i2) => a + i2.parsed.y, 0)) } } },
          scales: { x: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { font: CC_FONT, color: '#6B7280' } },
            y: { stacked: true, grid: { display: false }, border: { display: false }, beginAtZero: true, ticks: { font: CC_FONT, color: '#6B7280', callback: ccK } } } } });
      // caixa do PERÍODO escolhido (esse sim segue o calendário)
      let dTot = 0;
      rfF.forEach((f) => { for (let m = 0; m <= RF.curM; m++) { if (!H.inScope(m)) continue; dTot += (f.arr[drillL] || [])[m] || 0; } });
      // média por carro·mês: SEMPRE do início até hoje (ou projetada, nas linhas de evento)
      const AV = costsAvgPerCarMonth(drillL, RF, rfF);
      const avg = AV.v, dCarM = AV.cm;
      // De onde sai a média das linhas de AGENDA — sem isso o número vira adivinhação: o seguro,
      // por exemplo, é pago em poucas parcelas grandes mas rateado nos 12 meses de cobertura, e a
      // parcela (o que se lembra de pagar) é sempre bem maior que o custo mensal apropriado.
      // parâmetros contratuais da linha, para a ajuda mostrar de onde vêm os valores
      const baseTxt = (() => {
        const fxr = finPar('__fin_fx__') || 5.5;
        const par = (id, k) => { const v = (realFleetParams[id] || {})[k + '@@0']; return v != null ? Number(v) : 0; };
        const ids = rfF.map((f) => f.id);
        const wavg = (k) => { let s = 0, n = 0; ids.forEach((id) => { const f2 = ((OCN.ue || {}).fleets || []).find((x) => x.id === id); const c = f2 ? (f2.cars || (f2.placas || []).length || 0) : 0; s += par(id, k) * c; n += c; }); return n ? s / n : 0; };
        if (drillL === 'Insurance') {
          const t = wavg('__ins_total__'), np = Math.round(wavg('__ins_parcelas__'));
          return t > 0 ? ' The policy in the UE boxes is ' + money(t / fxr) + ' per car' + (np > 1 ? ' in ' + np + ' installments of ' + money(t / np / fxr) : '') + '.' : '';
        }
        if (drillL === 'Subrental fee') { const v = wavg('__subrental_mensal__'); return v > 0 ? ' The rent in the UE boxes is ' + money(v / fxr) + ' per car per month.' : ''; }
        if (drillL === 'GPS') { const mo = wavg('__gps_mensal__'), i0 = wavg('__gps_m0__'); return mo > 0 ? ' The UE boxes carry ' + money(mo / fxr) + ' per month plus ' + money(i0 / fxr) + ' of install.' : ''; }
        return '';
      })();
      // a explicação longa saiu do cartão e virou o "?" — o número fica limpo
      const frotasTxt = rfF.map((f) => {
        const f2 = ((OCN.ue || {}).fleets || []).find((x) => x.id === f.id);
        return 'fleet ' + f.id + ' = ' + (f2 ? (f2.cars || (f2.placas || []).length) : '?') + ' cars × months since ' + (f2 && f2.inicio ? f2.inicio.slice(0, 7) : '?');
      }).join(' · ');
      costsAvgHelp = { t: COSTS_LABEL(drillL) + ' — avg per car · month', d: AV.param
        ? 'This line has a CONTRACTED monthly rate per car, so the average is that rate itself, weighted by each fleet\'s number of cars (' + AV.nFleets + ' fleets, ' + ccNum(AV.cars) + ' cars). Deriving it from accumulated cost ÷ car-months instead would drag it below the rent of every single fleet: billing starts the month after delivery, and any fleet whose box is not filled would contribute cars to the denominator and nothing to the numerator. Fleets without the rate set are left out of the average entirely.' + baseTxt
        : (AV.proj
        ? 'This line is event-driven and the realized sample is still too short to average: a four-month-old fleet has not reached its first 10.000 km revision, and a month with no claim does not mean the cost is zero. So the figure comes from the PROJECTED per-car profile over the contract (M0–M13 of the reference fleets, weighted by the cohort mix) divided by the 12 contract months.'
        : (AV.cash
          ? 'Everything actually DISBURSED on this line since inception, across all fleets shown (' + money(AV.tot) + '), divided by the car-months each fleet has accumulated since its own start: ' + frotasTxt + ' — ' + ccNum(dCarM) + ' car-months in total. It is cash, not the premium spread over the coverage, so it answers "how much has insurance weighed per car that actually ran so far".' + baseTxt
          : 'Everything this line has cost since inception (' + money(AV.tot) + '), divided by the car-months each fleet has accumulated since its own start: ' + frotasTxt + ' — ' + ccNum(dCarM) + ' car-months in total. The cost is accrued to the months the cars were held, because the sub-rental is billed the month after delivery and raw cash would understate it.' + baseTxt)) };
      const avgTag = AV.param ? 'contracted' : (AV.proj ? 'projected' : 'since inception');
      document.getElementById('ccDrillInds').innerHTML =
        `<div class="cc-big cc-huge" style="--cl:${DC}">` +
          `<button type="button" class="costs-help cc-help-in" data-h="avg" title="How this is calculated">?</button>` +
          `<b>${avg == null ? '—' : money(avg)}</b>` +
          // o rótulo diz de onde vem o número — e que ele NÃO segue o calendário, de propósito
          `<span>avg per car · month <em class="cc-tag">${avgTag}</em></span></div>` +
        `<div class="cc-big" style="--cl:${DC}"><b>${money(dTot)}</b>` +
          (showProj ? `<em class="cc-proj">+ ${money(projTot)}</em>` : '') +
          `<span>cash · ${escH(perName(H.mSel))}</span>` +
          (showProj ? `<i><b class="cc-proj-lg">${money(dTot + projTot)}</b> full year · realized through ${monthLbl(RF.curM)} + forecast ahead</i>` : '') +
        `</div>`;
      document.querySelectorAll('#ccDrillInds .costs-help').forEach((b) => { b.onclick = () => costsHelpOpen('avg'); });
      // ---- share do COGS por mês (+ coluna do ANO): 100% empilhado, top-5 + Others ----
      const shareTop = rows.slice(0, 5).map((r) => r.L);
      const shareTotM = new Array(FIN_MONTHS).fill(0);
      COSTS_LIST.forEach((L) => { const a = H.lineOfL(L); for (let m = 0; m < FIN_MONTHS; m++) shareTotM[m] += a[m] || 0; });
      const anoTot = shareTotM.reduce((a, b) => a + b, 0);
      // a 13ª coluna é o ano inteiro — o share consolidado, que é outra pergunta que o mensal não responde
      const shareLabels = MONL.concat([String(finYear)]);
      const totCol = shareTotM.concat([anoTot]);
      const pctOf = (L) => { const a = H.lineOfL(L); const yr = a.reduce((s, v) => s + (v || 0), 0);
        return a.map((v, m) => (shareTotM[m] > 0 ? (v / shareTotM[m]) * 100 : null)).concat([anoTot > 0 ? (yr / anoTot) * 100 : null]); };
      const othersPct = new Array(FIN_MONTHS + 1).fill(0);
      COSTS_LIST.filter((L) => !shareTop.includes(L)).forEach((L) => { const p = pctOf(L); for (let m = 0; m <= FIN_MONTHS; m++) othersPct[m] += p[m] || 0; });
      const futuro = (m) => m < FIN_MONTHS && RF.curM >= 0 && m > RF.curM;   // projeção mais clara
      const isAno = (m) => m === FIN_MONTHS;
      const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
      mk('ccShare', { type: 'bar', data: { labels: shareLabels, datasets: shareTop.map((L) => (
          { label: COSTS_LABEL(L), data: pctOf(L).map(r1),
            backgroundColor: pctOf(L).map((v, m) => (futuro(m) ? costsTint(COSTS_COLOR[L], .45) : COSTS_COLOR[L])),
            borderColor: pctOf(L).map((v, m) => (isAno(m) ? '#111827' : 'transparent')), borderWidth: pctOf(L).map((v, m) => (isAno(m) ? 1 : 0)),
            stack: 's', maxBarThickness: 40 }
        )).concat([{ label: 'Others', data: othersPct.map((v, m) => (totCol[m] > 0 ? r1(v) : null)),
          backgroundColor: othersPct.map((_, m) => (futuro(m) ? 'rgba(156,163,175,.45)' : '#9CA3AF')),
          borderColor: othersPct.map((_, m) => (isAno(m) ? '#111827' : 'transparent')), borderWidth: othersPct.map((_, m) => (isAno(m) ? 1 : 0)),
          stack: 's', maxBarThickness: 40 }]) },
        // COGS absoluto de cada coluna, em destaque acima da barra
        plugins: [{ id: 'shareTot', afterDatasetsDraw(ch) {
          const { ctx } = ch; const top = ch.chartArea.top;
          ctx.save(); ctx.textAlign = 'center';
          ch.getDatasetMeta(0).data.forEach((el, i) => {
            if (!(totCol[i] > 0)) return;
            const y = top - 7, txt = ccK(totCol[i] * K);
            ctx.font = '800 ' + (isAno(i) ? 12 : 10.5) + 'px ' + getComputedStyle(document.body).fontFamily;
            const w = ctx.measureText(txt).width + 10;
            ctx.fillStyle = isAno(i) ? '#111827' : (futuro(i) ? '#EEF2F7' : '#F3F4F6');
            ctx.beginPath(); ctx.roundRect(el.x - w / 2, y - 12, w, 16, 8); ctx.fill();
            ctx.fillStyle = isAno(i) ? '#fff' : '#374151';
            ctx.fillText(txt, el.x, y);
          });
          ctx.restore();
        } }],
        options: { responsive: true, maintainAspectRatio: false,
          layout: { padding: { top: 24 } },
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'bottom', align: 'start', labels: Object.assign({}, CC_LEG, { padding: 14 }) },
            // com o gráfico mais alto cabe rótulo em fatia bem menor
            datalabels: { display: (c) => (c.dataset.data[c.dataIndex] || 0) >= 3, color: '#fff', font: { size: 9.5, weight: 800 }, formatter: (v) => (v >= 10 ? Math.round(v) : v.toFixed(1)) + '%' },
            tooltip: { padding: 10, titleFont: { size: 12 }, bodyFont: { size: 11.5 },
              callbacks: { title: (items) => shareLabels[items[0].dataIndex] + ' — ' + cs + ' ' + ccNum(totCol[items[0].dataIndex] * K),
                label: (c) => c.dataset.label + ': ' + (c.parsed.y == null ? '—' : c.parsed.y.toFixed(1) + '%'),
                afterTitle: (items) => (isAno(items[0].dataIndex) ? 'full year' : (futuro(items[0].dataIndex) ? 'projected' : '')) } } },
          scales: { x: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { font: { size: 10.5 }, color: (c) => (c.index === FIN_MONTHS ? '#111827' : '#6B7280') } },
            y: { stacked: true, min: 0, max: 100, grid: { display: false }, border: { display: false }, ticks: { font: CC_FONT, color: '#6B7280', callback: (v) => v + '%' } } } } });
    }
    function renderCosts() {
      const sec = document.getElementById('sub-fincosts');
      if (!sec || !sec.classList.contains('active')) return;   // canvas oculto mede 0 — só desenha visível
      renderFinYearSwitcher('costsYear');
      const S = (a) => a.reduce((x, y) => x + (y || 0), 0);
      const P = computePnl();
      const K = finCurK(), cs = finCS();
      // moeda fora dos números: a bandeira selecionada já diz em que moeda estamos
      const money = (v) => fmtQty(v * K);
      // ---- filtros: "Actuals" ou frota isolada trocam o motor (plano) pelas bases REAIS por
      // frota; mês isolado faz os cartões/totais olharem só aquele mês (vigente = só realizado) ----
      const RF = costsRealByFleet();
      if (!costsMonthInit) { costsMonthInit = true; if (RF.curM >= 0) costsMonth = RF.curM; }
      // Costs inteiro roda sobre as FROTAS DE HOJE (realizado + projeção do contrato delas).
      // O plano de coortes projeta entregas novas e por isso não entra aqui: a pergunta desta aba
      // é o que a operação atual custa, não o que uma frota maior custaria.
      const rfFleets = costsFleet != null ? RF.fleets.filter((f) => f.id === costsFleet) : RF.fleets;
      const rfLine = (L) => { const a = new Array(FIN_MONTHS).fill(0); rfFleets.forEach((f) => { for (let m = 0; m < FIN_MONTHS; m++) a[m] += (f.arr[L] || [])[m] || 0; }); return a; };
      const rfAccr = (L) => { const a = new Array(FIN_MONTHS).fill(0); rfFleets.forEach((f) => { for (let m = 0; m < FIN_MONTHS; m++) a[m] += ((f.accr || f.arr)[L] || [])[m] || 0; }); return a; };
      const lineOfL = rfLine;
      const act = (() => { const a = new Array(FIN_MONTHS).fill(0); rfFleets.forEach((f) => { for (let m = 0; m < FIN_MONTHS; m++) a[m] += f.cars[m]; }); return a; })();
      const carMonths = S(act);   // ano inteiro (usado só onde o período não se aplica)
      const arr = lineOfL(costsSel);
      // ---- PERÍODO em escopo: ano inteiro · YTD (só o realizado) · um mês ----
      // Um único predicado alimenta totais, cartões, gráficos e o drill, para o número na tela
      // nunca discordar do que o seletor diz.
      const mSel = costsMonth;
      const mIdx = (typeof mSel === 'number') ? mSel : null;
      const isYtd = mSel === 'ytd';
      const inScope = (m) => (mIdx != null ? m === mIdx : (isYtd ? m <= RF.curM : true));
      const sumIn = (a) => a.reduce((s, v, m) => s + (inScope(m) ? (v || 0) : 0), 0);
      const sumOf = (L) => {
        // mês VIGENTE isolado mostra só o realizado dele, nunca a mistura com o modelo
        return sumIn(lineOfL(L));
      };
      const fy = sumOf(costsSel);
      const cogsFY = COSTS_LIST.reduce((a2, L2) => a2 + sumOf(L2), 0);
      const revFY = null;   // receita ainda é do plano — não mistura com o custo por frota real
      // ---- elasticidade frota: inclinação de ln(custo) ~ ln(carros ativos) nos meses com os dois.
      // 1,0 = 10% mais carros → 10% mais custo (proporcional). ~0 = custo fixo, não segue a frota.
      const pts = [];
      for (let m = 0; m < FIN_MONTHS; m++) if (act[m] > 1 && arr[m] > 0) pts.push([Math.log(act[m]), Math.log(arr[m])]);
      let elast = null;
      if (pts.length >= 3) {
        const n = pts.length, mx = S(pts.map((p) => p[0])) / n, my = S(pts.map((p) => p[1])) / n;
        const vx = S(pts.map((p) => (p[0] - mx) * (p[0] - mx)));
        if (vx > 1e-6) elast = S(pts.map((p) => (p[0] - mx) * (p[1] - my))) / vx;
      }
      // ---- perfil por IDADE do carro (M0..M13): média dos modelos ponderada pelas coortes ----
      const per = new Array(UET_PERIODS).fill(0); let perOk = false;
      const qtyByModel = {};
      finCohorts.forEach((c) => { qtyByModel[c.model] = (qtyByModel[c.model] || 0) + c.qty; });
      const totQ = Math.max(1, S(Object.values(qtyByModel)));
      Object.entries(qtyByModel).forEach(([mod, q]) => {
        const pr = refProfiles && refProfiles[mod] && refProfiles[mod][costsSel];
        if (!pr) return;
        for (let p = 0; p < UET_PERIODS; p++) per[p] += Math.abs(pr[p] || 0) * (q / totQ);
        perOk = true;
      });
      const perTot = S(per);
      // Front-load Index: fatia do custo de vida do carro que cai nos 4 primeiros meses (M0–M3)
      // ÷ 25% — que é o que um custo espalhado POR IGUAL nos 12 meses recorrentes colocaria ali
      // (3 dos 12 meses M1..M12; o M0 não tem recorrência). Assim "igualmente espalhado" dá
      // exatamente 1,0; tudo na entrega dá o teto de 4,0; abaixo de 1 é carga no fim do contrato.
      let fli = null, com = null;
      if (perOk && perTot > 0) {
        fli = (S(per.slice(0, 4)) / perTot) / 0.25;
        com = per.reduce((s, v, i) => s + v * i, 0) / perTot;
      }
      // eventos por trás do custo (só onde faz sentido): recuperações / casos de reparo.
      // O custo por evento usa APENAS o realizado dos dois lados — o total do ano inclui projeção
      // mas a contagem de eventos não, e dividir um pelo outro inflava a média por caso.
      const evts = (() => {
        const hoje = (OCN.ue && OCN.ue.hoje) || '';
        const fx = finPar('__fin_fx__') || 5.5;
        const judReal = (field) => {
          let rs = 0;
          Object.values(((OCN.ue || {}).judBase || {}).placas || {}).forEach((a) => a.forEach((c) => {
            const iso = c.d || hoje; if (String(iso).slice(0, 4) === String(finYear)) rs += c[field] || 0;
          }));
          return rs / fx; // USD
        };
        if (costsSel === 'Recovery cost') {
          const z = new Array(FIN_MONTHS).fill(0);
          (((OCN.payments || {}).weeks) || []).forEach((w) => { if (!w.date || String(w.date).slice(0, 4) !== String(finYear)) return; const m = parseInt(String(w.date).slice(5, 7), 10) - 1; if (m >= 0 && m < FIN_MONTHS) z[m] += (w.counts && w.counts.recovered) || 0; });
          return { z, label: 'repossessions', realUSD: judReal('recovery') };
        }
        if (costsSel === 'Repair cost') {
          const z = new Array(FIN_MONTHS).fill(0);
          Object.values(((OCN.ue || {}).judBase || {}).placas || {}).forEach((a) => a.forEach((c) => {
            if (!(c.repair > 0)) return;
            const iso = c.d || hoje; if (String(iso).slice(0, 4) !== String(finYear)) return;
            const m = parseInt(String(iso).slice(5, 7), 10) - 1; if (m >= 0 && m < FIN_MONTHS) z[m] += 1;
          }));
          return { z, label: 'repair cases', realUSD: judReal('repair') };
        }
        return null;
      })();
      // ---- seletor (picker com cor e subtítulo por linha, mesmo modelo do Dashboard) + moeda ----
      const C = COSTS_COLOR[costsSel] || '#5A00F8';
      const ctl = document.getElementById('costsCtl');
      ctl.innerHTML = '<div class="costs-bar"><div class="costs-pk" id="costsPk">' +
        `<button type="button" class="costs-pk-btn" id="costsPkBtn" style="--cl:${C}"><span class="costs-pk-dot" style="background:${C}"></span><b>${escH(COSTS_LABEL(costsSel))}</b><span class="costs-pk-car">▾</span></button>` +
        '<div class="costs-pk-pop" id="costsPkPop" hidden>' + [COSTS_MAIN].concat(COSTS_LIST).map((L) =>
          `<button type="button" class="costs-pk-o${L === costsSel ? ' on' : ''}" data-v="${escH(L)}">` +
          `<span class="costs-pk-dot" style="background:${COSTS_COLOR[L]}"></span>` +
          `<span class="costs-pk-txt"><b>${escH(COSTS_LABEL(L))}</b></span></button>`).join('') +
        '</div></div>' + finCurFlags() +
        // filtros: visão · mês isolado · frota isolada
        // seletor de PERÍODO em calendário: botão pequeno + o que está escolhido em itálico ao lado
        `<div class="costs-cal" id="costsCal">` +
          // SVG inline em vez da fonte de ícones: o botão saía em branco quando o glifo não existia
          `<button type="button" class="costs-cal-btn" id="costsCalBtn" title="Choose the period">` +
            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
            `<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>` +
            `<rect x="7" y="12.5" width="3" height="3" rx=".6" fill="currentColor" stroke="none"/></svg></button>` +
          `<span class="costs-cal-lbl">${escH(perName(costsMonth))}</span>` +
          `<div class="costs-cal-pop" id="costsCalPop" hidden>` +
            `<div class="cal-tops">` +
              `<button type="button" class="cal-year${costsMonth == null ? ' on' : ''}" data-m="">Full year ${finYear}</button>` +
              `<button type="button" class="cal-ytd${costsMonth === 'ytd' ? ' on' : ''}" data-m="ytd">Year to date<em>realized</em></button>` +
            `</div>` +
            `<div class="cal-grid">` +
              Array.from({ length: FIN_MONTHS }, (_, m) =>
                `<button type="button" class="cal-m${costsMonth === m ? ' on' : ''}${m === RF.curM ? ' cur' : ''}" data-m="${m}">` +
                `${monthLbl(m)}${m === RF.curM ? '<em>current</em>' : ''}</button>`).join('') +
            `</div>` +
          `</div>` +
        `</div>` +
        `<select class="costs-mini" id="costsFleetSel" title="Isolate one fleet — realized data only">` +
          '<option value="">All fleets</option>' + (((OCN.ue || {}).fleets) || []).map((f) => `<option value="${escH(f.id)}"${costsFleet === f.id ? ' selected' : ''}>Fleet ${escH(f.id)} · ${f.cars || (f.placas || []).length} cars</option>`).join('') + '</select>' +
        '</div>';
      const pk = document.getElementById('costsPk'), pkB = document.getElementById('costsPkBtn'), pkP = document.getElementById('costsPkPop');
      const closePk = () => { pkP.hidden = true; pkB.classList.remove('open'); document.removeEventListener('click', outPk); };
      const outPk = (e) => { if (!pk.contains(e.target)) closePk(); };
      pkB.addEventListener('click', () => { const open = pkP.hidden; pkP.hidden = !open; pkB.classList.toggle('open', open); if (open) setTimeout(() => document.addEventListener('click', outPk), 0); });
      pkP.querySelectorAll('.costs-pk-o').forEach((b) => b.addEventListener('click', () => { costsSel = b.dataset.v; costsWhatifPct = 0; closePk(); renderCosts(); }));
      wireCurFlags(ctl, () => renderCosts());
      const cal = document.getElementById('costsCal'), calB = document.getElementById('costsCalBtn'), calP = document.getElementById('costsCalPop');
      const closeCal = () => { calP.hidden = true; calB.classList.remove('open'); document.removeEventListener('click', outCal); };
      const outCal = (e) => { if (!cal.contains(e.target)) closeCal(); };
      calB.addEventListener('click', () => { const open = calP.hidden; calP.hidden = !open; calB.classList.toggle('open', open); if (open) setTimeout(() => document.addEventListener('click', outCal), 0); });
      calP.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
        costsMonth = b.dataset.m === '' ? null : (b.dataset.m === 'ytd' ? 'ytd' : +b.dataset.m);
        closeCal(); renderCosts();
      }));
      ctl.querySelector('#costsFleetSel').addEventListener('change', (e) => { costsFleet = e.target.value === '' ? null : e.target.value; renderCosts(); });
      sec.querySelectorAll('.costs-help').forEach((b) => { b.onclick = () => costsHelpOpen(b.dataset.h); });
      // ---- Main (visão geral do COGS) × visão por linha ----
      const mainEl = document.getElementById('costsMain'), lineEl = document.getElementById('costsLineView');
      const isMain = costsSel === COSTS_MAIN;
      if (mainEl) mainEl.hidden = !isMain;
      if (lineEl) lineEl.hidden = isMain;
      if (isMain) { renderCostsMain(P, { S, K, cs, money, lineOfL, sumOf, mSel, inScope }); return; }
      // ---- cartões de peso (indicadores criados ficam DENTRO das caixas dos gráficos deles) ----
      const card = (t, v, sub, strong) => `<div class="costs-card${strong ? ' cc-strong' : ''}" style="--cl:${C}"><span>${escH(t)}</span><b>${v}</b><span class="sub">${escH(sub || '')}</span></div>`;
      const evFY = evts ? S(evts.z) : 0;
      const perEvent = (evts && evFY && evts.realUSD) ? evts.realUSD / evFY : null;
      // ---- INSURANCE: vale a pena ter seguro? ----
      // (1) BREAK-EVEN por acionamento = prêmio pago ÷ nº de sinistros. É quanto cada ocorrência
      //     precisaria custar do nosso bolso para empatar com o que pagamos de seguro.
      // (2) ECONOMIA = (nº de sinistros × custo médio que assumiríamos) − prêmio pago. O custo
      //     médio é digitado/arrastado, porque não temos o orçamento das oficinas por ocorrência.
      // Sinistros = ocorrências com `sinistro` (seguro acionado) no ano exibido, do site da frota.
      const insBox = document.getElementById('costsIns');
      if (insBox) {
        if (costsSel !== 'Insurance') { insBox.innerHTML = ''; insBox.style.display = 'none'; } else {
          insBox.style.display = '';
          const casos = ((OCN.ocorrencias || {}).casos) || [];
          const claims = casos.filter((c) => c.sinistro && String(c.iso).slice(0, 4) === String(finYear)
            && inScope(parseInt(String(c.iso).slice(5, 7), 10) - 1));
          const nCl = claims.length;
          const byTipo = {}; claims.forEach((c) => { byTipo[c.tipo] = (byTipo[c.tipo] || 0) + 1; });
          // COMPETÊNCIA, não caixa: o prêmio rateado pelos 365 dias de cobertura de cada frota.
          // `fy` (o que a linha do P&L mostra) é o desembolso, concentrado nas ~4 primeiras
          // parcelas — usá-lo aqui inflava o break-even, porque comparava o prêmio de um ano
          // inteiro de cobertura contra os sinistros de apenas parte dele.
          const accArr = rfAccr('Insurance');   // mesma competência usada no resto da aba
          const accrued = sumIn(accArr);
          // o caixa do rodapé vem das MESMAS frotas reais do rateio (não da linha do P&L, que na
          // visão Forecast é do plano e traria 775 carros contra os 170 reais do apropriado)
          const cashArr = rfLine('Insurance');
          const cash = sumIn(cashArr);
          const be = nCl > 0 ? accrued / nCl : null;         // break-even por acionamento
          if (costsInsAvg == null) costsInsAvg = be != null ? Math.round(be) : 0;
          const perLbl = perName(mSel);
          insBox.innerHTML =
            `<div class="ins-panel" style="--cl:${C}">` +
              `<div class="cc-head"><h4>Is the insurance paying for itself?</h4><span class="cc-hint">premium accrued over the coverage, not as paid</span><button type="button" class="costs-help" data-h="ins">?</button></div>` +
              `<div class="ins-grid">` +
                `<div class="cc-big cc-huge" style="--cl:${C}"><b>${be == null ? '—' : money(be)}</b><span>break-even per claim</span>` +
                  `<i>${nCl} claim${nCl === 1 ? '' : 's'} in ${escH(perLbl)} · each would have to cost this much to match the premium</i></div>` +
                `<div class="ins-mid">` +
                  `<label class="ins-lab">If each claim cost us, on average</label>` +
                  `<div class="ins-inp"><input type="number" id="insAvg" min="0" step="100" value="${Math.round(costsInsAvg)}"><span>${escH(cs)}</span></div>` +
                  `<input type="range" id="insAvgR" min="0" max="${Math.max(2000, Math.round((be || 1000) * 3))}" step="50" value="${Math.round(costsInsAvg)}" style="accent-color:${C}">` +
                  `<div class="ins-types">${Object.keys(byTipo).map((t) => `${escH(t)}: ${byTipo[t]}`).join(' · ') || 'no claims in the period'}</div>` +
                `</div>` +
                `<div class="cc-big cc-huge" id="insSave" style="--cl:${C}"></div>` +
              `</div>` +
              `<div class="ins-basis">Premium <b>accrued</b> for ${escH(perLbl)}: <b>${money(accrued)}</b>` +
                `<span>·</span>disbursed in cash by the same fleets: <b>${money(cash)}</b>` +
                `<span>${cash > 0 ? Math.round((accrued / cash) * 100) + '% of the cash is risk actually run in this window — the rest covers ' + (finYear + 1) : ''}</span></div>` +
            `</div>`;
          const paint = () => {
            const would = nCl * costsInsAvg, save = would - accrued;
            // empate: o valor padrão é o break-even arredondado, então uma diferença menor que
            // 0,1% do prêmio é ruído de arredondamento — não "prejuízo de 1"
            const even = Math.abs(save) < Math.max(1, accrued * 0.001);
            const el2 = document.getElementById('insSave');
            el2.style.setProperty('--cl', even ? '#6B7280' : (save > 0 ? '#15803D' : '#B91C1C'));
            el2.innerHTML = `<b>${even ? money(0) : (save > 0 ? '+' : '−') + money(Math.abs(save))}</b>` +
              `<span>${even ? 'exactly break-even' : (save > 0 ? 'saved by having insurance' : 'lost by having insurance')}</span>` +
              `<i>${money(would)} we would have paid out of pocket vs ${money(accrued)} of accrued premium</i>`;
          };
          const inp = document.getElementById('insAvg'), rng = document.getElementById('insAvgR');
          inp.addEventListener('input', () => { costsInsAvg = Math.max(0, +inp.value || 0); rng.value = Math.min(+rng.max, costsInsAvg); paint(); });
          rng.addEventListener('input', () => { costsInsAvg = +rng.value; inp.value = costsInsAvg; paint(); });
          insBox.querySelector('.costs-help').onclick = () => costsHelpOpen('ins');
          paint();
        }
      }
      const periodLbl = perName(mSel) + (mIdx != null && mIdx === RF.curM ? ' · realized' : '');
      // mesma regra do drill: a média por carro·mês é do início até hoje (ou projetada), nunca do
      // recorte do calendário — a pergunta "quanto custa um carro por mês" não muda com o filtro
      const AVL = costsAvgPerCarMonth(costsSel, RF, rfFleets);
      document.getElementById('costsHero').innerHTML = '<div class="costs-cards">' +
        card(periodLbl, money(fy), (cogsFY ? (fy / cogsFY * 100).toFixed(1) : '0') + '% of COGS', true) +
        (revFY != null ? card('Share of revenue', revFY ? (fy / revFY * 100).toFixed(1) + '%' : '—', 'gross revenue FY ' + money(revFY)) : '') +
        card('Per car · month' + (AVL.param ? ' (contracted)' : (AVL.proj ? ' (projected)' : ' (since inception)')), AVL.v != null ? money(AVL.v) : '—',
          AVL.param ? 'contracted rate, weighted by cars across ' + AVL.nFleets + ' fleets'
            : (AVL.proj ? 'from the per-car profile — realized sample still short' : ccNum(AVL.cm) + ' car-months since each fleet started')) +
        (perOk ? card('Per car · full contract', money(perTot / (finPar('__fin_fx__') || 5.5)), 'theoric M0–M13 profile') : '') +
        (evts && evFY ? card(evts.label + ' (FY)', String(evFY), perEvent != null ? money(perEvent) + ' per event — realized only' : 'no realized cost yet') : '') +
        '</div>';
      // ---- gráficos (todos vestem a cor da linha selecionada) ----
      const mk = (id, cfg) => { if (costsCharts[id]) { costsCharts[id].destroy(); delete costsCharts[id]; } const c = document.getElementById(id); if (!c) return; costsCharts[id] = new Chart(c.getContext('2d'), cfg); };
      const MONL = Array.from({ length: FIN_MONTHS }, (_, m) => monthLbl(m));
      const noDL = { datalabels: { display: false } };
      document.getElementById('ccMainT').innerHTML = `<span class="costs-pk-dot" style="background:${C}"></span>${escH(COSTS_LABEL(costsSel))} — per car · monthly`;
      // POR CARRO × média do ano: o absoluto parecia igual para toda linha (barra subindo com a
      // frota); dividido pelos carros, o mês fora do normal salta — acima da média acende em cor
      // cheia, e a média do ano entra tracejada como régua.
      const perCar = arr.map((v, m) => (act[m] > 1 ? (v * K) / act[m] : null));
      const pcVals = perCar.filter((v) => v != null);
      const pcAvg = pcVals.length ? pcVals.reduce((a, b) => a + b, 0) / pcVals.length : 0;
      mk('ccPerCar', { data: { labels: MONL, datasets: [
          { type: 'bar', label: cs + ' per car', data: perCar.map((v) => (v == null ? null : Math.round(v))),
            backgroundColor: perCar.map((v, m) => (mSel != null ? (inScope(m) ? C : costsTint(C, .28)) : (v != null && v > pcAvg * 1.02 ? C : costsTint(C, .35)))), borderRadius: 3, maxBarThickness: 30 },
          { type: 'line', label: 'year average', data: MONL.map(() => Math.round(pcAvg)), borderColor: C, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 },
        ] },
        options: { responsive: true, maintainAspectRatio: false, plugins: Object.assign({ legend: { labels: CC_LEG }, tooltip: { padding: 10, displayColors: false, callbacks: { label: (c) => ccNum(c.parsed.y) } } }, noDL),
          scales: CC_GRID } });
      mk('ccMain', { data: { labels: MONL, datasets: [
          { type: 'bar', label: costsSel, data: arr.map((v) => Math.round(v * K)), backgroundColor: arr.map((_, m) => (mSel != null ? (inScope(m) ? C : costsTint(C, .28)) : C)), yAxisID: 'y', borderRadius: 3, maxBarThickness: 30 },
          { type: 'line', label: 'Active cars', data: act.map((v) => Math.round(v)), borderColor: '#EB6834', backgroundColor: 'transparent', yAxisID: 'y2', tension: .3, pointRadius: 2, borderWidth: 2 },
        ].concat(evts ? [{ type: 'line', label: evts.label, data: evts.z, borderColor: '#0891B2', backgroundColor: 'transparent', yAxisID: 'y2', borderDash: [4, 3], pointRadius: 3, tension: 0, borderWidth: 1.5 }] : []) },
        options: { responsive: true, maintainAspectRatio: false, plugins: Object.assign({ legend: { labels: CC_LEG } }, noDL), interaction: { mode: 'index', intersect: false },
          scales: { y: { grid: { display: false }, border: { display: false }, beginAtZero: true, ticks: { font: CC_FONT, color: '#6B7280', callback: ccK } }, y2: { position: 'right', beginAtZero: true, grid: { display: false }, border: { display: false }, ticks: { font: CC_FONT, color: '#6B7280' } }, x: { grid: { display: false }, border: { display: false }, ticks: { font: CC_FONT, color: '#6B7280' } } } } });
      // elasticidade — enfática, na caixa do por-carro (é o gráfico que conta essa história)
      const elEl = document.getElementById('ccElast');
      if (elEl) elEl.innerHTML = elast == null ? '' :
        `<b style="color:${C}">${elast.toFixed(2)}</b><span>fleet-link · ${elast >= 0.75 ? 'follows the fleet' : elast >= 0.35 ? 'partly fleet-driven' : 'mostly fixed'}</span>`;
      // ranking: cada linha na PRÓPRIA cor — a selecionada cheia, as outras esmaecidas
      // segue o período do calendário como todo o resto (usava o ano inteiro, fixo)
      const rankRows = COSTS_LIST.map((L) => ({ L, v: sumOf(L) })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v);
      mk('ccRank', { type: 'bar', data: { labels: rankRows.map((r) => COSTS_LABEL(r.L)), datasets: [{ data: rankRows.map((r) => Math.round(r.v * K)), backgroundColor: rankRows.map((r) => r.L === costsSel ? COSTS_COLOR[r.L] : costsTint(COSTS_COLOR[r.L], .35)), borderRadius: 4, maxBarThickness: 24 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, datalabels: { anchor: 'end', align: 'end', color: '#4B5563', font: { size: 10.5, weight: 700 }, formatter: ccK } },
          scales: { x: { grid: { display: false }, border: { display: false }, beginAtZero: true, ticks: { font: CC_FONT, color: '#6B7280', callback: ccK }, grace: '16%' }, y: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 10.5 }, color: '#374151' } } } } });
      // perfil por idade + os DOIS indicadores enfáticos na mesma caixa
      const ageBox = document.getElementById('ccAgeBox');
      if (ageBox) ageBox.style.display = perOk ? '' : 'none';
      const inds = document.getElementById('ccAgeInds');
      // o índice em si virou detalhe: o que importa na leitura é o VEREDITO, não o 2,37×
      if (inds) inds.innerHTML = fli == null ? '' :
        `<div class="cc-big" style="--cl:${C}"><b class="cc-verdict">${fli >= 1.4 ? 'Front-loaded' : fli >= 0.8 ? 'Evenly spread' : 'Back-loaded'}</b><span>Cost timing</span><i>${fli >= 1.4 ? 'concentrated at delivery — hits the cash early' : fli >= 0.8 ? 'spread evenly over the contract' : 'lands at the end of the contract'}</i></div>` +
        `<div class="cc-big" style="--cl:${C}"><b>M${com.toFixed(1)}</b><span>Average month of spend</span><i>center of mass, M0–M13</i></div>`;
      if (perOk) mk('ccAge', { type: 'bar', data: { labels: Array.from({ length: UET_PERIODS }, (_, p) => 'M' + p), datasets: [{ data: per.map((v) => Math.round(v)), backgroundColor: per.map((_, p) => p < 4 ? C : costsTint(C, .35)), borderRadius: 3 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: Object.assign({ legend: { display: false }, tooltip: { padding: 10, displayColors: false, callbacks: { label: (c) => ccNum(c.parsed.y) } } }, noDL), scales: CC_GRID } });
      // ---- what-if: % sobre a linha, efeito primário em COGS / margem / caixa ----
      // Painel na cor da linha: % gigante + slider + 4 blocos de resultado com o delta em chip
      // colorido (vermelho = pior para o caixa, verde = melhor). Atualiza em cima, sem re-render.
      const wf = document.getElementById('costsWhatif');
      // filtro ativo (realizado/mês/frota) esconde o what-if: ele mexe na PROJEÇÃO do ano cheio,
      // e misturar delta de projeção com um recorte realizado enganaria
      if (mSel != null || costsFleet != null) { wf.style.display = 'none'; return; }
      wf.style.display = '';
      const gmFY = S(P.gm), ncfFY = S(P.netCf);
      wf.style.setProperty('--cl', C);
      wf.innerHTML =
        `<div class="cw-head"><div class="cw-title"><span class="costs-pk-dot" style="background:${C}"></span>What-if · <b>${escH(costsSel)}</b></div>` +
          `<button type="button" class="costs-help" data-h="whatif">?</button></div>` +
        `<div class="cw-body">` +
          `<div class="cw-slider">` +
            `<div class="cw-pct" id="cwPct"></div>` +
            `<input type="range" id="costsWfR" min="-50" max="50" step="5" value="${costsWhatifPct}" style="accent-color:${C}">` +
            `<div class="cw-scale"><span>−50%</span><span>even</span><span>+50%</span></div>` +
          `</div>` +
          `<div class="cw-tiles" id="cwOut"></div>` +
        `</div>`;
      wf.querySelector('.costs-help').onclick = () => costsHelpOpen('whatif');
      const chip = (d, goodWhenUp) => {
        if (Math.round(Math.abs(d) * K) === 0) return '<em class="cw-chip zero">—</em>';
        const up = d > 0, good = goodWhenUp ? up : !up;
        return `<em class="cw-chip ${good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${money(Math.abs(d))}</em>`;
      };
      const tile = (t, v, chipHtml, sub) => `<div class="cw-tile"><span>${escH(t)}</span><b>${v}</b>${chipHtml}<i>${escH(sub || '')}</i></div>`;
      const wfOut = () => {
        const d = fy * costsWhatifPct / 100;                    // Δ custo (positivo = mais caro)
        document.getElementById('cwPct').innerHTML = `<b style="color:${C}">${costsWhatifPct >= 0 ? '+' : ''}${costsWhatifPct}%</b><span>on ${escH(costsSel)}</span>`;
        document.getElementById('cwOut').innerHTML =
          tile('Line FY', money(fy + d), chip(d, false), 'was ' + money(fy)) +
          tile('Share of revenue', revFY ? ((fy + d) / revFY * 100).toFixed(1) + '%' : '—', '', 'was ' + (revFY ? (fy / revFY * 100).toFixed(1) : 0) + '%') +
          tile('Gross Margin FY', money(gmFY - d), chip(-d, true), 'was ' + money(gmFY)) +
          tile('Net cashflow FY', money(ncfFY - d), chip(-d, true), 'was ' + money(ncfFY));
      };
      wf.querySelector('#costsWfR').addEventListener('input', (e) => { costsWhatifPct = +e.target.value; wfOut(); });
      wfOut();
    }

    // ===================== UNIT — rentabilidade CARRO A CARRO =====================
    // Uma barra fininha por placa: tudo que o carro trouxe desde a entrega menos tudo que custou,
    // contra o BUDGET da idade dele (a economia contratual da frota + os ritmos de evento por
    // idade). Caução/refund, compra/venda e termination ficam FORA — é resultado da operação, não
    // movimentação de capital. Valores em USD (mesma base do Costs); moeda de exibição via K.
    let unitSort = 'delta', unitFleet = null, _unitCache = null;
    function unitData() {
      if (_unitCache) return _unitCache;
      const U = OCN.ue || {}, MS = 86400000, MESd = UET_WPM * 7;
      const fx = finPar('__fin_fx__') || 5.5;
      const hoje = new Date(((U.hoje) || new Date().toISOString().slice(0, 10)) + 'T12:00:00');
      const FRK = finesRatesByFleet();
      const AGE = {
        Maintenance: costsAgeProfile('Maintenance'),
        Recovery: costsAgeProfile('Recovery cost'),
        Repair: costsAgeProfile('Repair cost'),
        Parts: costsAgeProfile('Part Replacement'),
      };
      const pc = { pastilhas: cpar('__part_pastilhas_rs__', 250), disco: cpar('__part_disco_rs__', 350), pneus: cpar('__part_pneus_rs__', 700) };
      const out = [];
      (U.fleets || []).forEach((f) => {
        if (!f.inicio) return;
        const FP2 = realFleetParams[f.id] || {};
        const par = (k) => { const v = FP2[k + '@@0']; return v != null ? Number(v) : 0; };
        const ini = new Date(f.inicio + 'T12:00:00');
        if (ini > hoje) return;
        const ageM = Math.min(13, (hoje - ini) / MS / 30.44);
        const FR = FRK[f.id] || FRK.__pool || { gross: 0, net: 0, prem: 1.1 };
        // ---- budget mensal por carro (R$), mês de vida p ----
        const bm = (p) => {
          let v = 0;
          if (p === 0) v -= par('__gps_m0__') + 50 + 15;
          if (p >= 1 && p <= 12) {
            v += par('__sub_semanal__') * UET_WPM;                     // receita contratual
            v -= par('__subrental_mensal__') + par('__ins_total__') / 12 + par('__gps_mensal__');
            v += (FR.gross || 0) * (FR.prem || 1.1) * MESd;            // multas repassadas
            v -= (FR.net || 0) * MESd;                                 // multas pagas à LM
            v -= (AGE.Maintenance.ok ? AGE.Maintenance.per[p] || 0 : 0);
            v -= (AGE.Recovery.ok ? AGE.Recovery.per[p] || 0 : 0);
            v -= (AGE.Repair.ok ? AGE.Repair.per[p] || 0 : 0);
            v -= (AGE.Parts.ok ? AGE.Parts.per[p] || 0 : 0);
          }
          return v;
        };
        let bud = 0; const full = Math.floor(ageM);
        for (let p = 0; p < full && p <= 13; p++) bud += bm(p);
        if (full <= 13) bud += bm(full) * (ageM - full);
        bud /= fx;
        // ---- custos de AGENDA por carro (iguais para toda a frota), realizados até hoje ----
        let sched = 50 + 15 + par('__gps_m0__');
        const subr = par('__subrental_mensal__');
        if (subr > 0) {
          const dim = new Date(ini.getFullYear(), ini.getMonth() + 1, 0).getDate();
          const proR = Math.max(0, Math.min(1, (dim - ini.getDate()) / dim));
          for (let i = 1; i <= 13; i++) {
            const d = new Date(ini.getFullYear(), ini.getMonth() + i, 26, 12);
            if (d > hoje) break;
            sched += subr * (i === 1 ? proR : (i === 13 ? 1 - proR : 1));
          }
        }
        sched += par('__ins_total__') * Math.min(365, Math.max(0, (hoje - ini) / MS)) / 365;   // seguro apropriado
        const gpsM = par('__gps_mensal__');
        if (gpsM > 0) for (let n2 = 1; n2 <= 12; n2++) { const d = new Date(ini.getTime() + (n2 - 0.5) * MESd * MS); if (d <= hoje) sched += gpsM; }
        (f.placas || []).forEach((pl) => {
          let rev = 0, ev = 0;
          ((((U.pagamentos || {}).placas) || {})[pl] || []).forEach((s) => { rev += s.r != null ? s.r : (s.e != null ? s.e : 0); });
          ((((U.multas || {}).placas) || {})[pl] || []).forEach((x) => { if (x.pago) rev += x.v; });
          ((((U.multasBase || {}).placas) || {})[pl] || []).forEach((x) => { ev += (x.liq > 0 ? x.liq : (x.v || 0) / 1.05) * 1.05; });
          ((((U.revBase || {}).placas) || {})[pl] || []).forEach((r) => { if (r.valor) ev += r.valor; });
          ((((U.judBase || {}).placas) || {})[pl] || []).forEach((c) => { ev += (c.recovery || 0) + (c.repair || 0); });
          ((((U.reposicao || {}).placas) || {})[pl] || []).forEach((e2) => { (e2.itens || []).forEach((it) => { if (pc[it]) ev += pc[it]; }); });
          const real = (rev - ev - sched) / fx;
          out.push({ pl, fleet: f.id, ageM, real, bud, delta: real - bud, rev: rev / fx, cost: (ev + sched) / fx });
        });
      });
      _unitCache = out;
      return out;
    }
    function renderUnit() {
      const sec = document.getElementById('sub-finunit');
      if (!sec || !sec.classList.contains('active')) return;
      const K = finCurK(), cs = finCS();
      const money = (v) => fmtQty(v * K);
      const all = unitData();
      let rows = unitFleet != null ? all.filter((r) => r.fleet === unitFleet) : all.slice();
      const sorters = {
        delta: (a, b) => b.delta - a.delta,
        real: (a, b) => b.real - a.real,
        fleet: (a, b) => (a.fleet === b.fleet ? b.delta - a.delta : String(a.fleet).localeCompare(String(b.fleet))),
        age: (a, b) => b.ageM - a.ageM,
      };
      rows.sort(sorters[unitSort] || sorters.delta);
      // ---- controles ----
      const ctl = document.getElementById('unitCtl');
      const fleets = ((OCN.ue || {}).fleets) || [];
      ctl.innerHTML = '<div class="costs-bar">' +
        `<select class="costs-mini" id="unitFleetSel"><option value="">All fleets</option>` +
          fleets.map((f) => `<option value="${escH(f.id)}"${unitFleet === f.id ? ' selected' : ''}>Fleet ${escH(f.id)} · ${f.cars || (f.placas || []).length} cars</option>`).join('') + '</select>' +
        `<select class="costs-mini" id="unitSortSel">` +
          [['delta', 'Sort: Δ vs budget'], ['real', 'Sort: return'], ['fleet', 'Sort: fleet'], ['age', 'Sort: age']].map(([v, t]) => `<option value="${v}"${unitSort === v ? ' selected' : ''}>${t}</option>`).join('') + '</select>' +
        finCurFlags() + '</div>';
      ctl.querySelector('#unitFleetSel').addEventListener('change', (e) => { unitFleet = e.target.value === '' ? null : e.target.value; renderUnit(); });
      ctl.querySelector('#unitSortSel').addEventListener('change', (e) => { unitSort = e.target.value; renderUnit(); });
      wireCurFlags(ctl, () => renderUnit());
      sec.querySelectorAll('.costs-help').forEach((b) => { b.onclick = () => costsHelpOpen(b.dataset.h); });
      // ---- cartões ----
      const above = rows.filter((r) => r.delta >= 0).length, below = rows.length - above;
      const positive = rows.filter((r) => r.real >= 0).length;
      const totD = rows.reduce((s, r) => s + r.delta, 0);
      const card = (t, v, sub, cl) => `<div class="costs-card${cl ? ' cc-strong' : ''}" style="--cl:${cl || '#6D28D9'}"><span>${escH(t)}</span><b>${v}</b><span class="sub">${escH(sub || '')}</span></div>`;
      document.getElementById('unitHero').innerHTML = '<div class="costs-cards">' +
        card('Cars evaluated', String(rows.length), unitFleet != null ? 'fleet ' + unitFleet : 'all fleets') +
        card('Above budget', String(above), Math.round(above / Math.max(1, rows.length) * 100) + '% of the cars', '#059669') +
        card('Below budget', String(below), 'the red bars', '#DC2626') +
        card('Cash-positive', String(positive), 'return ≥ 0 regardless of budget') +
        card('Total Δ vs budget', (totD >= 0 ? '+' : '−') + money(Math.abs(totD)), 'sum of every car\'s delta', totD >= 0 ? '#059669' : '#DC2626') +
        '</div>';
      // ---- gráficos: barras fininhas, tooltip com o dossiê do carro ----
      const mk = (id, cfg) => { if (costsCharts[id]) { costsCharts[id].destroy(); delete costsCharts[id]; } const c = document.getElementById(id); if (!c) return; costsCharts[id] = new Chart(c.getContext('2d'), cfg); };
      const labels = rows.map((r) => r.pl);
      const tip = { padding: 10, titleFont: { size: 12 }, bodyFont: { size: 11 }, displayColors: false, callbacks: {
        title: (items) => { const r = rows[items[0].dataIndex]; return r.pl + ' · fleet ' + r.fleet + ' · M' + r.ageM.toFixed(1); },
        label: (c) => { const r = rows[c.dataIndex]; return ['return: ' + money(r.real), 'budget at this age: ' + money(r.bud), 'delta: ' + (r.delta >= 0 ? '+' : '−') + money(Math.abs(r.delta)), 'in: ' + money(r.rev) + ' · out: ' + money(r.cost)]; },
      } };
      const thin = { maxBarThickness: 9, barPercentage: .92, categoryPercentage: .95 };
      document.getElementById('unitRetHint').textContent = rows.length + ' bars — one per plate · dashed line = budget at each car\'s age';
      mk('unitRet', { data: { labels, datasets: [
          Object.assign({ type: 'bar', label: 'Return', data: rows.map((r) => Math.round(r.real * K)), backgroundColor: rows.map((r) => (r.delta >= 0 ? '#059669' : '#DC2626')), borderRadius: 2 }, thin),
          { type: 'line', label: 'Budget', data: rows.map((r) => Math.round(r.bud * K)), borderColor: '#111827', borderDash: [5, 4], borderWidth: 1.8, pointRadius: 0, tension: 0 },
        ] },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'bottom', align: 'start', labels: CC_LEG }, datalabels: { display: false }, tooltip: tip },
          scales: { x: { display: false }, y: { grid: { display: false }, border: { display: false }, ticks: { font: CC_FONT, color: '#6B7280', callback: ccK } } } } });
      mk('unitDelta', { type: 'bar', data: { labels, datasets: [
          Object.assign({ label: 'Δ vs budget', data: rows.map((r) => Math.round(r.delta * K)), backgroundColor: rows.map((r) => (r.delta >= 0 ? '#059669' : '#DC2626')), borderRadius: 2 }, thin),
        ] },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: false }, datalabels: { display: false }, tooltip: tip },
          scales: { x: { display: false }, y: { grid: { display: false }, border: { display: false }, ticks: { font: CC_FONT, color: '#6B7280', callback: ccK } } } } });
    }
    (async () => {
      const getVals = async (fleet) => { const o = {}; try { const r = await fetch('/api/ue/values?fleet=' + encodeURIComponent(fleet), { credentials: 'include' }); const d = await r.json(); (d.values || []).forEach((v) => { const lbl = v.line === 'Initial Fee / Vehicle Sell' ? 'Vehicle Sell' : v.line; if (o[lbl + '@@' + v.period] == null) o[lbl + '@@' + v.period] = v.value; }); } catch (e) {} return o; };
      try { const r = await fetch('/api/theoric/models', { credentials: 'include' }); const d = await r.json(); finModels = d.models || []; } catch (e) { finModels = []; }
      try { const r = await fetch('/api/finance/cohorts', { credentials: 'include' }); const d = await r.json(); finCohorts = d.cohorts || []; } catch (e) { finCohorts = []; }
      // HC/SG&A/CAC: um jogo de dados por ano. Se o ano seguinte nunca foi preenchido, ele nasce
      // como uma CÓPIA do ano-base — ponto de partida mais útil do que zerado ou do que o seed do Excel
      // (que é 2026-específico e não faz sentido como default de 2027).
      const seedYear = (byYear, empty) => {
        if (!byYear[FIN_BASE_YEAR]) byYear[FIN_BASE_YEAR] = empty();
        if (!byYear[FIN_BASE_YEAR + 1]) byYear[FIN_BASE_YEAR + 1] = clone(byYear[FIN_BASE_YEAR]);
        return byYear;
      };
      try { const r = await fetch('/api/finance/hc', { credentials: 'include' }); const d = await r.json(); finHcByYear = (d && d.hc) || {}; } catch (e) { finHcByYear = {}; }
      seedYear(finHcByYear, emptyHc);
      finHc = finHcByYear[finYear] || (finHcByYear[finYear] = emptyHc());
      hcEnsurePeople(); hcSyncPlan();
      finCfg = await getVals('__fin_cfg__');
      try { const r = await fetch('/api/finance/sga', { credentials: 'include' }); const d = await r.json(); finSgaByYear = (d && d.sga) || {}; } catch (e) { finSgaByYear = {}; }
      seedYear(finSgaByYear, emptySga);
      finSga = finSgaByYear[finYear] || (finSgaByYear[finYear] = emptySga());
      try { const r = await fetch('/api/finance/cac', { credentials: 'include' }); const d = await r.json(); finCacByYear = (d && d.cac) || {}; } catch (e) { finCacByYear = {}; }
      seedYear(finCacByYear, emptyCac);
      finCac = finCacByYear[finYear] || (finCacByYear[finYear] = emptyCac());
      for (const m of finModels) finModelVals[m.id] = await getVals('__theoric_' + m.id + '__');
      // caixinhas reais das frotas + config global do UE — base dos perfis de referência e dos realizados
      cfgReal = await getVals('__cfg__');
      const realFleets = ((OCN.ue || {}).fleets) || [];
      await Promise.all(realFleets.map(async (f) => { realFleetParams[f.id] = await getVals(f.id); }));
      refProfiles = buildProfiles();
      _unitCache = null;   // os parâmetros reais das frotas acabaram de chegar — invalida o por-placa
      await loadIndrive();
      await loadPnlVersions();
      try { const r = await fetch('/api/finance/scenarios', { credentials: 'include' }); const d = await r.json(); pnlScenarios = (d && d.scenarios) || []; } catch (e) { pnlScenarios = []; }
      renderFleetPlan(); renderHc(); renderAdmin(); renderCac(); renderAssump(); renderPnl();
      const dashTab = document.querySelector('.sub-tab[data-sub="findash"]');
      if (dashTab) dashTab.addEventListener('click', () => setTimeout(renderDash, 60));
      const costsTab = document.querySelector('.sub-tab[data-sub="fincosts"]');
      if (costsTab) costsTab.addEventListener('click', () => setTimeout(renderCosts, 60));
      const unitTab = document.querySelector('.sub-tab[data-sub="finunit"]');
      if (unitTab) unitTab.addEventListener('click', () => setTimeout(renderUnit, 60));
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

    // foto do modelo: a cadastrada pelo site (m.photo) vence a estática de config/static
    const modelPhoto = (m) => (m && m.photo) || ((OCN.modelos && OCN.modelos[m.id] && OCN.modelos[m.id].foto) || '');
    function renderFleets() {
      let h = uetModels.map((m) => {
        const foto = modelPhoto(m);
        const visual = foto ? `<img class="uet-photo" src="${escH(foto)}" alt="">` : `<span class="uet-dot" style="background:${escH(m.color || '#5A00F8')}"></span>`;
        const gear = isAdmin ? `<span class="uet-edit" data-edit="${escH(m.id)}" title="Edit or delete this model">✎</span>` : '';
        // regime: sublocação leva tag; compra do carro é o "normal" e não recebe nada
        const tag = m.subrental ? `<span class="uet-tag" title="Sub-rental model (we do not buy the car)">subrental</span>` : '';
        return `<button class="ue-fleet-btn uet-mbtn${m.id === uetSel ? ' active' : ''}" data-id="${escH(m.id)}">${visual}<span class="n">${escH(m.name)}</span>${tag}${gear}</button>`;
      }).join('');
      if (isAdmin) h += '<button class="ue-fleet-btn uet-add" id="uetAdd">+ Add model</button>';
      fleetsEl.innerHTML = h;
      fleetsEl.querySelectorAll('.ue-fleet-btn[data-id]').forEach((b) => b.addEventListener('click', async (ev) => {
        if (ev.target && ev.target.dataset && ev.target.dataset.edit) { ev.stopPropagation(); openModelModal(ev.target.dataset.edit); return; }
        uetSel = b.dataset.id; renderFleets(); await loadValues(uetSel);
      }));
      const addBtn = document.getElementById('uetAdd');
      if (addBtn) addBtn.addEventListener('click', addModel);
    }
    // caixinha do modelo: nome, cor, foto (URL) e exclusão — com confirmação por escrito
    function openModelModal(id) {
      const m = uetModels.find((x) => x.id === id); if (!m) return;
      const ov = document.createElement('div'); ov.className = 'ue-modal-overlay';
      ov.innerHTML =
        `<div class="ue-modal ue-modal-model">` +
          `<div class="ue-modal-title">${escH(m.name)}</div>` +
          `<div class="ue-modal-sub">Identity of the model in the Theoric UE and in the Fleet Plan.</div>` +
          `<div class="umd-preview" id="umdPrev">${modelPhoto(m) ? `<img src="${escH(modelPhoto(m))}" alt="">` : `<span class="umd-nophoto">no photo</span>`}</div>` +
          `<label class="umd-f"><span>Name</span><input id="umdName" type="text" maxlength="60" value="${escH(m.name)}"></label>` +
          `<label class="umd-f"><span>Photo — paste an image URL (https://…)</span><input id="umdPhoto" type="text" placeholder="https://…/polo.png" value="${escH(m.photo || '')}"></label>` +
          `<label class="umd-f umd-color"><span>Colour</span><input id="umdColor" type="color" value="${escH(m.color || '#5A00F8')}"></label>` +
          `<label class="umd-toggle"><input id="umdSubr" type="checkbox"${m.subrental ? ' checked' : ''}>` +
            `<span class="umd-toggle-txt"><b>Sub-rental model</b><i>we rent the car instead of buying it — buy models carry no tag</i></span></label>` +
          `<div class="ue-modal-hint">Leave the photo empty to go back to the coloured dot. The image is loaded straight from the URL — it is not uploaded here.</div>` +
          `<div class="umd-danger" id="umdDanger"></div>` +
          `<div class="ue-modal-actions"><button type="button" class="ue-modal-cancel">Cancel</button><button type="button" class="ue-modal-save" id="umdSave">Save</button></div>` +
        `</div>`;
      document.body.appendChild(ov);
      const close = () => ov.remove();
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      ov.querySelector('.ue-modal-cancel').addEventListener('click', close);
      const ph = ov.querySelector('#umdPhoto');
      ph.addEventListener('input', () => {
        const u = ph.value.trim();
        ov.querySelector('#umdPrev').innerHTML = u ? `<img src="${escH(u)}" alt="">` : `<span class="umd-nophoto">no photo</span>`;
      });
      ov.querySelector('#umdSave').addEventListener('click', async () => {
        const btn = ov.querySelector('#umdSave'); btn.disabled = true; btn.textContent = 'Saving…';
        try {
          const body = { id, name: ov.querySelector('#umdName').value, color: ov.querySelector('#umdColor').value, photo: ph.value.trim(), subrental: ov.querySelector('#umdSubr').checked };
          const r = await fetch('/api/theoric/models/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
          const d = await r.json().catch(() => ({}));
          if (!r.ok || !d.ok) throw new Error(d.error || ('HTTP ' + r.status));
          uetModels = d.models; close(); renderFleets();
        } catch (e) { btn.disabled = false; btn.textContent = 'Save'; alert('Could not save: ' + e.message); }
      });
      // exclusão em dois passos: o botão vira uma confirmação explícita dentro da própria caixinha
      const dz = ov.querySelector('#umdDanger');
      function drawDanger(armed) {
        dz.classList.toggle('armed', armed);
        dz.innerHTML = armed
          ? `<div class="umd-confirm"><b>Delete “${escH(m.name)}”?</b>` +
            `<span>The manual values of this model stay in the database, but it disappears from the Theoric UE and from the Fleet Plan.</span>` +
            `<div class="umd-confirm-row"><button type="button" class="umd-keep">Keep it</button><button type="button" class="umd-yes">Yes, delete</button></div></div>`
          : `<button type="button" class="umd-del">🗑 Delete model</button>`;
        const del = dz.querySelector('.umd-del'); if (del) del.addEventListener('click', () => drawDanger(true));
        const keep = dz.querySelector('.umd-keep'); if (keep) keep.addEventListener('click', () => drawDanger(false));
        const yes = dz.querySelector('.umd-yes');
        if (yes) yes.addEventListener('click', async () => {
          yes.disabled = true; yes.textContent = 'Deleting…';
          try {
            const r = await fetch('/api/theoric/models/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ id }) });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.ok) throw new Error(d.error || ('HTTP ' + r.status));
            uetModels = d.models;
            if (uetSel === id) uetSel = uetModels[0] ? uetModels[0].id : null;
            close(); renderFleets(); if (uetSel) await loadValues(uetSel);
          } catch (e) { yes.disabled = false; yes.textContent = 'Yes, delete'; alert('Could not delete: ' + e.message); }
        });
      }
      drawDanger(false);
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
      try { const r = await fetch('/api/ue/values?fleet=' + encodeURIComponent(fkey(id)), { credentials: 'include' }); const d = await r.json(); (d.values || []).forEach((v) => { const lbl = v.line === 'Initial Fee / Vehicle Sell' ? 'Vehicle Sell' : v.line; if (uetVals[lbl + '@@' + v.period] == null) uetVals[lbl + '@@' + v.period] = v.value; }); }
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
        `<div class="ue-cur-toggle">${CUR_FLAGS(uetCurrency)}</div>` +
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
    let ctxPlates = [];    // placas do CONTEXTO de cálculo — usado pelo InDrive (benefício por placa)
    let fleetCtx = null;   // all-mode: contexto por frota (params/entradas/derivados) p/ combinar célula a célula
    const viewMult = () => (plateView ? 1 : (viewAgg ? (curCars || 1) : 1)); // usado só pelo orçado (referência por modelo)
    let entered = {}; // "line@@period" -> {value, kind} — valores manuais em R$ (moeda principal)
    let manualMode = false; // edição manual desligada por padrão
    let currency = 'BRL';   // moeda de exibição: R$ (principal) ou US$ (toggle no cabeçalho)
    let cotacao = 5.5;      // câmbio futuro R$/US$ (slider, global) — converte os PROJETADOS
    // realizados convertem R$↔US$ no câmbio nominal fixo (ORCADO_FX, 5,0) — o campo editável foi removido
    // e o setting antigo (__cotacao_real__) é ignorado de propósito (ficou um valor fantasma no banco)
    let refundPct = 0.13;   // correção a.a. do Security Deposit Refund (campo, global)
    let cleanView = true;   // visão limpa é o PADRÃO: só o total (real+proj), sem orçado nem controles
    let showProj = true;    // false = esconde os projetados (roxo) e mostra só o realizado — só visualização
    let idrOff = false;     // true = tira o benefício InDrive da conta do UE (espelha o botão do P&L)
    let inadimplencia = 0;  // taxa de inadimplência % (slider, global) — desconta a projeção do Subscription
    let latePct = 0;        // % das semanas pagas COM atraso (slider, global) — projeta o Late-payment interest
    let termPct = 50;       // % da cobrança de rescisão (import_jud) que esperamos receber (slider, global)
    // Reposição de peças: a cada quantos MIL km trocar + custo por troca (painel ⚙, global)
    let partCfg = { pastilhas: { km: 15, rs: 250 }, disco: { km: 30, rs: 350 }, pneus: { km: 50, rs: 700 } };
    // Config de peças EFETIVA da visão atual: cada frota pode ter os próprios intervalos/custos
    // (salvos nas caixinhas da própria frota); o que ela não definir cai no padrão global (__cfg__).
    let partCfgCur = partCfg;
    const mergedParts = (prm) => {
      const get = (k) => { const v = prm && prm[k]; return (v != null && v !== '') ? Number(v) : null; };
      const it = (nome) => { const km = get('__part_' + nome + '_km__'), rs = get('__part_' + nome + '_rs__');
        return { km: km != null ? km : partCfg[nome].km, rs: rs != null ? rs : partCfg[nome].rs }; };
      return { pastilhas: it('pastilhas'), disco: it('disco'), pneus: it('pneus') };
    };
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
      const lbl = ORC_ALIAS[line] || line;
      const l = (U.orcado[model] && U.orcado[model].lines.find((x) => x.label === lbl));
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
    // Segundas-feiras COBRÁVEIS por carro no mês `m` do eixo do UE.
    // O eixo é ancorado na entrega mais antiga da frota, mas cada contrato tem as suas 52 semanas
    // contadas a partir da entrega DAQUELE carro. Na frota 1 a entrega média foi 11 dias depois do
    // início da frota (cobertura de só 63% do M1) — é isso que deixa o M1 baixo, e a contrapartida
    // é a cauda: quem pegou o carro no meio do M1 paga até o meio do M13.
    // `from` (opcional) conta só as segundas AINDA POR VIR — usado no mês vigente.
    function mondaysAvg(m, from) {
      if (!curIni) return 0;
      const MS = 86400000, len = SEMANAS_MES * 7 * MS;
      const winIni = curIni.getTime() + (m - 1) * len;
      const winFim = curIni.getTime() + m * len;
      const pls = plateView ? [plateView] : ctxPlates;
      if (!pls.length) return mondaysInMonth(curIni, m, from); // sem placas: comportamento antigo
      const starts = U.starts || {};
      const dur = U.periods * SEMANAS_MES * 7 * MS;            // 52 semanas de contrato
      let tot = 0, n = 0;
      pls.forEach((pl) => {
        const lm = lossMonthByPlate[pl];
        if (lm != null && m >= lm) return;                     // perda total sai do numerador E do denominador
        n++;
        const s = starts[pl] ? new Date(starts[pl] + 'T12:00:00').getTime() : curIni.getTime();
        const ini = Math.max(s, curIni.getTime());             // entrega anterior ao eixo ancora no início
        const a = Math.max(winIni, ini), b = Math.min(winFim, ini + dur);
        if (b <= a) return;
        const d0 = new Date(a);
        let d = a + (((1 - d0.getDay()) % 7 + 7) % 7) * MS;    // 1ª segunda ≥ a
        while (d < b) { if (!from || d > from.getTime()) tot++; d += 7 * MS; }
      });
      return n ? tot / n : 0;
    }
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
    // Subrental em R$ no período p. Regras:
    //  - 12 parcelas mensais, sempre no dia 26, a 1ª no mês seguinte ao da retirada;
    //  - a 1ª parcela é PRO-RATA dos dias com o carro no mês de entrada: retirada 05/04 →
    //    (30−5)/30 = 0,8333 da mensalidade em 26/05;
    //  - o complemento (1 − pro-rata) fecha os 12 meses numa 13ª cobrança, um mês depois da
    //    última parcela ("M14", dia 26). Aqui no UE ele SOMA no M13, que é o último mês visível;
    //    no P&L cai na data real de calendário.
    function subrentalRSAt(p) {
      if (!curIni) return 0;
      const mensal = par('__subrental_mensal__');
      if (!(mensal > 0)) return 0;
      const dim = new Date(curIni.getFullYear(), curIni.getMonth() + 1, 0).getDate();
      const prorata = Math.max(0, Math.min(1, (dim - curIni.getDate()) / dim));
      let tot = 0;
      for (let i = 1; i <= 13; i++) {
        const d = new Date(curIni.getFullYear(), curIni.getMonth() + i, 26, 12, 0, 0);
        let mo = Math.ceil(((d - curIni) / 86400000) / (SEMANAS_MES * 7));
        if (mo < 1) mo = 1;
        if (mo > PMAX) mo = PMAX;                       // a 13ª ("M14") aparece somada no M13
        if (mo !== p) continue;
        tot += mensal * (i === 1 ? prorata : (i === 13 ? 1 - prorata : 1));
      }
      return tot;
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
    // InDrive: R$ TOTAL que cai no período `p` do UE, contando só as placas do contexto (frota ou
    // placa selecionada). A data da leva vira mês do UE pelo mesmo eixo de 4,333 semanas das demais
    // linhas; leva anterior ao início da frota cai no M0 e leva depois do M13 fica de fora.
    function indriveRS(p) {
      if (idrOff || !indriveOn() || !curIni) return 0;
      const set = plateView ? new Set([plateView]) : new Set(ctxPlates);
      if (!set.size) return 0;
      let tot = 0;
      indriveData.batches.forEach((b) => {
        const d = new Date(b.date + 'T12:00:00');
        let mo = Math.ceil(((d - curIni) / 86400000) / (SEMANAS_MES * 7));
        if (mo < 0) mo = 0;
        if (mo > PMAX || mo !== p) return;
        let n = 0; (b.plates || []).forEach((pl) => { if (set.has(pl)) n++; });
        tot += n * indriveData.value;
      });
      return tot;
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
      // REGRA DO CONTRATO (conferida na planilha multas_consolidado, colunas N e O):
      //   cobramos do cliente  = valor BRUTO   × (1 + prêmio)   → 10% na v1/v2, 20% da v3 em diante
      //   pagamos à LM         = valor LÍQUIDO × 1,05           → o líquido é ~80% do bruto (col U = O × 1,05)
      // Ou seja, a margem nasce do desconto: cobra-se sobre o cheio e paga-se sobre o descontado.
      const desc = (U.multasBase && U.multasBase.descontoMedio) || 0.8;
      const ct = U.contratos || {};
      const premioDe = (pl) => VER_PREMIO(ct[pl] || 1);
      const brutoDe = (x) => (x.bruto > 0 ? x.bruto : (x.liq > 0 ? x.liq / desc : (x.v || 0) / 1.05 / desc));
      // Sem corte de inadimplência aqui: a multa é repassada ao cliente, então o recebível é
      // projetado INTEGRAL. Aplicar a taxa histórica de recebimento só na receita invertia o sinal
      // do balanço — a multa não paga hoje continua devida pelo cliente, não é perda.
      // `taxaRecebimento` segue medida no servidor (~85% em coortes maduras) p/ acompanhar o risco.
      const taxa = 1;
      const moOf = (d) => { const m = Math.ceil(((d - ini) / MS) / (SEMANAS_MES * 7)); return m < 1 ? 1 : m; };
      const plates = plateView ? [plateView] : (f.placas || []);
      for (let p = 0; p <= PMAX; p++) { finesRealRS[p] = 0; finesProjRS[p] = 0; }
      // REALIZADO = caixa que o cliente efetivamente pagou (API de cobranças), na data do pagamento.
      // Fica como está de propósito: é dinheiro que entrou, não modelo.
      plates.forEach((pl) => (mul[pl] || []).forEach((x) => {
        if (!x.pago) return;
        finesRealRS[Math.min(moOf(new Date(x.d + 'T12:00:00')), PMAX)] += x.v;
      }));
      // PROJETADO = a REGRA aplicada às multas já emitidas que ainda não venceram para o cliente
      // (multas_consolidado é a base única — a mesma da linha de saída, então os dois lados falam
      // do mesmo universo de infrações).
      const base = (U.multasBase && U.multasBase.placas) || {};
      let brutoTot = 0;
      plates.forEach((pl) => (base[pl] || []).forEach((x) => {
        const b = brutoDe(x);
        brutoTot += b;
        if (!x.inf) return;
        const quando = new Date(new Date(x.inf + 'T12:00:00').getTime() + lag * MS);
        if (quando <= hoje) return;                    // já dentro da janela realizada — vem da API acima
        const mo = Math.min(Math.max(moOf(quando), 1), PMAX);
        finesProjRS[mo] += b * (1 + premioDe(pl)) * taxa;
      }));
      // infrações FUTURAS: ritmo histórico de valor BRUTO por dia × (1 + prêmio médio das placas
      // desta frota hoje). Antes a base era o total já cobrado — que embute o prêmio antigo — e
      // precisava de um fator de escala; com o bruto o prêmio entra uma vez só, explicitamente.
      // ritmo de infrações NOVAS: janela madura + credibilidade (ver finesRatesByFleet). Antes era
      // brutoTot / dias corridos, que conta os ~27 dias finais cujas multas ainda não chegaram.
      const premioHoje = avgByVersion(f, VER_PREMIO, 0.10);
      const carsNow = plateView ? 1 : Math.max(1, f.cars || (f.placas || []).length || 1);
      const FR = finesRatesByFleet()[f.id];
      const perDay = (FR ? FR.gross * carsNow : brutoTot / Math.max(1, (hoje - ini) / MS)) * (1 + premioHoje) * taxa;
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
      // SAÍDA = valor LÍQUIDO da multa (com desconto) + 5% para a LM. Confere com a coluna U da
      // planilha (medido: U = O × 1,0500 em 233 multas); calcular aqui em vez de ler U deixa a
      // regra explícita e simétrica à linha de entrada, que usa o BRUTO + prêmio.
      const LM_FEE = 1.05;
      const liqDe = (x) => (x.liq > 0 ? x.liq : (x.v > 0 ? x.v / LM_FEE : 0));
      let total = 0;
      plates.forEach((pl) => (base[pl] || []).forEach((x) => {
        const val = liqDe(x) * LM_FEE;
        total += val;
        let quando = null, venceu = false;
        if (x.venc) { quando = new Date(x.venc + 'T12:00:00'); venceu = quando <= hoje; }
        else if (x.email) { quando = new Date(new Date(x.email + 'T12:00:00').getTime() + prazo * MS); }
        if (!quando) return;
        let mo = quando < hoje && !venceu ? currentMonthIdx() : moOf(quando); // atrasada -> mês vigente
        mo = Math.min(Math.max(mo, 1), PMAX);
        if (venceu) finesOutRealRS[mo] += x.v; else finesOutProjRS[mo] += x.v;
      }));
      // ritmo histórico de multas (R$/dia) para projetar as infrações que ainda vão acontecer —
      // mesma correção de maturação/credibilidade da linha de entrada, para os dois lados falarem
      // do mesmo universo de infrações
      const carsOut = plateView ? 1 : Math.max(1, f.cars || (f.placas || []).length || 1);
      const FRo = finesRatesByFleet()[f.id];
      const perDay = FRo ? FRo.net * carsOut : total / Math.max(1, (hoje - curIni) / MS);
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
        // Caso SEM data é um caso que JÁ ACONTECEU (está importado na planilha) — só não sabemos o
        // dia. Tratá-lo como projeção escondia 44% dos casos do realizado (14 de 32 hoje, R$9k de
        // recovery + R$6k de repair) e era por isso que o realizado do UE ficava abaixo da planilha.
        const realized = c.d ? new Date(c.d + 'T12:00:00') <= hoje : true;
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
            const cfg = partCfgCur[it]; if (!cfg) return;
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
        Object.values(partCfgCur).forEach((cfg) => {
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
        // O M13 deixou de ser zerado: é lá que cai a cauda dos contratos que começaram depois
        // do início da frota (52 semanas contadas da entrega de cada carro).
        if (period === 0) return { rs: 0, perActive: true };
        // projeção de uma semana: semanalidade × (1 − inadimplência do slider); placa com perda total não paga
        const wk = par('__sub_semanal__') * (1 - inadimplencia / 100) * plateCut(period);
        if (periodStatus(period) === 'real') {
          if (!subsReady) return null;
          const real = subsRS[period] || 0;
          // mês VIGENTE: soma o que já foi recebido + projeção das segundas que ainda faltam nesta janela
          if (period === currentMonthIdx() && curIni) {
            return { rs: real, rsProj: mondaysAvg(period, hoje) * wk, perActive: true };
          }
          return { rs: real, perActive: true };
        }
        if (!curIni) return null;
        return { rs: mondaysAvg(period) * wk, perActive: true };
      }
      if (line === 'Late-payment interest' && par('__sub_semanal__') > 0) {
        // realizado = juro efetivo (recebido − esperado). Projetado = semanas × semanalidade
        // × % de semanas pagas em atraso (slider) × % de juros da caixinha da linha.
        // Segue o mesmo eixo por placa do Subscription — inclusive a cauda no M13.
        if (period === 0) return { rs: 0, perActive: true };
        const wkJuros = par('__sub_semanal__') * (latePct / 100) * (jurosPct / 100) * plateCut(period);
        if (periodStatus(period) === 'real') {
          if (!subsReady) return null;
          const real = subsJurosRS[period] || 0;
          if (period === currentMonthIdx() && curIni) {
            return { rs: real, rsProj: mondaysAvg(period, hoje) * wkJuros, perActive: true };
          }
          return { rs: real, perActive: true };
        }
        if (!curIni) return null;
        return { rs: mondaysAvg(period) * wkJuros, perActive: true };
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
        if (!curIni) return null;
        return { rs: -subrentalRSAt(period) * plateCut(period), perActive: true };
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
      // Calção: SEMPRE resolvido aqui, mesmo quando a frota não tem nenhum. Antes, frota sem
      // `__num_alugueis__` caía no fim da função e herdava o ORÇADO do modelo teórico — a frota 1
      // não pagou calção nenhum e mesmo assim aparecia um no M0 do realizado.
      if (line === 'Security Deposit') return { rs: (secDepMag() > 0 && period === 0) ? -secDepMag() : 0 };
      if (line === 'Deposit Refund') {
        const rp = par('__refund_pct__') > 0 ? par('__refund_pct__') / 100 : refundPct; // caixinha da linha vence o global
        return { rs: (secDepMag() > 0 && period === PMAX) ? secDepMag() * (1 + rp) : 0 }; // devolução corrigida, no M13
      }
      if (line === 'Vehicle Purchase' && par('__vehicle__') > 0) return { rs: period === PMAX ? -par('__vehicle__') : 0 };
      // a antiga linha "Initial Fee / Vehicle Sell" virou DUAS: a venda do carro (103% da compra,
      // no M13) e o bônus InDrive (levas por placa, no mês de cada leva)
      if (line === 'Vehicle Sell' && par('__vehicle__') > 0) {
        return { rs: period === PMAX ? par('__vehicle__') * 1.03 : 0 };
      }
      if (line === 'InDrive bonus') {
        const idr = indriveRS(period) / (plateView ? 1 : (ctxCars || 1));
        if (idr) return { rs: idr };
        if (indriveOn()) return { rs: 0 };
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
      model = c.f.model; params = c.params; entered = c.entered; curIni = c.ini; ctxCars = c.f.cars || 0; ctxPlates = c.f.placas || []; partCfgCur = c.partCfg || partCfg;
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
      // "Actuals only": zera o lado projetado em TODA a cadeia (célula, totalizadores e TIR), para
      // a visão ficar coerente — não adianta esconder o roxo e o Total continuar somando-o.
      const cut = (o) => { if (o && !showProj) { o.proj = 0; if (o.status === 'proj') o.real = 0; } return o; };
      if (allMode && !plateView) {
        const r = combinedSplit(line, period);
        if (!r) return null;
        const k = viewAgg ? 1 : 1 / r.den; // combinado já vem como soma total; unitary divide pelo denominador
        return cut({ real: Math.round(r.real * k), proj: Math.round(r.proj * k), status: r.status });
      }
      const e = effSplitOne(line, period);
      if (!e) return null;
      const k = plateView ? 1 : (viewAgg ? (e.perActive ? activeCarsAt(period) : (curCars || 1)) : 1);
      return cut({ real: Math.round((e.real || 0) * k), proj: Math.round((e.proj || 0) * k), status: e.status });
    }
    // linhas cujo lançamento pontual foi movido para o M13 (planilha original só vai até M12) — o orçado de
    // referência sai do M12 e passa a aparecer só no M13 (substituição, não duplicação)
    const M13_LINES = ['Vehicle Purchase', 'Vehicle Sell', 'Deposit Refund'];
    // a PLANILHA de orçado ainda usa o rótulo combinado — as linhas novas leem dela por alias
    const ORC_ALIAS = { 'Vehicle Sell': 'Initial Fee / Vehicle Sell' };
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
          const l = U.orcado[ff.model] && U.orcado[ff.model].lines.find((x) => x.label === (ORC_ALIAS[line] || line));
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

    function slider(id, label, min, max, step, val, hint) {
      return `<div class="ue-slider"><div class="ue-sl-top"><label>${label}</label><span class="ue-sl-val" id="${id}Val"></span></div>` +
        `<input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"${isAdmin ? '' : ' disabled'}/>` +
        (hint || '') + `</div>`;
    }
    // Inadimplência medida no histórico: contrato encerrado por "Recuperação" = o cliente parou de
    // pagar e o carro foi retomado. A taxa é POR PAGAMENTO (recuperações ÷ cobranças semanais
    // esperadas) — é assim que o slider é aplicado (semanalidade × (1 − inad%)). Em "All fleets"
    // usa o consolidado; numa frota, o histórico DAQUELA frota.
    const churnOf = () => {
      const c = U.churn; if (!c) return null;
      return (!allMode && c.byFleet && c.byFleet[current]) ? c.byFleet[current] : c;
    };
    const churnRate = () => { const c = churnOf(); return (c && c.taxa > 0) ? Math.round(c.taxa * 10000) / 100 : null; }; // % por pagamento
    // Evidência de que a recuperação veio de falta de pagamento. O import_clientes NÃO traz o
    // submotivo, então o que dá para medir é o histórico de cobrança da placa: semanas pagas com
    // atraso na matriz. (Semanas "em aberto" não entram: U.pagamentos só lista o que foi pago,
    // então contá-las aqui daria sempre zero — o número em aberto vive na matriz bruta.)
    function churnEvidence(c) {
      const pag = (U.pagamentos || {}).placas; if (!pag || !c || !c.placas) return null;
      const pls = [...new Set(c.placas)];
      const comAtraso = pls.filter((pl) => (pag[pl] || []).some((s) => s.r != null && s.e != null && s.r > s.e)).length;
      return { n: pls.length, comAtraso };
    }
    function inadHint() {
      const r = churnRate(); if (r == null) return '';
      const c = churnOf();
      const ev = churnEvidence(c);
      const same = Math.abs(inadimplencia - r) < 0.005;
      const escopo = (!allMode && U.churn.byFleet && U.churn.byFleet[current]) ? 'this fleet' : 'all fleets';
      const tip = `${c.recuperacoes} repossessions over ${c.pagamentos.toLocaleString('pt-BR')} weekly charges (${escopo}). `
        + (ev && ev.n ? `${ev.comAtraso} of the ${ev.n} repossessed plates had late payments in the billing matrix. ` : '')
        + 'The sheet does not record WHY each car was repossessed — "Recuperação" is a single value with no sub-reason, so all of them count as default.';
      return `<button type="button" class="ue-sl-hint${same ? ' on' : ''}" id="ueInadHist" title="${tip.replace(/"/g, '&quot;')}">` +
        `${same ? '✓ historical' : 'use historical: ' + String(r).replace('.', ',') + '%'}</button>`;
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

    // "?" do UE — mesmo guia navegável do P&L (linha do tempo + famílias + linha expansível),
    // no lugar da tabela de três colunas que não cabia as explicações longas.
    function openInfoModal() {
      // escape próprio: initUnit() não tem um no escopo (o do P&L vive dentro de initFinance)
      const escH = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
      const FAM_DOT = { rev: '#5A00F8', cogs: '#EB6834', fines: '#15803D', eng: '#0891B2' };
      const GROUPS = [
        { id: 'rev', name: 'Revenue', dot: FAM_DOT.rev, rows: [
          { t: 'Subscription', src: 'Payments matrix + ✎ weekly fee', upd: 'auto',
            d: 'Realized comes from the payments matrix (billing panel API). Projected is the weekly fee (✎ box) × the Mondays inside EACH plate’s own 52 weeks, counted from its delivery date — which is why the tail lands in M13 instead of stopping at M12.' },
          { t: 'Late-payment interest', src: 'Same matrix + late % slider', upd: 'auto',
            d: 'Actual interest from the same payments matrix, plus the contract version of each plate: 5% on v1/v2, 20% from v3 onwards. The late % slider sets how much of the base pays late.' },
          { t: 'Traffic fines (inflow)', src: 'Fines API + contract rule', upd: 'auto',
            d: 'Realized is the fines API — what clients actually paid, on the payment date. Projected applies the contract rule: GROSS fine × (1 + premium), 10% on v1/v2 and 20% from v3. How the underlying pace per car is measured is explained in the "Traffic fines — how the pace is measured" section below.' },
          { t: 'Termination fee', src: 'import_jud + recovery % slider', upd: 'auto',
            d: 'Total charged on early terminations (sheet import_jud, total charge minus fines and tolls) × the recovery % slider. Lands at contract end, in M13.' },
          { t: 'Vehicle Sell', src: '✎ box', upd: 'man',
            d: 'Sale at 103% of the purchase price, at M13.' },
          { t: 'InDrive bonus', src: 'iD panel', upd: 'mix',
            d: 'Value per plate × the plates of each batch, on the month of the batch date.' },
          { t: 'Security Deposit Refund', src: 'Derived from the deposit', upd: 'man',
            d: 'The deposit coming back at M13, corrected by the % p.a. field. Deposit and refund are two sides of the same coin — the P&L’s "No deposit" view removes both together.' },
        ]},
        { id: 'cogs', name: 'COGS', dot: FAM_DOT.cogs, rows: [
          { t: 'Subrental fee', src: '✎ monthly amount', upd: 'man',
            d: 'Installments on the 26th. The 1st one is PRO-RATA of the days we actually held the car in its arrival month, and the missing complement closes the 12 months in a 13th charge, shown inside M13.' },
          { t: 'Maintenance', src: 'import_rev + km pace', upd: 'auto',
            d: 'Realized: the real invoices from sheet import_rev, by due date. Projected: each plate’s km pace (fleet API odometer) schedules the next revisions, priced from the revisions site with the 25% discount.' },
          { t: 'Traffic fines (outflow)', src: 'multas_consolidado', upd: 'auto',
            d: 'What we pay LM: the NET fine (column O, about 80% of the gross) × 1.05, on our due date. The margin of the fines business comes from this asymmetry — we charge over the gross and pay over the net, roughly 26% on the current numbers.' },
          { t: 'Recovery / Repair cost', src: 'import_jud', upd: 'auto',
            d: 'Sheet import_jud by event date: towing and recovery on one line, damages, cleaning and others on the other.' },
          { t: 'Part Replacement', src: 'Fleet events + ⚙ Parts panel', upd: 'mix',
            d: 'Realized from the fleet site events, counting natural wear only (atypical damage is charged to the client). Projected from each plate’s km pace against the intervals and costs set in the ⚙ Parts panel.' },
          { t: 'Insurance · GPS · Deposit · Vehicle Purchase', src: '✎ boxes', upd: 'man',
            d: 'Manual boxes. Insurance splits its total across the number of installments; the others land on their own schedule.' },
          { t: 'Car Preparation / Sticker', src: 'Fixed at M0', upd: 'mix',
            d: 'Flat −50 and −15 R$ in M0, the month the car is delivered.' },
        ]},
        // A pergunta que mais aparece: "de onde sai o número de multas de uma frota que mal começou?"
        { id: 'fines', name: 'Traffic fines — how the pace is measured', dot: FAM_DOT.fines, rows: [
          { t: 'The reporting lag, and why the window stops early', src: 'measured on 292 fines', upd: 'auto',
            d: 'A fine does not exist for us on the day of the infraction — it exists when the agency e-mail arrives. Measured on this base: 20 days on average, 27 at the 90th percentile, 42 at most. So the most recent weeks always look artificially clean: those fines are still in transit. Dividing the known total by EVERY day since the fleet started therefore counts days whose fines had not arrived yet, and understates the pace of every fleet — measured at 15% on the oldest and 47% on the newest. The observation window now stops at the last matured day instead.' },
          { t: 'A young fleet borrows the pace of the others', src: 'credibility blend', upd: 'auto',
            d: 'A fleet that just opened has a thin and noisy sample: fleet 6 shows 6 fines where the pooled pace would predict 22 — too few to tell a real difference from luck. Rather than a hard "under 3 months" cutoff, which would make the number jump overnight, each fleet’s own pace is mixed with the pooled one by credibility: weight = its own exposure / (exposure + 50 car-months). A young fleet leans on the others and shifts to its own data as that data gains mass. Only the GROSS value is borrowed — each fleet keeps the contract premium of its own plates (10% on v1/v2, 20% from v3), so the donor fleet’s contract mix is not imported.' },
          { t: 'Fines start on day one — they do not ramp with car age', src: 'pooled age curve', upd: 'auto',
            d: 'Pooling every fleet by car age gives a flat curve — R$129 per car-month at M1, R$120 at M2. There is no "new car gets fewer fines" effect to model: the whole gap on young fleets was reporting lag plus sample noise, which is why the fix corrects the measurement instead of adding an age discount.' },
        ]},
        { id: 'eng', name: 'Engine', dot: FAM_DOT.eng, rows: [
          { t: 'Delinquency slider', src: 'Measured per fleet', upd: 'auto',
            d: 'Measured, not guessed: contracts ended as "Recuperação" ÷ the weekly charges expected in the period, per fleet — the chip under the slider fills it in. It is a rate PER CHARGE, because that is how it is applied.' },
          { t: 'When the numbers refresh', src: '05:00 São Paulo', upd: 'auto',
            d: 'Automatic sources refresh daily at 05:00 (São Paulo), on every deploy, and whenever the ↻ Refresh button is pressed. Manual boxes and sliders save to the database instantly.' },
        ]},
      ];
      const BADGE = { auto: ['Auto · daily 05:00', 'pi-b-auto'], man: ['Manual', 'pi-b-man'], mix: ['Mixed', 'pi-b-mix'] };
      const ov = document.createElement('div');
      ov.className = 'ue-modal-overlay';
      ov.innerHTML =
        `<div class="ue-modal pnl-infox">` +
          `<div class="pi-head"><div><div class="ue-modal-title" style="margin:0">Where each line comes from</div>` +
            `<div class="ue-modal-sub" style="margin:4px 0 0">Click a line to read how it is built. Every value is per car, over the M0–M13 life of the contract.</div></div>` +
            `<button type="button" class="pi-close" title="Close">✕</button></div>` +
          `<div class="pi-tl">` +
            `<div class="pi-tl-seg past"><b>Realized</b><span>black — money that actually moved, at the FX of the day</span></div>` +
            `<div class="pi-tl-seg now"><b>Current month</b><span>realized so far + the model for the remaining days</span></div>` +
            `<div class="pi-tl-seg fut"><b>Projected</b><span>purple at the FX slider · grey = budget</span></div>` +
          `</div>` +
          GROUPS.map((g) =>
            `<div class="pi-g"><div class="pi-g-h"><i style="background:${g.dot}"></i>${escH(g.name)}</div>` +
            g.rows.map((r, i) => {
              const [bl, bc] = BADGE[r.upd];
              return `<div class="pi-row" data-k="${g.id}${i}">` +
                `<div class="pi-row-top"><span class="pi-row-t">${escH(r.t)}</span>` +
                  `<span class="pi-row-src">${escH(r.src)}</span>` +
                  `<span class="pi-b ${bc}">${bl}</span><span class="pi-chev">▸</span></div>` +
                `<div class="pi-row-d" hidden>${escH(r.d)}</div></div>`;
            }).join('') + `</div>`).join('') +
        `</div>`;
      document.body.appendChild(ov);
      const close = () => ov.remove();
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      ov.querySelector('.pi-close').addEventListener('click', close);
      ov.querySelectorAll('.pi-row').forEach((row) => row.addEventListener('click', () => {
        const d = row.querySelector('.pi-row-d');
        const open = d.hidden;
        d.hidden = !open;
        row.classList.toggle('open', open);
      }));
    }

    // painel ⚙ Parts: a cada quantos MIL km trocar cada peça + custo por troca (global, persiste em __cfg__)
    function openPartsModal(f) {
      const PARTS = [['pastilhas', 'Brake pads', '🟣'], ['disco', 'Brake discs', '⚙️'], ['pneus', 'Tires', '🛞']];
      const ov = document.createElement('div');
      ov.className = 'ue-modal-overlay';
      ov.innerHTML =
        `<div class="ue-modal ue-modal-parts"><div class="ue-modal-title">Part Replacement — intervals &amp; costs</div>` +
        `<div class="ue-modal-sub">One card per part: how often it wears out and what one replacement costs us. ${allMode ? 'Editing the GLOBAL default (fallback for every fleet).' : 'Saved for THIS fleet only — All fleets edits the global default.'}</div>` +
        PARTS.map(([k, lbl, ic]) =>
          `<div class="ue-part-group">` +
            `<div class="ue-part-title"><span class="ue-part-ic">${ic}</span>${lbl}</div>` +
            `<div class="ue-part-row">` +
              `<label class="ue-part-field"><span class="ue-part-lbl">Replace every</span>` +
                `<span class="ue-part-inwrap"><input type="text" inputmode="decimal" data-k="${k}" data-f="km" value="${(allMode ? partCfg : partCfgCur)[k].km}"/><b>× 1.000 km</b></span></label>` +
              `<label class="ue-part-field"><span class="ue-part-lbl">Cost per replacement</span>` +
                `<span class="ue-part-inwrap"><b>R$</b><input type="text" inputmode="decimal" data-k="${k}" data-f="rs" value="${(allMode ? partCfg : partCfgCur)[k].rs}"/></span></label>` +
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
        // POR FROTA: numa frota específica os valores vão para as caixinhas DELA (e valem só
        // para ela); em "All fleets" editam o padrão global, que é o fallback de todo mundo.
        const alvo = allMode ? '__cfg__' : current;
        const ops = [];
        ov.querySelectorAll('input[data-k]').forEach((inp) => {
          const val = parseFloat(String(inp.value).trim().replace(/\./g, '').replace(',', '.'));
          if (!isFinite(val) || val < 0) return;
          const k = '__part_' + inp.dataset.k + '_' + inp.dataset.f + '__';
          if (allMode) partCfg[inp.dataset.k][inp.dataset.f] = val; else params[k] = val;
          ops.push({ k, value: val });
        });
        if (!allMode) partCfgCur = mergedParts(params);
        if (isAdmin) for (const o of ops) {
          try { await fetch('/api/ue/value', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fleet: alvo, line: o.k, period: 0, value: o.value, kind: 'real' }) }); } catch (e) {}
        }
        close();
        renderTable(f);
      });
    }

    // InDrive: uma leva = uma data + a lista de placas que recebem o benefício naquela data.
    // O valor por placa é o MESMO em todas as levas (campo único no topo). As placas são coladas
    // como texto solto — qualquer separador (espaço, vírgula, quebra de linha) serve.
    function openIndriveModal(f) {
      const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
      // cópia de trabalho: só grava no Save
      let draft = { value: indriveData.value, batches: indriveData.batches.map((b) => ({ date: b.date, plates: (b.plates || []).slice() })) };
      if (!draft.batches.length) draft.batches = [{ date: (U.hoje || new Date().toISOString().slice(0, 10)), plates: [] }];
      const ov = document.createElement('div');
      ov.className = 'ue-modal-overlay';
      ov.innerHTML = `<div class="ue-modal ue-modal-idr"></div>`;
      document.body.appendChild(ov);
      const box = ov.querySelector('.ue-modal-idr');
      const close = () => ov.remove();
      const norm = (raw) => [...new Set(String(raw).toUpperCase().split(/[^A-Z0-9]+/).filter((p) => p.length >= 6 && p.length <= 8))];
      const knownPlates = new Set((U.fleets || []).flatMap((x) => x.placas || []));
      function draw() {
        const totPl = draft.batches.reduce((s, b) => s + b.plates.length, 0);
        const known = draft.batches.reduce((s, b) => s + b.plates.filter((p) => knownPlates.has(p)).length, 0);
        box.innerHTML =
          `<div class="idr-head"><span class="idr-mark idr-mark-lg">iD</span>` +
            `<div><div class="ue-modal-title" style="margin:0">InDrive benefit</div>` +
            `<div class="ue-modal-sub" style="margin:2px 0 0">Revenue we receive per plate, delivered in batches. It lands on the <b>InDrive bonus</b> line, on the month of each batch date.</div></div></div>` +
          `<div class="idr-topline">` +
            `<label class="idr-field"><span>Benefit per plate</span><span class="idr-inwrap"><b>R$</b>` +
              `<input id="idrValue" type="text" inputmode="decimal" value="${draft.value ? String(draft.value).replace('.', ',') : ''}" placeholder="0,00"></span></label>` +
            `<div class="idr-sum"><div><b>${draft.batches.length}</b><span>batches</span></div>` +
              `<div><b>${totPl}</b><span>plates</span></div>` +
              `<div class="idr-sum-tot"><b>R$ ${(totPl * (draft.value || 0)).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</b><span>total</span></div></div>` +
          `</div>` +
          (totPl && known < totPl ? `<div class="idr-warn">${totPl - known} plate${totPl - known > 1 ? 's are' : ' is'} not in any fleet — they are kept, but only plates of the current fleet show up in this table.</div>` : '') +
          `<div class="idr-batches">` + draft.batches.map((b, i) =>
            `<div class="idr-batch" data-i="${i}">` +
              `<div class="idr-batch-head">` +
                `<span class="idr-batch-n">Batch ${i + 1}</span>` +
                `<label class="idr-date"><span>Date</span><input type="date" data-i="${i}" class="idr-d" value="${esc(b.date || '')}"></label>` +
                `<span class="idr-chip">${b.plates.length} plate${b.plates.length === 1 ? '' : 's'}</span>` +
                `<button type="button" class="idr-del" data-i="${i}" title="Remove this batch">✕</button>` +
              `</div>` +
              `<textarea class="idr-ta" data-i="${i}" rows="3" placeholder="Paste the plates here — any separator works (space, comma, line break)">${esc(b.plates.join(' '))}</textarea>` +
            `</div>`).join('') +
          `</div>` +
          `<button type="button" class="idr-add" id="idrAdd">＋ Add batch</button>` +
          `<div class="ue-modal-hint">Plates are normalised (uppercase, no punctuation) and de-duplicated inside each batch. Same value for every batch.</div>` +
          `<div class="ue-modal-actions"><button type="button" class="ue-modal-cancel">Cancel</button><button type="button" class="ue-modal-save">Save</button></div>`;
        // valor por placa
        const vin = box.querySelector('#idrValue');
        vin.addEventListener('change', () => { const n = parseInput(vin.value); draft.value = (n == null || isNaN(n)) ? 0 : Math.max(0, n); draw(); });
        box.querySelectorAll('.idr-d').forEach((inp) => inp.addEventListener('change', () => { draft.batches[+inp.dataset.i].date = inp.value; }));
        box.querySelectorAll('.idr-ta').forEach((ta) => {
          const commit = () => { draft.batches[+ta.dataset.i].plates = norm(ta.value); draw(); };
          ta.addEventListener('blur', commit);
          ta.addEventListener('paste', () => setTimeout(commit, 0));
        });
        box.querySelectorAll('.idr-del').forEach((b) => b.addEventListener('click', () => { draft.batches.splice(+b.dataset.i, 1); if (!draft.batches.length) draft.batches = [{ date: (U.hoje || ''), plates: [] }]; draw(); }));
        box.querySelector('#idrAdd').addEventListener('click', () => {
          const last = draft.batches[draft.batches.length - 1];
          const d = last && last.date ? new Date(last.date + 'T12:00:00') : new Date();
          d.setMonth(d.getMonth() + 1);
          draft.batches.push({ date: d.toISOString().slice(0, 10), plates: [] });
          draw();
        });
        box.querySelector('.ue-modal-cancel').addEventListener('click', close);
        box.querySelector('.ue-modal-save').addEventListener('click', save);
      }
      async function save() {
        // pega o que estiver nas caixas de texto sem depender do blur
        box.querySelectorAll('.idr-ta').forEach((ta) => { draft.batches[+ta.dataset.i].plates = norm(ta.value); });
        const vin = box.querySelector('#idrValue');
        if (vin) { const n = parseInput(vin.value); draft.value = (n == null || isNaN(n)) ? 0 : Math.max(0, n); }
        const payload = { value: draft.value, batches: draft.batches.filter((b) => b.date && b.plates.length) };
        const btn = box.querySelector('.ue-modal-save'); btn.disabled = true; btn.textContent = 'Saving…';
        try {
          const r = await fetch('/api/indrive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ indrive: payload }) });
          const d = await r.json().catch(() => ({}));
          if (!r.ok || !d.ok) throw new Error(d.error || ('HTTP ' + r.status));
          indriveData = { value: Number(d.indrive.value) || 0, batches: d.indrive.batches || [] };
          close();
          loadFleet(true);
        } catch (e) { btn.disabled = false; btn.textContent = 'Save'; alert('Could not save: ' + e.message); }
      }
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      draw();
    }

    // painel de visões: Fleet (unitary) = por veículo · Fleet (aggregate) = soma de todas as placas · uma placa
    function renderPlates(f) {
      const platesEl = document.getElementById('uePlates');
      if (!platesEl) return;
      // O grid de placas fica visível TAMBÉM no clean view: sem ele não dava para usar o modo
      // limpo olhando uma placa ou uma visão específica.
      const plates = f.placas || [];
      platesEl.innerHTML =
        `<div class="ue-plates-label">View by plate</div>` + `<div class="ue-plates-grid">` +
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
            const lbl = v.line === 'Initial Fee / Vehicle Sell' ? 'Vehicle Sell' : v.line; // rótulo antigo
            if (lbl !== v.line && e_[ekey(lbl, v.period)]) return;   // edição nova vence a antiga
            e_[ekey(lbl, v.period)] = { value: v.value, kind: v.kind };
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
      return { f: ff, params: vals.params, entered: vals.entered, partCfg: mergedParts(vals.params), ini, elapsed: el, realizedFull: Math.min(PMAX, Math.ceil(el)), lossMonthByPlate: lmp, activeFracArr: afa, subsRS: [], subsReady: false };
    }
    async function loadFleet(keepView) {
      allMode = current === 'all';
      const f = allMode ? allFleet() : U.fleets.find((x) => x.id === current);
      model = f.model;
      // trocar de FROTA reseta a visão; toggles (clean view, moeda, InDrive, projeção) preservam —
      // antes, ligar o clean view estando numa placa jogava o usuário de volta para a frota inteira
      if (!keepView) { plateView = null; viewAgg = false; }
      curCars = f.cars || 0; ctxCars = f.cars || 0; ctxPlates = f.placas || [];
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
        partCfgCur = mergedParts(params);   // peças: config da frota com fallback no padrão global
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
            `<div><div class="ue-fleet-title">${f.label} — ${f.modelLabel}${plateView ? ' · ' + plateView : (viewAgg ? ' · aggregate' : '')}</div>` +
            `<div class="ue-fleet-sub">${f.cars} cars · ${U.periods}-month contract</div>` +
            `<div class="ue-fleet-sub">${subInfo}</div></div>` +
          `</div>` +
          `<div class="ue-head-actions">` +
            // moeda + Clean view empilhados (o Clean fica logo abaixo das bandeiras)
            `<div class="ue-actstack">` +
              `<div class="ue-cur-toggle" id="ueCurToggle">${CUR_FLAGS(currency)}</div>` +
              `<button class="ue-clean2${cleanView ? ' on' : ''}" id="ueClean" title="${cleanView ? 'Back to the full view' : 'Strip the panel down to the table: one number per month, no budget comparison, no controls'}">✨ Clean view</button>` +
            `</div>` +
            // no modo limpo some tudo que é controle — fica só moeda, clean view e o "?"
            (cleanView ? '' :
              `<button class="ue-projbtn${showProj ? '' : ' off'}" id="ueProj" title="${showProj ? 'Hide the projected numbers (purple) and show actuals only' : 'Bring the projections back'}">` +
                `<span class="ue-projbtn-dot"></span><span>${showProj ? 'Actuals + projection' : 'Actuals only'}</span></button>` +
              `<button class="ue-tool-btn" id="ueParts" title="Replacement intervals and cost per part">⚙ Parts</button>` +
              `<button class="idr-btn${indriveOn() && !idrOff ? ' on' : (indriveOn() ? ' off' : '')}" id="ueIndrive" title="Edit the InDrive batches">` +
                `<span class="idr-mark">iD</span><span class="idr-txt">InDrive</span>` +
                (indriveOn()
                  ? `<span class="idr-state" id="ueIdrToggle" title="${idrOff ? 'InDrive is OUT of the UE — click to bring it back' : 'Click to remove the InDrive benefit from the UE'}">${idrOff ? 'off' : 'on'}</span>`
                  : '') +
              `</button>` +
              (isAdmin ? `<label class="ue-switch"><input type="checkbox" id="ueManual"${manualMode ? ' checked' : ''}/><span>Manual mode</span></label>` : '') +
              `<button class="ue-tool-btn" id="ueRefresh" title="Re-fetches the spreadsheet data">↻ Refresh</button>`) +
            `<button class="ue-tool-btn ue-info-btn" id="ueInfo" title="Where each line comes from and how it updates">?</button>` +
          `</div>` +
        `</div>` +
        (cleanView ? '' : contractBar) +
        (cleanView ? '' :
        `<div class="ue-sliders">` +
          slider('ueCotacao', 'future FX (R$/US$)', 3, 8, 0.05, cotacao) +
          // por PAGAMENTO: a faixa útil é de poucos %, então passo de 0,1 (o histórico dá ~1,1%)
          slider('ueInad', 'delinquency rate (%)', 0, 20, 0.1, inadimplencia, inadHint()) +
          slider('ueLate', 'late-payment rate (%)', 0, 100, 1, latePct) +
          slider('ueTermPct', 'termination fee recovery (%)', 0, 100, 1, termPct) +
        `</div>`);
      const infoBtn = document.getElementById('ueInfo');
      if (infoBtn) infoBtn.addEventListener('click', openInfoModal);
      const partsBtn = document.getElementById('ueParts');
      if (partsBtn) partsBtn.addEventListener('click', () => openPartsModal(f));
      // o mesmo botão faz as duas coisas: a pílula on/off liga e desliga o efeito, o resto abre o painel
      const idrBtn = document.getElementById('ueIndrive');
      if (idrBtn) idrBtn.addEventListener('click', (ev) => {
        if (ev.target && ev.target.id === 'ueIdrToggle') { ev.stopPropagation(); idrOff = !idrOff; loadFleet(true); return; }
        openIndriveModal(f);
      });
      const projBtn = document.getElementById('ueProj');
      if (projBtn) projBtn.addEventListener('click', () => { showProj = !showProj; loadFleet(true); });
      const cleanBtn = document.getElementById('ueClean');
      if (cleanBtn) cleanBtn.addEventListener('click', () => { cleanView = !cleanView; loadFleet(true); });
      const inadHist = document.getElementById('ueInadHist');
      if (inadHist) inadHist.addEventListener('click', async () => {
        const r = churnRate(); if (r == null) return;
        inadimplencia = r;
        if (isAdmin) { try { await fetch('/api/ue/value', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fleet: '__cfg__', line: '__inadimplencia__', period: 0, value: r, kind: 'proj' }) }); } catch (e) {} }
        loadFleet(true);
      });
      if (isAdmin && !cleanView) document.getElementById('ueManual').addEventListener('change', (e) => { manualMode = e.target.checked; renderTable(f); });
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
      wireSlider('ueInad', (v) => { inadimplencia = v; }, () => String(Math.round(inadimplencia * 10) / 10).replace('.', ',') + '%', () => inadimplencia, '__inadimplencia__', '__cfg__', f);
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
      // a linha combinada da planilha vira duas na tela (venda + InDrive); o orçado dela fica na venda
      const baseLines = orc.lines.flatMap((l) => (l.label === 'Initial Fee / Vehicle Sell'
        ? [{ label: 'Vehicle Sell', group: 'inflow', values: [] }, { label: 'InDrive bonus', group: 'inflow', values: [] }]
        : [l]));
      const subIdx = baseLines.findIndex((l) => l.label === 'Subscription');
      let lines = subIdx < 0 ? baseLines
        : [...baseLines.slice(0, subIdx + 1),
           { label: 'Late-payment interest', group: 'inflow', values: [] },
           { label: 'Traffic fines', group: 'inflow', values: [] },
           { label: 'Termination fee', group: 'inflow', values: [] },
           ...baseLines.slice(subIdx + 1)];
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
      // agregado = soma de 50 carros: os números passam de 7 dígitos e, com table-layout fixed +
      // nowrap, transbordavam ~7px para a coluna vizinha. Fonte/padding menores nessa visão só.
      tbl.classList.toggle('ue-agg', !!viewAgg && !plateView);
      if (editable) {
        tbl.querySelectorAll('.ue-editable').forEach((td) => td.addEventListener('click', () => openEditor(td, f)));
        tbl.querySelectorAll('.ue-param-label').forEach((el) => el.addEventListener('click', () => openParamModal(el.dataset.pline, f)));
      }
      // no modo limpo a legenda some junto com o resto dos detalhes (só sobra a tabela e a TIR)
      document.getElementById('ueFoot').innerHTML = cleanView ? ''
        : '<span class="ue-tag ue-tag-real">Actual</span>'
          + (showProj ? '<span class="ue-tag ue-tag-proj">Projected</span>' : '')
          + '<span class="ue-tag ue-tag-orc">Budget</span>';
      renderIrr(T);
    }

    // TIR (IRR) do contrato: fluxo de caixa líquido M0..M13 da visão atual. Mensal = taxa por
    // período do UE (janela de 4,333 semanas); anual = (1 + mensal)^12 − 1.
    function renderIrr(T) {
      const el = document.getElementById('ueIrr'); if (!el) return;
      const flows = [];
      for (let p = 0; p <= PMAX; p++) { const c = T.net[p]; flows.push(c ? (c.hasMain ? c.eff : (c.orc || 0)) : 0); }
      const rM = irrOf(flows);
      const cur = currency === 'BRL' ? 'R$' : 'US$';
      const netTot = flows.reduce((a, b) => a + b, 0);
      const invested = -flows.filter((v) => v < 0).reduce((a, b) => a + b, 0);
      // payback = primeiro mês em que o acumulado vira positivo
      let acc = 0, payback = null;
      for (let p = 0; p <= PMAX; p++) { acc += flows[p]; if (payback == null && acc > 0) payback = p; }
      const pct = (v) => (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
      const money = (v) => cur + ' ' + Math.round(Math.abs(v)).toLocaleString('pt-BR') ;
      if (rM == null) {
        const why = netTot < 0
          ? `the contract does not pay the invested cash back in this view (net ${cur} ${Math.round(netTot).toLocaleString('pt-BR')} over M0–M${PMAX}), so there is no rate that zeroes the NPV.`
          : `the net cashflow never turns negative in this view — with no outlay to discount there is no IRR.`;
        el.innerHTML = `<div class="irr-panel irr-na"><div class="irr-na-txt"><b>IRR not defined</b><span>${why}</span></div></div>`;
        return;
      }
      // TIR só significa alguma coisa quando existe um desembolso relevante para remunerar.
      // Na frota 1, por exemplo, não houve calção: o "investido" é só a preparação do carro, e
      // dividir um ano de mensalidades por uma base quase nula explode a taxa (centenas de % a.m.)
      // sem dizer nada sobre o negócio. Nesse caso mostramos o retorno em CAIXA, que é o que vale.
      const inflowTot = flows.filter((v) => v > 0).reduce((a, b) => a + b, 0);
      // dois gatilhos: base de desembolso irrelevante (< 10% do que entra) ou taxa fora de qualquer
      // faixa útil (> 20% a.m. ≈ 700% a.a.) — nos dois casos a TIR vira ruído, não informação
      const semCalcao = invested < inflowTot * 0.10;
      const absurda = rM > 0.20;
      if (semCalcao || absurda) {
        const mult = invested > 0 ? (netTot / invested) : null;
        const porque = semCalcao
          ? `Almost no cash goes in up front (${money(invested)} against ${money(inflowTot)} of inflows — this fleet has no sub-rental deposit), so the rate that zeroes the NPV runs away from any useful range.`
          : `The upfront outlay is small next to a full year of subscriptions, so the rate compounds to a number that no longer compares to anything.`;
        el.innerHTML =
          `<div class="irr-panel irr-thin">` +
            `<div class="irr-main">` +
              `<div class="irr-kpi"><span class="irr-lbl">IRR not meaningful here</span>` +
                `<b class="irr-big irr-year">${money(netTot)}</b>` +
                `<span class="irr-sub">net cash per car over M0–M${PMAX} — use this instead</span></div>` +
            `</div>` +
            `<div class="irr-side">` +
              `<div class="irr-facts">` +
                `<div><span>Cash invested</span><b>${money(invested)}</b></div>` +
                `<div><span>Return on cash</span><b class="${netTot >= 0 ? 'up' : 'down'}">${mult == null ? '—' : (mult >= 0 ? '' : '−') + Math.abs(mult).toFixed(1) + '×'}</b></div>` +
                `<div><span>Payback</span><b>${payback == null ? 'not reached' : 'M' + payback}</b></div>` +
              `</div>` +
              `<div class="irr-why">${porque} The IRR would read ${pct(rM)} a month (${pct(Math.pow(1 + rM, 12) - 1)} a year).</div>` +
            `</div>` +
          `</div>`;
        return;
      }
      const rA = Math.pow(1 + rM, 12) - 1;
      const good = rM > 0;
      // barrinha: posição da TIR mensal numa escala de −10% a +30%
      const gaugePct = Math.max(0, Math.min(100, ((rM * 100) + 10) / 40 * 100));
      el.innerHTML =
        `<div class="irr-panel${good ? '' : ' neg'}">` +
          `<div class="irr-main">` +
            `<div class="irr-kpi"><span class="irr-lbl">Monthly IRR</span><b class="irr-big">${pct(rM)}</b><span class="irr-sub">per UE month (4.33 weeks)</span></div>` +
            `<div class="irr-sep"></div>` +
            `<div class="irr-kpi"><span class="irr-lbl">Annual IRR</span><b class="irr-big irr-year">${pct(rA)}</b><span class="irr-sub">(1 + monthly)<sup>12</sup> − 1</span></div>` +
          `</div>` +
          `<div class="irr-side">` +
            `<div class="irr-gauge"><div class="irr-gauge-track"><span class="irr-gauge-zero" style="left:25%"></span>` +
              `<span class="irr-gauge-pin" style="left:${gaugePct.toFixed(1)}%"></span></div>` +
              `<div class="irr-gauge-scale"><span>−10%</span><span>0</span><span>+30%</span></div></div>` +
            `<div class="irr-facts">` +
              `<div><span>Cash invested</span><b>${money(invested)}</b></div>` +
              `<div><span>Net over the contract</span><b class="${netTot >= 0 ? 'up' : 'down'}">${netTot < 0 ? '−' : ''}${money(netTot)}</b></div>` +
              `<div><span>Payback</span><b>${payback == null ? 'not reached' : 'M' + payback}</b></div>` +
            `</div>` +
          `</div>` +
        `</div>`;
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
      await loadIndrive();
      loadFleet();
    })();
  }
  }
})();

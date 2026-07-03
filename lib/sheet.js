// Busca uma aba do Google Sheets como CSV (endpoint gviz) e parseia.
const { parse } = require('csv-parse/sync');
const { SHEET_ID, TAB_GIDS } = require('../config/static');

function tabUrl(tab) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
}
// endpoint /export: devolve o VALOR EXIBIDO (sem inferência de tipo do gviz, que
// descarta células destoantes — ex.: datas gravadas como texto). Exige gid da aba.
function gidUrl(gid) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${encodeURIComponent(gid)}`;
}

const parseCsv = (text) => parse(text, { relax_column_count: true, skip_empty_lines: false, bom: true });

async function fetchTab(tab, gid) {
  // se um gid for informado, usa /export (preserva valores de display); senão, gviz por nome
  const url = gid ? gidUrl(gid) : tabUrl(tab);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Falha ao buscar aba "${tab}": HTTP ${res.status}`);
  return parseCsv(await res.text());
}

// aba opcional: falha não derruba o refresh (a seção mostra aviso)
const optional = (tab, tag) => (tab ? fetchTab(tab).catch((e) => { console.error(`[${tag}] aba "${tab}" falhou:`, e.message); return null; }) : Promise.resolve(null));

// aba via /export (por gid), com fallback pro gviz por nome se o export falhar —
// assim uma indisponibilidade do export não derruba uma aba obrigatória, só perde
// os valores de display que o gviz descarta (datas em texto etc.)
const viaGid = (tab, gid) => fetchTab(tab, gid).catch((e) => { console.error(`[export] aba "${tab}" (gid ${gid}) falhou, usando gviz:`, e.message); return fetchTab(tab); });

async function fetchAllTabs(tabs) {
  const [importData, ocorrencias, clientes, rh, leads, time, funil, leadsInDrive, perfInDrive, carrosEsperados] = await Promise.all([
    fetchTab(tabs.importData),
    viaGid(tabs.ocorrencias, TAB_GIDS.ocorrencias),
    fetchTab(tabs.clientes),
    optional(tabs.rh, 'rh'),
    optional(tabs.leads, 'leads'),
    optional(tabs.time, 'time'),
    optional(tabs.funil, 'funil'),
    optional(tabs.leadsInDrive, 'leadsInDrive'),
    optional(tabs.perfInDrive, 'perfInDrive'),
    optional(tabs.carrosEsperados, 'carrosEsperados'),
  ]);
  return { importData, ocorrencias, clientes, rh, leads, time, funil, leadsInDrive, perfInDrive, carrosEsperados };
}

// Busca as abas de Unit Economics (uma por modelo). Falha de uma não derruba as outras.
async function fetchUeTabs(ueTabs) {
  const entries = await Promise.all(
    Object.entries(ueTabs).map(async ([model, tab]) => {
      try { return [model, await fetchTab(tab)]; }
      catch (e) { console.error(`[ue] aba "${tab}" falhou:`, e.message); return [model, null]; }
    })
  );
  return Object.fromEntries(entries);
}

module.exports = { fetchTab, fetchAllTabs, fetchUeTabs };

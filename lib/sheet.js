// Busca uma aba do Google Sheets como CSV (endpoint gviz) e parseia.
const { parse } = require('csv-parse/sync');
const { SHEET_ID } = require('../config/static');

function tabUrl(tab) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
}

async function fetchTab(tab) {
  const res = await fetch(tabUrl(tab), { redirect: 'follow' });
  if (!res.ok) throw new Error(`Falha ao buscar aba "${tab}": HTTP ${res.status}`);
  const text = await res.text();
  // relax_column_count: linhas com nº de colunas variável; sem header (acessamos por índice)
  return parse(text, { relax_column_count: true, skip_empty_lines: false, bom: true });
}

// aba opcional: falha não derruba o refresh (a seção mostra aviso)
const optional = (tab, tag) => (tab ? fetchTab(tab).catch((e) => { console.error(`[${tag}] aba "${tab}" falhou:`, e.message); return null; }) : Promise.resolve(null));

async function fetchAllTabs(tabs) {
  const [importData, ocorrencias, clientes, rh, leads, time, funil] = await Promise.all([
    fetchTab(tabs.importData),
    fetchTab(tabs.ocorrencias),
    fetchTab(tabs.clientes),
    optional(tabs.rh, 'rh'),
    optional(tabs.leads, 'leads'),
    optional(tabs.time, 'time'),
    optional(tabs.funil, 'funil'),
  ]);
  return { importData, ocorrencias, clientes, rh, leads, time, funil };
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

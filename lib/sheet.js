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

async function fetchAllTabs(tabs) {
  const [importData, ocorrencias, clientes] = await Promise.all([
    fetchTab(tabs.importData),
    fetchTab(tabs.ocorrencias),
    fetchTab(tabs.clientes),
  ]);
  return { importData, ocorrencias, clientes };
}

module.exports = { fetchTab, fetchAllTabs };

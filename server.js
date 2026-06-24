const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve o dashboard estatico (publico, somente leitura)
app.use(express.static(path.join(__dirname, 'public')));

// Healthcheck simples para o Railway
app.get('/health', (_req, res) => res.json({ ok: true }));

// Fallback: qualquer rota cai no index (SPA-ish)
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`OCN KPIs rodando na porta ${PORT}`);
});

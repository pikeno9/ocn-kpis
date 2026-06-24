# OCN — Dashboard de KPIs

Dashboard interno de KPIs da One Car Now. Frentes: **Operação** (Frota, Ocorrências, Unit Economics), **Comercial** e **Recursos Humanos**.

Site público (somente leitura). O login de admin para edição entra na **v2**.

## Stack
- Node + Express (servidor estático)
- Chart.js para os gráficos
- Sem build step — HTML/CSS/JS puro em `public/`

## Rodar localmente
```bash
npm install
npm start
# abre em http://localhost:3000
```

## Estrutura
```
ocn-kpis-site/
├── server.js          # Express: serve public/ + /health
├── package.json
├── railway.json       # config de deploy do Railway
└── public/
    ├── index.html     # estrutura: abas e seções
    ├── styles.css     # identidade visual OCN
    ├── data.js        # TODOS os números do dashboard (editar aqui)
    └── app.js         # gráficos e navegação
```

## Onde mexer nos dados
Tudo em `public/data.js`. Os números vêm da planilha `import_data` (Google Sheets)
e do calendário de recebimento (PPTX), consolidados em 24/06/2026.

## Deploy (Railway)
1. Push do repositório para o GitHub.
2. No Railway: **New Project → Deploy from GitHub repo** → selecionar este repo.
3. O Railway detecta Node, roda `npm install` e `npm start` automaticamente.
4. Gerar o domínio público em **Settings → Networking → Generate Domain**.

## Roadmap
- **v1 (atual):** site público, dados consolidados em `data.js`, seção Frota completa.
- **v2:** login de admin + edição pelo site + sincronização ao vivo com a planilha.

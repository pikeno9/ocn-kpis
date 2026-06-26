# OCN — Dashboard de KPIs

Dashboard interno de KPIs da One Car Now. Frentes: **Operação** (Frota, Ocorrências, Unit Economics), **Comercial** e **Recursos Humanos**.

Os dados são **lidos e recalculados da planilha Google** automaticamente (atualização diária). Site público (somente leitura); login de admin para edição entra na v2.

## Stack
- Node + Express
- Chart.js (gráficos), sem build step no front (HTML/CSS/JS puro em `public/`)
- `csv-parse` (lê as abas da planilha via endpoint CSV) + `node-cron` (agendador)

## Como os dados funcionam
1. Na subida e a cada execução do cron, o servidor busca 3 abas da planilha (`import_data`, `Ocorrencias`, `import_clientes`).
2. `lib/compute.js` recalcula todos os KPIs (mesma lógica da análise original, com as exceções vindas de `config/static.js`).
3. O resultado fica em cache e é servido em `GET /api/data`.
4. O front (`public/app.js`) consome `/api/data`; se falhar, usa o snapshot fallback `public/data.js`.

**Ao vivo vs. estático:** recebidos, status (coluna Q), ocorrências e contratos vêm da planilha. O **calendário/esperado de recebimento** e as **regras de exceção** ficam em `config/static.js` (o calendário muda pouco; será movido para uma aba da planilha no futuro).

## Estrutura
```
ocn-kpis-site/
├── server.js            # Express + /api/data + cron diário
├── config/static.js     # calendário/esperado, regras de exceção, cores, rótulos
├── lib/
│   ├── sheet.js         # busca as abas (CSV) da planilha
│   └── compute.js       # recalcula todos os KPIs
└── public/
    ├── index.html
    ├── styles.css
    ├── app.js           # consome /api/data (data.js = fallback)
    └── data.js          # snapshot fallback
```

## Autenticação (site inteiro atrás de login)
O site é protegido por login (id + senha). Credenciais ficam em variáveis de ambiente — nunca no código (repo público).

**Configurar (no Railway → Variables):**
1. Gere o hash de cada senha localmente:
   ```bash
   npm run hash -- "a-senha-do-usuario"
   ```
2. Monte `AUTH_USERS` (JSON em uma linha) com os hashes:
   ```
   AUTH_USERS=[{"login":"enrico","name":"Enrico","role":"admin","hash":"$2a$10$..."}]
   ```
3. Gere e defina `SESSION_SECRET`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. Redeploy. Pronto: `/login` valida e cria um cookie de sessão (httpOnly, 7 dias).

> Em produção (Railway), se `AUTH_USERS` não estiver definido, **ninguém loga** (fail-closed). Localmente, sem `AUTH_USERS`, há um usuário de dev `dev`/`dev` (nunca ativo no Railway).

## Variáveis de ambiente
- `AUTH_USERS` — JSON dos usuários com hash bcrypt (obrigatório em produção).
- `SESSION_SECRET` — segredo que assina o cookie de sessão (defina um valor fixo forte).
- `PORT` — porta (Railway injeta automaticamente).
- `CRON_SCHEDULE` — agenda do refresh. Default `0 5 * * *` (05:00 America/Sao_Paulo). Ex.: `0 */6 * * *`.
- `REFERENCE_DATE` — data de referência para os cálculos (ex.: `2026-06-24`). Default: hoje.

## Endpoints
- `GET /api/data` — KPIs computados (+ `_meta.updatedAt`, `_meta.live`).
- `GET /api/refresh` — força um refresh na hora.
- `GET /health` — status do servidor e do último refresh.

## Rodar localmente
```bash
npm install
npm start          # http://localhost:3000
```

## Deploy (Railway)
1. Push para o GitHub.
2. Railway → **Deploy from GitHub repo** → seleciona o repo. Detecta Node, roda `npm install` e `npm start`.
3. **Settings → Networking → Generate Domain** para a URL pública.
> Atenção: como os dados são lidos da planilha, o servidor precisa estar rodando (no Railway) para o dashboard atualizar.

## Onde mexer nos dados / regras
- Calendário/esperado e exceções: `config/static.js`.
- Lógica de cálculo: `lib/compute.js`.
- Cores/rótulos de status, tipos de ocorrência, etc.: `config/static.js`.

## Roadmap
- **v2:** login de admin + edição pelo site; mover calendário/esperado para uma aba da planilha.

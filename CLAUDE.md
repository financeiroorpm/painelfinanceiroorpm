# Sistema Financeiro ORPM

Controle de boletos a pagar e a receber de uma empresa pequena. Roda em um PC ou servidor **Windows** na rede local e é acessado pelo navegador. Quem usa e mantém fala português: **toda a interface, as mensagens de erro, os comentários e os nomes no código ficam em português do Brasil**, com uma linguagem simples, sem jargão técnico na tela.

## Como rodar

- `npm install` e depois `npm run dev`: liga em http://localhost:3000, com o banco em `dados/financeiro.db`.
- `npm test`: roda os testes (node:test, sem dependência extra). **Rode antes de cada commit e mantenha tudo passando.**
- Variáveis opcionais: `PORT`, `HOST`, `DATA_DIR`, `DIAS_SESSAO`, `BACKUPS_GUARDADOS`, `COOKIE_SEGURO=1` (só atrás de HTTPS).

## Arquitetura (sem etapa de build, de propósito)

- `src/server.js`: abre o banco, agenda os backups e sobe o servidor HTTP.
- `src/app.js`: monta o app Express com **todas as rotas da API** (`/api/...`) e serve `public/`. Recebe o `db` por parâmetro, e os testes usam um banco em memória.
- `src/db.js`: abre o SQLite (better-sqlite3, WAL), aplica as migrações e faz o backup.
- `src/boletos.js`: regras de negócio dos boletos (validar, criar parcelas, editar, pagar, cancelar, histórico). **Toda alteração em boleto grava uma linha na tabela `historico`** com o antes e o depois.
- `src/auth.js`: senhas com scrypt, sessão em cookie HttpOnly guardada na tabela `sessoes`, papéis, proteção de origem (CSRF) e limite de tentativas de login.
- `src/importar.js`: lê as planilhas antigas (.xlsx exportado do Google Planilhas). A cor de fundo do nome dá a situação.
- `src/util.js`: funções puras (números em R$, datas BR, meses). `public/comum.js` repete algumas para o navegador; **se mudar uma regra, mude nos dois**.
- `public/`: HTML, CSS e JavaScript puro (módulos ES), sem framework. Há `index.html`/`app.js` (painel), `admin.html`/`admin.js` (usuários e importação) e `login.html`. O gráfico usa o d3, servido de `node_modules` em `/vendor/d3.min.js` (funciona sem internet).

## Regras importantes

- **Dinheiro sempre em centavos inteiros** (`valor_centavos`). Nunca use float no banco.
- **Datas** são texto ISO `AAAA-MM-DD`. "Hoje" é sempre calculado no fuso `America/Sao_Paulo` (`hojeBR()`).
- "Atrasado" não é gravado: é calculado (`situacao = 'aberto'` e vencimento antes de hoje).
- Boleto **nunca é apagado**: cancelar muda a `situacao` para `'cancelado'`, e o boleto continua no histórico.
- Papéis: `admin` faz tudo; `financeiro` lança, edita e dá baixa; `leitura` só vê. Confira o papel no servidor (`exigirPapel`), não só escondendo botão na tela.

## Como mudar o banco

Crie um arquivo novo em `migrations/` com o próximo número (`002_algo.sql`, `003_...`). Ele roda sozinho uma vez quando o servidor liga. **Nunca edite uma migração que já foi usada**, porque o servidor do cliente já rodou a antiga. Prefira `ALTER TABLE ... ADD COLUMN`.

## Instalação no cliente

Os scripts ficam em `scripts/windows/` (instalar, atualizar, parar, desinstalar). Eles rodam no Windows PowerShell 5.1, então **devem ficar só com caracteres ASCII** (sem acento), senão o texto sai embaralhado. A atualização no cliente é `git pull` + `npm ci`, feita pelo `atualizar.ps1`. Por isso, mudanças que precisem de um passo manual devem ir para uma migração ou para o script.

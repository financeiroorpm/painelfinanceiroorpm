-- Estrutura inicial do sistema financeiro ORPM.
-- Valores em centavos (inteiro) para nunca ter erro de arredondamento.
-- Datas em texto ISO (AAAA-MM-DD); data e hora em ISO com fuso (UTC).

CREATE TABLE usuarios (
  id           INTEGER PRIMARY KEY,
  nome         TEXT NOT NULL,
  login        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash   TEXT NOT NULL,
  papel        TEXT NOT NULL CHECK (papel IN ('admin', 'financeiro', 'leitura')),
  ativo        INTEGER NOT NULL DEFAULT 1,
  criado_em    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE sessoes (
  token_hash   TEXT PRIMARY KEY,
  usuario_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em    TEXT NOT NULL,
  criado_em    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE boletos (
  id              INTEGER PRIMARY KEY,
  tipo            TEXT NOT NULL CHECK (tipo IN ('receber', 'pagar')),
  com_nota        INTEGER NOT NULL DEFAULT 1,          -- só faz sentido em "pagar"
  nome            TEXT NOT NULL,                       -- cliente ou fornecedor
  valor_centavos  INTEGER NOT NULL CHECK (valor_centavos > 0),
  vencimento      TEXT NOT NULL,                       -- AAAA-MM-DD
  data_compra     TEXT,
  documento       TEXT,                                -- número do documento (pagar)
  nf_servico      TEXT,
  nf_peca         TEXT,
  os              TEXT,
  banco           TEXT,
  observacao      TEXT,
  situacao        TEXT NOT NULL DEFAULT 'aberto' CHECK (situacao IN ('aberto', 'pago', 'cancelado')),
  marcador        TEXT,                                -- ex.: 'amarelo' (vindo da cor da planilha)
  pago_em         TEXT,
  pago_por        INTEGER REFERENCES usuarios(id),
  grupo_parcelas  TEXT,                                -- mesmo valor em todas as parcelas de um lançamento
  parcela         INTEGER,
  total_parcelas  INTEGER,
  conferir_motivo TEXT,                                -- preenchido quando a importação achou algo estranho
  origem          TEXT NOT NULL DEFAULT 'sistema',     -- 'sistema' ou 'planilha'
  origem_ref      TEXT UNIQUE,                         -- evita importar a mesma linha duas vezes
  criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  criado_por      INTEGER REFERENCES usuarios(id),
  atualizado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX boletos_venc ON boletos (vencimento);
CREATE INDEX boletos_tipo_sit ON boletos (tipo, situacao);

-- Tudo o que acontece com um boleto: quem fez, quando, e como estava antes e depois.
CREATE TABLE historico (
  id          INTEGER PRIMARY KEY,
  boleto_id   INTEGER NOT NULL REFERENCES boletos(id),
  usuario_id  INTEGER REFERENCES usuarios(id),
  acao        TEXT NOT NULL,
  antes       TEXT,
  depois      TEXT,
  em          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX historico_boleto ON historico (boleto_id);

-- Linhas da planilha que não deu para importar (valor ou data ilegível).
CREATE TABLE pendencias (
  id            INTEGER PRIMARY KEY,
  tipo          TEXT NOT NULL,
  com_nota      INTEGER NOT NULL DEFAULT 1,
  aba           TEXT NOT NULL,
  linha         INTEGER NOT NULL,
  nome          TEXT,
  valor_texto   TEXT,
  venc_texto    TEXT,
  documento     TEXT,
  motivo        TEXT NOT NULL,
  origem_ref    TEXT UNIQUE,
  resolvida     INTEGER NOT NULL DEFAULT 0,
  criado_em     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

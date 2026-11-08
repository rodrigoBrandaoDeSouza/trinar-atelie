-- Esquema do banco do Trinar Ateliê Criativo.
-- Idempotente: pode rodar a cada deploy (o Procfile roda no "release").

CREATE TABLE IF NOT EXISTS usuarios (
  id          SERIAL PRIMARY KEY,
  nome        TEXT NOT NULL DEFAULT 'Administradora',
  email       TEXT NOT NULL UNIQUE,
  senha_hash  TEXT NOT NULL,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cursos (
  id            SERIAL PRIMARY KEY,
  nome          TEXT NOT NULL,
  nivel         TEXT NOT NULL DEFAULT '',
  descricao     TEXT NOT NULL DEFAULT '',
  horario       TEXT NOT NULL DEFAULT '',
  vagas         INTEGER NOT NULL CHECK (vagas > 0),
  valor_mensal  NUMERIC(10,2) NOT NULL CHECK (valor_mensal >= 0),
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,
  cor           TEXT NOT NULL DEFAULT '#D9C9B4',
  ordem         INTEGER NOT NULL DEFAULT 0,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alunas (
  id          SERIAL PRIMARY KEY,
  nome        TEXT NOT NULL,
  whatsapp    TEXT NOT NULL,
  email       TEXT,
  nascimento  DATE,
  observacoes TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matriculas (
  id               SERIAL PRIMARY KEY,
  aluna_id         INTEGER NOT NULL REFERENCES alunas(id) ON DELETE CASCADE,
  curso_id         INTEGER NOT NULL REFERENCES cursos(id) ON DELETE RESTRICT,
  forma_pagamento  TEXT NOT NULL DEFAULT 'pix' CHECK (forma_pagamento IN ('pix','cartao','boleto','dinheiro')),
  dia_vencimento   INTEGER NOT NULL DEFAULT 10 CHECK (dia_vencimento BETWEEN 1 AND 28),
  inicio           DATE NOT NULL DEFAULT CURRENT_DATE,
  ativa            BOOLEAN NOT NULL DEFAULT TRUE,
  encerrada_em     DATE,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS matriculas_curso_idx ON matriculas (curso_id) WHERE ativa;

CREATE TABLE IF NOT EXISTS mensalidades (
  id               SERIAL PRIMARY KEY,
  matricula_id     INTEGER NOT NULL REFERENCES matriculas(id) ON DELETE CASCADE,
  competencia      DATE NOT NULL,              -- sempre o dia 1 do mês de referência
  vencimento       DATE NOT NULL,
  valor            NUMERIC(10,2) NOT NULL,
  pago_em          TIMESTAMPTZ,
  forma_pagamento  TEXT,
  UNIQUE (matricula_id, competencia)
);
CREATE INDEX IF NOT EXISTS mensalidades_competencia_idx ON mensalidades (competencia);

CREATE TABLE IF NOT EXISTS inscricoes (
  id               SERIAL PRIMARY KEY,
  curso_id         INTEGER NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
  nome             TEXT NOT NULL,
  whatsapp         TEXT NOT NULL,
  email            TEXT,
  nascimento       DATE,
  como_conheceu    TEXT,
  experiencia      TEXT,
  observacoes      TEXT,
  forma_pagamento  TEXT NOT NULL CHECK (forma_pagamento IN ('pix','cartao','boleto')),
  lista_espera     BOOLEAN NOT NULL DEFAULT FALSE,
  status           TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','confirmada','recusada')),
  matricula_id     INTEGER REFERENCES matriculas(id) ON DELETE SET NULL,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  decidido_em      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS inscricoes_status_idx ON inscricoes (status);

-- ---------- WhatsApp ----------

-- Chave para comparar telefones: DDD + últimos 8 dígitos (ignora 55 e o 9º dígito).
CREATE OR REPLACE FUNCTION chave_tel(t TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d TEXT := regexp_replace(COALESCE(t, ''), '\D', '', 'g');
BEGIN
  IF length(d) >= 12 AND left(d, 2) = '55' THEN d := substr(d, 3); END IF;
  IF length(d) < 10 THEN RETURN d; END IF;
  RETURN left(d, 2) || right(d, 8);
END $$;

CREATE TABLE IF NOT EXISTS whatsapp_mensagens (
  id            SERIAL PRIMARY KEY,
  telefone      TEXT NOT NULL,                      -- só dígitos, com 55
  chave         TEXT GENERATED ALWAYS AS (chave_tel(telefone)) STORED,
  direcao       TEXT NOT NULL CHECK (direcao IN ('entrada','saida')),
  texto         TEXT NOT NULL,
  tipo          TEXT NOT NULL DEFAULT 'manual',     -- manual, inscricao_recebida, boas_vindas, lembrete, cobranca, aviso_turma, aviso_dona, celular
  status        TEXT NOT NULL DEFAULT 'enviada' CHECK (status IN ('enviada','erro','recebida')),
  erro          TEXT,
  wa_id         TEXT UNIQUE,                        -- id da mensagem no WhatsApp (evita duplicar)
  nome_contato  TEXT,
  lida          BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_mensagens_chave_idx ON whatsapp_mensagens (chave, criado_em DESC);
CREATE INDEX IF NOT EXISTS whatsapp_mensagens_nao_lidas_idx ON whatsapp_mensagens (chave) WHERE NOT lida;

CREATE TABLE IF NOT EXISTS configuracoes (
  chave  TEXT PRIMARY KEY,
  valor  JSONB NOT NULL
);

ALTER TABLE mensalidades ADD COLUMN IF NOT EXISTS lembrete_enviado_em TIMESTAMPTZ;
ALTER TABLE mensalidades ADD COLUMN IF NOT EXISTS cobranca_enviada_em TIMESTAMPTZ;

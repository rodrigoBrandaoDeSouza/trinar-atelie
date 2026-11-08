-- Cursos de exemplo, inseridos só se a tabela estiver vazia.
-- Edite ou desative pelo painel depois do primeiro deploy.
INSERT INTO cursos (nome, nivel, descricao, horario, vagas, valor_mensal, cor, ordem)
SELECT * FROM (VALUES
  ('Costura Criativa',  'Iniciante',       'Máquina, moldes e acabamentos para criar suas próprias peças.',                     'Ter e Qui · 19h às 21h', 10, 220.00, '#D9C9B4', 1),
  ('Bordado Livre',     'Todos os níveis', 'Pontos clássicos e contemporâneos em bastidor, do risco ao acabamento.',            'Sáb · 9h às 12h',        12, 180.00, '#F0D9A8', 2),
  ('Crochê do Zero',    'Iniciante',       'Correntinha, pontos básicos e as primeiras peças: bolsas, tapetes e amigurumis.',   'Qua · 14h às 16h',        8, 160.00, '#C9D6CC', 3),
  ('Pintura em Tecido', 'Todos os níveis', 'Pintura à mão livre e com estêncil em panos, roupas e decoração.',                  'Seg · 19h às 21h',       10, 170.00, '#E8C6B8', 4),
  ('Macramê',           'Iniciante',       'Nós e tramas para painéis, suportes de plantas e acessórios.',                       'Sex · 15h às 17h',        8, 150.00, '#DCD3C2', 5),
  ('Ateliê Kids',       '7 a 12 anos',     'Criatividade e coordenação com costura simples, pintura e reciclagem.',             'Sáb · 14h às 16h',       10, 190.00, '#CFD9E3', 6)
) AS v(nome, nivel, descricao, horario, vagas, valor_mensal, cor, ordem)
WHERE NOT EXISTS (SELECT 1 FROM cursos);

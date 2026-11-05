-- Guarda de qual aba da planilha o boleto veio, para a reimportação saber
-- o que foi pago, alterado ou apagado na planilha.
ALTER TABLE boletos ADD COLUMN origem_aba TEXT;

UPDATE boletos
SET origem_aba = substr(observacao, 29, instr(observacao, '", linha') - 29)
WHERE origem = 'planilha' AND observacao LIKE 'Importado da planilha (aba "%", linha %';

CREATE INDEX boletos_origem ON boletos (origem, tipo, origem_aba);

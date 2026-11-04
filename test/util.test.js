import test from 'node:test';
import assert from 'node:assert/strict';
import { lerNumero, lerData, lerDataCompra, mesDoNome, somarMeses, dataValida } from '../src/util.js';
import { mesDaAba } from '../src/importar.js';

test('lerNumero entende os formatos das planilhas', () => {
  assert.equal(lerNumero('R$ 1.033,00'), 1033);
  assert.equal(lerNumero('R$ 1385,00'), 1385);
  assert.equal(lerNumero('R$ 540,20'), 540.2);
  assert.equal(lerNumero('1.250'), 1250);
  assert.equal(lerNumero('12.5'), 12.5);
  assert.equal(lerNumero(''), null);
  assert.equal(lerNumero('abc'), null);
});

test('lerData aceita ano com 2 ou 4 dígitos e recusa datas impossíveis', () => {
  assert.equal(lerData('2/11/2026'), '2026-11-02');
  assert.equal(lerData('01/11/26'), '2026-11-01');
  assert.equal(lerData('31/02/2026'), null);
  assert.equal(lerData('1/11'), null);
});

test('lerDataCompra completa o ano pela data de vencimento', () => {
  assert.equal(lerDataCompra('21/out.', '2026-11-02'), '2026-10-21');
  assert.equal(lerDataCompra('08/outubro', '2026-11-01'), '2026-10-08');
  assert.equal(lerDataCompra('15/dez', '2027-01-10'), '2026-12-15');
  assert.equal(lerDataCompra('', '2027-01-10'), null);
});

test('mês pelo nome da aba, inclusive com erro de digitação', () => {
  assert.equal(mesDoNome('Feveiro'), 2);
  assert.equal(mesDaAba(' MARÇO 2027', 2026), '2027-03');
  assert.equal(mesDaAba('agosto', 2026), '2026-08');
  assert.equal(mesDaAba('Resumo', 2026), null);
});

test('somarMeses segura o fim do mês', () => {
  assert.equal(somarMeses('2026-01-31', 1), '2026-02-28');
  assert.equal(somarMeses('2026-11-15', 3), '2027-02-15');
  assert.ok(dataValida('2028-02-29'));
  assert.ok(!dataValida('2027-02-29'));
});

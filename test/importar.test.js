import test from 'node:test';
import assert from 'node:assert/strict';
import { analisarPlanilha, gravarImportacao } from '../src/importar.js';
import { abrirBanco } from '../src/db.js';
import { planilhaPagar, planilhaReceber } from './planilhas-exemplo.js';

test('planilha a pagar: dois blocos, cor = situação, linhas ruins viram pendência', async () => {
  const a = await analisarPlanilha(await planilhaPagar(), 'pagar', 2026);
  const nomes = a.boletos.map((b) => b.nome);
  assert.deepEqual(nomes.sort(), ['DATA LONGE', 'DJKR COBRANÇAS', 'MEGATRUK DISTRIBUIDORA', 'PACAEMBU', 'POSTO SEM NOTA']);
  const pac = a.boletos.find((b) => b.nome === 'PACAEMBU');
  assert.equal(pac.situacao, 'pago');
  assert.equal(pac.valor_centavos, 54020);
  assert.equal(pac.vencimento, '2026-11-02');
  assert.equal(pac.data_compra, '2026-10-21');
  assert.equal(pac.com_nota, 1);
  assert.equal(a.boletos.find((b) => b.nome === 'DJKR COBRANÇAS').marcador, 'amarelo');
  assert.equal(a.boletos.find((b) => b.nome === 'POSTO SEM NOTA').com_nota, 0);
  assert.match(a.boletos.find((b) => b.nome === 'DATA LONGE').conferir_motivo, /longe do mês/);
  assert.equal(a.pendencias.length, 1);
  assert.equal(a.pendencias[0].motivo, 'Valor ilegível');
  assert.ok(a.abas.find((x) => x.aba === 'Resumo').ignorada);
});

test('planilha a receber: acha colunas pelo cabeçalho, pula cancelados, lê números e datas reais', async () => {
  const a = await analisarPlanilha(await planilhaReceber(), 'receber', 2026);
  assert.equal(a.boletos.length, 3);
  const igm = a.boletos.find((b) => b.nome.startsWith('IGM'));
  assert.equal(igm.os, '55');
  assert.equal(igm.banco, 'BANESTES');
  assert.equal(igm.nf_servico, '2908');
  assert.equal(igm.situacao, 'aberto');
  assert.equal(a.boletos.find((b) => b.nome.startsWith('CAMPE')).situacao, 'pago');
  const jm = a.boletos.find((b) => b.nome === 'JM BERGAMINI');
  assert.equal(jm.valor_centavos, 122625);
  assert.equal(jm.vencimento, '2026-11-02');
});

test('importar duas vezes não duplica', async () => {
  const db = abrirBanco(':memory:');
  const a = { ...(await analisarPlanilha(await planilhaPagar(), 'pagar', 2026)) };
  const r1 = gravarImportacao(db, [a], null);
  const r2 = gravarImportacao(db, [a], null);
  assert.equal(r1.novos, 5);
  assert.equal(r1.pendencias, 1);
  assert.equal(r2.novos, 0);
  assert.equal(r2.repetidos, 5);
  assert.equal(db.prepare('SELECT COUNT(*) FROM boletos').pluck().get(), 5);
});

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
  const a = await analisarPlanilha(await planilhaPagar(), 'pagar', 2026);
  const r1 = gravarImportacao(db, [{ tipo: 'pagar', ...a }], null);
  const r2 = gravarImportacao(db, [{ tipo: 'pagar', ...a }], null);
  assert.equal(r1.novos, 5);
  assert.equal(r1.pendenciasNovas, 1);
  assert.deepEqual(Object.values(r2).filter((n) => n > 0), [], 'segunda importação igual não muda nada');
  assert.equal(db.prepare('SELECT COUNT(*) FROM boletos').pluck().get(), 5);
});

test('reimportar sincroniza: pagos, apagados, alterados e o que foi pago pelo sistema', async () => {
  const db = abrirBanco(':memory:');
  db.prepare("INSERT INTO usuarios (id, nome, login, senha_hash, papel) VALUES (1, 'Ana', 'ana', 'x', 'financeiro')").run();
  const ler = async (buf) => ({ tipo: 'pagar', ...(await analisarPlanilha(buf, 'pagar', 2026)) });
  gravarImportacao(db, [await ler(await planilhaPagar())], 1);
  const id = (nome) => db.prepare('SELECT id FROM boletos WHERE nome = ?').pluck().get(nome);
  // alguém deu baixa pelo sistema na MEGATRUK
  db.prepare("UPDATE boletos SET situacao = 'pago', pago_por = 1, pago_em = 'x' WHERE id = ?").run(id('MEGATRUK DISTRIBUIDORA'));
  // um boleto lançado direto no sistema não pode ser tocado pela planilha
  db.prepare("INSERT INTO boletos (tipo, nome, valor_centavos, vencimento) VALUES ('pagar', 'SO NO SISTEMA', 100, '2026-11-02')").run();

  // a planilha mudou
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await planilhaPagar());
  const ws = wb.getWorksheet('novembro 2026');
  ws.getCell('C5').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF069A2E' } }; // MEGATRUK pintada (já paga no sistema)
  ws.getCell('C3').fill = { type: 'pattern', pattern: 'none' };                                 // PACAEMBU deixou de estar verde
  ws.getCell('C4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF069A2E' } }; // DJKR paga
  ws.getCell('D7').value = 'R$ 12,00';                                                          // DATA LONGE mudou de valor
  ws.getCell('J3').value = null; ws.getCell('K3').value = null; ws.getCell('L3').value = null;  // POSTO SEM NOTA apagado
  ws.getCell('D6').value = 'R$ 30,00';                                                          // VALOR RUIM foi corrigido
  const plan2 = Buffer.from(await wb.xlsx.writeBuffer());

  const r = gravarImportacao(db, [await ler(plan2)], 1);
  const b = (nome) => db.prepare("SELECT * FROM boletos WHERE nome = ? AND situacao <> 'cancelado'").get(nome);
  assert.equal(b('DJKR COBRANÇAS').situacao, 'pago');
  assert.equal(b('DJKR COBRANÇAS').marcador, null);
  assert.equal(b('PACAEMBU').situacao, 'aberto', 'pago veio da planilha, então segue a planilha');
  assert.equal(b('MEGATRUK DISTRIBUIDORA').pago_por, 1, 'baixa feita no sistema é mantida');
  assert.equal(b('POSTO SEM NOTA'), undefined);
  assert.equal(b('DATA LONGE').valor_centavos, 1200);
  assert.equal(db.prepare("SELECT COUNT(*) FROM boletos WHERE nome = 'DATA LONGE'").pluck().get(), 2, 'o antigo fica cancelado no histórico');
  assert.equal(b('VALOR RUIM').valor_centavos, 3000);
  assert.equal(b('SO NO SISTEMA').situacao, 'aberto');
  assert.deepEqual(r, { novos: 2, pagos: 1, reabertos: 1, cancelados: 2, conferir: 0, pendenciasNovas: 0, pendenciasResolvidas: 1, marcadores: 1 });
  assert.equal(db.prepare('SELECT COUNT(*) FROM pendencias WHERE resolvida = 0').pluck().get(), 0);
  const hist = db.prepare('SELECT acao FROM historico WHERE boleto_id = ? ORDER BY id').pluck().all(b('DJKR COBRANÇAS').id);
  assert.deepEqual(hist, ['importado', 'pago (planilha)', 'marcador (planilha)']);

  // linha paga pelo sistema e depois apagada da planilha vai para "Para conferir", não é cancelada
  ws.getCell('C5').value = null; ws.getCell('D5').value = null; ws.getCell('E5').value = null;
  const r3 = gravarImportacao(db, [await ler(Buffer.from(await wb.xlsx.writeBuffer()))], 1);
  assert.equal(r3.conferir, 1);
  assert.match(b('MEGATRUK DISTRIBUIDORA').conferir_motivo, /não existe mais na planilha/);
});

test('migração 002 descobre a aba de boletos importados antes dela', () => {
  const db = abrirBanco(':memory:');
  db.prepare("INSERT INTO boletos (tipo, nome, valor_centavos, vencimento, origem, origem_ref, observacao) VALUES ('pagar','X',1,'2026-01-01','planilha','r','Importado da planilha (aba \"março 2027\", linha 7)')").run();
  db.prepare('UPDATE boletos SET origem_aba = NULL').run();
  db.exec(`UPDATE boletos SET origem_aba = substr(observacao, 29, instr(observacao, '", linha') - 29) WHERE origem = 'planilha' AND observacao LIKE 'Importado da planilha (aba "%", linha %'`);
  assert.equal(db.prepare('SELECT origem_aba FROM boletos').pluck().get(), 'março 2027');
});

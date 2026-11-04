import test from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco } from '../src/db.js';
import { criarApp } from '../src/app.js';
import { planilhaPagar } from './planilhas-exemplo.js';

// Sobe o app num banco em memória e devolve um "navegador" com cookie próprio
async function subir() {
  const db = abrirBanco(':memory:');
  const srv = criarApp(db).listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const cliente = () => {
    let cookie = '';
    return async (metodo, url, corpo, extra = {}) => {
      const headers = { ...(cookie ? { cookie } : {}), ...(extra.headers || {}) };
      let body;
      if (corpo instanceof FormData) body = corpo;
      else if (corpo !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(corpo); }
      const r = await fetch(base + url, { method: metodo, headers, body });
      const sc = r.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      const txt = await r.text();
      let dados; try { dados = JSON.parse(txt); } catch { dados = txt; }
      return { status: r.status, dados };
    };
  };
  return { db, srv, cliente };
}

test('fluxo completo: configurar, usuários, boletos, permissões, histórico, importação', async (t) => {
  const { srv, cliente } = await subir();
  t.after(() => srv.close());
  const adm = cliente();

  assert.equal((await adm('GET', '/api/estado')).dados.precisaConfigurar, true);
  assert.equal((await adm('GET', '/api/boletos')).status, 401);
  assert.equal((await adm('POST', '/api/configurar', { nome: 'Dono', login: 'dono', senha: '123' })).status, 400);
  assert.equal((await adm('POST', '/api/configurar', { nome: 'Dono', login: 'dono', senha: 'senha-forte-1' })).status, 201);
  assert.equal((await adm('POST', '/api/configurar', { nome: 'X', login: 'x', senha: 'senha-forte-1' })).status, 409);
  assert.equal((await adm('GET', '/api/estado')).dados.usuario.papel, 'admin');

  // usuários
  assert.equal((await adm('POST', '/api/usuarios', { nome: 'Ana', login: 'ana', senha: 'senha-da-ana', papel: 'financeiro' })).status, 201);
  assert.equal((await adm('POST', '/api/usuarios', { nome: 'Leo', login: 'leo', senha: 'senha-do-leo', papel: 'leitura' })).status, 201);
  assert.equal((await adm('POST', '/api/usuarios', { nome: 'Ana 2', login: 'ANA', senha: 'senha-da-ana', papel: 'financeiro' })).status, 409);

  const ana = cliente();
  assert.equal((await ana('POST', '/api/login', { login: 'ana', senha: 'errada' })).status, 401);
  assert.equal((await ana('POST', '/api/login', { login: 'Ana', senha: 'senha-da-ana' })).status, 200);

  // boletos
  const novo = await ana('POST', '/api/boletos', { tipo: 'pagar', com_nota: true, nome: 'fornecedor x', valor: '1.250,00', vencimento: '2026-01-31', parcelas: 3, documento: '123' });
  assert.equal(novo.status, 201);
  assert.deepEqual(novo.dados.boletos.map((b) => b.vencimento), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.deepEqual(novo.dados.boletos.map((b) => b.documento), ['123/1-3', '123/2-3', '123/3-3']);
  assert.equal(novo.dados.boletos[0].nome, 'FORNECEDOR X');
  assert.equal(novo.dados.boletos[0].valor_centavos, 125000);

  const dup = await ana('POST', '/api/boletos', { tipo: 'pagar', nome: 'Fornecedor  X', valor: 1250, vencimento: '2026-02-28' });
  assert.equal(dup.status, 409);
  assert.equal(dup.dados.duplicado, true);
  assert.equal((await ana('POST', '/api/boletos', { tipo: 'pagar', nome: 'Fornecedor X', valor: 1250, vencimento: '2026-02-28', ignorarDuplicado: true })).status, 201);
  assert.equal((await ana('POST', '/api/boletos', { tipo: 'pagar', nome: 'Y', valor: '0', vencimento: '2026-02-28' })).status, 400);
  assert.equal((await ana('POST', '/api/boletos', { tipo: 'pagar', nome: 'Y', valor: '10', vencimento: '2026-02-30' })).status, 400);

  const id = novo.dados.boletos[0].id;
  const pago = await ana('POST', `/api/boletos/${id}/pagar`);
  assert.equal(pago.dados.boleto.situacao, 'pago');
  assert.equal(pago.dados.boleto.pago_por_nome, 'Ana');
  const ed = await ana('PUT', `/api/boletos/${id}`, { valor: '1.300,00', tipo: 'receber' });
  assert.equal(ed.dados.boleto.valor_centavos, 130000);
  assert.equal(ed.dados.boleto.tipo, 'pagar', 'tipo não muda na edição');
  assert.equal((await ana('POST', `/api/boletos/${id}/reabrir`)).dados.boleto.situacao, 'aberto');
  const hist = await ana('GET', `/api/boletos/${id}/historico`);
  assert.deepEqual(hist.dados.historico.map((h) => h.acao), ['reaberto', 'editado', 'pago', 'criado']);
  assert.equal(hist.dados.historico[0].usuario, 'Ana');

  assert.equal((await ana('POST', `/api/boletos/${id}/cancelar`, { motivo: 'erro' })).dados.boleto.situacao, 'cancelado');
  assert.equal((await ana('GET', '/api/boletos')).dados.boletos.length, 3);
  assert.equal((await ana('GET', '/api/boletos?cancelados=1')).dados.boletos.length, 4);
  assert.equal((await ana('POST', '/api/boletos/999/pagar')).status, 404);

  // permissões
  const leo = cliente();
  await leo('POST', '/api/login', { login: 'leo', senha: 'senha-do-leo' });
  assert.equal((await leo('GET', '/api/boletos')).status, 200);
  assert.equal((await leo('POST', '/api/boletos', { tipo: 'pagar', nome: 'Z', valor: 1, vencimento: '2026-01-01' })).status, 403);
  assert.equal((await ana('GET', '/api/usuarios')).status, 403);

  // proteção contra pedido vindo de outro site
  assert.equal((await ana('POST', `/api/boletos/${id}/reabrir`, undefined, { headers: { origin: 'http://site-malicioso.com' } })).status, 403);

  // CSV
  const csv = await ana('GET', '/api/exportar.csv');
  assert.match(csv.dados, /FORNECEDOR X;1300,00/);

  // desativar usuário derruba a sessão
  const lista = (await adm('GET', '/api/usuarios')).dados.usuarios;
  const leoId = lista.find((u) => u.login === 'leo').id;
  await adm('PUT', `/api/usuarios/${leoId}`, { ativo: false });
  assert.equal((await leo('GET', '/api/boletos')).status, 401);
  // não pode ficar sem administrador
  const donoId = lista.find((u) => u.login === 'dono').id;
  assert.equal((await adm('PUT', `/api/usuarios/${donoId}`, { papel: 'leitura' })).status, 400);

  // trocar a própria senha
  assert.equal((await ana('POST', '/api/minha-senha', { atual: 'errada', nova: 'nova-senha-123' })).status, 400);
  assert.equal((await ana('POST', '/api/minha-senha', { atual: 'senha-da-ana', nova: 'nova-senha-123' })).status, 200);

  // importação: conferir não grava; gravar grava; pendência pode ser lançada
  const fd = () => { const f = new FormData(); f.append('pagar', new Blob([planilhaXlsx]), 'pagar.xlsx'); f.append('ano', '2026'); return f; };
  const planilhaXlsx = await planilhaPagar();
  const sim = await adm('POST', '/api/importar', fd());
  assert.equal(sim.status, 200, JSON.stringify(sim.dados));
  assert.equal(sim.dados.simulacao, true);
  assert.equal(sim.dados.resumo[0].boletos, 5);
  const f2 = fd(); f2.set('gravar', '1');
  const imp = await adm('POST', '/api/importar', f2);
  assert.equal(imp.dados.resultado.novos, 5);
  const pend = (await ana('GET', '/api/pendencias')).dados.pendencias;
  assert.equal(pend.length, 1);
  const lanc = await ana('POST', '/api/boletos', { tipo: 'pagar', nome: pend[0].nome, valor: '20,00', vencimento: '2026-11-03', pendenciaId: pend[0].id });
  assert.equal(lanc.status, 201);
  assert.equal((await ana('GET', '/api/pendencias')).dados.pendencias.length, 0);
  assert.equal((await ana('POST', '/api/importar', fd())).status, 403);
  const ruim = new FormData(); ruim.append('pagar', new Blob(['isto não é excel']), 'x.xlsx');
  assert.equal((await adm('POST', '/api/importar', ruim)).status, 400);

  // páginas
  assert.equal((await adm('GET', '/login')).status, 200);
  assert.equal((await adm('GET', '/vendor/d3.min.js')).status, 200);
  assert.equal((await adm('GET', '/api/nada')).status, 404);
});

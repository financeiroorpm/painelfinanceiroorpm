import { $, el, api, mensagem, montarBarra, exigirSessao, reais, fmtD, fmtDH, NOME_MES, lerNumero, somarMeses, normalizarNome } from '/comum.js';

const st = { usuario: null, hoje: '', mes: '', boletos: [], pendencias: [], carregando: true, confirmar: null, ocupado: null, editando: null, pendencia: null, dupOk: false };
const podeEscrever = () => st.usuario && st.usuario.papel !== 'leitura';
const ehAno = () => /^\d{4}$/.test(st.mes);
const rotuloTipo = (t) => (t === 'receber' ? 'Receber' : 'Pagar');
const rotuloMes = (k) => NOME_MES[+k.slice(5, 7) - 1] + '/' + k.slice(2, 4);

// Atrasado = não pago e o vencimento já passou
const vencido = (b) => b.situacao === 'aberto' && b.vencimento < st.hoje;
const situacao = (b) => (b.situacao === 'pago' ? 'Pago' : vencido(b) ? 'Atrasado' : b.marcador === 'amarelo' ? 'Amarelo' : 'Em aberto');
const docDe = (b) => [b.documento && 'Doc ' + b.documento, b.nf_servico && 'NF ' + b.nf_servico, b.nf_peca && 'NF-P ' + b.nf_peca, b.os && 'OS ' + b.os, b.banco,
  b.tipo === 'pagar' && !b.com_nota ? 'sem nota' : '', b.total_parcelas ? `parcela ${b.parcela}/${b.total_parcelas}` : ''].filter(Boolean).join(' · ');

// ---------- dados ----------
async function carregar() {
  st.carregando = true; render();
  try {
    const [b, p] = await Promise.all([api('GET', '/api/boletos'), api('GET', '/api/pendencias')]);
    st.boletos = b.boletos; st.hoje = b.hoje; st.pendencias = p.pendencias;
    montarMeses();
    mensagem('');
  } catch (e) { mensagem(e.message, 'erro'); }
  st.carregando = false; render();
}

function montarMeses() {
  const sel = $('mes');
  const anoHoje = +st.hoje.slice(0, 4);
  const meses = new Set(st.boletos.map((b) => b.vencimento.slice(0, 7)));
  for (let m = 1; m <= 12; m++) meses.add(anoHoje + '-' + String(m).padStart(2, '0'));
  const anos = [...new Set([...meses].map((k) => k.slice(0, 4)))].sort();
  const opts = [];
  for (const y of anos) {
    opts.push([y, 'Ano de ' + y + ' inteiro']);
    [...meses].filter((k) => k.startsWith(y)).sort().forEach((k) => opts.push([k, NOME_MES[+k.slice(5, 7) - 1].replace(/^./, (c) => c.toUpperCase()) + ' ' + y]));
  }
  if (!st.mes) st.mes = st.hoje.slice(0, 7);
  sel.replaceChildren(...opts.map(([v, t]) => { const o = el('option', '', t); o.value = v; return o; }));
  sel.value = st.mes;
}

// ---------- ações ----------
async function acao(b, rotaAcao, texto) {
  st.ocupado = b.id; st.confirmar = null; render();
  try {
    const r = await api('POST', `/api/boletos/${b.id}/${rotaAcao}`);
    Object.assign(b, r.boleto);
    mensagem(texto(b), 'ok');
  } catch (e) { mensagem(e.message, 'erro'); }
  st.ocupado = null; render();
}

async function verHistorico(b) {
  $('h-hist').textContent = 'Histórico: ' + b.nome + ', ' + reais(b.valor_centavos);
  $('l-hist').replaceChildren(el('li', 'q', 'Carregando…'));
  $('dlg-hist').showModal();
  try {
    const { historico } = await api('GET', `/api/boletos/${b.id}/historico`);
    const ACOES = { criado: 'Lançado', importado: 'Importado da planilha', editado: 'Editado', pago: 'Marcado como pago', reaberto: 'Voltou para em aberto', cancelado: 'Cancelado', conferido: 'Conferido' };
    const NOMES = { nome: 'nome', valor_centavos: 'valor', vencimento: 'vencimento', data_compra: 'data da compra', documento: 'documento', nf_servico: 'NF serviço', nf_peca: 'NF peça', os: 'OS', banco: 'banco', observacao: 'observação', com_nota: 'com nota' };
    const mostra = (k, v) => (v == null || v === '' ? '(vazio)' : k === 'valor_centavos' ? reais(v) : /^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtD(v) : String(v));
    $('l-hist').replaceChildren(...historico.map((h) => {
      const li = el('li');
      li.append(el('div', '', ACOES[h.acao] || h.acao), el('div', 'q', fmtDH(h.em) + (h.usuario ? ' · ' + h.usuario : '')));
      if (h.acao === 'editado' && h.antes && h.depois) {
        Object.keys(NOMES).filter((k) => h.antes[k] !== h.depois[k]).forEach((k) => li.append(el('div', 'q', `${NOMES[k]}: ${mostra(k, h.antes[k])} → ${mostra(k, h.depois[k])}`)));
      }
      return li;
    }));
  } catch (e) { $('l-hist').replaceChildren(el('li', 'q', e.message)); }
}

// ---------- formulário (novo e editar) ----------
function tipoForm(b) { return b.tipo === 'receber' ? 'receber' : b.com_nota ? 'pagar-com' : 'pagar-sem'; }
const CAMPOS = { 'b-nome': 'nome', 'b-venc': 'vencimento', 'b-compra': 'data_compra', 'b-nfs': 'nf_servico', 'b-nfp': 'nf_peca', 'b-os': 'os', 'b-banco': 'banco', 'b-doc': 'documento', 'b-obs': 'observacao' };

function abrirForm(b, pendencia) {
  st.editando = b || null; st.pendencia = pendencia || null; st.dupOk = false;
  $('f-boleto').reset();
  $('b-titulo').textContent = b ? 'Editar boleto' : pendencia ? 'Lançar linha da planilha' : 'Lançar boleto novo';
  $('b-nota').textContent = b ? 'As mudanças ficam registradas no histórico do boleto.' : pendencia ? `Aba "${pendencia.aba}", linha ${pendencia.linha}: ${pendencia.motivo}. Planilha dizia: valor "${pendencia.valor_texto || ''}", vencimento "${pendencia.venc_texto || ''}".` : 'Com mais de uma parcela, cada uma vence no mesmo dia dos meses seguintes.';
  $('b-tipo').disabled = !!b;
  document.querySelectorAll('#dlg-boleto .so-novo').forEach((e) => { e.hidden = !!b; });
  $('b-cancelar-boleto').hidden = !b;
  $('b-compra').value = st.hoje;
  if (b) {
    $('b-tipo').value = tipoForm(b);
    for (const [id, k] of Object.entries(CAMPOS)) $(id).value = b[k] || '';
    $('b-valor').value = (b.valor_centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  } else if (pendencia) {
    $('b-tipo').value = pendencia.tipo === 'receber' ? 'receber' : pendencia.com_nota ? 'pagar-com' : 'pagar-sem';
    $('b-nome').value = pendencia.nome || '';
    const v = lerNumero(pendencia.valor_texto); if (v) $('b-valor').value = v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    $('b-doc').value = pendencia.documento || '';
    $('b-obs').value = `Da planilha: aba "${pendencia.aba}", linha ${pendencia.linha}`;
  }
  atualizarForm();
  $('dlg-boleto').showModal();
  $('b-nome').focus();
}

function lerForm() {
  const t = $('b-tipo').value;
  const tipo = t === 'receber' ? 'receber' : 'pagar';
  const dados = { tipo, com_nota: t !== 'pagar-sem', valor: $('b-valor').value };
  for (const [id, k] of Object.entries(CAMPOS)) dados[k] = $(id).value.trim();
  if (tipo === 'receber') dados.documento = ''; else { dados.nf_servico = ''; dados.nf_peca = ''; dados.os = ''; dados.banco = ''; }
  const n = st.editando ? 1 : Math.round(Number($('b-parc').value) || 1);
  const valor = lerNumero(dados.valor);
  const erros = [];
  if (!dados.nome) erros.push(tipo === 'receber' ? 'Falta o nome do cliente.' : 'Falta o nome do fornecedor.');
  if (valor == null || valor <= 0) erros.push('Falta o valor (ex.: 1.250,00).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dados.vencimento)) erros.push('Falta a data de vencimento.');
  if (n < 1 || n > 60) erros.push('Parcelas: de 1 a 60.');
  const vencs = erros.length ? [] : Array.from({ length: n }, (_, i) => somarMeses(dados.vencimento, i));
  const nn = normalizarNome(dados.nome);
  const centavos = valor ? Math.round(valor * 100) : 0;
  const dup = st.editando || erros.length ? null : st.boletos.find((b) => b.tipo === tipo && b.situacao !== 'cancelado' && b.valor_centavos === centavos && vencs.includes(b.vencimento) && normalizarNome(b.nome) === nn);
  return { tipo, dados, n, valor, vencs, erros, dup };
}

function atualizarForm() {
  const rec = $('b-tipo').value === 'receber';
  document.querySelectorAll('#dlg-boleto .so-rec').forEach((e) => { e.hidden = !rec; });
  document.querySelectorAll('#dlg-boleto .so-pag').forEach((e) => { e.hidden = rec; });
  const n = Math.round(Number($('b-parc').value) || 1);
  $('b-nome-lbl').textContent = rec ? 'Cliente' : 'Fornecedor';
  $('b-valor-lbl').textContent = n > 1 && !st.editando ? 'Valor de cada parcela' : 'Valor';
  $('b-venc-lbl').textContent = n > 1 && !st.editando ? 'Vencimento da 1ª parcela' : 'Vencimento';
  const tipo = rec ? 'receber' : 'pagar';
  const nomes = [...new Set(st.boletos.filter((b) => b.tipo === tipo).map((b) => b.nome))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  $('b-nomes').replaceChildren(...nomes.map((x) => { const o = document.createElement('option'); o.value = x; return o; }));
  previa();
}

function previa() {
  const f = lerForm(); const itens = [];
  const preenchido = $('b-nome').value.trim() || $('b-valor').value.trim() || $('b-venc').value;
  if (f.erros.length) { if (preenchido) f.erros.forEach((e) => itens.push(el('li', 'e', e))); }
  else if (!st.editando) {
    f.vencs.forEach((v, i) => itens.push(el('li', '', (f.n > 1 ? (i + 1) + 'ª  ' : '') + fmtD(v) + '  ·  ' + reais(Math.round(f.valor * 100)))));
    if (f.n > 1) itens.push(el('li', '', 'Total: ' + reais(Math.round(f.valor * 100) * f.n)));
    if (f.dup) itens.push(el('li', 'w', 'Atenção: já existe um boleto de ' + f.dup.nome + ' de ' + reais(f.dup.valor_centavos) + ' com vencimento em ' + fmtD(f.dup.vencimento) + '.' + (st.dupOk ? ' Clique em Lançar mesmo assim para lançar de novo.' : '')));
  }
  $('b-previa').replaceChildren(...itens);
  $('b-salvar').textContent = st.ocupado === 'form' ? 'Salvando…' : f.dup && st.dupOk ? 'Lançar mesmo assim' : 'Salvar';
  $('b-salvar').disabled = !!st.ocupado;
}

async function salvarForm() {
  if (st.ocupado) return;
  const f = lerForm();
  if (f.erros.length) { previa(); return; }
  if (f.dup && !st.dupOk) { st.dupOk = true; previa(); return; }
  st.ocupado = 'form'; previa();
  try {
    if (st.editando) {
      const { tipo, ...dados } = f.dados;
      const r = await api('PUT', `/api/boletos/${st.editando.id}`, dados);
      Object.assign(st.editando, r.boleto);
      mensagem('Boleto atualizado: ' + r.boleto.nome + ', ' + reais(r.boleto.valor_centavos) + '.', 'ok');
    } else {
      const r = await api('POST', '/api/boletos', { ...f.dados, parcelas: f.n, ignorarDuplicado: st.dupOk, pendenciaId: st.pendencia ? st.pendencia.id : null });
      st.boletos.push(...r.boletos);
      st.boletos.sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.tipo.localeCompare(b.tipo) || a.nome.localeCompare(b.nome));
      if (st.pendencia) st.pendencias = st.pendencias.filter((p) => p.id !== st.pendencia.id);
      mensagem('Lançado: ' + r.boletos[0].nome + ', ' + reais(r.boletos[0].valor_centavos) + (r.boletos.length > 1 ? ' em ' + r.boletos.length + ' parcelas' : '') + '.', 'ok');
    }
    st.ocupado = null;
    $('dlg-boleto').close();
  } catch (e) {
    st.ocupado = null;
    if (e.dados && e.dados.duplicado) { st.dupOk = true; previa(); return; }
    previa(); $('b-previa').prepend(el('li', 'e', e.message));
  }
  render();
}

async function cancelarBoleto() {
  const b = st.editando; if (!b) return;
  const motivo = prompt('Cancelar o boleto de ' + b.nome + ' (' + reais(b.valor_centavos) + ')?\nEle some do painel, mas fica no histórico.\n\nMotivo:');
  if (motivo === null) return;
  try {
    await api('POST', `/api/boletos/${b.id}/cancelar`, { motivo });
    st.boletos = st.boletos.filter((x) => x.id !== b.id);
    $('dlg-boleto').close();
    mensagem('Boleto cancelado: ' + b.nome + '.', 'ok');
  } catch (e) { mensagem(e.message, 'erro'); }
  render();
}

// ---------- cálculos ----------
function calcular() {
  const atual = st.boletos.filter((b) => b.vencimento.startsWith(st.mes));
  const soma = (xs) => xs.reduce((s, b) => s + b.valor_centavos, 0);
  const R = atual.filter((b) => b.tipo === 'receber'), P = atual.filter((b) => b.tipo === 'pagar');
  const pago = (xs) => xs.filter((b) => b.situacao === 'pago');
  const aberto = (xs) => xs.filter((b) => b.situacao === 'aberto');
  const atrasados = st.boletos.filter(vencido);
  const fim7 = new Date(Date.parse(st.hoje + 'T00:00:00Z') + 6 * 86400000).toISOString().slice(0, 10);
  const entre = (d0, d1, tipo) => soma(st.boletos.filter((b) => b.situacao === 'aberto' && b.tipo === tipo && b.vencimento >= d0 && b.vencimento <= d1));
  const chave = (b) => (ehAno() ? b.vencimento.slice(0, 7) : b.vencimento);
  const porDia = new Map();
  atual.forEach((b) => { const k = chave(b); const d = porDia.get(k) || { e: 0, s: 0 }; if (b.tipo === 'receber') d.e += b.valor_centavos / 100; else d.s += b.valor_centavos / 100; porDia.set(k, d); });
  const fluxo = [];
  let acum = 0;
  if (ehAno()) {
    for (let m = 1; m <= 12; m++) { const k = st.mes + '-' + String(m).padStart(2, '0'); const x = porDia.get(k) || { e: 0, s: 0 }; acum += x.e - x.s; fluxo.push({ dia: k, entradas: x.e, saidas: x.s, acum }); }
  } else {
    const dias = [...porDia.keys()].sort();
    if (dias.length) {
      for (let t = Date.parse(dias[0] + 'T00:00:00Z'); t <= Date.parse(dias[dias.length - 1] + 'T00:00:00Z'); t += 86400000) {
        const d = new Date(t).toISOString().slice(0, 10); const x = porDia.get(d) || { e: 0, s: 0 }; acum += x.e - x.s;
        fluxo.push({ dia: d, entradas: x.e, saidas: x.s, acum });
      }
    }
  }
  const top = (xs) => {
    const g = new Map();
    xs.forEach((b) => { const n = normalizarNome(b.nome); const x = g.get(n) || { nome: b.nome, valor: 0, qtd: 0 }; x.valor += b.valor_centavos; x.qtd++; g.set(n, x); });
    return [...g.values()].sort((a, b) => b.valor - a.valor).slice(0, 8);
  };
  return {
    atual, atrasados, fluxo,
    atrRec: atrasados.filter((b) => b.tipo === 'receber'), atrPag: atrasados.filter((b) => b.tipo === 'pagar'),
    totRec: soma(R), totPag: soma(P), recebido: soma(pago(R)), pago: soma(pago(P)), abRec: soma(aberto(R)), abPag: soma(aberto(P)),
    hojeRec: entre(st.hoje, st.hoje, 'receber'), hojePag: entre(st.hoje, st.hoje, 'pagar'), seteRec: entre(st.hoje, fim7, 'receber'), setePag: entre(st.hoje, fim7, 'pagar'),
    topPag: top(P), topRec: top(R), soma,
  };
}

// ---------- desenho ----------
const statusCls = (s) => ({ Pago: 'pago', Atrasado: 'atrasado', Amarelo: 'amarelo' }[s] || 'aberto');
const botao = (t, cls, fn, dis) => { const b = el('button', 'btn ' + (cls || ''), t); b.type = 'button'; b.disabled = !!dis; b.addEventListener('click', fn); return b; };

function acoes(b) {
  const box = el('div', 'acao');
  if (podeEscrever()) {
    const ocup = !!st.ocupado;
    if (st.ocupado === b.id) box.append(botao('Salvando…', 'sec', () => {}, true));
    else if (b.situacao === 'pago') box.append(botao('Reabrir', 'sec', () => acao(b, 'reabrir', (x) => 'Voltou para em aberto: ' + x.nome + '.'), ocup));
    else if (st.confirmar === b.id) box.append(botao('Confirmar pago', 'conf', () => acao(b, 'pagar', (x) => 'Marcado como pago: ' + x.nome + ', ' + reais(x.valor_centavos) + '.')), botao('Cancelar', 'sec', () => { st.confirmar = null; render(); }));
    else box.append(botao('Marcar como pago', '', () => { st.confirmar = b.id; render(); }, ocup));
    box.append(botao('Editar', 'sec', () => abrirForm(b), ocup));
  }
  box.append(botao('Histórico', 'sec', () => verHistorico(b)));
  return box;
}

function linha(b) {
  const tr = el('tr');
  if (vencido(b)) tr.className = 'vencido'; else if (b.vencimento === st.hoje && b.situacao !== 'pago') tr.className = 'hoje';
  const tdTipo = el('td'); tdTipo.append(el('span', 'pill ' + (b.tipo === 'receber' ? 'in' : 'out'), rotuloTipo(b.tipo)));
  const tdNome = el('td', 'nm');
  const extra = [docDe(b), b.situacao === 'pago' && b.pago_em ? 'pago em ' + fmtDH(b.pago_em) + (b.pago_por_nome ? ' por ' + b.pago_por_nome : '') : ''].filter(Boolean).join(' · ');
  tdNome.append(el('strong', '', b.nome), el('span', '', extra));
  const s = situacao(b);
  const tdSit = el('td'); tdSit.append(el('span', 'pill ' + statusCls(s), s));
  const tdAc = el('td'); tdAc.append(acoes(b));
  tr.append(el('td', 'dt', fmtD(b.vencimento)), tdTipo, tdNome, el('td', 'num', reais(b.valor_centavos)), tdSit, tdAc);
  return tr;
}

function tabela(id, rows, vazio, fn = linha) {
  const tb = $(id);
  const msg = (t) => { const tr = el('tr'); const td = el('td', 'vazio', t); td.colSpan = 6; tr.append(td); tb.replaceChildren(tr); };
  if (st.carregando) return msg('Carregando…');
  if (!rows.length) return msg(vazio);
  tb.replaceChildren(...rows.map(fn));
}

function linhaConferir(x) {
  const tr = el('tr');
  if (x.pendencia) {
    const p = x.pendencia;
    const tp = el('td'); tp.append(el('span', 'pill ' + (p.tipo === 'receber' ? 'in' : 'out'), rotuloTipo(p.tipo)));
    const nm = el('td', 'nm'); nm.append(el('strong', '', p.nome || '(sem nome)'), el('span', '', `aba "${p.aba}", linha ${p.linha}`));
    const ac = el('td'); const box = el('div', 'acao');
    if (podeEscrever()) {
      box.append(botao('Lançar', '', () => abrirForm(null, p)), botao('Descartar', 'sec', async () => {
        if (!confirm('Descartar esta linha da planilha? Ela não vai virar boleto.')) return;
        try { await api('POST', `/api/pendencias/${p.id}/descartar`); st.pendencias = st.pendencias.filter((q) => q.id !== p.id); mensagem('Linha descartada.', 'ok'); } catch (e) { mensagem(e.message, 'erro'); }
        render();
      }));
    }
    ac.append(box);
    tr.append(el('td', 'dt', p.venc_texto || '(vazio)'), tp, nm, el('td', 'num', p.valor_texto || '—'), el('td', '', p.motivo), ac);
    return tr;
  }
  const b = x.boleto;
  const tp = el('td'); tp.append(el('span', 'pill ' + (b.tipo === 'receber' ? 'in' : 'out'), rotuloTipo(b.tipo)));
  const nm = el('td', 'nm'); nm.append(el('strong', '', b.nome), el('span', '', b.observacao || ''));
  const ac = el('td'); const box = el('div', 'acao');
  if (podeEscrever()) {
    box.append(botao('Editar', '', () => abrirForm(b)), botao('Está certo', 'sec', async () => {
      try { const r = await api('POST', `/api/boletos/${b.id}/conferido`); Object.assign(b, r.boleto); mensagem('Conferido: ' + b.nome + '.', 'ok'); } catch (e) { mensagem(e.message, 'erro'); }
      render();
    }));
  }
  ac.append(box);
  tr.append(el('td', 'dt', fmtD(b.vencimento)), tp, nm, el('td', 'num', reais(b.valor_centavos)), el('td', '', b.conferir_motivo), ac);
  return tr;
}

function barras(id, itens, cor) {
  const ul = $(id); ul.replaceChildren();
  if (st.carregando) return;
  const max = Math.max(1, ...itens.map((x) => x.valor));
  itens.forEach((x) => {
    const li = el('li'); const n = el('span', 'n', x.nome); n.title = x.nome;
    const t = el('div', 't'); const f = el('div', 'f'); f.style.width = (x.valor / max * 100) + '%'; f.style.background = cor; t.append(f);
    li.append(n, el('span', 'v', reais(x.valor) + ' · ' + x.qtd + (x.qtd === 1 ? ' boleto' : ' boletos')), t);
    ul.append(li);
  });
  if (!itens.length) ul.append(el('li', 'vazio', 'Nada neste período.'));
}

function grafico(rows) {
  const box = $('grafico'); box.replaceChildren();
  const d3 = window.d3;
  if (st.carregando || !rows.length || !d3) { if (!st.carregando) box.append(el('p', 'vazio', rows.length ? 'O gráfico não carregou.' : 'Nada neste período.')); return; }
  const cs = getComputedStyle(document.documentElement);
  const cor = (n) => cs.getPropertyValue(n).trim();
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const rotulo = (r) => (r.dia.length === 7 ? NOME_MES[+r.dia.slice(5, 7) - 1].slice(0, 3) : r.dia.slice(8, 10) + '/' + r.dia.slice(5, 7));
  const W = Math.max(280, box.clientWidth), H = 300, mt = 12, mb = 26, mr = 8;
  const fmtY = (v) => (Math.abs(v) >= 1000 ? 'R$ ' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : 'R$ ' + Math.round(v));
  const lo = d3.min(rows, (r) => Math.min(-r.saidas, r.acum, 0)), hi = d3.max(rows, (r) => Math.max(r.entradas, r.acum, 0));
  const y = d3.scaleLinear([lo, hi], [H - mb, mt]).nice();
  const ticks = y.ticks(5);
  const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Fluxo de caixa');
  const fonte = cs.getPropertyValue('--font-num');
  const probe = svg.append('g').attr('font-size', 12).attr('font-family', fonte);
  let ml = 0; ticks.forEach((t) => { ml = Math.max(ml, probe.append('text').text(fmtY(t)).node().getComputedTextLength()); }); probe.remove();
  ml = Math.ceil(ml) + 10;
  const x = d3.scaleBand(rows.map((r) => r.dia), [ml, W - mr]).paddingInner(0.25).paddingOuter(0.1);
  const g = svg.append('g');
  g.selectAll('line.g').data(ticks).join('line').attr('x1', ml).attr('x2', W - mr).attr('y1', (t) => y(t)).attr('y2', (t) => y(t)).attr('stroke', (t) => (t === 0 ? cor('--muted') : cor('--grid')));
  g.selectAll('text.y').data(ticks).join('text').attr('x', ml - 8).attr('y', (t) => y(t)).attr('dy', '0.32em').attr('text-anchor', 'end').attr('fill', cor('--muted')).attr('font-size', 12).attr('font-family', fonte).text(fmtY);
  const bw = Math.min(28, x.bandwidth()), off = (x.bandwidth() - bw) / 2, rx = Math.min(3, bw / 2);
  g.selectAll('rect.e').data(rows.filter((r) => r.entradas > 0)).join('rect').attr('x', (r) => x(r.dia) + off).attr('width', bw).attr('y', (r) => y(r.entradas)).attr('height', (r) => Math.max(0, y(0) - y(r.entradas))).attr('rx', rx).attr('fill', cor('--entrada'));
  g.selectAll('rect.s').data(rows.filter((r) => r.saidas > 0)).join('rect').attr('x', (r) => x(r.dia) + off).attr('width', bw).attr('y', y(0)).attr('height', (r) => Math.max(0, y(-r.saidas) - y(0))).attr('rx', rx).attr('fill', cor('--saida'));
  g.append('path').datum(rows).attr('d', d3.line().x((r) => x(r.dia) + x.bandwidth() / 2).y((r) => y(r.acum))).attr('fill', 'none').attr('stroke', cor('--linha')).attr('stroke-width', 2).attr('stroke-linejoin', 'round');
  if (rows.some((r) => r.dia === st.hoje)) {
    const hx = x(st.hoje) + x.bandwidth() / 2;
    g.append('line').attr('x1', hx).attr('x2', hx).attr('y1', mt).attr('y2', H - mb).attr('stroke', cor('--muted')).attr('stroke-dasharray', '4 4');
    g.append('text').attr('x', hx + 4).attr('y', mt + 10).attr('fill', cor('--muted')).attr('font-size', 12).text('hoje');
  }
  const every = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor((W - ml - mr) / 48))));
  g.selectAll('text.x').data(rows.filter((r, i) => i % every === 0)).join('text').attr('x', (r) => x(r.dia) + x.bandwidth() / 2).attr('y', H - 8).attr('text-anchor', 'middle').attr('fill', cor('--muted')).attr('font-size', 12).attr('font-family', fonte).text(rotulo);
  const tip = el('div', 'tip'); tip.hidden = true; box.append(tip);
  const dot = g.append('circle').attr('r', 4).attr('fill', cor('--linha')).attr('visibility', 'hidden');
  g.selectAll('rect.h').data(rows).join('rect').attr('x', (r) => x(r.dia) - (x.step() - x.bandwidth()) / 2).attr('width', x.step()).attr('y', mt).attr('height', H - mb - mt).attr('fill', 'transparent')
    .on('mousemove', (ev, r) => {
      tip.replaceChildren(el('div', 'd', (r.dia.length === 7 ? rotuloMes(r.dia) : fmtD(r.dia)) + (r.dia === st.hoje ? ' · hoje' : '')), el('div', '', 'Entradas: ' + brl.format(r.entradas)), el('div', '', 'Saídas: ' + brl.format(r.saidas)), el('div', '', 'Saldo acumulado: ' + brl.format(r.acum)));
      tip.hidden = false; dot.attr('cx', x(r.dia) + x.bandwidth() / 2).attr('cy', y(r.acum)).attr('visibility', 'visible');
      const [px, py] = d3.pointer(ev, box); let left = px + 12; if (left + tip.offsetWidth > box.clientWidth) left = px - tip.offsetWidth - 12;
      tip.style.left = Math.max(0, left) + 'px'; tip.style.top = Math.max(0, Math.min(py - tip.offsetHeight / 2, H - tip.offsetHeight)) + 'px';
    })
    .on('mouseleave', () => { tip.hidden = true; dot.attr('visibility', 'hidden'); });
}

function setNum(id, centavos, sinal) {
  const e = $(id); e.textContent = reais(centavos);
  if (sinal) { e.classList.toggle('neg', centavos < 0); e.classList.toggle('pos', centavos >= 0); }
}

function render() {
  document.querySelectorAll('.so-escrita').forEach((e) => { e.hidden = !podeEscrever(); });
  if (!st.hoje) return;
  const mesAtual = st.mes === st.hoje.slice(0, 7) || st.mes === st.hoje.slice(0, 4);
  document.querySelectorAll('.so-mes-atual').forEach((s) => { s.hidden = !mesAtual; });
  const per = ehAno() ? 'do ano' : 'do mês';
  $('h-total').textContent = ehAno() ? 'Total do ano' : 'Total do mês';
  $('h-fluxo').textContent = ehAno() ? 'Fluxo de caixa por mês de vencimento' : 'Fluxo de caixa por dia de vencimento';
  $('h-venc').textContent = 'Todos os vencimentos ' + per;
  $('h-topp').textContent = 'Maiores fornecedores ' + per;
  $('h-topr').textContent = 'Maiores clientes ' + per;
  const c = calcular();
  setNum('k-atr-rec', c.soma(c.atrRec)); $('k-atr-rec-n').textContent = c.atrRec.length;
  setNum('k-atr-pag', c.soma(c.atrPag)); $('k-atr-pag-n').textContent = c.atrPag.length;
  setNum('k-rec', c.totRec); $('k-rec-pago').textContent = reais(c.recebido); $('k-rec-ab').textContent = reais(c.abRec);
  setNum('k-pag', c.totPag); $('k-pag-pago').textContent = reais(c.pago); $('k-pag-ab').textContent = reais(c.abPag);
  setNum('k-saldo', c.totRec - c.totPag, true);
  setNum('k-hoje-pag', c.hojePag); $('k-hoje-rec').textContent = reais(c.hojeRec);
  setNum('k-7-pag', c.setePag); setNum('k-7-rec', c.seteRec); setNum('k-7-saldo', c.seteRec - c.setePag, true);
  tabela('t-atrasados', c.atrasados, 'Nenhum boleto em atraso.');
  const tipo = $('f-tipo').value, sit = $('f-sit').value, q = normalizarNome($('busca').value);
  const ok = (b) => (!tipo || b.tipo === tipo) && (!sit || (sit === 'pago' && b.situacao === 'pago') || (sit === 'naopago' && b.situacao !== 'pago') || (sit === 'atrasado' && vencido(b)))
    && (!q || normalizarNome(b.nome + ' ' + docDe(b)).includes(q));
  tabela('t-venc', c.atual.filter(ok), c.atual.length ? 'Nenhum boleto com esse filtro.' : 'Nenhum boleto neste período.');
  const conferir = [...st.pendencias.map((p) => ({ pendencia: p })), ...st.boletos.filter((b) => b.conferir_motivo).map((b) => ({ boleto: b }))];
  $('sec-conferir').hidden = !conferir.length;
  if (conferir.length) tabela('t-conferir', conferir, '', linhaConferir);
  barras('top-pag', c.topPag, 'var(--saida)'); barras('top-rec', c.topRec, 'var(--entrada)');
  grafico(c.fluxo);
}

// ---------- eventos ----------
$('novo-btn').addEventListener('click', () => abrirForm(null));
$('b-fechar').addEventListener('click', () => $('dlg-boleto').close());
$('b-salvar').addEventListener('click', salvarForm);
$('b-cancelar-boleto').addEventListener('click', cancelarBoleto);
$('b-tipo').addEventListener('change', () => { st.dupOk = false; atualizarForm(); });
$('f-boleto').addEventListener('input', (ev) => { st.dupOk = false; if (ev.target.id === 'b-parc') atualizarForm(); else previa(); });
$('f-boleto').addEventListener('submit', (ev) => { ev.preventDefault(); salvarForm(); });
$('f-boleto').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') { ev.preventDefault(); salvarForm(); } });
$('h-fechar').addEventListener('click', () => $('dlg-hist').close());
$('mes').addEventListener('change', () => { st.mes = $('mes').value; st.confirmar = null; render(); });
$('atualizar').addEventListener('click', carregar);
['f-tipo', 'f-sit'].forEach((id) => $(id).addEventListener('change', render));
$('busca').addEventListener('input', render);
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 150); });
// Atualiza sozinho a cada 2 minutos para ver o que os colegas lançaram (se nenhum formulário estiver aberto)
setInterval(() => { if (!document.hidden && !st.ocupado && !$('dlg-boleto').open && !$('dlg-hist').open) carregar(); }, 120000);

const estado = await exigirSessao();
st.usuario = estado.usuario; st.hoje = estado.hoje;
montarBarra(st.usuario, 'painel');
carregar();

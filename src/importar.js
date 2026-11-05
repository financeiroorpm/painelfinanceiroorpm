// Importação das planilhas antigas (Google Planilhas baixado como .xlsx).
// Regras herdadas do painel antigo:
//  - uma aba por mês; o nome da aba diz o mês ("novembro 2026", "Feveiro", " MARÇO 2027")
//  - a cor de fundo do nome diz a situação: verde = pago, amarelo = marcado, resto = em aberto
//  - planilha a pagar: dois blocos lado a lado, A-E com nota e H-L sem nota, cabeçalho na linha 2
//  - planilha a receber: colunas achadas pelo cabeçalho (FORNECEDOR/CLIENTE, VALOR, VENCT, OS, BANCO, Pago)
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import { lerNumero, lerData, lerDataCompra, mesDoNome, paraCentavos, dataDeSerial, semAcento } from './util.js';

// Valor "cru" da célula do exceljs -> texto, número ou data ISO
function valorCelula(cell) {
  let v = cell ? cell.value : null;
  if (v && typeof v === 'object') {
    if (v instanceof Date) return { data: v.toISOString().slice(0, 10), texto: v.toISOString().slice(0, 10).split('-').reverse().join('/') };
    if ('result' in v) v = v.result;
    else if (Array.isArray(v.richText)) v = v.richText.map((r) => r.text).join('');
    else if ('text' in v) v = v.text;
    if (v instanceof Date) return { data: v.toISOString().slice(0, 10), texto: v.toISOString().slice(0, 10).split('-').reverse().join('/') };
  }
  if (typeof v === 'number') return { numero: v, texto: String(v) };
  return { texto: String(v ?? '').trim() };
}

function lerValor(c) { return c.numero != null ? c.numero : lerNumero(c.texto); }
function lerVenc(c) {
  if (c.data) return c.data;
  if (c.numero != null && c.numero > 30000 && c.numero < 80000) return dataDeSerial(c.numero);
  return lerData(c.texto);
}

export function corDaCelula(cell) {
  const fill = cell && cell.fill;
  const argb = fill && fill.type === 'pattern' && fill.pattern !== 'none' && fill.fgColor && fill.fgColor.argb;
  if (!argb || !/^[0-9A-F]{8}$/i.test(argb)) return 'branco';
  const r = parseInt(argb.slice(2, 4), 16) / 255, g = parseInt(argb.slice(4, 6), 16) / 255, b = parseInt(argb.slice(6, 8), 16) / 255;
  if (r > 0.93 && g > 0.93 && b > 0.93) return 'branco';
  if (r > 0.7 && g > 0.55 && b < g - 0.25) return 'amarelo';
  if (g - Math.max(r, b) > 0.04) return 'verde';
  if (r - Math.max(g, b) > 0.1) return 'vermelho';
  return 'outra';
}

const valorBemEscrito = (t) => {
  const s = String(t || '').replace(/R\$/i, '').replace(/\s/g, '');
  return /^\d{1,3}(\.\d{3})*,\d{2}$/.test(s) || /^\d+,\d{2}$/.test(s) || /^\d+(\.\d+)?$/.test(s);
};

// "novembro 2026" -> "2026-11"; sem ano usa anoPadrao
export function mesDaAba(nome, anoPadrao) {
  const m = mesDoNome(nome);
  if (!m) return null;
  const y = /(20\d{2})/.exec(nome);
  return (y ? y[1] : anoPadrao) + '-' + String(m).padStart(2, '0');
}

function blocosDe(tipo, ws) {
  if (tipo === 'pagar') {
    return { linhaCab: 2, blocos: [
      { com_nota: 1, cCompra: 1, cDoc: 2, cNome: 3, cValor: 4, cVenc: 5 },
      { com_nota: 0, cCompra: 8, cDoc: 9, cNome: 10, cValor: 11, cVenc: 12 },
    ] };
  }
  // receber: procura a linha de cabeçalho nas 6 primeiras linhas
  for (let r = 1; r <= 6; r++) {
    const cab = {};
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => { cab[col] = semAcento(valorCelula(cell).texto).toLowerCase().trim(); });
    const achar = (f) => Number(Object.keys(cab).find((k) => f(cab[k]))) || null;
    const cNome = achar((h) => h === 'fornecedor' || h === 'cliente');
    const cValor = achar((h) => h === 'valor');
    const cVenc = achar((h) => h.startsWith('venc'));
    if (cNome && cValor && cVenc) {
      return { linhaCab: r, blocos: [{
        com_nota: 1, cNome, cValor, cVenc,
        cCompra: achar((h) => h.startsWith('data')), cNfs: achar((h) => h === 'nf-s' || h === 'nf servico'), cNfp: achar((h) => h === 'nf-p' || h === 'nf peca'),
        cOs: achar((h) => h === 'os'), cBanco: achar((h) => h === 'banco'), cPago: achar((h) => h === 'pago'),
      }] };
    }
  }
  return null;
}

// Lê um arquivo .xlsx e devolve o que seria importado, sem gravar nada
export async function analisarPlanilha(buffer, tipo, anoPadrao = new Date().getFullYear()) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const boletos = [], pendencias = [], abas = [];
  wb.eachSheet((ws) => {
    const aba = ws.name;
    const mesTab = mesDaAba(aba, anoPadrao);
    if (!mesTab) { abas.push({ aba, ignorada: 'nome da aba não tem mês' }); return; }
    const forma = blocosDe(tipo, ws);
    if (!forma) { abas.push({ aba, ignorada: 'não achei o cabeçalho (FORNECEDOR, VALOR, VENCT)' }); return; }
    let lidas = 0;
    const vistos = new Map();
    for (let r = forma.linhaCab + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      for (const bl of forma.blocos) {
        const t = (c) => (c ? valorCelula(row.getCell(c)) : { texto: '' });
        const nome = t(bl.cNome).texto.replace(/\s+/g, ' ').trim();
        const valorC = t(bl.cValor), vencC = t(bl.cVenc);
        if (!nome && !valorC.texto) continue;
        const pagoTxt = t(bl.cPago).texto;
        if (/cancel/i.test(pagoTxt) || /cancelad/i.test(nome)) continue;
        const doc = t(bl.cDoc).texto;
        const base = { tipo, com_nota: bl.com_nota, aba, linha: r, nome, valor_texto: valorC.texto, venc_texto: vencC.texto, documento: doc || null };
        const chaveTexto = [tipo, bl.com_nota, aba.trim(), nome.toUpperCase(), valorC.texto, vencC.texto, doc].join('|');
        const k = (vistos.get(chaveTexto) || 0) + 1;
        vistos.set(chaveTexto, k);
        const origem_ref = 'planilha:' + crypto.createHash('sha1').update(chaveTexto + '#' + k).digest('hex').slice(0, 20);
        const valor = lerValor(valorC);
        const venc = lerVenc(vencC);
        if (!nome || valor == null || valor <= 0 || !venc) {
          pendencias.push({ ...base, origem_ref, motivo: !nome ? 'Sem nome' : (valor == null || valor <= 0) ? 'Valor ilegível' : 'Vencimento ilegível' });
          continue;
        }
        const motivos = [];
        if (valorC.numero == null && !valorBemEscrito(valorC.texto)) motivos.push('valor com formato estranho na planilha (' + valorC.texto + ')');
        const dif = (Date.parse(venc) - Date.parse(mesTab + '-01')) / 86400000;
        if (dif < -45 || dif > 75) motivos.push('vencimento longe do mês da aba "' + aba.trim() + '"');
        const cor = corDaCelula(row.getCell(bl.cNome));
        const pago = cor === 'verde' || /^\s*pago/i.test(pagoTxt);
        const compraC = t(bl.cCompra);
        boletos.push({
          tipo, com_nota: bl.com_nota, nome: nome.toUpperCase(), valor_centavos: paraCentavos(valor), vencimento: venc,
          data_compra: compraC.data || lerDataCompra(compraC.texto, venc), documento: doc || null,
          nf_servico: t(bl.cNfs).texto || null, nf_peca: t(bl.cNfp).texto || null, os: t(bl.cOs).texto || null,
          banco: (t(bl.cBanco).texto || '').toUpperCase() || null,
          situacao: pago ? 'pago' : 'aberto', marcador: !pago && cor === 'amarelo' ? 'amarelo' : null,
          conferir_motivo: motivos.length ? motivos.join('; ') : null,
          observacao: `Importado da planilha (aba "${aba.trim()}", linha ${r})`, origem_ref, origem_aba: aba.trim(),
        });
        lidas++;
      }
    }
    abas.push({ aba, mes: mesTab, boletos: lidas });
  });
  return { boletos, pendencias, abas };
}

// Compara a planilha com o que já está no banco e diz o que mudaria, sem gravar nada.
// Só mexe em boletos que vieram da planilha e em abas presentes no arquivo; o que foi lançado no sistema fica como está.
//  - linha nova na planilha                       -> boleto novo
//  - pintada de verde (ou "Pago") na planilha      -> marca como pago
//  - deixou de estar verde, e o "pago" veio da planilha -> volta para em aberto
//  - sumiu da planilha (apagada ou com valor/data/nome mudados) -> cancela o antigo
//    (se alguém deu baixa nele pelo sistema, não cancela: manda para "Para conferir")
export function planejarImportacao(db, analises) {
  const plano = { novos: [], pagar: [], reabrir: [], marcador: [], cancelar: [], conferir: [], pendenciasNovas: [], pendenciasResolver: [] };
  for (const a of analises) {
    const abas = new Set(a.abas.filter((x) => x.mes).map((x) => x.aba.trim()));
    const naPlanilha = new Map(a.boletos.map((b) => [b.origem_ref, b]));
    const existentes = db.prepare("SELECT * FROM boletos WHERE origem = 'planilha' AND tipo = ?").all(a.tipo);
    const porRef = new Map(existentes.map((b) => [b.origem_ref, b]));
    for (const b of a.boletos) {
      const atual = porRef.get(b.origem_ref);
      if (!atual) { plano.novos.push(b); continue; }
      if (atual.situacao === 'cancelado') continue;
      if (b.situacao === 'pago' && atual.situacao === 'aberto') plano.pagar.push(atual);
      else if (b.situacao === 'aberto' && atual.situacao === 'pago' && atual.pago_por == null) plano.reabrir.push(atual);
      if ((b.marcador || null) !== (atual.marcador || null)) plano.marcador.push({ atual, marcador: b.marcador || null });
    }
    for (const atual of existentes) {
      if (atual.situacao === 'cancelado' || !atual.origem_aba || !abas.has(atual.origem_aba) || naPlanilha.has(atual.origem_ref)) continue;
      if (atual.situacao === 'pago' && atual.pago_por != null) { if (!atual.conferir_motivo) plano.conferir.push(atual); }
      else plano.cancelar.push(atual);
    }
    const refsPend = new Set(a.pendencias.map((p) => p.origem_ref));
    const pendAbertas = db.prepare('SELECT * FROM pendencias WHERE tipo = ? AND resolvida = 0').all(a.tipo);
    const jaTem = new Set(db.prepare('SELECT origem_ref FROM pendencias WHERE tipo = ?').pluck().all(a.tipo));
    plano.pendenciasNovas.push(...a.pendencias.filter((p) => !jaTem.has(p.origem_ref)));
    plano.pendenciasResolver.push(...pendAbertas.filter((p) => abas.has(p.aba.trim()) && !refsPend.has(p.origem_ref)));
  }
  return plano;
}

export function resumoDoPlano(plano) {
  return {
    novos: plano.novos.length, pagos: plano.pagar.length, reabertos: plano.reabrir.length, cancelados: plano.cancelar.length,
    conferir: plano.conferir.length, pendenciasNovas: plano.pendenciasNovas.length, pendenciasResolvidas: plano.pendenciasResolver.length,
    marcadores: plano.marcador.length,
  };
}

// Grava no banco tudo o que planejarImportacao achou. Cada mudança entra no histórico do boleto.
export function gravarImportacao(db, analises, usuarioId) {
  const agora = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const hist = db.prepare('INSERT INTO historico (boleto_id, usuario_id, acao, antes, depois) VALUES (?, ?, ?, ?, ?)');
  const obter = db.prepare('SELECT * FROM boletos WHERE id = ?');
  const insB = db.prepare(`INSERT OR IGNORE INTO boletos (tipo, com_nota, nome, valor_centavos, vencimento, data_compra, documento, nf_servico, nf_peca, os, banco,
    observacao, situacao, marcador, conferir_motivo, origem, origem_ref, origem_aba, criado_por)
    VALUES (@tipo, @com_nota, @nome, @valor_centavos, @vencimento, @data_compra, @documento, @nf_servico, @nf_peca, @os, @banco,
    @observacao, @situacao, @marcador, @conferir_motivo, 'planilha', @origem_ref, @origem_aba, @criado_por)`);
  const insP = db.prepare(`INSERT OR IGNORE INTO pendencias (tipo, com_nota, aba, linha, nome, valor_texto, venc_texto, documento, motivo, origem_ref)
    VALUES (@tipo, @com_nota, @aba, @linha, @nome, @valor_texto, @venc_texto, @documento, @motivo, @origem_ref)`);
  const mudar = (b, acao, sql, ...args) => {
    db.prepare(sql).run(...args, agora, b.id);
    hist.run(b.id, usuarioId, acao, JSON.stringify(b), JSON.stringify(obter.get(b.id)));
  };
  let plano;
  db.transaction(() => {
    plano = planejarImportacao(db, analises);
    for (const b of plano.novos) {
      const r = insB.run({ origem_aba: null, ...b, criado_por: usuarioId });
      if (r.changes) hist.run(Number(r.lastInsertRowid), usuarioId, 'importado', null, JSON.stringify(b));
    }
    for (const b of plano.pagar) mudar(b, 'pago (planilha)', "UPDATE boletos SET situacao = 'pago', pago_em = NULL, pago_por = NULL, atualizado_em = ? WHERE id = ?");
    for (const b of plano.reabrir) mudar(b, 'reaberto (planilha)', "UPDATE boletos SET situacao = 'aberto', pago_em = NULL, pago_por = NULL, atualizado_em = ? WHERE id = ?");
    for (const { atual, marcador } of plano.marcador) mudar(atual, 'marcador (planilha)', 'UPDATE boletos SET marcador = ?, atualizado_em = ? WHERE id = ?', marcador);
    for (const b of plano.cancelar) {
      mudar(b, 'cancelado (planilha)', "UPDATE boletos SET situacao = 'cancelado', observacao = COALESCE(observacao || ' | ', '') || ?, atualizado_em = ? WHERE id = ?",
        'Cancelado na reimportação: a linha foi apagada ou alterada na planilha');
    }
    for (const b of plano.conferir) {
      mudar(b, 'conferir (planilha)', 'UPDATE boletos SET conferir_motivo = ?, atualizado_em = ? WHERE id = ?',
        'foi pago pelo sistema, mas a linha não existe mais na planilha (apagada ou alterada)');
    }
    for (const p of plano.pendenciasNovas) insP.run(p);
    for (const p of plano.pendenciasResolver) db.prepare('UPDATE pendencias SET resolvida = 1 WHERE id = ?').run(p.id);
  })();
  return resumoDoPlano(plano);
}

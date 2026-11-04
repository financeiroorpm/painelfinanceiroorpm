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
          observacao: `Importado da planilha (aba "${aba.trim()}", linha ${r})`, origem_ref,
        });
        lidas++;
      }
    }
    abas.push({ aba, mes: mesTab, boletos: lidas });
  });
  return { boletos, pendencias, abas };
}

// Grava no banco. Linhas já importadas antes (mesmo origem_ref) são puladas.
export function gravarImportacao(db, analises, usuarioId) {
  const insB = db.prepare(`INSERT OR IGNORE INTO boletos (tipo, com_nota, nome, valor_centavos, vencimento, data_compra, documento, nf_servico, nf_peca, os, banco,
    observacao, situacao, marcador, conferir_motivo, origem, origem_ref, criado_por)
    VALUES (@tipo, @com_nota, @nome, @valor_centavos, @vencimento, @data_compra, @documento, @nf_servico, @nf_peca, @os, @banco,
    @observacao, @situacao, @marcador, @conferir_motivo, 'planilha', @origem_ref, @criado_por)`);
  const insH = db.prepare("INSERT INTO historico (boleto_id, usuario_id, acao, depois) VALUES (?, ?, 'importado', ?)");
  const insP = db.prepare(`INSERT OR IGNORE INTO pendencias (tipo, com_nota, aba, linha, nome, valor_texto, venc_texto, documento, motivo, origem_ref)
    VALUES (@tipo, @com_nota, @aba, @linha, @nome, @valor_texto, @venc_texto, @documento, @motivo, @origem_ref)`);
  const res = { novos: 0, repetidos: 0, pendencias: 0 };
  db.transaction(() => {
    for (const a of analises) {
      for (const b of a.boletos) {
        const r = insB.run({ ...b, criado_por: usuarioId });
        if (r.changes) { res.novos++; insH.run(Number(r.lastInsertRowid), usuarioId, JSON.stringify(b)); } else res.repetidos++;
      }
      for (const p of a.pendencias) res.pendencias += insP.run(p).changes;
    }
  })();
  return res;
}

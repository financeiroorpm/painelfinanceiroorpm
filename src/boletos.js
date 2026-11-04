import crypto from 'node:crypto';
import { dataValida, lerNumero, paraCentavos, somarMeses, normalizarNome } from './util.js';

export class ErroValidacao extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

const CAMPOS_TEXTO = ['documento', 'nf_servico', 'nf_peca', 'os', 'banco', 'observacao'];

function limparTexto(v, max = 200) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

// Confere e normaliza o que vem do formulário. Lança ErroValidacao com uma mensagem para o usuário.
export function validarBoleto(b, { parcial = false } = {}) {
  const out = {};
  const tem = (k) => !parcial || b[k] !== undefined;
  if (tem('tipo')) {
    if (!['receber', 'pagar'].includes(b.tipo)) throw new ErroValidacao('Escolha se o boleto é a receber ou a pagar.');
    out.tipo = b.tipo;
  }
  if (tem('com_nota')) out.com_nota = b.com_nota === false || b.com_nota === 0 || b.com_nota === '0' ? 0 : 1;
  if (tem('nome')) {
    const nome = limparTexto(b.nome, 120);
    if (!nome) throw new ErroValidacao('Falta o nome do cliente ou fornecedor.');
    out.nome = nome.toUpperCase();
  }
  if (tem('valor')) {
    const v = typeof b.valor === 'number' ? b.valor : lerNumero(b.valor);
    if (v == null || v <= 0 || v > 100_000_000) throw new ErroValidacao('Valor inválido. Exemplo: 1.250,00');
    out.valor_centavos = paraCentavos(v);
  }
  if (tem('vencimento')) {
    if (!dataValida(b.vencimento)) throw new ErroValidacao('Data de vencimento inválida.');
    out.vencimento = b.vencimento;
  }
  if (tem('data_compra')) {
    if (b.data_compra && !dataValida(b.data_compra)) throw new ErroValidacao('Data da compra inválida.');
    out.data_compra = b.data_compra || null;
  }
  for (const k of CAMPOS_TEXTO) {
    if (tem(k)) out[k] = limparTexto(b[k], k === 'observacao' ? 1000 : 80);
  }
  if (out.banco) out.banco = out.banco.toUpperCase();
  return out;
}

const SELECT = `SELECT b.*, u.nome AS pago_por_nome FROM boletos b LEFT JOIN usuarios u ON u.id = b.pago_por`;

export function criarServicoBoletos(db) {
  const registrar = db.prepare('INSERT INTO historico (boleto_id, usuario_id, acao, antes, depois) VALUES (?, ?, ?, ?, ?)');
  const buscar = db.prepare(SELECT + ' WHERE b.id = ?');
  const agora = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const json = (x) => (x == null ? null : JSON.stringify(x));

  function obter(id) {
    const b = buscar.get(id);
    if (!b) throw new ErroValidacao('Boleto não encontrado.', 404);
    return b;
  }

  function listar({ incluirCancelados = false } = {}) {
    return db.prepare(SELECT + (incluirCancelados ? '' : " WHERE b.situacao <> 'cancelado'") + ' ORDER BY b.vencimento, b.tipo, b.nome').all();
  }

  // Procura boleto igual (mesmo tipo, nome, valor e vencimento) para avisar de duplicidade
  function duplicados(tipo, nome, valorCentavos, vencimentos) {
    const n = normalizarNome(nome);
    const q = db.prepare("SELECT id, nome, vencimento FROM boletos WHERE tipo = ? AND valor_centavos = ? AND vencimento = ? AND situacao <> 'cancelado'");
    const achados = [];
    for (const v of vencimentos) for (const b of q.all(tipo, valorCentavos, v)) if (normalizarNome(b.nome) === n) achados.push(b);
    return achados;
  }

  // Cria 1 ou mais parcelas (uma por mês, a partir do vencimento da 1ª)
  const criar = db.transaction((dados, usuarioId, { parcelas = 1, ignorarDuplicado = false, pendenciaId = null } = {}) => {
    const b = validarBoleto(dados);
    const n = Math.round(Number(parcelas) || 1);
    if (n < 1 || n > 60) throw new ErroValidacao('Parcelas: de 1 a 60.');
    const vencs = Array.from({ length: n }, (_, i) => somarMeses(b.vencimento, i));
    if (!ignorarDuplicado) {
      const dup = duplicados(b.tipo, b.nome, b.valor_centavos, vencs);
      if (dup.length) {
        const e = new ErroValidacao(`Já existe um boleto de ${dup[0].nome} com esse valor vencendo em ${dup[0].vencimento.split('-').reverse().join('/')}.`, 409);
        e.duplicado = true;
        throw e;
      }
    }
    const grupo = n > 1 ? crypto.randomUUID() : null;
    const ins = db.prepare(`INSERT INTO boletos (tipo, com_nota, nome, valor_centavos, vencimento, data_compra, documento, nf_servico, nf_peca, os, banco, observacao,
      grupo_parcelas, parcela, total_parcelas, criado_por) VALUES (@tipo, @com_nota, @nome, @valor_centavos, @vencimento, @data_compra, @documento, @nf_servico, @nf_peca, @os, @banco, @observacao,
      @grupo, @parcela, @total, @criado_por)`);
    const sufixo = (t, i) => (t && n > 1 && /\d/.test(t) ? `${t}/${i + 1}-${n}` : t);
    const ids = [];
    vencs.forEach((v, i) => {
      const linha = {
        com_nota: 1, data_compra: null, ...Object.fromEntries(CAMPOS_TEXTO.map((k) => [k, null])), ...b,
        vencimento: v, grupo, parcela: n > 1 ? i + 1 : null, total: n > 1 ? n : null, criado_por: usuarioId,
      };
      linha.documento = sufixo(linha.documento, i);
      linha.nf_servico = sufixo(linha.nf_servico, i);
      const id = Number(ins.run(linha).lastInsertRowid);
      registrar.run(id, usuarioId, 'criado', null, json(obter(id)));
      ids.push(id);
    });
    if (pendenciaId) db.prepare('UPDATE pendencias SET resolvida = 1 WHERE id = ?').run(pendenciaId);
    return ids.map(obter);
  });

  const atualizar = db.transaction((id, dados, usuarioId) => {
    const antes = obter(id);
    if (antes.situacao === 'cancelado') throw new ErroValidacao('Boleto cancelado não pode ser alterado.');
    const b = validarBoleto(dados, { parcial: true });
    delete b.tipo;
    const campos = Object.keys(b);
    if (!campos.length) return antes;
    db.prepare(`UPDATE boletos SET ${campos.map((k) => `${k} = @${k}`).join(', ')}, conferir_motivo = NULL, atualizado_em = @agora WHERE id = @id`)
      .run({ ...b, id, agora: agora() });
    const depois = obter(id);
    registrar.run(id, usuarioId, 'editado', json(antes), json(depois));
    return depois;
  });

  const mudarSituacao = db.transaction((id, nova, usuarioId) => {
    const antes = obter(id);
    if (antes.situacao === 'cancelado') throw new ErroValidacao('Este boleto está cancelado.');
    if (antes.situacao === nova) return antes;
    const pago = nova === 'pago';
    db.prepare('UPDATE boletos SET situacao = ?, pago_em = ?, pago_por = ?, atualizado_em = ? WHERE id = ?')
      .run(nova, pago ? agora() : null, pago ? usuarioId : null, agora(), id);
    const depois = obter(id);
    registrar.run(id, usuarioId, pago ? 'pago' : 'reaberto', json(antes), json(depois));
    return depois;
  });

  const cancelar = db.transaction((id, usuarioId, motivo) => {
    const antes = obter(id);
    db.prepare("UPDATE boletos SET situacao = 'cancelado', observacao = COALESCE(observacao || ' | ', '') || ?, atualizado_em = ? WHERE id = ?")
      .run('Cancelado: ' + (limparTexto(motivo, 300) || 'sem motivo'), agora(), id);
    const depois = obter(id);
    registrar.run(id, usuarioId, 'cancelado', json(antes), json(depois));
    return depois;
  });

  const marcarConferido = db.transaction((id, usuarioId) => {
    const antes = obter(id);
    db.prepare('UPDATE boletos SET conferir_motivo = NULL, atualizado_em = ? WHERE id = ?').run(agora(), id);
    registrar.run(id, usuarioId, 'conferido', json(antes), json(obter(id)));
    return obter(id);
  });

  function historico(id) {
    obter(id);
    return db.prepare(`SELECT h.id, h.acao, h.em, h.antes, h.depois, u.nome AS usuario FROM historico h LEFT JOIN usuarios u ON u.id = h.usuario_id
      WHERE h.boleto_id = ? ORDER BY h.id DESC`).all(id).map((h) => ({ ...h, antes: h.antes && JSON.parse(h.antes), depois: h.depois && JSON.parse(h.depois) }));
  }

  return { listar, obter, criar, atualizar, mudarSituacao, cancelar, marcarConferido, historico };
}

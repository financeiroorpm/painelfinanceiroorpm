import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { RAIZ } from './config.js';
import {
  carregarUsuario, exigirLogin, exigirPapel, mesmaOrigem, criarSessao, encerrarSessao, gerarHashSenha, conferirSenha, senhaFraca,
  podeTentarLogin, registrarErroLogin, limparErrosLogin,
} from './auth.js';
import { criarServicoBoletos, ErroValidacao } from './boletos.js';
import { analisarPlanilha, gravarImportacao, planejarImportacao, resumoDoPlano } from './importar.js';
import { hojeBR } from './util.js';

// Monta o app Express. Recebe o banco já aberto (assim os testes usam um banco em memória).
export function criarApp(db, { diasSessao = 30, cookieSeguro = false } = {}) {
  const app = express();
  const boletos = criarServicoBoletos(db);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 2 } });

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(carregarUsuario(db));
  app.use('/api', mesmaOrigem);

  const papelEscrita = exigirPapel('admin', 'financeiro');
  const id = (req) => {
    const n = Number(req.params.id);
    if (!Number.isInteger(n) || n <= 0) throw new ErroValidacao('Identificador inválido.', 404);
    return n;
  };
  // Envolve rotas para mandar erros de validação como resposta, e o resto como erro 500
  const rota = (fn) => (req, res, next) => {
    try {
      const r = fn(req, res);
      if (r && typeof r.then === 'function') r.catch(next);
    } catch (e) { next(e); }
  };

  // ---------- sessão ----------
  const contarUsuarios = () => db.prepare('SELECT COUNT(*) FROM usuarios').pluck().get();

  app.get('/api/estado', (req, res) => {
    res.json({ precisaConfigurar: contarUsuarios() === 0, usuario: req.usuario, hoje: hojeBR() });
  });

  // Cria o primeiro administrador (só funciona com o banco sem nenhum usuário)
  app.post('/api/configurar', rota((req, res) => {
    const { nome, login, senha } = req.body || {};
    if (contarUsuarios() > 0) throw new ErroValidacao('O sistema já foi configurado.', 409);
    if (!String(nome || '').trim() || !String(login || '').trim()) throw new ErroValidacao('Preencha nome e usuário.');
    const fraca = senhaFraca(senha);
    if (fraca) throw new ErroValidacao(fraca);
    const r = db.prepare("INSERT INTO usuarios (nome, login, senha_hash, papel) VALUES (?, ?, ?, 'admin')")
      .run(String(nome).trim(), String(login).trim().toLowerCase(), gerarHashSenha(senha));
    criarSessao(db, res, Number(r.lastInsertRowid), diasSessao, cookieSeguro);
    res.status(201).json({ ok: true });
  }));

  app.post('/api/login', rota((req, res) => {
    const ip = req.ip;
    if (!podeTentarLogin(ip)) throw new ErroValidacao('Muitas tentativas erradas. Espere 15 minutos.', 429);
    const { login, senha } = req.body || {};
    const u = db.prepare('SELECT * FROM usuarios WHERE login = ? AND ativo = 1').get(String(login || '').trim());
    if (!u || !conferirSenha(senha, u.senha_hash)) {
      registrarErroLogin(ip);
      throw new ErroValidacao('Usuário ou senha errados.', 401);
    }
    limparErrosLogin(ip);
    criarSessao(db, res, u.id, diasSessao, cookieSeguro);
    res.json({ ok: true });
  }));

  app.post('/api/logout', (req, res) => { encerrarSessao(db, req, res); res.json({ ok: true }); });

  app.post('/api/minha-senha', exigirLogin, rota((req, res) => {
    const { atual, nova } = req.body || {};
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.usuario.id);
    if (!conferirSenha(atual, u.senha_hash)) throw new ErroValidacao('A senha atual está errada.');
    const fraca = senhaFraca(nova);
    if (fraca) throw new ErroValidacao(fraca);
    db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(gerarHashSenha(nova), u.id);
    res.json({ ok: true });
  }));

  // ---------- boletos ----------
  app.get('/api/boletos', exigirLogin, (req, res) => {
    res.json({ hoje: hojeBR(), boletos: boletos.listar({ incluirCancelados: req.query.cancelados === '1' }) });
  });

  app.post('/api/boletos', papelEscrita, rota((req, res) => {
    const { parcelas, ignorarDuplicado, pendenciaId, ...dados } = req.body || {};
    res.status(201).json({ boletos: boletos.criar(dados, req.usuario.id, { parcelas, ignorarDuplicado: !!ignorarDuplicado, pendenciaId: pendenciaId || null }) });
  }));

  app.get('/api/boletos/:id/historico', exigirLogin, rota((req, res) => res.json({ historico: boletos.historico(id(req)) })));
  app.put('/api/boletos/:id', papelEscrita, rota((req, res) => res.json({ boleto: boletos.atualizar(id(req), req.body || {}, req.usuario.id) })));
  app.post('/api/boletos/:id/pagar', papelEscrita, rota((req, res) => res.json({ boleto: boletos.mudarSituacao(id(req), 'pago', req.usuario.id) })));
  app.post('/api/boletos/:id/reabrir', papelEscrita, rota((req, res) => res.json({ boleto: boletos.mudarSituacao(id(req), 'aberto', req.usuario.id) })));
  app.post('/api/boletos/:id/cancelar', papelEscrita, rota((req, res) => res.json({ boleto: boletos.cancelar(id(req), req.usuario.id, (req.body || {}).motivo) })));
  app.post('/api/boletos/:id/conferido', papelEscrita, rota((req, res) => res.json({ boleto: boletos.marcarConferido(id(req), req.usuario.id) })));

  // Planilha CSV (abre no Excel com acentos certos por causa do BOM)
  app.get('/api/exportar.csv', exigirLogin, (req, res) => {
    const linhas = boletos.listar({ incluirCancelados: true });
    const cols = ['id', 'tipo', 'com_nota', 'nome', 'valor', 'vencimento', 'situacao', 'pago_em', 'pago_por_nome', 'data_compra', 'documento', 'nf_servico', 'nf_peca', 'os', 'banco', 'observacao'];
    const esc = (v) => { const s = v == null ? '' : String(v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const corpo = linhas.map((b) => cols.map((c) => esc(c === 'valor' ? (b.valor_centavos / 100).toFixed(2).replace('.', ',') : b[c])).join(';'));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="boletos-${hojeBR()}.csv"`);
    res.send('﻿' + [cols.join(';'), ...corpo].join('\r\n'));
  });

  // ---------- pendências da importação ----------
  app.get('/api/pendencias', exigirLogin, (req, res) => {
    res.json({ pendencias: db.prepare('SELECT * FROM pendencias WHERE resolvida = 0 ORDER BY aba, linha').all() });
  });
  app.post('/api/pendencias/:id/descartar', papelEscrita, rota((req, res) => {
    const r = db.prepare('UPDATE pendencias SET resolvida = 1 WHERE id = ?').run(id(req));
    if (!r.changes) throw new ErroValidacao('Pendência não encontrada.', 404);
    res.json({ ok: true });
  }));

  // ---------- administração ----------
  const adm = exigirPapel('admin');
  app.post('/api/importar', adm, upload.fields([{ name: 'pagar', maxCount: 1 }, { name: 'receber', maxCount: 1 }]), rota(async (req, res) => {
    const ano = Number((req.body || {}).ano) || Number(hojeBR().slice(0, 4));
    const gravar = (req.body || {}).gravar === '1';
    const arquivos = req.files || {};
    if (!arquivos.pagar && !arquivos.receber) throw new ErroValidacao('Escolha pelo menos uma planilha (.xlsx).');
    const analises = [];
    for (const tipo of ['pagar', 'receber']) {
      const f = arquivos[tipo] && arquivos[tipo][0];
      if (!f) continue;
      try {
        analises.push({ tipo, ...(await analisarPlanilha(f.buffer, tipo, ano)) });
      } catch (e) {
        throw new ErroValidacao(`Não consegui ler a planilha a ${tipo} (${f.originalname}). Baixe do Google Planilhas em Arquivo → Fazer download → Microsoft Excel (.xlsx).`);
      }
    }
    const resumo = analises.map((a) => ({
      tipo: a.tipo, abas: a.abas, boletos: a.boletos.length, pagos: a.boletos.filter((b) => b.situacao === 'pago').length,
      conferir: a.boletos.filter((b) => b.conferir_motivo).length, pendencias: a.pendencias,
      totalCentavos: a.boletos.reduce((s, b) => s + b.valor_centavos, 0),
    }));
    if (!gravar) return res.json({ simulacao: true, resumo, mudancas: resumoDoPlano(planejarImportacao(db, analises)) });
    res.json({ simulacao: false, resumo, mudancas: gravarImportacao(db, analises, req.usuario.id) });
  }));

  app.get('/api/usuarios', adm, (req, res) => {
    res.json({ usuarios: db.prepare('SELECT id, nome, login, papel, ativo, criado_em FROM usuarios ORDER BY nome').all() });
  });

  const PAPEIS = ['admin', 'financeiro', 'leitura'];
  app.post('/api/usuarios', adm, rota((req, res) => {
    const { nome, login, senha, papel } = req.body || {};
    if (!String(nome || '').trim() || !/^[a-z0-9._-]{3,40}$/i.test(String(login || '').trim())) throw new ErroValidacao('Preencha o nome e um usuário de 3 a 40 letras, números, ponto ou traço, sem espaços.');
    if (!PAPEIS.includes(papel)) throw new ErroValidacao('Papel inválido.');
    const fraca = senhaFraca(senha);
    if (fraca) throw new ErroValidacao(fraca);
    if (db.prepare('SELECT 1 FROM usuarios WHERE login = ?').get(String(login).trim())) throw new ErroValidacao('Já existe alguém com esse usuário.', 409);
    const r = db.prepare('INSERT INTO usuarios (nome, login, senha_hash, papel) VALUES (?, ?, ?, ?)').run(String(nome).trim(), String(login).trim().toLowerCase(), gerarHashSenha(senha), papel);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  }));

  app.put('/api/usuarios/:id', adm, rota((req, res) => {
    const uid = id(req);
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(uid);
    if (!u) throw new ErroValidacao('Usuário não encontrado.', 404);
    const { nome, papel, ativo, senha } = req.body || {};
    const novo = { nome: nome != null ? String(nome).trim() || u.nome : u.nome, papel: papel ?? u.papel, ativo: ativo == null ? u.ativo : (ativo ? 1 : 0) };
    if (!PAPEIS.includes(novo.papel)) throw new ErroValidacao('Papel inválido.');
    const outrosAdmins = db.prepare("SELECT COUNT(*) FROM usuarios WHERE papel = 'admin' AND ativo = 1 AND id <> ?").pluck().get(uid);
    if (u.papel === 'admin' && (novo.papel !== 'admin' || !novo.ativo) && outrosAdmins === 0) throw new ErroValidacao('Precisa sobrar pelo menos um administrador ativo.');
    db.transaction(() => {
      db.prepare('UPDATE usuarios SET nome = ?, papel = ?, ativo = ? WHERE id = ?').run(novo.nome, novo.papel, novo.ativo, uid);
      if (senha) {
        const fraca = senhaFraca(senha);
        if (fraca) throw new ErroValidacao(fraca);
        db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(gerarHashSenha(senha), uid);
      }
      if (senha || !novo.ativo || novo.papel !== u.papel) db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND ? <> ?').run(uid, uid, req.usuario.id);
    })();
    res.json({ ok: true });
  }));

  app.get('/api/saude', (req, res) => res.json({ ok: true }));
  app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

  // ---------- páginas ----------
  app.get('/vendor/d3.min.js', (req, res) => res.sendFile(path.join(RAIZ, 'node_modules', 'd3', 'dist', 'd3.min.js')));
  app.use(express.static(path.join(RAIZ, 'public'), { extensions: ['html'], index: 'index.html' }));

  // Erros: validação vira mensagem para o usuário; o resto vira 500 e vai para o log
  app.use((err, req, res, _next) => {
    if (err instanceof ErroValidacao) return res.status(err.status).json({ erro: err.message, duplicado: err.duplicado || undefined });
    if (err instanceof multer.MulterError) return res.status(400).json({ erro: 'Arquivo inválido ou grande demais (máximo 20 MB).' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'Dados inválidos.' });
    console.error(new Date().toISOString(), req.method, req.originalUrl, err);
    res.status(500).json({ erro: 'Erro interno. Veja o log do servidor.' });
  });

  return app;
}

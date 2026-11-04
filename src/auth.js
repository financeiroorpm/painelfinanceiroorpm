import crypto from 'node:crypto';

const COOKIE = 'orpm_sessao';

// Senha com scrypt (vem no Node, sem dependência extra). Formato: scrypt$sal$hash
export function gerarHashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, sal, 64);
  return 'scrypt$' + sal.toString('base64') + '$' + hash.toString('base64');
}

export function conferirSenha(senha, guardado) {
  const [alg, sal, hash] = String(guardado || '').split('$');
  if (alg !== 'scrypt' || !sal || !hash) return false;
  const esperado = Buffer.from(hash, 'base64');
  const calc = crypto.scryptSync(String(senha), Buffer.from(sal, 'base64'), esperado.length);
  return crypto.timingSafeEqual(calc, esperado);
}

export function senhaFraca(senha) {
  if (String(senha || '').length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  return null;
}

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function lerCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

export function criarSessao(db, res, usuarioId, dias, seguro) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expira = new Date(Date.now() + dias * 86400000);
  db.prepare('INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (?, ?, ?)').run(sha(token), usuarioId, expira.toISOString());
  db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(new Date().toISOString());
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${dias * 86400}${seguro ? '; Secure' : ''}`);
}

export function encerrarSessao(db, req, res) {
  const token = lerCookies(req)[COOKIE];
  if (token) db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(sha(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Coloca req.usuario quando há sessão válida
export function carregarUsuario(db) {
  const busca = db.prepare(`SELECT u.id, u.nome, u.login, u.papel FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token_hash = ? AND s.expira_em > ? AND u.ativo = 1`);
  return (req, _res, next) => {
    const token = lerCookies(req)[COOKIE];
    req.usuario = token ? busca.get(sha(token), new Date().toISOString()) || null : null;
    next();
  };
}

export function exigirLogin(req, res, next) {
  if (!req.usuario) return res.status(401).json({ erro: 'Entre com seu usuário e senha.' });
  next();
}

// Papéis: admin > financeiro > leitura
export const exigirPapel = (...papeis) => (req, res, next) => {
  if (!req.usuario) return res.status(401).json({ erro: 'Entre com seu usuário e senha.' });
  if (!papeis.includes(req.usuario.papel)) return res.status(403).json({ erro: 'Seu usuário não tem permissão para isso.' });
  next();
};

// Bloqueia pedidos de escrita vindos de outro site (proteção contra CSRF)
export function mesmaOrigem(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origem = req.headers.origin;
  if (origem) {
    let host;
    try { host = new URL(origem).host; } catch { host = null; }
    if (host !== req.headers.host) return res.status(403).json({ erro: 'Pedido recusado (origem diferente).' });
  }
  next();
}

// Limite simples de tentativas de login por IP: 10 erros em 15 minutos
const tentativas = new Map();
export function podeTentarLogin(ip) {
  const agora = Date.now();
  const t = (tentativas.get(ip) || []).filter((x) => agora - x < 15 * 60000);
  tentativas.set(ip, t);
  return t.length < 10;
}
export function registrarErroLogin(ip) {
  const t = tentativas.get(ip) || [];
  t.push(Date.now());
  tentativas.set(ip, t);
}
export function limparErrosLogin(ip) { tentativas.delete(ip); }

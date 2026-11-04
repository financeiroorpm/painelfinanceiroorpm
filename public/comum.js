// Ajudantes usados por todas as páginas.
export const $ = (id) => document.getElementById(id);
export const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const reais = (centavos) => brl.format(centavos / 100);
export const fmtD = (s) => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '—');
export const fmtDH = (s) => (s ? new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '—');
export const NOME_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function hojeBR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// "R$ 1.234,56" -> 1234.56 (mesma regra do servidor)
export function lerNumero(t) {
  let s = String(t ?? '').replace(/[^\d.,-]/g, '');
  if (!s) return null;
  if (s.includes(',')) { const i = s.lastIndexOf(','); s = s.slice(0, i).replace(/[.,]/g, '') + '.' + s.slice(i + 1).replace(/[.,]/g, ''); }
  else { const p = s.split('.'); if (p.length > 1) { const l = p[p.length - 1]; s = (p.length > 2 || l.length !== 3) ? p.slice(0, -1).join('') + '.' + l : p.join(''); } }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function somarMeses(iso, n) {
  let y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + n; const d = +iso.slice(8, 10);
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
  const fim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(Math.min(d, fim)).padStart(2, '0');
}

export const normalizarNome = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

// Chamada à API. Se a sessão caiu, volta para o login.
export async function api(metodo, url, corpo) {
  const opts = { method: metodo, headers: {} };
  if (corpo instanceof FormData) opts.body = corpo;
  else if (corpo !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(corpo); }
  let r;
  try { r = await fetch(url, opts); } catch { throw Object.assign(new Error('Sem conexão com o servidor. Confira a rede e tente de novo.'), { status: 0 }); }
  const dados = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.startsWith('/api/login') && !url.startsWith('/api/minha-senha')) { location.href = '/login'; throw new Error('Sessão encerrada.'); }
  if (!r.ok) throw Object.assign(new Error(dados.erro || 'Erro ' + r.status), { status: r.status, dados });
  return dados;
}

export function mensagem(texto, tipo) {
  const m = $('msg');
  if (!m) return;
  if (!texto) { m.hidden = true; return; }
  m.hidden = false; m.className = 'msg ' + (tipo || ''); m.textContent = texto;
}

// Barra do topo: nome do usuário, links e sair
export function montarBarra(usuario, pagina) {
  const b = $('barra');
  if (!b) return;
  const papel = { admin: 'administrador', financeiro: 'financeiro', leitura: 'só leitura' }[usuario.papel];
  const esq = el('span', '', 'Sistema financeiro ORPM');
  const dir = el('span', 'controls');
  dir.append(el('span', '', usuario.nome + ' (' + papel + ')'));
  if (pagina !== 'painel') { const a = el('a', '', 'Painel'); a.href = '/'; dir.append(a); }
  if (usuario.papel === 'admin' && pagina !== 'admin') { const a = el('a', '', 'Administração'); a.href = '/admin'; dir.append(a); }
  const senha = el('button', 'linkbtn', 'Trocar senha'); senha.type = 'button'; senha.addEventListener('click', trocarSenha);
  const sair = el('button', 'linkbtn', 'Sair'); sair.type = 'button';
  sair.addEventListener('click', async () => { await api('POST', '/api/logout').catch(() => {}); location.href = '/login'; });
  dir.append(senha, sair);
  b.replaceChildren(esq, dir);
}

function trocarSenha() {
  const d = el('dialog');
  d.innerHTML = `<h3>Trocar minha senha</h3>
    <form class="form" method="dialog" style="grid-template-columns:1fr">
      <label class="fld"><span>Senha atual</span><input type="password" name="atual" autocomplete="current-password" required></label>
      <label class="fld"><span>Nova senha (mínimo 8 caracteres)</span><input type="password" name="nova" autocomplete="new-password" minlength="8" required></label>
      <p class="note" data-erro hidden style="color:var(--atraso)"></p>
      <div class="acao" style="justify-content:flex-start"><button class="btn" value="ok">Salvar</button><button class="btn sec" value="cancelar" formnovalidate>Cancelar</button></div>
    </form>`;
  document.body.append(d);
  const f = d.querySelector('form'); const erro = d.querySelector('[data-erro]');
  f.addEventListener('submit', async (ev) => {
    if (ev.submitter && ev.submitter.value === 'cancelar') { d.close(); return; }
    ev.preventDefault();
    try { await api('POST', '/api/minha-senha', { atual: f.atual.value, nova: f.nova.value }); d.close(); mensagem('Senha trocada.', 'ok'); }
    catch (e) { erro.hidden = false; erro.textContent = e.message; }
  });
  d.addEventListener('close', () => d.remove());
  d.showModal();
}

// Garante login; devolve { usuario, hoje }
export async function exigirSessao() {
  const e = await api('GET', '/api/estado');
  if (!e.usuario) { location.href = '/login'; return new Promise(() => {}); }
  return e;
}

import { $, el, api, mensagem, montarBarra, exigirSessao, reais } from '/comum.js';

const estado = await exigirSessao();
if (estado.usuario.papel !== 'admin') location.href = '/';
montarBarra(estado.usuario, 'admin');
const PAPEIS = { admin: 'Administrador', financeiro: 'Financeiro', leitura: 'Só leitura' };

// ---------- usuários ----------
async function carregarUsuarios() {
  const { usuarios } = await api('GET', '/api/usuarios');
  $('t-usuarios').replaceChildren(...usuarios.map((u) => {
    const tr = el('tr');
    const sel = el('select'); sel.setAttribute('aria-label', 'Papel de ' + u.nome);
    Object.entries(PAPEIS).forEach(([v, t]) => { const o = el('option', '', t); o.value = v; sel.append(o); });
    sel.value = u.papel;
    sel.addEventListener('change', () => salvar(u, { papel: sel.value }, 'Papel de ' + u.nome + ' mudou para ' + PAPEIS[sel.value] + '.'));
    const tdP = el('td'); tdP.append(sel);
    const ac = el('td'); const box = el('div', 'acao');
    const b1 = el('button', 'btn sec', 'Nova senha'); b1.type = 'button';
    b1.addEventListener('click', () => {
      const s = prompt('Nova senha para ' + u.nome + ' (mínimo 8 caracteres):');
      if (s) salvar(u, { senha: s }, 'Senha de ' + u.nome + ' trocada. Passe a nova senha para a pessoa.');
    });
    const b2 = el('button', u.ativo ? 'btn perigo' : 'btn sec', u.ativo ? 'Desativar' : 'Reativar'); b2.type = 'button';
    b2.addEventListener('click', () => salvar(u, { ativo: !u.ativo }, u.nome + (u.ativo ? ' não consegue mais entrar.' : ' pode entrar de novo.')));
    box.append(b1, b2); ac.append(box);
    tr.append(el('td', '', u.nome), el('td', '', u.login), tdP, el('td', '', u.ativo ? 'Ativo' : 'Desativado'), ac);
    return tr;
  }));
}

async function salvar(u, dados, ok) {
  try { await api('PUT', '/api/usuarios/' + u.id, dados); mensagem(ok, 'ok'); } catch (e) { mensagem(e.message, 'erro'); }
  carregarUsuarios();
}

$('f-usuario').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  try {
    await api('POST', '/api/usuarios', { nome: f.nome.value, login: f.login.value, senha: f.senha.value, papel: f.papel.value });
    mensagem(f.nome.value + ' foi adicionado. Entra com o usuário "' + f.login.value.trim().toLowerCase() + '" e a senha que você definiu.', 'ok');
    f.reset(); carregarUsuarios();
  } catch (e) { mensagem(e.message, 'erro'); }
});

// ---------- importação ----------
const fi = $('f-importar');
fi.ano.value = estado.hoje.slice(0, 4);
fi.addEventListener('change', () => { $('i-gravar').hidden = true; });

async function importar(gravar) {
  const fd = new FormData();
  if (fi.pagar.files[0]) fd.append('pagar', fi.pagar.files[0]);
  if (fi.receber.files[0]) fd.append('receber', fi.receber.files[0]);
  fd.append('ano', fi.ano.value);
  fd.append('gravar', gravar ? '1' : '0');
  const b = gravar ? $('i-gravar') : $('i-conferir');
  b.disabled = true; mensagem(gravar ? 'Importando…' : 'Lendo as planilhas…');
  try {
    const r = await api('POST', '/api/importar', fd);
    mostrarResumo(r);
    if (gravar) {
      const x = r.resultado;
      mensagem(`Importação feita: ${x.novos} boletos novos, ${x.repetidos} já estavam no sistema, ${x.pendencias} linhas para conferir no painel.`, 'ok');
      $('i-gravar').hidden = true;
    } else { mensagem(''); $('i-gravar').hidden = false; }
  } catch (e) { mensagem(e.message, 'erro'); }
  b.disabled = false;
}

function mostrarResumo(r) {
  const box = $('i-resumo'); box.replaceChildren();
  for (const p of r.resumo) {
    const c = el('div'); c.style.marginTop = '16px';
    c.append(el('h3', '', 'Planilha a ' + p.tipo));
    c.append(el('p', 'note', `${p.boletos} boletos (${reais(p.totalCentavos)}), ${p.pagos} já pagos, ${p.conferir} com algo para conferir, ${p.pendencias.length} linhas que não deu para ler.`));
    const tb = el('div', 'tbox'); const t = el('table');
    t.innerHTML = '<thead><tr><th>Aba</th><th>Mês</th><th class="num">Boletos</th></tr></thead>';
    const body = el('tbody');
    p.abas.forEach((a) => { const tr = el('tr'); tr.append(el('td', '', a.aba), el('td', '', a.mes || 'ignorada: ' + a.ignorada), el('td', 'num', a.boletos != null ? String(a.boletos) : '—')); body.append(tr); });
    t.append(body); tb.append(t); c.append(tb);
    if (p.pendencias.length) {
      c.append(el('p', 'note', 'Linhas que não deu para ler (vão aparecer em "Para conferir" no painel):'));
      const ul = el('ul', 'previa');
      p.pendencias.slice(0, 50).forEach((x) => ul.append(el('li', 'e', `aba "${x.aba}" linha ${x.linha}: ${x.nome || '(sem nome)'} · valor "${x.valor_texto}" · venc. "${x.venc_texto}" · ${x.motivo}`)));
      if (p.pendencias.length > 50) ul.append(el('li', 'e', '… e mais ' + (p.pendencias.length - 50)));
      c.append(ul);
    }
    box.append(c);
  }
  if (r.simulacao) box.append(el('p', 'note', 'Nada foi gravado ainda. Se estiver certo, clique em "Importar para o sistema".'));
}

$('i-conferir').addEventListener('click', () => importar(false));
$('i-gravar').addEventListener('click', () => importar(true));
carregarUsuarios().catch((e) => mensagem(e.message, 'erro'));

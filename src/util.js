// Funções puras usadas no servidor e na importação. As mesmas regras existem em public/comum.js.

// "R$ 1.234,56", "1234,56", "1.033,00", "540.2" -> número (ou null)
export function lerNumero(t) {
  if (typeof t === 'number') return Number.isFinite(t) ? t : null;
  let s = String(t ?? '').replace(/[^\d.,-]/g, '');
  if (!s) return null;
  if (s.includes(',')) {
    const i = s.lastIndexOf(',');
    s = s.slice(0, i).replace(/[.,]/g, '') + '.' + s.slice(i + 1).replace(/[.,]/g, '');
  } else {
    const p = s.split('.');
    if (p.length > 1) {
      const l = p[p.length - 1];
      s = (p.length > 2 || l.length !== 3) ? p.slice(0, -1).join('') + '.' + l : p.join('');
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export const paraCentavos = (n) => Math.round(n * 100);

const isoDe = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');

export function dataValida(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// "2/11/2026", "01/11/26" -> "2026-11-02" (ou null)
export function lerData(t) {
  const p = String(t ?? '').trim().split('/').filter(Boolean);
  if (p.length !== 3) return null;
  const d = +p[0], m = +p[1];
  let y = +p[2];
  if (y < 100) y += 2000;
  if (!(y >= 2000 && y <= 2100)) return null;
  const iso = isoDe(y, m, d);
  return dataValida(iso) ? iso : null;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Número do mês (1-12) a partir de um nome: "Feveiro" -> 2, "MARÇO 2027" -> 3
export function mesDoNome(t) {
  const s = semAcento(t).toLowerCase().trim();
  const i = MESES.findIndex((m) => s.startsWith(m));
  return i >= 0 ? i + 1 : null;
}

// "21/out.", "08/outubro", "9/10" -> data ISO, usando o ano que deixa a compra antes (ou no dia) do vencimento
export function lerDataCompra(t, vencimentoISO) {
  const completa = lerData(t);
  if (completa) return completa;
  const m = /^\s*(\d{1,2})\s*\/\s*([^\/\s]+)\s*$/.exec(String(t ?? ''));
  if (!m || !vencimentoISO) return null;
  const d = +m[1];
  const mes = /^\d+$/.test(m[2]) ? +m[2] : mesDoNome(m[2]);
  if (!mes || mes > 12) return null;
  let y = +vencimentoISO.slice(0, 4);
  let iso = isoDe(y, mes, d);
  if (iso > vencimentoISO) iso = isoDe(y - 1, mes, d);
  return dataValida(iso) ? iso : null;
}

export const normalizarNome = (s) => semAcento(s).toUpperCase().replace(/\s+/g, ' ').trim();

// Hoje no horário de Brasília, como AAAA-MM-DD
export function hojeBR(agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

// Soma n meses mantendo o dia (31/01 + 1 mês = 28 ou 29/02)
export function somarMeses(iso, n) {
  let y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + n;
  const d = +iso.slice(8, 10);
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  const fim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return isoDe(y, m + 1, Math.min(d, fim));
}

// Excel guarda datas como número de dias desde 30/12/1899
export function dataDeSerial(n) {
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

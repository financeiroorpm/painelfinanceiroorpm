import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { RAIZ } from './config.js';

// Abre o banco e aplica as migrações que ainda não rodaram (pasta migrations/, em ordem de nome).
export function abrirBanco(arquivo) {
  if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new Database(arquivo);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrar(db);
  return db;
}

function migrar(db) {
  db.exec('CREATE TABLE IF NOT EXISTS migracoes (nome TEXT PRIMARY KEY, aplicada_em TEXT NOT NULL)');
  const feitas = new Set(db.prepare('SELECT nome FROM migracoes').pluck().all());
  const pasta = path.join(RAIZ, 'migrations');
  const arquivos = fs.readdirSync(pasta).filter((f) => f.endsWith('.sql')).sort();
  for (const nome of arquivos) {
    if (feitas.has(nome)) continue;
    const sql = fs.readFileSync(path.join(pasta, nome), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO migracoes (nome, aplicada_em) VALUES (?, ?)').run(nome, new Date().toISOString());
    })();
    console.log('Migração aplicada:', nome);
  }
}

// Cópia de segurança do banco inteiro, sem parar o sistema. Guarda as N mais recentes.
export async function fazerBackup(db, pastaDados, guardar) {
  const pasta = path.join(pastaDados, 'backups');
  fs.mkdirSync(pasta, { recursive: true });
  const nome = 'financeiro-' + new Date().toISOString().slice(0, 10) + '.db';
  await db.backup(path.join(pasta, nome));
  const todos = fs.readdirSync(pasta).filter((f) => /^financeiro-.*\.db$/.test(f)).sort();
  for (const velho of todos.slice(0, Math.max(0, todos.length - guardar))) fs.rmSync(path.join(pasta, velho));
  return path.join(pasta, nome);
}

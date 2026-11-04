import os from 'node:os';
import path from 'node:path';
import { config } from './config.js';
import { abrirBanco, fazerBackup } from './db.js';
import { criarApp } from './app.js';

const arquivo = path.join(config.pastaDados, 'financeiro.db');
const db = abrirBanco(arquivo);
const app = criarApp(db, { diasSessao: config.diasSessao, cookieSeguro: process.env.COOKIE_SEGURO === '1' });

const backup = () => fazerBackup(db, config.pastaDados, config.backupsGuardados)
  .then((f) => console.log('Backup feito:', f))
  .catch((e) => console.error('Falha no backup:', e));
backup();
setInterval(backup, 6 * 60 * 60 * 1000).unref();

const servidor = app.listen(config.porta, config.host, () => {
  console.log(`Sistema financeiro ORPM rodando. Banco: ${arquivo}`);
  console.log(`  Neste computador: http://localhost:${config.porta}`);
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista || []) if (i.family === 'IPv4' && !i.internal) console.log(`  Na rede:          http://${i.address}:${config.porta}`);
  }
});

function desligar() {
  console.log('Desligando...');
  servidor.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', desligar);
process.on('SIGTERM', desligar);

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Aceita --porta=3000 na linha de comando (usado pelo serviço do Windows)
const arg = (nome) => (process.argv.find((a) => a.startsWith('--' + nome + '=')) || '').split('=').slice(1).join('=') || undefined;

export const config = {
  porta: Number(arg('porta') || process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  pastaDados: path.resolve(process.env.DATA_DIR || path.join(RAIZ, 'dados')),
  diasSessao: Number(process.env.DIAS_SESSAO) || 30,
  backupsGuardados: Number(process.env.BACKUPS_GUARDADOS) || 30,
};

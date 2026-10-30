// Зупинити проєкт: npm run down. З даними: npm run down -- --wipe
import { spawnSync } from 'node:child_process';
const wipe = process.argv.includes('--wipe');
const args = ['compose', ...[], 'down', '--remove-orphans'];
if (wipe) args.push('-v');
const r = spawnSync('docker', args, { stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(r.status ?? 1);

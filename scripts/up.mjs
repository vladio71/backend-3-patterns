// Запуск проєкту однією командою: npm run up
// Що робить:
//   1. створює .env з .env.example, якщо .env ще немає
//   2. гасить інші проєкти backend-*, які зараз працюють у Docker (вони ділять ті самі порти)
//   3. перевіряє, чи вільні порти цього проєкту; якщо порт тримає щось поза Docker, каже що і зупиняється
//   4. docker compose up --build -d
//   5. чекає, поки всі сервіси стануть healthy
//   6. робить перевірочні запити і друкує, що відкривати
// Прапорці: --wipe (видалити томи, тобто дані, перед запуском), інших немає
import { spawnSync } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import { createConnection } from 'node:net';

const PROJECT = 'backend-3-patterns';
const HEALTH_URL = 'http://localhost:3002/health';
const SMOKE = [["health", "http://localhost:3002/health", {"status": 200, "includes": "ok"}], ["товари v1 (без токена має бути 401)", "http://localhost:3002/v1/products", {"status": 401}], ["контракт API", "http://localhost:3002/reference", {"status": 200}], ["MinIO консоль", "http://localhost:9001/", {"status": 200}]]; // [назва, url, що очікуємо]
const OPEN = [["контракт API", "http://localhost:3002/reference"], ["Bull Board, черги (email і dead-letter)", "http://localhost:3002/queues"], ["MinIO консоль, minioadmin / minioadmin", "http://localhost:9001"], ["Jaeger, трейси", "http://localhost:16686"]];   // [назва, url]
const PROFILES = {}; // прапорець -> профіль compose

const args = new Set(process.argv.slice(2));
const wipe = args.has('--wipe');
const profiles = Object.entries(PROFILES).filter(([flag]) => args.has(flag)).map(([, p]) => p);
const profileArgs = profiles.flatMap((p) => ['--profile', p]);

const log = (s) => console.log(s);
const fail = (s) => { console.error('\n' + s); process.exit(1); };

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', stdio: opts.inherit ? 'inherit' : 'pipe', shell: process.platform === 'win32' });
  if (r.error) fail(`Не вдалося запустити ${cmd}: ${r.error.message}`);
  return r;
}

function dockerOk() {
  const r = run('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (r.status !== 0) fail('Docker не запущений. Відкрий Docker Desktop, дочекайся зеленого статусу і повтори npm run up.');
}

// 1. .env
function ensureEnv() {
  if (!existsSync('.env') && existsSync('.env.example')) {
    copyFileSync('.env.example', '.env');
    log('Створив .env з .env.example');
  }
}

// 2. інші проєкти backend-*
function stopOtherProjects() {
  const r = run('docker', ['compose', 'ls', '--format', 'json', '--all']);
  if (r.status !== 0) return;
  let list = [];
  try { list = JSON.parse(r.stdout || '[]'); } catch { return; }
  for (const p of list) {
    const name = p.Name || '';
    if (name === PROJECT || !name.startsWith('backend-')) continue;
    log(`Гашу інший проєкт, щоб звільнити порти: ${name}`);
    run('docker', ['compose', '-p', name, 'down', '--remove-orphans'], { inherit: true });
  }
}

// 3. порти
function publishedPorts() {
  const r = run('docker', ['compose', ...profileArgs, 'config', '--format', 'json']);
  if (r.status !== 0) fail(`docker compose config впав:\n${r.stderr}`);
  const cfg = JSON.parse(r.stdout);
  const ports = [];
  for (const [svc, def] of Object.entries(cfg.services || {})) {
    for (const p of def.ports || []) {
      const published = typeof p === 'string' ? p.split(':')[0] : p.published;
      if (published) ports.push({ svc, port: Number(String(published).split('-')[0]) });
    }
  }
  return ports;
}

function isListening(port) {
  return new Promise((resolve) => {
    const s = createConnection({ host: '127.0.0.1', port });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.setTimeout(700, () => { s.destroy(); resolve(false); });
  });
}

function dockerPortOwners() {
  const r = run('docker', ['ps', '--format', '{{.Names}}\t{{.Ports}}']);
  const owners = new Map();
  for (const line of (r.stdout || '').split('\n')) {
    const [name, ports] = line.split('\t');
    if (!ports) continue;
    for (const m of ports.matchAll(/:(\d+)->/g)) owners.set(Number(m[1]), name);
  }
  return owners;
}

async function checkPorts() {
  const owners = dockerPortOwners();
  const busy = [];
  for (const { svc, port } of publishedPorts()) {
    if (!(await isListening(port))) continue;
    const owner = owners.get(port);
    if (owner && owner.startsWith(PROJECT)) continue; // наш же контейнер, compose його перезапустить
    busy.push({ svc, port, owner });
  }
  if (busy.length === 0) return;
  const lines = busy.map(({ svc, port, owner }) =>
    owner ? `  порт ${port} (${svc}) тримає контейнер ${owner}` : `  порт ${port} (${svc}) тримає щось поза Docker`);
  const hint = process.platform === 'win32'
    ? '  Windows: Get-NetTCPConnection -LocalPort <порт> -State Listen | Select OwningProcess, потім Get-Process -Id <pid>'
    : '  Linux/mac: lsof -iTCP:<порт> -sTCP:LISTEN';
  fail(`Порти зайняті, запуск зупинено:\n${lines.join('\n')}\n\nЯк знайти, хто тримає порт:\n${hint}\nЗазвичай це локально встановлений Postgres або Redis. Зупини їх або зміни порт у docker-compose.yml.`);
}

// 4. up
function composeUp() {
  if (wipe) {
    log('Видаляю томи (--wipe)');
    run('docker', ['compose', ...profileArgs, 'down', '-v', '--remove-orphans'], { inherit: true });
  }
  const r = run('docker', ['compose', ...profileArgs, 'up', '--build', '-d', '--remove-orphans'], { inherit: true });
  if (r.status !== 0) fail('docker compose up впав. Текст помилки вище.');
}

// 5. чекаємо healthy
async function waitHealthy(timeoutMs = 240_000) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    const r = run('docker', ['compose', ...profileArgs, 'ps', '--all', '--format', 'json']);
    const rows = (r.stdout || '').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const items = rows.flatMap((x) => (Array.isArray(x) ? x : [x]));
    const bad = items.filter((c) => c.State === 'exited' && c.ExitCode !== 0);
    if (bad.length) {
      for (const c of bad) {
        console.error(`\nСервіс ${c.Service} упав (код ${c.ExitCode}). Останні рядки логів:`);
        run('docker', ['compose', ...profileArgs, 'logs', '--tail', '40', c.Service], { inherit: true });
      }
      fail('Запуск не вдався.');
    }
    const pending = items.filter((c) => c.State === 'running' && c.Health && c.Health !== 'healthy')
      .concat(items.filter((c) => c.State === 'created' || c.State === 'restarting'));
    const summary = items.map((c) => `${c.Service}:${c.State}${c.Health ? '/' + c.Health : ''}`).join('  ');
    if (summary !== last) { log('  ' + summary); last = summary; }
    if (pending.length === 0) return;
    await new Promise((res) => setTimeout(res, 3000));
  }
  run('docker', ['compose', ...profileArgs, 'ps'], { inherit: true });
  fail('За 4 хвилини не всі сервіси стали healthy. Подивись docker compose logs <сервіс>.');
}

// 6. smoke
async function smoke() {
  for (const [name, url, expect] of SMOKE) {
    let res = null, text = '', err = null;
    // Сервіс може ще секунду-дві підніматись після healthy, тому кілька спроб.
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        res = await fetch(url, { headers: { Accept: 'application/json' } });
        text = await res.text();
        err = null;
        if (![502, 503].includes(res.status)) break;
      } catch (e) { err = e; }
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (err || !res) { log(`  FAIL ${name}: ${url} (${err ? err.message : 'немає відповіді'})`); continue; }
    const ok = res.status === expect.status && (!expect.includes || text.includes(expect.includes));
    log(`  ${ok ? 'ok ' : 'FAIL'} ${name}: ${res.status} ${url}`);
    if (!ok) log(`       очікував ${expect.status}${expect.includes ? ` і "${expect.includes}" у відповіді` : ''}, отримав: ${text.slice(0, 160)}`);
  }
}

(async () => {
  dockerOk();
  ensureEnv();
  stopOtherProjects();
  await checkPorts();
  composeUp();
  log('\nЧекаю, поки сервіси стануть healthy...');
  await waitHealthy();
  log('\nПеревірка:');
  await smoke();
  log('\nГотово. Відкривай:');
  for (const [name, url] of OPEN) log(`  ${url.padEnd(38)} ${name}`);
  log(`\nЗупинити: npm run down (дані лишаються) або npm run down -- --wipe (разом з даними).`);
})();

/**
 * backup — 本地数据/交接文档快照，纯文件操作，不联网、不删除任何旧备份。
 *
 * 用法：
 *   tsx tools/backup.ts                    创建 backups/<时间戳>/ 快照
 *   tsx tools/backup.ts --list            列出已有快照
 *   tsx tools/backup.ts --restore <dir>   预览将覆盖的文件（dry-run）
 *   tsx tools/backup.ts --restore <dir> --force   真正恢复
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const BACKUPS = path.join(ROOT, 'backups');
const argv = process.argv.slice(2);

const GLOBS: { dir: string; filter: (f: string) => boolean }[] = [
  { dir: 'data', filter: (f) => f.endsWith('.json') },
  { dir: 'docs', filter: (f) => /\.(md|json)$/.test(f) },
  { dir: 'runs', filter: (f) => f.endsWith('.md') },
  { dir: 'server/saves', filter: () => true },
  { dir: '.', filter: (f) => ['package.json', 'tsconfig.json', '.env.example'].includes(f) },
];

type Item = { rel: string; bytes: number; sha256: string };

function collect(): { rel: string; abs: string; buf: Buffer }[] {
  const out: { rel: string; abs: string; buf: Buffer }[] = [];
  for (const g of GLOBS) {
    const dir = path.join(ROOT, g.dir);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const abs = path.join(dir, f);
      if (!fs.statSync(abs).isFile() || !g.filter(f)) continue;
      out.push({ rel: path.relative(ROOT, abs).replace(/\\/g, '/'), abs, buf: fs.readFileSync(abs) });
    }
  }
  return out;
}

function sha(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function listSnapshots(): string[] {
  if (!fs.existsSync(BACKUPS)) return [];
  return fs.readdirSync(BACKUPS)
    .filter((d) => fs.existsSync(path.join(BACKUPS, d, 'manifest.json')))
    .sort();
}

if (argv.includes('--list')) {
  const snaps = listSnapshots();
  if (!snaps.length) console.log('[backup] 暂无快照');
  for (const s of snaps) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(BACKUPS, s, 'manifest.json'), 'utf8'));
      console.log(`${s}  files=${m.fileCount}  bytes=${m.totalBytes}  created=${m.createdAt}`);
    } catch {
      console.log(`${s}  (manifest 损坏)`);
    }
  }
  process.exit(0);
}

const restoreIdx = argv.indexOf('--restore');
if (restoreIdx >= 0) {
  const target = argv[restoreIdx + 1];
  if (!target) {
    console.error('[backup] --restore 需要指定快照目录名');
    process.exit(1);
  }
  const snap = path.join(BACKUPS, target);
  const mf = path.join(snap, 'manifest.json');
  if (!fs.existsSync(mf)) {
    console.error(`[backup] 找不到快照 ${snap}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const force = argv.includes('--force');
  console.log(`[backup] 快照 ${target} 含 ${manifest.fileCount} 个文件，${force ? '执行恢复' : '仅预览（加 --force 才写入）'}`);
  let changed = 0;
  for (const it of manifest.items as Item[]) {
    const src = path.join(snap, 'files', it.rel);
    const dst = path.join(ROOT, it.rel);
    if (!fs.existsSync(src)) continue;
    const same = fs.existsSync(dst) && sha(fs.readFileSync(dst)) === it.sha256;
    if (same) continue;
    changed++;
    console.log(`  ${it.rel}  ${same ? 'unchanged' : 'would overwrite'}`);
    if (force) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }
  console.log(`[backup] ${force ? '已恢复' : '待恢复'} ${changed} 个变更文件`);
  process.exit(0);
}

// 默认：创建快照
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const snap = path.join(BACKUPS, stamp);
const filesDir = path.join(snap, 'files');
const items = collect();
if (!items.length) {
  console.error('[backup] ERROR: 没有可备份的文件');
  process.exit(1);
}

let totalBytes = 0;
const manifestItems: Item[] = [];
for (const it of items) {
  const dst = path.join(filesDir, it.rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, it.buf);
  totalBytes += it.buf.length;
  manifestItems.push({ rel: it.rel, bytes: it.buf.length, sha256: sha(it.buf) });
}

const manifest = {
  version: 1,
  createdAt: new Date().toISOString(),
  fileCount: manifestItems.length,
  totalBytes,
  note: '本地快照，仅包含 data/docs/runs 与房间存档；不含 node_modules / art 原始素材 / dist。',
  items: manifestItems,
};
fs.writeFileSync(path.join(snap, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`[backup] ${stamp}  files=${manifestItems.length}  bytes=${totalBytes}  -> ${path.relative(ROOT, snap)}`);

/**
 * build:art — 把 art/ 下的球员素材同步进 Vite publicDir，并生成前端可用的清单。
 *
 * 幂等：内容未变则跳过拷贝；--check 只校验不写入（不同步时退出码 1）。
 * 产物：client/public/art/{cutout,raw}/*.png|jpg + client/public/art/manifest.json
 * 前端用法：fetch('/art/manifest.json') -> players[].cutout / .raw 做「重绘 / 原图」切换。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const ART = path.join(ROOT, 'art');
const OUT = path.join(ROOT, 'client', 'public', 'art');
const CHECK = process.argv.includes('--check');

type Entry = {
  id: string;
  cutout: string | null;
  raw: string | null;
  cutoutBytes: number | null;
  rawBytes: number | null;
  cutoutWidth: number | null;
  cutoutHeight: number | null;
};

function sha(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function pngSize(buf: Buffer): [number, number] | null {
  if (buf.length < 24 || buf.subarray(1, 4).toString('ascii') !== 'PNG') return null;
  const sig = buf.subarray(12, 16).toString('ascii');
  if (sig !== 'IHDR') return null;
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

function list(kind: 'cutout' | 'raw', ext: string): Map<string, { file: string; abs: string }> {
  const dir = path.join(ART, kind);
  const map = new Map<string, { file: string; abs: string }>();
  if (!fs.existsSync(dir)) return map;
  for (const f of fs.readdirSync(dir)) {
    if (!f.toLowerCase().endsWith(ext)) continue;
    const m = f.match(/^p(\d+)\./i);
    if (!m) continue;
    map.set(m[1].padStart(2, '0'), { file: f, abs: path.join(dir, f) });
  }
  return map;
}

function syncOne(srcAbs: string, dstAbs: string): 'copied' | 'unchanged' {
  const buf = fs.readFileSync(srcAbs);
  if (fs.existsSync(dstAbs) && sha(fs.readFileSync(dstAbs)) === sha(buf)) return 'unchanged';
  if (!CHECK) {
    fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
    fs.copyFileSync(srcAbs, dstAbs);
  }
  return 'copied';
}

const cutouts = list('cutout', '.png');
const raws = list('raw', '.jpg');
const ids = [...new Set([...cutouts.keys(), ...raws.keys()])].sort();

if (ids.length === 0) {
  console.error('[gen-art] ERROR: art/cutout 或 art/raw 下没有找到 pNN.png / pNN.jpg 素材');
  process.exit(1);
}

let copied = 0;
let unchanged = 0;
const entries: Entry[] = [];

for (const id of ids) {
  const c = cutouts.get(id);
  const r = raws.get(id);
  let cw: number | null = null;
  let ch: number | null = null;

  if (c) {
    const dst = path.join(OUT, 'cutout', c.file);
    const res = syncOne(c.abs, dst);
    res === 'copied' ? copied++ : unchanged++;
    const size = pngSize(fs.readFileSync(c.abs));
    if (size) [cw, ch] = [size[0], size[1]];
  }
  if (r) {
    const dst = path.join(OUT, 'raw', r.file);
    const res = syncOne(r.abs, dst);
    res === 'copied' ? copied++ : unchanged++;
  }

  entries.push({
    id,
    cutout: c ? `/art/cutout/${c.file}` : null,
    raw: r ? `/art/raw/${r.file}` : null,
    cutoutBytes: c ? fs.statSync(c.abs).size : null,
    rawBytes: r ? fs.statSync(r.abs).size : null,
    cutoutWidth: cw,
    cutoutHeight: ch,
  });
}

const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: 'art/{cutout,raw}',
  note: 'cutout = 抠图/重绘，raw = 原图；缺失字段为 null，前端切换时需回退。',
  playerCount: entries.length,
  withCutout: entries.filter((e) => e.cutout).length,
  withRaw: entries.filter((e) => e.raw).length,
  players: entries,
};

const manifestPath = path.join(OUT, 'manifest.json');
const serialized = JSON.stringify(manifest, null, 2) + '\n';
// generatedAt 每次都变，会导致 manifest 永远判定为变更；比较时忽略时间戳
let manifestNeedsWrite = !fs.existsSync(manifestPath);
if (fs.existsSync(manifestPath)) {
  try {
    const prev = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const comparable = (o: object): string => {
      const c: Record<string, unknown> = { ...o };
      delete c.generatedAt;
      return JSON.stringify(c);
    };
    manifestNeedsWrite = comparable(prev) !== comparable(manifest);
  } catch {
    manifestNeedsWrite = true;
  }
}

if (!CHECK && manifestNeedsWrite) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(manifestPath, serialized, 'utf8');
}

const needSync = copied > 0 || manifestNeedsWrite;
console.log(
  `[gen-art] players=${entries.length} cutout=${manifest.withCutout} raw=${manifest.withRaw} ` +
    `copied=${copied} unchanged=${unchanged} manifest=${manifestNeedsWrite ? 'rewritten' : 'unchanged'}` +
    (CHECK ? ` -> ${needSync ? 'OUT OF SYNC' : 'IN SYNC'}` : '')
);

if (CHECK && needSync) process.exit(1);

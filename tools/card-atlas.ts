import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import players from '../data/players.json';
import { CardAtlasSchema, type CardAtlas } from '../packages/contracts/src/card-atlas';
import { layoutCardAtlas, validateCardBindings } from '../packages/game-core/src/card-atlas';
import { canonicalJson } from '../packages/game-core/src/snapshot';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, 'client/public/assets/cards/atlas.json');
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
function generatorHash(rootPath = root) {
  return sha(
    canonicalJson(
      ['tools/card-textures.mjs', 'packages/game-core/src/card-atlas.ts'].map((file) => ({
        file,
        sha256: sha(readFileSync(path.join(rootPath, file))),
      })),
    ),
  );
}
export function verifyCardAtlas(rootPath = root): CardAtlas {
  const atlas = CardAtlasSchema.parse(
    JSON.parse(readFileSync(path.join(rootPath, 'client/public/assets/cards/atlas.json'), 'utf8')),
  );
  const source = JSON.parse(readFileSync(path.join(rootPath, 'data/players.json'), 'utf8')) as typeof players;
  validateCardBindings(atlas, source.players);
  if (atlas.generatorSha256 !== generatorHash(rootPath)) throw new Error('Card atlas generator changed; export again');
  const { version, ...payload } = atlas;
  if (version !== `cards-${sha(canonicalJson(payload)).slice(0, 16)}`)
    throw new Error('Card atlas content version mismatch');
  for (const page of atlas.pages) {
    const bytes = readFileSync(path.join(rootPath, 'client/public', page.path));
    if (
      sha(bytes) !== page.sha256 ||
      bytes.length !== page.bytes ||
      bytes.readUInt32BE(16) !== page.width ||
      bytes.readUInt32BE(20) !== page.height
    )
      throw new Error(`Card atlas image mismatch: ${page.id}`);
  }
  return atlas;
}
async function exportCardAtlas() {
  const layout = layoutCardAtlas(players.players);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><meta charset="utf-8"><title>Card texture export</title>');
    await page.addScriptTag({ content: readFileSync(path.join(root, 'tools/card-textures.mjs'), 'utf8') });
    const images = [];
    mkdirSync(path.dirname(target), { recursive: true });
    for (const definition of layout.pages) {
      const request = {
        page: definition,
        portraits: layout.portraits.filter((p) => p.pageId === definition.id),
        frames: layout.frames.filter((f) => f.pageId === definition.id),
      };
      const url = await page.evaluate(
        (value) => (globalThis as unknown as { renderCardAtlas: (input: unknown) => string }).renderCardAtlas(value),
        request,
      );
      const bytes = Buffer.from(url.split(',')[1], 'base64');
      const filename = path.join(root, 'client/public', definition.path);
      if (!existsSync(filename) || !readFileSync(filename).equals(bytes)) writeFileSync(filename, bytes);
      images.push({ ...definition, bytes: bytes.length, sha256: sha(bytes) });
    }
    const payload = {
      ...layout,
      pages: images,
      generatorSha256: generatorHash(),
      generatorEngine: `chromium-${browser.version()}`,
    };
    const atlas = CardAtlasSchema.parse({ ...payload, version: `cards-${sha(canonicalJson(payload)).slice(0, 16)}` });
    writeFileSync(target, JSON.stringify(atlas, null, 2) + '\n');
    return verifyCardAtlas();
  } finally {
    await browser.close();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const atlas = process.argv.includes('--check') ? verifyCardAtlas() : await exportCardAtlas();
  console.log(
    `Card atlas ${atlas.version}: ${atlas.portraits.length} identities, ${atlas.frames.length} frames, ${atlas.pages.length} pages, ${atlas.pages.reduce((sum, page) => sum + page.bytes, 0)} bytes`,
  );
}

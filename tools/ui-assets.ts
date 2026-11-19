import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { UI_AUDIO, UiPackSchema, UiTokensSchema } from '../packages/contracts/src/ui';
import { layoutUiPack } from '../packages/game-core/src/ui-resources';
import { canonicalJson } from '../packages/game-core/src/snapshot';
const root = fileURLToPath(new URL('../', import.meta.url));
const sha = (input: Buffer | string) => createHash('sha256').update(input).digest('hex');
const sources = ['tools/ui-textures.mjs', 'packages/game-core/src/ui-resources.ts', 'config/ui-tokens.json'];
function generatorHash(base: string) {
  return sha(canonicalJson(sources.map((file) => ({ file, sha256: sha(readFileSync(path.join(base, file))) }))));
}
export function verifyUiPack(base = root) {
  const pack = UiPackSchema.parse(
    JSON.parse(readFileSync(path.join(base, 'client/public/assets/ui/pack.json'), 'utf8')),
  );
  const layout = layoutUiPack();
  const tokens = UiTokensSchema.parse(JSON.parse(readFileSync(path.join(base, 'config/ui-tokens.json'), 'utf8')));
  if (
    canonicalJson(pack.sprites) !== canonicalJson(layout.sprites) ||
    pack.tokensVersion !== tokens.version ||
    pack.generatorSha256 !== generatorHash(base) ||
    pack.audio.sha256 !== sha(readFileSync(path.join(base, pack.audio.sourcePath)))
  )
    throw new Error('UI resources changed; export again');
  const { version, ...payload } = pack;
  if (version !== `ui-assets-${sha(canonicalJson(payload)).slice(0, 16)}`)
    throw new Error('UI package version mismatch');
  for (const page of pack.pages) {
    const bytes = readFileSync(path.join(base, 'client/public', page.path));
    if (
      sha(bytes) !== page.sha256 ||
      bytes.length !== page.bytes ||
      bytes.readUInt32BE(16) !== page.width ||
      bytes.readUInt32BE(20) !== page.height
    )
      throw new Error(`UI image mismatch: ${page.id}`);
  }
  return pack;
}
async function exportUiPack() {
  const layout = layoutUiPack();
  const tokens = UiTokensSchema.parse(JSON.parse(readFileSync(path.join(root, 'config/ui-tokens.json'), 'utf8')));
  const audioSource = readFileSync(path.join(root, 'client/src/sfx.ts'));
  if (UI_AUDIO.some((name) => !new RegExp(`\\b${name}:`).test(audioSource.toString())))
    throw new Error('Missing audio effect');
  mkdirSync(path.join(root, 'client/public/assets/ui'), { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>Original UI exporter</title>');
    await page.addScriptTag({ content: readFileSync(path.join(root, 'tools/ui-textures.mjs'), 'utf8') });
    const pages = [];
    for (const definition of layout.pages) {
      const request = { page: definition, sprites: layout.sprites.filter((s) => s.pageId === definition.id), tokens };
      const url = await page.evaluate(
        (value) => (globalThis as unknown as { renderUiPack: (v: unknown) => string }).renderUiPack(value),
        request,
      );
      const bytes = Buffer.from(url.split(',')[1], 'base64');
      writeFileSync(path.join(root, 'client/public', definition.path), bytes);
      pages.push({ ...definition, bytes: bytes.length, sha256: sha(bytes) });
    }
    const payload = {
      ...layout,
      pages,
      tokensVersion: tokens.version,
      generatorSha256: generatorHash(root),
      generatorEngine: `chromium-${browser.version()}`,
      audio: {
        ids: [...UI_AUDIO],
        sourcePath: 'client/src/sfx.ts',
        sha256: sha(audioSource),
        strategy: 'user-gesture-procedural',
      },
    };
    const pack = UiPackSchema.parse({ ...payload, version: `ui-assets-${sha(canonicalJson(payload)).slice(0, 16)}` });
    writeFileSync(path.join(root, 'client/public/assets/ui/pack.json'), JSON.stringify(pack, null, 2) + '\n');
    return verifyUiPack();
  } finally {
    await browser.close();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pack = process.argv.includes('--check') ? verifyUiPack() : await exportUiPack();
  console.log(
    `UI package ${pack.version}: ${pack.sprites.length} sprites, ${pack.pages.length} pages, ${pack.pages.reduce((sum, p) => sum + p.bytes, 0)} bytes; ${pack.audio.ids.length} procedural sounds`,
  );
}

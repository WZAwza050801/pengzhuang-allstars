import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import fields from '../data/fields.json';
import { AssetVariantsSchema } from '../packages/contracts/src/asset-variants';
import { canonicalJson } from '../packages/game-core/src/snapshot';
const root = fileURLToPath(new URL('../', import.meta.url));
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const sources = () =>
  [...new Set(fields.skins.flatMap((s) => [s.art, s.scene].filter((p): p is string => !!p)))].sort();
const generatorHash = (base: string) => sha(readFileSync(path.join(base, 'tools/asset-variants.ts')));
export function verifyAssetVariants(base = root) {
  const pack = AssetVariantsSchema.parse(
    JSON.parse(readFileSync(path.join(base, 'client/public/assets/fields/low/manifest.json'), 'utf8')),
  );
  const { version, ...payload } = pack;
  if (
    version !== `textures-${sha(canonicalJson(payload)).slice(0, 16)}` ||
    pack.generatorSha256 !== generatorHash(base)
  )
    throw new Error('Texture variants stale');
  if (
    pack.variants.length !== sources().length ||
    sources().some((p) => !pack.variants.some((v) => v.sourcePath === `/${p}`))
  )
    throw new Error('Field variants incomplete');
  for (const v of pack.variants) {
    const input = readFileSync(path.join(base, 'client/public', v.sourcePath)),
      out = readFileSync(path.join(base, 'client/public', v.path));
    if (sha(input) !== v.sourceSha256 || sha(out) !== v.sha256 || out.length !== v.bytes)
      throw new Error('Texture variant content mismatch');
  }
  return pack;
}
async function exportVariants() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>Texture resolution export</title>');
    const variants = [];
    mkdirSync(path.join(root, 'client/public/assets/fields/low'), { recursive: true });
    for (const source of sources()) {
      const input = readFileSync(path.join(root, 'client/public', source)),
        mime = source.endsWith('.webp') ? 'image/webp' : source.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
      const result = await page.evaluate(
        async ({ url, maxEdge }) => {
          const image = new Image();
          image.src = url;
          await image.decode();
          const factor = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.naturalWidth * factor));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * factor));
          const ctx = canvas.getContext('2d')!;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          return {
            url: canvas.toDataURL('image/webp', 0.84),
            width: canvas.width,
            height: canvas.height,
            sourceWidth: image.naturalWidth,
            sourceHeight: image.naturalHeight,
          };
        },
        { url: `data:${mime};base64,${input.toString('base64')}`, maxEdge: 768 },
      );
      const bytes = Buffer.from(result.url.split(',')[1], 'base64'),
        output = `/assets/fields/low/field-${sha(source).slice(0, 12)}.webp`;
      writeFileSync(path.join(root, 'client/public', output), bytes);
      variants.push({
        sourcePath: `/${source}`,
        sourceSha256: sha(input),
        sourceWidth: result.sourceWidth,
        sourceHeight: result.sourceHeight,
        path: output,
        sha256: sha(bytes),
        bytes: bytes.length,
        width: result.width,
        height: result.height,
      });
    }
    const payload = {
      schemaVersion: 1,
      maxEdge: 768,
      generatorSha256: generatorHash(root),
      generatorEngine: `chromium-${browser.version()}`,
      variants,
    };
    const pack = AssetVariantsSchema.parse({
      ...payload,
      version: `textures-${sha(canonicalJson(payload)).slice(0, 16)}`,
    });
    writeFileSync(
      path.join(root, 'client/public/assets/fields/low/manifest.json'),
      JSON.stringify(pack, null, 2) + '\n',
    );
    return verifyAssetVariants();
  } finally {
    await browser.close();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pack = process.argv.includes('--check') ? verifyAssetVariants() : await exportVariants();
  console.log(
    `Texture variants ${pack.version}: ${pack.variants.length} full-image low-resolution fields, ${pack.variants.reduce((sum, v) => sum + v.bytes, 0)} bytes`,
  );
}

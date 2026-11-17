import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { AssetCatalogSchema, type AssetCatalog } from '../packages/contracts/src/assets';
import { canonicalJson } from '../packages/game-core/src/snapshot';
import { PROTOCOL_VERSION } from '../shared/protocol';
import fields from '../data/fields.json';
import players from '../data/players.json';
import portraits from '../data/portrait_map.json';
import displayCatalog from '../data/player_catalog.json';
import provenance from '../config/asset-sources.json';
import policy from '../config/asset-catalog-policy.json';
import { verifyCardAtlas } from './card-atlas';
import { verifyUiPack } from './ui-assets';
import { verifyAssetVariants } from './asset-variants';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const fileId = (p: string) => p.replaceAll('/', '.');
export function imageSize(b: Buffer): { width: number; height: number } {
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && b.length >= 24)
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length >= 10 && b.readUInt16LE(0) === 0 && b.readUInt16LE(2) === 1 && b.readUInt16LE(4) > 0)
    return { width: b[6] || 256, height: b[7] || 256 };
  if (b.subarray(0, 2).equals(Buffer.from([255, 216]))) {
    let i = 2;
    while (i + 8 < b.length) {
      if (b[i++] !== 255) throw new Error('Invalid JPEG marker');
      while (b[i] === 255) i++;
      const marker = b[i++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const size = b.readUInt16BE(i);
      if (size < 2 || i + size > b.length) throw new Error('Invalid JPEG size');
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker))
        return { height: b.readUInt16BE(i + 3), width: b.readUInt16BE(i + 5) };
      i += size;
    }
  }
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 16383, height: b.readUInt16LE(28) & 16383 };
    if (kind === 'VP8L' && b[20] === 47) {
      const n = b.readUInt32LE(21);
      return { width: (n & 16383) + 1, height: ((n >>> 14) & 16383) + 1 };
    }
  }
  throw new Error('Unsupported or corrupt image header');
}
function files(directory: string): string[] {
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const full = path.join(directory, name),
        s = lstatSync(full);
      if (s.isSymbolicLink()) throw new Error('Asset symlink needs explicit review');
      return s.isDirectory() ? files(full) : s.isFile() ? [full] : [];
    });
}
/** Explicit URLs and the finite legacy UI naming domain used by both validation and packaging. */
export function runtimeReferencedPaths(root = ROOT): Set<string> {
  const required = new Set<string>();
  for (const entry of displayCatalog.entries)
    for (const skill of entry.skills) required.add(`/assets/skills/${skill.icon}.png`);
  for (const source of [...files(path.join(root, 'client/src')), path.join(root, 'client/index.html')].filter((p) =>
    /\.(ts|css|html)$/.test(p),
  )) {
    const text = readFileSync(source, 'utf8');
    for (const match of text.matchAll(/\/(?:assets|art)\/[A-Za-z0-9_./-]+\.(?:png|jpg|webp|ico)/g))
      required.add(match[0]);
    if (!source.endsWith('.ts')) continue;
    const tree = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'ui') {
        const input = node.arguments[0];
        if (input && ts.isStringLiteral(input)) required.add(`/assets/orig_ui/${input.text}.png`);
        else if (
          input &&
          ts.isBinaryExpression(input) &&
          input.operatorToken.kind === ts.SyntaxKind.PlusToken &&
          ts.isStringLiteral(input.left)
        ) {
          const prefix = input.left.text,
            domain = policy.dynamicUi.find((v) => v.prefix === prefix);
          if (!domain) throw new Error(`Unenumerated UI prefix: ${prefix}`);
          for (const value of domain.values) required.add(`/assets/orig_ui/${prefix}${value}.png`);
        }
      }
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (/^(?:Btn_Icon_|Store_Icon_|Tab_Icon_|Ico_|Logo_|Image_|Img_|Player_Attributes_)\w+$/.test(node.text))
          required.add(`/assets/orig_ui/${/^(?:Image_|Img_)/.test(node.text) ? 'stadium/' : ''}${node.text}.png`);
        if (/(?:^|\/)materials\/|(?:^|\/)art\/raw\//.test(node.text) && !node.text.startsWith('/art/'))
          throw new Error(`Runtime source-directory reference: ${source}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return required;
}
/** All public images are enumerated; alias references provide the verified dynamic expansions. */
export function createAssetCatalog(root = ROOT): AssetCatalog {
  const cardAtlas = verifyCardAtlas(root);
  const uiPack = verifyUiPack(root);
  const variants = verifyAssetVariants(root);
  const publicDir = path.join(root, 'client/public');
  const assets: AssetCatalog['assets'] = [];
  const aliases: AssetCatalog['aliases'] = [];
  for (const full of files(publicDir)) {
    const rel = path.relative(publicDir, full).replaceAll(path.sep, '/');
    if (policy.excluded.some((e) => e.path === rel)) continue;
    const sourcePath = `client/public/${rel}`;
    const rule = provenance.rules.find((r) => sourcePath.startsWith(r.prefix));
    if (!rule) throw new Error(`Missing provenance: ${rel}`);
    const bytes = readFileSync(full),
      isData = rel.endsWith('.json'),
      dimensions = isData ? { width: null, height: null } : imageSize(bytes);
    assets.push({
      id: fileId(rel),
      kind: isData ? 'data' : 'image',
      path: `/${rel}`,
      bytes: bytes.length,
      sha256: sha(bytes),
      ...dimensions,
      anchors: isData ? {} : { center: { x: 0.5, y: 0.5, space: 'normalized' } },
      category: rule.category,
      priority:
        rel === 'favicon.ico'
          ? 'critical'
          : rel.startsWith('assets/orig_ui/') || rel.startsWith('assets/cards/') || rel.startsWith('assets/ui/')
            ? 'lobby'
            : rel.startsWith('art/')
              ? 'optional'
              : 'match',
      source: {
        evidence: rule.evidence,
        kind: rule.category.includes('original') ? 'original' : rule.category.includes('rebuilt') ? 'rebuilt' : 'mixed',
      },
      rights: 'unverified',
      releaseAllowed: false,
      rightsEvidence: null,
      geometryVersion: rel.startsWith('assets/fields/') ? fields.version : null,
    });
  }
  const alias = (id: string, rel: string, usage: AssetCatalog['aliases'][number]['usage']) => {
    if (!assets.some((a) => a.id === fileId(rel))) throw new Error(`Missing asset for ${id}: ${rel}`);
    aliases.push({ id, target: fileId(rel), usage });
  };
  const raw = (id: string, filename: string, kind: 'procedural-field' | 'procedural-audio') => {
    const filenames =
      kind === 'procedural-field'
        ? [filename, 'client/src/quality.ts', 'packages/game-core/src/field-art.ts', 'packages/game-core/src/camera.ts']
        : [filename];
    const sources = filenames.map((name) => ({ path: name, bytes: readFileSync(path.join(root, name)) }));
    const b = canonicalJson(sources.map((source) => ({ path: source.path, sha256: sha(source.bytes) })));

    assets.push({
      id,
      kind,
      path: null,
      bytes: sources.reduce((sum, source) => sum + source.bytes.length, 0),
      sha256: sha(b),
      width: null,
      height: null,
      anchors: {},
      category: kind,
      priority: 'match',
      source: { evidence: filenames.join('; '), kind: 'rebuilt' },
      rights: 'unverified',
      releaseAllowed: false,
      rightsEvidence: null,
      geometryVersion: kind === 'procedural-field' ? fields.version : null,
    });
  };
  raw('procedural.field', 'client/src/render.ts', 'procedural-field');
  raw('procedural.audio', 'client/src/sfx.ts', 'procedural-audio');
  for (const skin of fields.skins) {
    if (skin.art) alias(`field.${skin.id}.art`, skin.art, 'field-art');
    if (skin.scene) {
      alias(`field.${skin.id}.scene`, skin.scene, 'field-scene');
      const entry = assets.find((a) => a.id === fileId(skin.scene))!;
      const [l, t, r, b] = skin.artCrop!;
      const [sw, sh] = skin.sceneSize!;
      entry.anchors.playTopLeft = { x: l / sw, y: t / sh, space: 'normalized' };
      entry.anchors.playBottomRight = { x: r / sw, y: b / sh, space: 'normalized' };
    } else aliases.push({ id: `field.${skin.id}.generated`, target: 'procedural.field', usage: 'field-generated' });
  }
  for (const player of players.players) {
    const original = portraits.entries.find((e) => e.id === player.id)?.portraitId;
    alias(
      `player.${player.id}.portrait`,
      original ? `assets/players_original/${original}.png` : `assets/players/${player.id}_avatar.png`,
      'portrait',
    );
  }
  for (const portrait of cardAtlas.portraits) {
    const page = cardAtlas.pages.find((p) => p.id === portrait.pageId)!;
    alias(`player.${portrait.playerId}.cardPortrait`, page.path.slice(1), 'card-portrait');
  }
  alias('card.atlas', 'assets/cards/atlas.json', 'card-data');
  for (const frame of cardAtlas.frames) {
    const page = cardAtlas.pages.find((p) => p.id === frame.pageId)!;
    alias(`card.frame.${frame.quality}.${frame.state}`, page.path.slice(1), 'card-frame');
  }
  for (let i = 1; i <= 5; i++) alias(`lobby.stadium.${i}`, `assets/orig_ui/stadium/Image_0${i}.png`, 'lobby-field');
  alias('ui.pack', 'assets/ui/pack.json', 'ui-data');
  for (const sprite of uiPack.sprites) {
    const page = uiPack.pages.find((p) => p.id === sprite.pageId)!;
    alias(
      `ui.${sprite.id}`,
      page.path.slice(1),
      sprite.kind === 'surface' ? 'ui-surface' : sprite.kind === 'icon' ? 'ui-icon' : 'ui-stadium',
    );
  }
  const sfx = readFileSync(path.join(root, 'client/src/sfx.ts'), 'utf8');
  alias('asset.variants', 'assets/fields/low/manifest.json', 'asset-variants');
  for (const variant of variants.variants)
    alias(`low.${fileId(variant.sourcePath.slice(1))}`, variant.path.slice(1), 'low-resolution');
  for (const name of ['hit', 'kick', 'wall', 'spring', 'post', 'shoot', 'goal', 'skill', 'turn']) {
    if (!new RegExp(`\\b${name}:`).test(sfx)) throw new Error(`Unknown procedural audio ${name}`);
    aliases.push({ id: `audio.${name}`, target: 'procedural.audio', usage: 'audio' });
  }
  // Static paths in TS/CSS/HTML, plus enumerated dynamic UI tokens, are all checked against actual files.
  for (const ref of runtimeReferencedPaths(root))
    if (!assets.some((a) => a.path === ref)) throw new Error(`Missing referenced resource: ${ref}`);
  assets.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  aliases.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const payload = {
    schemaVersion: 1 as const,
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    assets,
    aliases,
  };
  return AssetCatalogSchema.parse({ ...payload, version: `assets-${sha(canonicalJson(payload)).slice(0, 16)}` });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = path.join(ROOT, 'client/public/assets/catalog.json');
  const catalog = createAssetCatalog();
  const content = JSON.stringify(catalog, null, 2) + '\n';
  if (process.argv.includes('--write')) writeFileSync(target, content);
  else if (!existsSync(target) || readFileSync(target, 'utf8') !== content)
    throw new Error('Asset catalog stale; review and run npm run assets:catalog');
  console.log(
    `Asset catalog ${catalog.version}: ${catalog.assets.length} resources, ${catalog.aliases.length} verified aliases; release approved=${catalog.assets.filter((a) => a.releaseAllowed).length}`,
  );
}

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { UiTokensSchema } from '../packages/contracts/src/ui';
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, 'client/src/ui/generated');
export function tokenOutputs() {
  const tokens = UiTokensSchema.parse(JSON.parse(readFileSync(path.join(root, 'config/ui-tokens.json'), 'utf8')));
  const variables = [
    `--ui-touch-target:${tokens.touchTarget}px`,
    `--ui-radius:${tokens.radius}px`,
    ...Object.entries(tokens.typography).map(
      ([key, value]) => `--ui-${key}:${value}${key === 'lineHeight' ? '' : 'px'}`,
    ),
    ...tokens.spacing.map((value) => `--ui-space-${value}:${value}px`),
    ...Object.entries(tokens.motion).map(([key, value]) => `--ui-${key}:${value}ms`),
    ...Object.entries(tokens.quality).map(([key, value]) => `--ui-quality-${key}:${value}`),
  ];
  const palettes = Object.entries(tokens.themes).map(
    ([name, colors]) =>
      `${name === 'light' ? ':root,' : ''}[data-ui-theme="${name}"]{color-scheme:${name};${Object.entries(colors)
        .map(([key, value]) => `--ui-${key}:${value}`)
        .join(';')}}`,
  );
  return {
    css: `/* Generated from config/ui-tokens.json (${tokens.version}); run npm run ui:tokens. */\n:root{${variables.join(';')}}\n${palettes.join('\n')}\n@media(prefers-reduced-motion:reduce){:root{--ui-fastMs:0ms;--ui-normalMs:0ms}}\n`,
    canvas: JSON.stringify(tokens, null, 2) + '\n',
  };
}
export function verifyTokenOutputs() {
  const output = tokenOutputs();
  for (const [filename, content] of [
    ['tokens.css', output.css],
    ['tokens.canvas.json', output.canvas],
  ])
    if (readFileSync(path.join(destination, filename), 'utf8') !== content)
      throw new Error(`Generated tokens stale: ${filename}`);
  return true;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) {
    mkdirSync(destination, { recursive: true });
    const output = tokenOutputs();
    writeFileSync(path.join(destination, 'tokens.css'), output.css);
    writeFileSync(path.join(destination, 'tokens.canvas.json'), output.canvas);
  }
  verifyTokenOutputs();
  console.log('Web CSS and Canvas tokens match the single source');
}

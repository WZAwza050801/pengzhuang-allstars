import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const prohibited = new Set(['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'wx', 'AudioContext', 'Worker', 'HTMLElement', 'HTMLCanvasElement']);
let errors = 0;
let count = 0;
function walk(directory) {
  const folder = path.join(root, directory);
  if (!existsSync(folder)) return;
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) { if (!['node_modules', 'dist'].includes(entry.name)) walk(name); continue; }
    if (!name.endsWith('.ts')) continue;
    count++;
    const source = ts.createSourceFile(name, readFileSync(path.join(root, name), 'utf8'), ts.ScriptTarget.Latest, true);
    function report(what) { console.error(`Boundary: ${name}: ${what}`); errors++; }
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const spec = node.moduleSpecifier.text;
        if (/^(node:|react|express|colyseus|pg$|@capacitor)/.test(spec)) report(`forbidden dependency ${spec}`);
      }
      if (ts.isIdentifier(node) && prohibited.has(node.text)) report(`platform global ${node.text}`);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
for (const dir of ['shared', 'packages/game-core/src', 'packages/contracts/src']) walk(dir);
console.log(`Boundary checked ${count} portable source files`);
process.exitCode = errors ? 1 : 0;

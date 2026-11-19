import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createAssetPackage } from '../tools/asset-packages';

const root = fileURLToPath(new URL('.', import.meta.url));
const entryChunks = new Set<string>();

export default defineConfig({
  root,
  publicDir: 'public',
  plugins: [
    {
      name: 'skip-redundant-entry-preloads',
      apply: 'build',
      generateBundle: {
        order: 'pre',
        handler(_options, bundle) {
          entryChunks.clear();
          for (const chunk of Object.values(bundle))
            if (chunk.type === 'chunk' && chunk.isEntry) entryChunks.add(chunk.fileName);
        },
      },
    },
    {
      name: 'verified-asset-packages',
      apply: 'build',
      enforce: 'post',
      // Measure after Vite's dynamic-import rewriting: https://rollupjs.org/plugin-development/#build-hooks
      generateBundle: {
        order: 'post',
        handler(_options, bundle) {
          const { manifest, report } = createAssetPackage();
          for (const asset of manifest.assets)
            if (asset.path)
              this.emitFile({
                type: 'asset',
                fileName: asset.path.slice(1),
                source: readFileSync(path.join(root, 'public', asset.path)),
              });
          this.emitFile({
            type: 'asset',
            fileName: 'assets/catalog.json',
            source: JSON.stringify(manifest, null, 2) + '\n',
          });
          for (const group of report.packages)
            this.emitFile({
              type: 'asset',
              fileName: `packs/${group.id}.json`,
              source: JSON.stringify({ version: manifest.version, ...group }) + '\n',
            });
          const applicationFiles = Object.values(bundle).filter((item) => /\.(js|css)$/.test(item.fileName));
          const applicationBytes = applicationFiles.reduce(
            (sum, item) => sum + Buffer.byteLength(item.type === 'chunk' ? item.code : item.source),
            0,
          );
          this.emitFile({
            type: 'asset',
            fileName: 'asset-package-report.json',
            source:
              JSON.stringify(
                { ...report, applicationBytes, applicationFiles: applicationFiles.map((item) => item.fileName) },
                null,
                2,
              ) + '\n',
          });
        },
      },
    },
  ],
  server: {
    host: true,
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://localhost:2567',
      '/colyseus': { target: 'ws://localhost:2567', ws: true },
    },
  },
  build: {
    modulePreload: {
      // Entry scripts load through their document/import; lazy routes preload their other dependencies.
      resolveDependencies: (_file, dependencies, { hostType }) =>
        hostType === 'js' ? dependencies.filter((dependency) => !entryChunks.has(dependency)) : dependencies,
    },
    copyPublicDir: false,
    outDir: '../dist/client',
    emptyOutDir: true,
    target: 'es2022',
  },
});

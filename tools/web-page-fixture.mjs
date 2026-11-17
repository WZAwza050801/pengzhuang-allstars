import { tsImport } from 'tsx/esm/api';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

/** Real capabilities route; page suites never rely on a developer's port 2567. */
export async function startWebPageFixture(clientDirectory) {
  const { createGameServer } = await tsImport('../server/app.ts', import.meta.url);
  const { authOptionsModule } = await tsImport('../server/api/auth-options.ts', import.meta.url);
  const api = createGameServer({
    clientDirectory: clientDirectory ?? null,
    modules: [authOptionsModule(false, false, null)],
  });
  let vite;
  try {
    await api.gameServer.listen(0);
    const address = api.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('No fixture port');
    let base = `http://127.0.0.1:${address.port}/`;
    if (!clientDirectory) {
      vite = await createServer({
        configFile: fileURLToPath(new URL('../client/vite.config.ts', import.meta.url)),
        server: { host: '127.0.0.1', port: 0, open: false, proxy: { '/api': base } },
      });
      await vite.listen();
      base = vite.resolvedUrls.local?.[0];
      if (!base) throw new Error('No fixture URL');
    }
    return {
      base,
      async close() {
        try {
          await vite?.close();
        } finally {
          await api.close();
        }
      },
    };
  } catch (error) {
    try {
      await vite?.close();
    } finally {
      await api.close();
    }
    throw error;
  }
}

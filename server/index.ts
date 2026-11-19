import { readRuntimeConfig } from '../config/runtime';
import { startRuntime } from './runtime';

async function main(): Promise<void> {
  const server = await startRuntime(readRuntimeConfig());
  const address = server.httpServer.address();
  console.log(JSON.stringify({ event: 'server_started', port: typeof address === 'object' ? address?.port : null, recovery: server.recovery, accountRecovery: server.accountRecovery }));
  const shutdown = (signal: string): void => {
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
    console.log(JSON.stringify({ event: 'server_stopping', signal }));
    // Bound draining if a client keeps an HTTP request open indefinitely.
    const deadline = setTimeout(() => process.exit(1), 15000);
    deadline.unref();
    server.close().then(() => { clearTimeout(deadline); process.exit(0); }, () => {
      console.error(JSON.stringify({ event: 'server_shutdown_failed' }));
      clearTimeout(deadline); process.exit(1);
    });
  };
  const onInterrupt = () => shutdown('SIGINT');
  const onTerminate = () => shutdown('SIGTERM');
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
}
main().catch(() => { console.error(JSON.stringify({ event: 'server_startup_failed' })); process.exit(1); });

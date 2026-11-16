import type { AddressInfo } from 'node:net';
import { Client } from 'colyseus.js';
import { createGameServer } from '../server/app';
import { PROTOCOL_VERSION, ROOM_NAME } from '../shared/protocol';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const uncaught: string[] = [];
process.on('uncaughtException', (e) => {
  uncaught.push(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
});

async function probe(url: string, label: string, type: string, payload: unknown): Promise<void> {
  const before = uncaught.length;
  const client = new Client(url);
  const room = await client.create(ROOM_NAME, { protocol: PROTOCOL_VERSION, nickname: 'probe' });
  const log: string[] = [];
  room.onError.clear();
  room.onError((code, msg) => log.push(`onError ${code} ${String(msg).slice(0, 80)}`));
  room.onLeave((code, reason) => log.push(`onLeave ${code} ${String(reason).slice(0, 80)}`));
  room.onMessage('*', (t, m) => log.push(`msg ${String(t)} ${JSON.stringify(m)}`));
  await sleep(200);
  log.length = 0;
  room.send(type, payload);
  await sleep(600);
  console.log(`[${label}] type=${type} payloadLen=${typeof payload === 'string' ? payload.length : '-'}`);
  console.log(`   client saw: ${log.length ? log.join(' | ') : '(nothing)'}`);
  console.log(`   new uncaught exceptions: ${uncaught.slice(before).join(' | ') || '(none)'}`);
}

async function main(): Promise<void> {
  const { httpServer, gameServer } = createGameServer();
  await gameServer.listen(0);
  const port = (httpServer.address() as AddressInfo).port;
  console.log(`listening on ephemeral port ${port}`);
  const url = `ws://127.0.0.1:${port}`;

  await probe(url, 'A unknown type', 'whatever', 1);
  await probe(url, 'B __proto__', '__proto__', 1);
  await probe(url, 'C constructor', 'constructor', 1);
  await probe(url, 'D __no_message_handler short', '__no_message_handler', 'x');
  await probe(url, 'E __no_message_handler long', '__no_message_handler', 'y'.repeat(300));
  await probe(url, 'F __no_message_handler multibyte', '__no_message_handler', '球'.repeat(60));

  const res = await fetch(`http://127.0.0.1:${port}/healthz`);
  console.log(`healthz after probes: ${res.status}`);
  await gameServer.gracefullyShutdown(false);
  console.log('server shut down');
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('SCRATCH FAILED', err);
  process.exit(1);
});

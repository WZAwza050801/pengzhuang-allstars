import type { AddressInfo } from 'node:net';
import { Client, type Room } from 'colyseus.js';
import { createGameServer } from '../server/app';
import { PROTOCOL_VERSION, ROOM_NAME } from '../shared/protocol';
import { makeRng } from '../shared/rng';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const uncaught: string[] = [];
process.on('uncaughtException', (e) => {
  uncaught.push(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
});

const raw = (...bytes: number[]) => (room: Room) => room.connection.send(new Uint8Array(bytes));

async function probe(url: string, label: string, send: (room: Room) => void, quiet = false): Promise<{ closed: string | null; live: boolean; newUncaught: number }> {
  const before = uncaught.length;
  const client = new Client(url);
  const room = await client.create(ROOM_NAME, { protocol: PROTOCOL_VERSION, nickname: 'probe' });
  const log: string[] = [];
  let closed: string | null = null;
  room.onError.clear();
  room.onError((code, msg) => log.push(`onError ${code} ${String(msg).slice(0, 80)}`));
  room.onLeave((code, reason) => {
    closed = `${code} ${String(reason ?? '').slice(0, 60)}`.trim();
    log.push(`onLeave ${closed}`);
  });
  room.onMessage('*', (t, m) => log.push(`msg ${String(t)} ${JSON.stringify(m)}`));
  await sleep(quiet ? 40 : 150);
  log.length = 0;
  send(room);
  await sleep(quiet ? 80 : 450);
  const afterSend = log.slice();
  let live = false;
  if (closed === null) {
    log.length = 0;
    room.send('ready', { ready: false });
    await sleep(quiet ? 60 : 200);
    live = log.some((l) => l.startsWith('msg room '));
    await room.leave();
  }
  const newUncaught = uncaught.length - before;
  if (!quiet || newUncaught > 0) {
    console.log(`[${label}]`);
    console.log(`   after send: ${afterSend.length ? afterSend.join(' | ') : '(nothing)'}`);
    console.log(`   closed=${closed ?? 'no'}  liveness-after=${closed === null ? (live ? 'OK' : 'NO-REPLY') : 'n/a'}  new uncaught=${uncaught.slice(before).join(' | ') || '(none)'}`);
  }
  return { closed, live, newUncaught };
}

async function main(): Promise<void> {
  const { httpServer, gameServer } = createGameServer();
  await gameServer.listen(0);
  const port = (httpServer.address() as AddressInfo).port;
  console.log(`listening on ephemeral port ${port}`);
  const url = `ws://127.0.0.1:${port}`;

  await probe(url, 'A unknown type', (r) => r.send('whatever', 1));
  await probe(url, 'B __proto__', (r) => r.send('__proto__', 1));
  await probe(url, 'C constructor', (r) => r.send('constructor', 1));
  await probe(url, 'D __no_message_handler short', (r) => r.send('__no_message_handler', 'x'));
  await probe(url, 'E __no_message_handler long 300', (r) => r.send('__no_message_handler', 'y'.repeat(300)));
  await probe(url, 'F __no_message_handler multibyte 60x', (r) => r.send('__no_message_handler', '球'.repeat(60)));
  await probe(url, 'G shot with no payload', (r) => r.send('shot'));
  await probe(url, 'H shot with null', (r) => r.send('shot', null));
  await probe(url, 'I oversize 3000 B', (r) => r.send('shot', 'z'.repeat(3000)));
  await probe(url, 'J sendBytes shot [1,2,3]', (r) => r.sendBytes('shot', new Uint8Array([1, 2, 3])));
  await probe(url, 'K sendBytes shot empty', (r) => r.sendBytes('shot', new Uint8Array(0)));
  await probe(url, 'L sendBytes unknown', (r) => r.sendBytes('whatever', new Uint8Array([1])));
  await probe(url, 'M sendBytes __no_message_handler 300', (r) => r.sendBytes('__no_message_handler', new Uint8Array(300)));
  await probe(url, 'N numeric type 0', (r) => r.send(0, 1));
  await probe(url, 'O numeric type -1', (r) => r.send(-1));
  await probe(url, 'P numeric type 2**40', (r) => r.send(2 ** 40, 'x'));
  await probe(url, 'Q numeric type 1.5', (r) => r.send(1.5, 'x'));

  console.log('--- raw frames ---');
  await probe(url, 'R1 [13]', raw(13));
  await probe(url, 'R2 [13,0xca]', raw(13, 0xca));
  await probe(url, 'R3 [13,0xcb,1,2]', raw(13, 0xcb, 1, 2));
  await probe(url, 'R4 [13,0xd9,0xff]', raw(13, 0xd9, 0xff));
  await probe(url, 'R5 [13,0xdb,ff,ff,ff,ff]', raw(13, 0xdb, 0xff, 0xff, 0xff, 0xff));
  await probe(url, 'R6 [13,0xa1,0x61,0xc1]', raw(13, 0xa1, 0x61, 0xc1));
  await probe(url, 'R7 shot + corrupt msgpack', raw(13, 0xa4, 0x73, 0x68, 0x6f, 0x74, 0xc1));
  await probe(url, 'R8 [17] bytes with no type', raw(17));
  await probe(url, 'R9 [17,0xdb,ff,ff,ff,ff]', raw(17, 0xdb, 0xff, 0xff, 0xff, 0xff));
  await probe(url, 'R10 [99]', raw(99));
  await probe(url, 'R11 [0]', raw(0));
  await probe(url, 'R12 [255,1,2,3]', raw(255, 1, 2, 3));
  await probe(url, 'R13 [10] JOIN_ROOM replay', raw(10));
  await probe(url, 'R14 [11,1,0xa1,0x61] ERROR', raw(11, 1, 0xa1, 0x61));
  await probe(url, 'R15 [14] ROOM_STATE', raw(14, 1, 2, 3));
  await probe(url, 'R16 empty frame', raw());

  console.log('--- fuzz ---');
  const rng = makeRng(20261115);
  const rnd = (n: number) => Math.floor(rng.next() * n);
  const firstBytes = [13, 13, 13, 17, 17, 10, 14, 99];
  let closedCount = 0;
  let aliveCount = 0;
  let badReplyCount = 0;
  const N = 120;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const len = rnd(40);
    const bytes = [firstBytes[rnd(firstBytes.length)]];
    for (let j = 0; j < len; j++) bytes.push(rnd(256));
    const res = await probe(url, `fuzz#${i} [${bytes.join(',')}]`, raw(...bytes), true);
    if (res.closed !== null) closedCount++;
    else if (res.live) aliveCount++;
    else badReplyCount++;
  }
  console.log(`fuzz ${N} frames in ${Math.round(performance.now() - t0)} ms: kicked=${closedCount} alive=${aliveCount} no-reply=${badReplyCount}`);

  const res = await fetch(`http://127.0.0.1:${port}/healthz`);
  console.log(`healthz after probes: ${res.status}  total uncaught=${uncaught.length}${uncaught.length ? '  ' + uncaught.join(' | ') : ''}`);
  await gameServer.gracefullyShutdown(false);
  console.log('server shut down');
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('SCRATCH FAILED', err);
  process.exit(1);
});

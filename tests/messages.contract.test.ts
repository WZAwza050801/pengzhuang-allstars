import { expect, test } from 'vitest';
import {
  decodeBody,
  UpgradeSchema,
  RegisterSchema,
  LineupSchema,
  MoneySchema,
  MatchTicketSchema,
  supportsProtocol,
  parseNickname,
  parseSeatToken,
  parseReady,
  parseShotMessage,
  PROTOCOL_VERSION,
} from '@pengzhuang/contracts';
import { parseReady as serverReady } from '../server/validation';

test('HTTP body schemas reject authority claims and malformed numbers', () => {
  expect(decodeBody(UpgradeSchema, { expectedRevision: 0 }).ok).toBe(true);
  for (const body of [
    { expectedRevision: Infinity },
    { expectedRevision: NaN },
    { expectedRevision: -1 },
    { expectedRevision: 0, price: 0 },
    { expectedRevision: 0, resultingLevel: 10 },
  ])
    expect(decodeBody(UpgradeSchema, body).ok).toBe(false);
  expect(
    RegisterSchema.safeParse({ email: 'x@y.org', password: 'a'.repeat(12), nickname: '玩家', role: 'admin' }).success,
  ).toBe(false);
  expect(RegisterSchema.safeParse({ email: 'x@y.org', password: 'a'.repeat(300), nickname: '玩家' }).success).toBe(
    false,
  );
});
test('identifiers, card uniqueness and precise money are bounded', () => {
  const id = '72c415cf-481f-42ab-8a97-e021e8135b61';
  expect(LineupSchema.safeParse({ ownedCardIds: Array(5).fill(id), expectedRevision: 0 }).success).toBe(false);
  expect(MoneySchema.parse('9007199254740993')).toBe('9007199254740993');
  expect(MoneySchema.safeParse(Number('9007199254740993')).success).toBe(false);
  expect(MoneySchema.safeParse('9223372036854775808').success).toBe(false);
  expect(
    MatchTicketSchema.safeParse({ mode: 'friend', lineupId: id, expectedRevision: 0, protocol: PROTOCOL_VERSION + 1 })
      .success,
  ).toBe(false);
});
test('v1 protocol compatibility keeps nickname, ready and seat-token error codes', () => {
  expect(supportsProtocol(1)).toBe(true);
  for (const value of [0, 2, '1', null]) expect(supportsProtocol(value)).toBe(false);
  expect(parseNickname('  e\u0301  ')).toEqual({ ok: true, value: 'é' });
  expect(parseNickname('\u200b')).toEqual({ ok: false, code: 'bad-nickname' });
  expect(parseSeatToken('x')).toEqual({ ok: false, code: 'bad-seat-token' });
  expect(parseReady({ ready: true })).toEqual(serverReady({ ready: true }));
  expect(parseReady({ ready: true, role: 'admin' })).toEqual({ ok: false, code: 'bad-message' });
});
test('legacy shot shape defers numeric legality to authoritative rules', () => {
  const input = { pieceId: '0-0', dirX: NaN, dirY: 0, power: 0.5, curve: 0 };
  const body = { matchId: 'm1', turnId: 0, clientShotId: 's1', configVersion: 'v1', input };
  expect(parseShotMessage(body).ok).toBe(true);
  expect(parseShotMessage({ ...body, unexpected: true })).toEqual({ ok: false, code: 'bad-message' });
});

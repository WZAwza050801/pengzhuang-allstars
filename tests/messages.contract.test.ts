import { expect, test } from 'vitest';
import {
  decodeBody,
  UpgradeSchema,
  CraftSchema,
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
import { AccountRoomJoinSchema, MatchTicketResultSchema } from '@pengzhuang/contracts';

test('HTTP body schemas reject authority claims and malformed numbers', () => {
  expect(decodeBody(UpgradeSchema, { expectedRevision: 0, expectedEconomyVersion: 'economy-1' }).ok).toBe(true);
  for (const body of [
    { expectedRevision: Infinity },
    { expectedRevision: NaN },
    { expectedRevision: -1 },
    { expectedRevision: 0, price: 0 },
    { expectedRevision: 0, resultingLevel: 10 },
  ])
    expect(decodeBody(UpgradeSchema, { ...body, expectedEconomyVersion: 'economy-1' }).ok).toBe(false);
  expect(decodeBody(UpgradeSchema, { expectedRevision: 0 }).ok).toBe(false);
  expect(
    decodeBody(CraftSchema, { playerDefId: 'p03', expectedRevision: 0, expectedEconomyVersion: 'economy-1' }).ok,
  ).toBe(true);
  expect(
    decodeBody(CraftSchema, {
      playerDefId: 'p03',
      expectedRevision: 0,
      expectedEconomyVersion: 'economy-1',
      price: '1',
    }).ok,
  ).toBe(false);
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

test('account room tickets have bounded nonce/destination/expiry schemas and cannot carry authority claims', () => {
  const ticket = 'a'.repeat(43);
  expect(AccountRoomJoinSchema.parse({ protocol: PROTOCOL_VERSION, ticket })).toEqual({
    protocol: PROTOCOL_VERSION,
    ticket,
  });
  for (const extra of [
    { userId: 'fake' },
    { seatToken: 'a'.repeat(22) },
    { nickname: 'pretend' },
    { snapshot: {} },
    { protocol: 999 },
    { ticket: 'short' },
  ])
    expect(AccountRoomJoinSchema.safeParse({ protocol: PROTOCOL_VERSION, ticket, ...extra }).success).toBe(false);
  const result = {
    ticket,
    roomCode: 'ABCDEF',
    expiresAt: '2026-11-18T00:00:00.000Z',
    protocol: PROTOCOL_VERSION,
    mode: 'friend',
    configVersion: 'test',
  };
  expect(MatchTicketResultSchema.safeParse(result).success).toBe(true);
  for (const extra of [
    { roomCode: '../../bad' },
    { expiresAt: 'tomorrow' },
    { ticket: 'a'.repeat(2048) },
    { accessToken: 'secret' },
  ])
    expect(MatchTicketResultSchema.safeParse({ ...result, ...extra }).success).toBe(false);
});

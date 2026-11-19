import { expect, test } from 'vitest';
import { SignedMoneySchema } from '../packages/contracts/src/money';
import { LedgerPageSchema } from '../packages/contracts/src/economy-operations';

test('ledger amounts preserve the complete signed int64 string domain and reject lossy numeric forms', () => {
  for (const value of ['0', '9007199254740993', '-9007199254740993', '9223372036854775807', '-9223372036854775808'])
    expect(SignedMoneySchema.parse(value)).toBe(value);
  for (const value of [
    '-0',
    '01',
    '+1',
    '1e3',
    '1.5',
    '9223372036854775808',
    '-9223372036854775809',
    1,
    Number('9007199254740993'),
    null,
  ])
    expect(SignedMoneySchema.safeParse(value).success).toBe(false);
});
test('public ledger DTOs reject credential/hash or target-user additions', () => {
  const entry = {
    id: '00000000-0000-4000-8000-000000000001',
    currency: 'coins',
    delta: '-9007199254740993',
    balanceAfter: '300',
    reason: 'admin.correction',
    sourceId: 'fixture:1',
    createdAt: '2026-11-18T00:00:00.000Z',
  };
  expect(LedgerPageSchema.safeParse({ entries: [entry], nextCursor: null }).success).toBe(true);
  for (const extra of [{ userId: entry.id }, { payloadHash: 'secret' }, { refreshToken: 'secret' }])
    expect(LedgerPageSchema.safeParse({ entries: [{ ...entry, ...extra }], nextCursor: null }).success).toBe(false);
});

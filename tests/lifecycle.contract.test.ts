import { expect, test } from 'vitest';
import {
  DeleteAccountSchema,
  ReauthenticateSchema,
  LinkIdentitySchema,
  DeletionRecoverySchema,
} from '../packages/contracts/src/lifecycle';
import { HTTP_CONTRACTS } from '../packages/contracts/src/http';

test('lifecycle schemas accept proofs and explicit deletion intent, never client authority', () => {
  expect(ReauthenticateSchema.safeParse({ method: 'password', password: 'current' }).success).toBe(true);
  for (const extra of [{ userId: 'other' }, { authenticatedUntil: 'forever' }, { role: 'admin' }])
    expect(ReauthenticateSchema.safeParse({ method: 'password', password: 'current', ...extra }).success).toBe(false);
  expect(LinkIdentitySchema.safeParse({ provider: 'wechat', openid: 'forged' }).success).toBe(false);
  expect(LinkIdentitySchema.safeParse({ provider: 'email', email: 'x@example.test', password: 'weak' }).success).toBe(
    false,
  );
  expect(
    DeletionRecoverySchema.safeParse({
      method: 'password',
      email: 'x@example.test',
      password: 'current',
      userId: 'victim',
    }).success,
  ).toBe(false);
  expect(DeleteAccountSchema.safeParse({ confirm: 'DELETE' }).success).toBe(true);
  expect(DeleteAccountSchema.safeParse({ confirm: true }).success).toBe(false);
  expect(
    HTTP_CONTRACTS.filter((item) => item.path === '/api/v1/me')
      .map((item) => item.method)
      .sort(),
  ).toEqual(['delete', 'get']);
});

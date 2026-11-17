import { expect, test } from 'vitest';
import { Passwords } from '../server/accounts/passwords';

test('Argon2id uses independent random salts, the fixed policy and full Unicode passwords', async () => {
  const passwords = new Passwords();
  const secret = '测试-passphrase-0123456789';
  const [first, second] = await Promise.all([passwords.hash(secret), passwords.hash(secret)]);
  expect(first).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  expect(first).not.toBe(second);
  expect(first).not.toContain(secret);
  expect(await passwords.matches(secret, first)).toBe(true);
  expect(await passwords.matches(`${secret}x`, first)).toBe(false);
  expect(await passwords.matches(secret, null)).toBe(false);
  expect(await passwords.matches(secret, 'malformed')).toBe(false);
});
test('native password work refuses an unbounded concurrent allocation', async () => {
  const passwords = new Passwords();
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => passwords.hash('load-test-passphrase-123')));
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(4);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
});

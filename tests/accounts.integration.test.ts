import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  AccountRepository,
  DuplicateIdentityError,
  InvalidAccountStatusTransitionError,
  Database,
  migrateDatabase,
} from '@pengzhuang/persistence';
import { readRuntimeConfig } from '../config/runtime';

const hash = (seed: string) => seed.padEnd(64, '0');

describe('account persistence', () => {
  let db: Database;
  let accounts: AccountRepository;

  beforeAll(async () => {
    const config = readRuntimeConfig({ ...process.env, APP_ENV: 'test' });
    if (!config.databaseUrl) throw new Error('Real TEST_DATABASE_URL is required; integration tests cannot be skipped');
    db = new Database({ connectionString: config.databaseUrl, max: 4 });
    await migrateDatabase(db);
    accounts = new AccountRepository(db);
  });

  afterAll(async () => {
    await db?.close();
  });

  test('creates a long-lived user and records status transitions without allowing deleted users to reactivate', async () => {
    const user = await accounts.createUser();
    expect(user.status).toBe('active');
    expect(user.deletedAt).toBeNull();

    const deleting = await accounts.transitionStatus(user.id, 'deleting');
    expect(deleting.deletionRequestedAt).toBeInstanceOf(Date);
    const deleted = await accounts.transitionStatus(user.id, 'deleted');
    expect(deleted.deletedAt).toBeInstanceOf(Date);
    await expect(accounts.transitionStatus(user.id, 'active')).rejects.toBeInstanceOf(
      InvalidAccountStatusTransitionError,
    );
  });

  test('preserves provider app and subject uniqueness under concurrent identity linking', async () => {
    const [first, second] = await Promise.all([accounts.createUser(), accounts.createUser()]);
    const attempts = await Promise.allSettled([
      accounts.linkIdentity({
        userId: first.id,
        provider: 'wechat',
        providerAppId: 'wx-test-app',
        providerSubject: 'open-id-123',
      }),
      accounts.linkIdentity({
        userId: second.id,
        provider: 'wechat',
        providerAppId: 'wx-test-app',
        providerSubject: 'open-id-123',
      }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')[0]?.reason).toBeInstanceOf(
      DuplicateIdentityError,
    );
    expect(
      await accounts.findUserByIdentity({
        provider: 'wechat',
        providerAppId: 'wx-test-app',
        providerSubject: 'open-id-123',
      }),
    ).not.toBeNull();
  });

  test('stores opaque credential, verification and session hashes without returning their values', async () => {
    const user = await accounts.createUser();
    await accounts.setPasswordCredential({ userId: user.id, passwordHash: '$argon2id$opaque-test-hash' });
    expect(await accounts.hasPasswordCredential(user.id)).toBe(true);

    const expiresAt = new Date(Date.now() + 60_000);
    await accounts.createVerificationToken({
      userId: user.id,
      purpose: 'email-verification',
      tokenHash: hash('verification'),
      expiresAt,
    });
    expect(
      await accounts.consumeVerificationToken({ purpose: 'email-verification', tokenHash: hash('verification') }),
    ).toEqual(user.id);
    expect(
      await accounts.consumeVerificationToken({ purpose: 'email-verification', tokenHash: hash('verification') }),
    ).toBeNull();

    const session = await accounts.createSession({
      userId: user.id,
      refreshTokenHash: hash('refresh'),
      familyId: randomUUID(),
      expiresAt,
      deviceLabel: 'integration test',
    });
    expect('refreshTokenHash' in session).toBe(false);
    expect(await accounts.revokeSession({ userId: user.id, sessionId: session.id })).toBe(true);
    expect(await accounts.revokeSession({ userId: user.id, sessionId: session.id })).toBe(false);
  });

  test('database foreign keys reject identities for unknown users', async () => {
    await expect(
      accounts.linkIdentity({
        userId: randomUUID(),
        provider: 'email',
        providerAppId: 'primary',
        providerSubject: 'missing@example.test',
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

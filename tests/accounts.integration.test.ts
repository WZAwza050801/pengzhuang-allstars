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

  test('isolates identical provider subjects by app and keeps each user binding unique within an app', async () => {
    const [first, second] = await Promise.all([accounts.createUser(), accounts.createUser()]);
    await accounts.linkIdentity({
      userId: first.id,
      provider: 'wechat',
      providerAppId: 'app-a',
      providerSubject: 'shared-subject',
    });
    await accounts.linkIdentity({
      userId: second.id,
      provider: 'wechat',
      providerAppId: 'app-b',
      providerSubject: 'shared-subject',
    });
    expect(
      (
        await accounts.findUserByIdentity({
          provider: 'wechat',
          providerAppId: 'app-a',
          providerSubject: 'shared-subject',
        })
      )?.id,
    ).toBe(first.id);
    expect(
      (
        await accounts.findUserByIdentity({
          provider: 'wechat',
          providerAppId: 'app-b',
          providerSubject: 'shared-subject',
        })
      )?.id,
    ).toBe(second.id);
    await expect(
      accounts.linkIdentity({
        userId: first.id,
        provider: 'wechat',
        providerAppId: 'app-a',
        providerSubject: 'other-subject',
      }),
    ).rejects.toBeInstanceOf(DuplicateIdentityError);
    await expect(db.query('DELETE FROM users WHERE id = $1', [first.id])).rejects.toMatchObject({ code: '23503' });
  });

  test('records bans and rejects status transitions that bypass the deletion lifecycle', async () => {
    const user = await accounts.createUser();
    const banned = await accounts.transitionStatus(user.id, 'banned');
    expect(banned.bannedAt).toBeInstanceOf(Date);
    expect((await accounts.transitionStatus(user.id, 'active')).status).toBe('active');
    await expect(accounts.transitionStatus(user.id, 'deleted')).rejects.toBeInstanceOf(
      InvalidAccountStatusTransitionError,
    );
  });

  test('consumes a verification token only once under contention and rejects expired or wrong-purpose tokens', async () => {
    const user = await accounts.createUser();
    const tokenHash = hash('concurrent');
    await accounts.createVerificationToken({
      userId: user.id,
      purpose: 'password-reset',
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await accounts.consumeVerificationToken({ purpose: 'email-verification', tokenHash })).toBeNull();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => accounts.consumeVerificationToken({ purpose: 'password-reset', tokenHash })),
    );
    expect(results.filter((result) => result === user.id)).toHaveLength(1);
    await db.query(
      "INSERT INTO verification_tokens(user_id, purpose, token_hash, created_at, expires_at) VALUES ($1, 'password-reset', $2, now() - interval '2 hours', now() - interval '1 hour')",
      [user.id, hash('expired')],
    );
    expect(
      await accounts.consumeVerificationToken({ purpose: 'password-reset', tokenHash: hash('expired') }),
    ).toBeNull();
  });

  test('session ownership and refresh hash uniqueness are enforced by the database', async () => {
    const [owner, other] = await Promise.all([accounts.createUser(), accounts.createUser()]);
    const input = {
      userId: owner.id,
      refreshTokenHash: hash('unique-session'),
      familyId: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
    };
    const session = await accounts.createSession(input);
    await expect(accounts.createSession(input)).rejects.toMatchObject({ code: '23505' });
    expect(await accounts.revokeSession({ userId: other.id, sessionId: session.id })).toBe(false);
    expect(await accounts.revokeSession({ userId: owner.id, sessionId: session.id })).toBe(true);
  });
});

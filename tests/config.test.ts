import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'vitest';
import { ConfigurationError, describeRuntimeConfig, readRuntimeConfig } from '../config/runtime';

const production = () => ({
  APP_ENV: 'production',
  PUBLIC_ORIGIN: 'https://game.example.org',
  DATABASE_URL: 'postgresql://game:secret@localhost/game',
  SESSION_SIGNING_KEY: randomBytes(32).toString('base64url'),
});
test('local defaults preserve existing port and store', () => {
  const cfg = readRuntimeConfig({});
  assert.equal(cfg.port, 2567);
  assert.equal(cfg.devAuthBypass, false);
  assert.equal(cfg.cookieSecure, false);
  assert.ok(Object.isFrozen(cfg.allowedOrigins));
});
test('port, flag and origin validation rejects malformed input', () => {
  for (const env of [
    { PORT: '0' },
    { PORT: '65536' },
    { PORT: 'wat' },
    { DEV_AUTH_BYPASS: 'yes' },
    { PUBLIC_ORIGIN: 'https://example.org/path' },
    { ALLOWED_ORIGINS: '*' },
    { ALLOWED_ORIGINS: 'https://*.example.org' },
  ]) {
    assert.throws(() => readRuntimeConfig(env), ConfigurationError);
  }
  assert.equal(readRuntimeConfig({ DEV_AUTH_BYPASS: 'false' }).devAuthBypass, false);
  assert.throws(
    () => readRuntimeConfig({ NODE_ENV: 'production', APP_ENV: 'local', DEV_AUTH_BYPASS: 'true' }),
    ConfigurationError,
  );
});
test('test runtime may request an operating-system assigned port', () => {
  assert.equal(readRuntimeConfig({ APP_ENV: 'test', PORT: '0' }).port, 0);
  assert.throws(() => readRuntimeConfig({ APP_ENV: 'local', PORT: '0' }), ConfigurationError);
  assert.throws(() => readRuntimeConfig({ ...production(), PORT: '0' }), ConfigurationError);
});
test('production accepts strong config but rejects unsafe options', () => {
  assert.equal(readRuntimeConfig(production()).mode, 'production');
  for (const override of [
    { PUBLIC_ORIGIN: 'http://example.org' },
    { PUBLIC_ORIGIN: '' },
    { SESSION_SIGNING_KEY: 'x'.repeat(43) },
    { DEV_AUTH_BYPASS: 'true' },
    { COOKIE_SECURE: 'false' },
    { EMAIL_PROVIDER: 'mailpit' },
    { DATABASE_URL: '' },
  ]) {
    assert.throws(() => readRuntimeConfig({ ...production(), ...override }), ConfigurationError);
  }
});
test('test environment never falls back to the production DSN', () => {
  assert.throws(
    () => readRuntimeConfig({ APP_ENV: 'test', DATABASE_URL: production().DATABASE_URL }),
    ConfigurationError,
  );
  assert.throws(
    () => readRuntimeConfig({ APP_ENV: 'test', TEST_DATABASE_URL: 'postgres://localhost/production' }),
    ConfigurationError,
  );
  assert.equal(
    readRuntimeConfig({
      APP_ENV: 'test',
      DATABASE_URL: production().DATABASE_URL,
      TEST_DATABASE_URL: 'postgres://localhost/game_test',
    }).databaseUrl,
    'postgres://localhost/game_test',
  );
});
test('enabled providers require credentials and errors redact values', () => {
  assert.throws(() => readRuntimeConfig({ WECHAT_ENABLED: 'true' }), ConfigurationError);
  const secret = 'DO_NOT_LOG_THIS_SECRET';
  try {
    readRuntimeConfig({ ...production(), DATABASE_URL: secret, SMTP_URL: secret, EMAIL_PROVIDER: 'smtp' });
    assert.fail('must reject');
  } catch (error) {
    assert.ok(error instanceof ConfigurationError);
    assert.ok(!error.message.includes(secret));
  }
  assert.ok(!JSON.stringify(describeRuntimeConfig(readRuntimeConfig(production()))).includes('secret'));
});
test('mail encryption requires a strong key and production rejects local capture and plaintext SMTP', () => {
  assert.throws(() => readRuntimeConfig({ EMAIL_PROVIDER: 'mailpit' }), ConfigurationError);
  const SESSION_SIGNING_KEY = randomBytes(32).toString('base64url');
  assert.equal(readRuntimeConfig({ EMAIL_PROVIDER: 'mailpit', SESSION_SIGNING_KEY }).emailProvider, 'mailpit');
  assert.throws(
    () => readRuntimeConfig({ EMAIL_PROVIDER: 'mailpit', SESSION_SIGNING_KEY, SMTP_URL: 'smtp://remote.example:1025' }),
    ConfigurationError,
  );
  assert.throws(() => readRuntimeConfig({ ...production(), EMAIL_PROVIDER: 'mailpit' }), ConfigurationError);
  assert.throws(
    () =>
      readRuntimeConfig({
        ...production(),
        EMAIL_PROVIDER: 'smtp',
        SMTP_URL: 'smtp://mail.example',
        MAIL_FROM: 'no-reply@example.org',
      }),
    ConfigurationError,
  );
  assert.equal(
    readRuntimeConfig({
      ...production(),
      EMAIL_PROVIDER: 'smtp',
      SMTP_URL: 'smtps://mail.example',
      MAIL_FROM: 'no-reply@example.org',
    }).emailProvider,
    'smtp',
  );
});

test('enabled WeChat requires durable storage and a strong session key even when email is disabled', () => {
  const valid = {
    WECHAT_ENABLED: 'true',
    WECHAT_APP_ID: 'wx0000000000000001',
    WECHAT_APP_SECRET: 'server-test-secret',
    SESSION_SIGNING_KEY: randomBytes(32).toString('base64url'),
    DATABASE_URL: 'postgres://localhost/game_local',
  };
  assert.equal(readRuntimeConfig(valid).wechatEnabled, true);
  for (const override of [
    { SESSION_SIGNING_KEY: '' },
    { DATABASE_URL: '' },
    { DEV_AUTH_BYPASS: 'true' },
    { WECHAT_APP_SECRET: '' },
  ])
    assert.throws(() => readRuntimeConfig({ ...valid, ...override }), ConfigurationError);
  assert.ok(!JSON.stringify(describeRuntimeConfig(readRuntimeConfig(valid))).includes(valid.WECHAT_APP_SECRET));
});

test('production account deletion requires an explicit versioned policy and delay', () => {
  assert.equal(readRuntimeConfig(production()).accountDeletionEnabled, false);
  assert.equal(readRuntimeConfig({}).accountDeletionGraceHours, 168);
  assert.throws(() => readRuntimeConfig({ ...production(), ACCOUNT_DELETION_ENABLED: 'true' }), ConfigurationError);
  const cfg = readRuntimeConfig({
    ...production(),
    ACCOUNT_DELETION_ENABLED: 'true',
    ACCOUNT_DELETION_GRACE_HOURS: '24',
    ACCOUNT_RETENTION_POLICY: 'reviewed-test-v1',
  });
  assert.equal(cfg.accountDeletionGraceHours, 24);
  assert.equal(cfg.accountDeletionEnabled, true);
  assert.throws(() => readRuntimeConfig({ ACCOUNT_DELETION_GRACE_HOURS: '-1' }), ConfigurationError);
});

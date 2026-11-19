import path from 'node:path';
import { z } from 'zod';

const flag = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean());
const schema = z.object({
  mode: z.enum(['local', 'test', 'staging', 'production']),
  port: z.coerce.number().int().min(0).max(65535),
  publicOrigin: z.url(),
  databaseUrl: z.string().optional(),
  sessionSigningKey: z.string().optional(),
  roomStoreDir: z.string().min(1),
  devAuthBypass: flag,
  cookieSecure: flag,
  allowedOrigins: z.array(z.url()).min(1),
  wechatEnabled: flag,
  wechatAppId: z.string().trim().min(1).max(128).optional(),
  wechatSecret: z.string().trim().min(1).max(256).optional(),
  emailProvider: z.enum(['disabled', 'mailpit', 'smtp']),
  smtpUrl: z.string().optional(),
  mailFrom: z.email().optional(),
  assetOrigin: z.url().optional(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
  lobbyMaintenance: flag,
  accountDeletionEnabled: flag,
  accountDeletionGraceHours: z.coerce.number().int().min(0).max(2160),
  accountRetentionPolicy: z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/),
});
export type RuntimeConfig = Readonly<
  Omit<z.infer<typeof schema>, 'allowedOrigins'> & { allowedOrigins: readonly string[] }
>;

export class ConfigurationError extends Error {
  constructor(readonly fields: readonly string[]) {
    super(`Invalid configuration fields: ${[...new Set(fields)].sort().join(', ')}`);
    this.name = 'ConfigurationError';
  }
}

/** Accept explicit values in tests; never mutate process.env or print untrusted values. */
export function readRuntimeConfig(env: NodeJS.ProcessEnv = process.env): Readonly<RuntimeConfig> {
  const mode = env.APP_ENV ?? (env.NODE_ENV === 'development' || !env.NODE_ENV ? 'local' : env.NODE_ENV);
  const deployed = mode === 'production' || mode === 'staging';
  const origin = env.PUBLIC_ORIGIN || `http://localhost:${env.PORT || 2567}`;
  const parsed = schema.safeParse({
    mode,
    port: env.PORT ?? '2567',
    publicOrigin: origin,
    databaseUrl: mode === 'test' ? env.TEST_DATABASE_URL : env.DATABASE_URL,
    sessionSigningKey: env.SESSION_SIGNING_KEY,
    roomStoreDir: env.ROOM_STORE_DIR || path.resolve('data/rooms'),
    devAuthBypass: env.DEV_AUTH_BYPASS ?? false,
    cookieSecure: env.COOKIE_SECURE ?? deployed,
    allowedOrigins: env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((v) => v.trim()) : [origin],
    wechatEnabled: env.WECHAT_ENABLED ?? false,
    wechatAppId: env.WECHAT_APP_ID,
    wechatSecret: env.WECHAT_APP_SECRET,
    emailProvider: env.EMAIL_PROVIDER ?? 'disabled',
    smtpUrl: env.SMTP_URL,
    mailFrom: env.MAIL_FROM,
    assetOrigin: env.ASSET_ORIGIN,
    logLevel: env.LOG_LEVEL ?? 'info',
    lobbyMaintenance: env.LOBBY_MAINTENANCE ?? false,
    accountDeletionEnabled: env.ACCOUNT_DELETION_ENABLED ?? !deployed,
    accountDeletionGraceHours: env.ACCOUNT_DELETION_GRACE_HOURS ?? 168,
    accountRetentionPolicy: env.ACCOUNT_RETENTION_POLICY ?? 'local-development-v1',
  });
  if (!parsed.success)
    throw new ConfigurationError(parsed.error.issues.map((i) => String(i.path[0] ?? 'configuration')));
  const cfg = parsed.data;
  const bad: string[] = [];
  if (cfg.port === 0 && cfg.mode !== 'test') bad.push('port');
  if (env.NODE_ENV === 'production' && !deployed) bad.push('APP_ENV');
  const safeOrigin = (value: string, secure: boolean) => {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      (!secure || url.protocol === 'https:') &&
      !url.hostname.includes('*') &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/'
    );
  };
  if (!safeOrigin(cfg.publicOrigin, deployed)) bad.push('publicOrigin');
  if (cfg.allowedOrigins.some((v) => !safeOrigin(v, deployed))) bad.push('allowedOrigins');
  if (cfg.assetOrigin && !safeOrigin(cfg.assetOrigin, deployed)) bad.push('assetOrigin');
  if (cfg.databaseUrl) {
    try {
      const db = new URL(cfg.databaseUrl);
      if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.hostname || db.pathname.length < 2)
        bad.push('databaseUrl');
      if (mode === 'test' && !/(?:^|[_-])test(?:[_-]|$)/i.test(db.pathname.slice(1))) bad.push('TEST_DATABASE_URL');
    } catch {
      bad.push('databaseUrl');
    }
  }
  if (mode === 'test' && env.DATABASE_URL && !env.TEST_DATABASE_URL) bad.push('TEST_DATABASE_URL');
  if (deployed || cfg.emailProvider !== 'disabled' || cfg.wechatEnabled) {
    const key = cfg.sessionSigningKey ?? '';
    if (
      !/^[A-Za-z0-9_-]{43,}$/.test(key) ||
      new Set(key).size < 12 ||
      /example|placeholder|changeme|development/i.test(key)
    )
      bad.push('sessionSigningKey');
  }
  if (deployed) {
    if (!env.PUBLIC_ORIGIN) bad.push('PUBLIC_ORIGIN');
    if (!cfg.databaseUrl) bad.push('databaseUrl');
    if (cfg.devAuthBypass) bad.push('devAuthBypass');
    if (!cfg.cookieSecure) bad.push('cookieSecure');
    if (cfg.emailProvider === 'mailpit') bad.push('emailProvider');
  }
  if (cfg.wechatEnabled && (!cfg.wechatAppId || !cfg.wechatSecret)) bad.push('wechatCredentials');
  if (cfg.wechatEnabled && !cfg.databaseUrl) bad.push('databaseUrl');
  if (cfg.wechatEnabled && cfg.devAuthBypass) bad.push('devAuthBypass');
  if (deployed && cfg.accountDeletionEnabled && (!env.ACCOUNT_RETENTION_POLICY || !env.ACCOUNT_DELETION_GRACE_HOURS))
    bad.push('accountDeletionPolicy');
  if (deployed && cfg.emailProvider !== 'disabled' && !cfg.mailFrom) bad.push('mailFrom');
  if (cfg.emailProvider === 'smtp' || cfg.emailProvider === 'mailpit') {
    try {
      const url = new URL(cfg.smtpUrl ?? (cfg.emailProvider === 'mailpit' ? 'smtp://127.0.0.1:1025' : ''));
      if (!['smtp:', 'smtps:'].includes(url.protocol) || !url.hostname || (deployed && url.protocol !== 'smtps:'))
        bad.push('smtpUrl');
      if (url.search || url.hash || !['', '/'].includes(url.pathname)) bad.push('smtpUrl');
      if (cfg.emailProvider === 'mailpit' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
        bad.push('smtpUrl');
    } catch {
      bad.push('smtpUrl');
    }
  }
  if (bad.length) throw new ConfigurationError(bad);
  return Object.freeze({
    ...cfg,
    allowedOrigins: Object.freeze([...cfg.allowedOrigins]),
    roomStoreDir: path.resolve(cfg.roomStoreDir),
  });
}

export function describeRuntimeConfig(cfg: Readonly<RuntimeConfig>) {
  return {
    mode: cfg.mode,
    port: cfg.port,
    publicOrigin: cfg.publicOrigin,
    databaseConfigured: Boolean(cfg.databaseUrl),
    wechatEnabled: cfg.wechatEnabled,
    emailProvider: cfg.emailProvider,
  };
}

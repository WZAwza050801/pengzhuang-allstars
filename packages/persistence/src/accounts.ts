import type { SqlExecutor } from './database';

export const ACCOUNT_STATUSES = ['active', 'banned', 'deleting', 'deleted'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
export const VERIFICATION_PURPOSES = ['email-verification', 'password-reset', 'identity-link'] as const;
export type VerificationPurpose = (typeof VERIFICATION_PURPOSES)[number];

export interface AccountUser {
  id: string;
  status: AccountStatus;
  createdAt: Date;
  updatedAt: Date;
  bannedAt: Date | null;
  deletionRequestedAt: Date | null;
  deletedAt: Date | null;
}

export interface AccountIdentity {
  id: string;
  userId: string;
  provider: string;
  providerAppId: string;
  providerSubject: string;
  createdAt: Date;
}

export interface AccountSession {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  deviceLabel: string | null;
  createdAt: Date;
}

export class DuplicateIdentityError extends Error {
  constructor() {
    super('Identity is already linked');
    this.name = 'DuplicateIdentityError';
  }
}

export class AccountNotFoundError extends Error {
  constructor() {
    super('Account not found');
    this.name = 'AccountNotFoundError';
  }
}

export class InvalidAccountStatusTransitionError extends Error {
  constructor() {
    super('Invalid account status transition');
    this.name = 'InvalidAccountStatusTransitionError';
  }
}

type UserRow = {
  id: string;
  status: AccountStatus;
  created_at: Date;
  updated_at: Date;
  banned_at: Date | null;
  deletion_requested_at: Date | null;
  deleted_at: Date | null;
};

type IdentityRow = {
  id: string;
  user_id: string;
  provider: string;
  provider_app_id: string;
  provider_subject: string;
  created_at: Date;
};

type SessionRow = {
  id: string;
  user_id: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  device_label: string | null;
  created_at: Date;
};

const transitions: Readonly<Record<AccountStatus, readonly AccountStatus[]>> = {
  active: ['active', 'banned', 'deleting'],
  banned: ['banned', 'active', 'deleting'],
  deleting: ['deleting', 'active', 'deleted'],
  deleted: [],
};

function accountUser(row: UserRow): AccountUser {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    bannedAt: row.banned_at,
    deletionRequestedAt: row.deletion_requested_at,
    deletedAt: row.deleted_at,
  };
}

function accountIdentity(row: IdentityRow): AccountIdentity {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerAppId: row.provider_app_id,
    providerSubject: row.provider_subject,
    createdAt: row.created_at,
  };
}

function accountSession(row: SessionRow): AccountSession {
  return {
    id: row.id,
    userId: row.user_id,
    familyId: row.family_id,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    deviceLabel: row.device_label,
    createdAt: row.created_at,
  };
}

function postgresCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

export class AccountRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async createUser(): Promise<AccountUser> {
    const result = await this.sql.query<UserRow>(
      'INSERT INTO users DEFAULT VALUES RETURNING id, status, created_at, updated_at, banned_at, deletion_requested_at, deleted_at',
    );
    return accountUser(result.rows[0]);
  }

  async getUser(userId: string): Promise<AccountUser | null> {
    const result = await this.sql.query<UserRow>(
      'SELECT id, status, created_at, updated_at, banned_at, deletion_requested_at, deleted_at FROM users WHERE id = $1',
      [userId],
    );
    return result.rows[0] ? accountUser(result.rows[0]) : null;
  }

  async transitionStatus(userId: string, next: AccountStatus): Promise<AccountUser> {
    const current = await this.getUser(userId);
    if (!current) throw new AccountNotFoundError();
    if (!transitions[current.status].includes(next)) throw new InvalidAccountStatusTransitionError();
    const result = await this.sql.query<UserRow>(
      `UPDATE users
       SET status = $2::user_status,
           updated_at = now(),
           banned_at = CASE WHEN $2::user_status = 'banned' THEN now() ELSE banned_at END,
           deletion_requested_at = CASE WHEN $2::user_status = 'deleting' THEN now() ELSE deletion_requested_at END,
           deleted_at = CASE WHEN $2::user_status = 'deleted' THEN now() ELSE deleted_at END
       WHERE id = $1 AND status = $3::user_status
       RETURNING id, status, created_at, updated_at, banned_at, deletion_requested_at, deleted_at`,
      [userId, next, current.status],
    );
    if (!result.rows[0]) throw new InvalidAccountStatusTransitionError();
    return accountUser(result.rows[0]);
  }

  async linkIdentity(input: {
    userId: string;
    provider: string;
    providerAppId: string;
    providerSubject: string;
  }): Promise<AccountIdentity> {
    try {
      const result = await this.sql.query<IdentityRow>(
        `INSERT INTO auth_identities(user_id, provider, provider_app_id, provider_subject)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_id, provider, provider_app_id, provider_subject, created_at`,
        [input.userId, input.provider, input.providerAppId, input.providerSubject],
      );
      return accountIdentity(result.rows[0]);
    } catch (error) {
      if (postgresCode(error) === '23505') throw new DuplicateIdentityError();
      throw error;
    }
  }

  async findUserByIdentity(input: {
    provider: string;
    providerAppId: string;
    providerSubject: string;
  }): Promise<AccountUser | null> {
    const result = await this.sql.query<UserRow>(
      `SELECT u.id, u.status, u.created_at, u.updated_at, u.banned_at, u.deletion_requested_at, u.deleted_at
       FROM users u
       INNER JOIN auth_identities i ON i.user_id = u.id
       WHERE i.provider = $1 AND i.provider_app_id = $2 AND i.provider_subject = $3`,
      [input.provider, input.providerAppId, input.providerSubject],
    );
    return result.rows[0] ? accountUser(result.rows[0]) : null;
  }

  async setPasswordCredential(input: { userId: string; passwordHash: string }): Promise<void> {
    await this.sql.query(
      `INSERT INTO password_credentials(user_id, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
      [input.userId, input.passwordHash],
    );
  }

  async hasPasswordCredential(userId: string): Promise<boolean> {
    const result = await this.sql.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM password_credentials WHERE user_id = $1) AS exists',
      [userId],
    );
    return result.rows[0]?.exists ?? false;
  }

  async createVerificationToken(input: {
    userId: string;
    purpose: VerificationPurpose;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.sql.query(
      'INSERT INTO verification_tokens(user_id, purpose, token_hash, expires_at) VALUES ($1, $2::verification_purpose, $3, $4)',
      [input.userId, input.purpose, input.tokenHash, input.expiresAt],
    );
  }

  async consumeVerificationToken(input: { purpose: VerificationPurpose; tokenHash: string }): Promise<string | null> {
    const result = await this.sql.query<{ user_id: string }>(
      `UPDATE verification_tokens
       SET used_at = now()
       WHERE purpose = $1::verification_purpose AND token_hash = $2 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [input.purpose, input.tokenHash],
    );
    return result.rows[0]?.user_id ?? null;
  }

  async createSession(input: {
    userId: string;
    refreshTokenHash: string;
    familyId: string;
    expiresAt: Date;
    deviceLabel?: string;
  }): Promise<AccountSession> {
    const result = await this.sql.query<SessionRow>(
      `INSERT INTO sessions(user_id, refresh_token_hash, family_id, expires_at, device_label)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, family_id, expires_at, revoked_at, device_label, created_at`,
      [input.userId, input.refreshTokenHash, input.familyId, input.expiresAt, input.deviceLabel ?? null],
    );
    return accountSession(result.rows[0]);
  }

  async revokeSession(input: { userId: string; sessionId: string }): Promise<boolean> {
    const result = await this.sql.query(
      'UPDATE sessions SET revoked_at = clock_timestamp() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
      [input.sessionId, input.userId],
    );
    return result.rowCount === 1;
  }
}

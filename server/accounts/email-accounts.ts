import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  AccountRepository,
  DuplicateIdentityError,
  type VerificationPurpose,
} from '../../packages/persistence/src/accounts';
import { Database, type SqlExecutor } from '../../packages/persistence/src/database';
import { EmailAuthRepository } from '../../packages/persistence/src/email-auth';
import { ApiError } from '../api/http';
import { type AccountMail } from './mail';
import { Passwords } from './passwords';
import type { Sessions } from './sessions';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const normalizeEmail = (value: string) => value.trim().toLowerCase();
const accepted = Object.freeze({ accepted: true });
type MailPurpose = 'email-verification' | 'password-reset';
type MailPayload = { to: string; token: string };

export class EmailAccounts {
  private readonly passwords = new Passwords();
  private readonly mailKey: Buffer;
  private timer: ReturnType<typeof setInterval> | undefined;
  private delivery: Promise<void> | null = null;

  constructor(
    private readonly db: Database,
    private readonly mail: AccountMail,
    signingKey: string,
  ) {
    this.mailKey = createHmac('sha256', signingKey).update('account-mail-encryption-v1').digest();
  }

  private seal(payload: MailPayload): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.mailKey, nonce);
    const bytes = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), bytes]).toString('base64');
  }

  private open(value: string): MailPayload {
    const bytes = Buffer.from(value, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', this.mailKey, bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'),
    ) as MailPayload;
  }

  private async rate(action: string, source: string, email?: string): Promise<void> {
    const repository = new EmailAuthRepository(this.db);
    const login = action === 'login';
    const window = login || action === 'token' ? 900 : 3600;
    const maximum = login ? 50 : action === 'token' ? 30 : 20;
    const ipAllowed = await repository.rateLimit(digest(`${action}:ip:${source}`), window, maximum);
    const emailAllowed =
      email === undefined || (await repository.rateLimit(digest(`${action}:email:${email}`), window, login ? 10 : 5));
    if (!ipAllowed || !emailAllowed) throw new ApiError('RATE_LIMITED', 429, true);
  }

  private async conceal<T>(work: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await work();
    } finally {
      await delay(Math.max(0, 100 - (performance.now() - start)));
    }
  }

  private async issue(tx: SqlExecutor, userId: string, email: string, purpose: MailPurpose): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = digest(token);
    await new AccountRepository(tx).createVerificationToken({
      userId,
      purpose,
      tokenHash,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    await new EmailAuthRepository(tx).enqueueMail(purpose, tokenHash, this.seal({ to: email, token }));
  }

  async register(input: { email: string; password: string; nickname: string }, source: string) {
    const email = normalizeEmail(input.email);
    await this.rate('register', source, email);
    return this.conceal(async () => {
      const passwordHash = await this.passwords.hash(input.password);
      try {
        await this.db.transaction(async (tx) => {
          const userId = await new EmailAuthRepository(tx).createAccount(email, passwordHash, input.nickname);
          await this.issue(tx, userId, email, 'email-verification');
        });
      } catch (error) {
        if (!(error instanceof DuplicateIdentityError)) throw error;
      }
      return accepted;
    });
  }

  async login(input: { email: string; password: string }, source: string, session: { service: Sessions; csrf: string }) {
    const email = normalizeEmail(input.email);
    await this.rate('login', source, email);
    return this.conceal(async () => {
      return this.db.transaction(async (tx) => {
        const userId = await new EmailAuthRepository(tx).authenticate(email, (hash) => this.passwords.matches(input.password, hash));
        if (!userId) throw new ApiError('UNAUTHENTICATED', 401);
        const credentials = await session.service.issue(tx, userId, session.csrf);
        return { userId, credentials };
      });
    });
  }

  async requestReset(emailInput: string, source: string) {
    const email = normalizeEmail(emailInput);
    await this.rate('reset-request', source, email);
    return this.conceal(async () => {
      await this.db.transaction(async (tx) => {
        const userId = await new EmailAuthRepository(tx).verifiedActiveUser(email);
        if (userId) await this.issue(tx, userId, email, 'password-reset');
      });
      return accepted;
    });
  }

  async requestVerification(emailInput: string, source: string) {
    const email = normalizeEmail(emailInput);
    await this.rate('verification-request', source, email);
    return this.conceal(async () => {
      await this.db.transaction(async (tx) => {
        const repository = new EmailAuthRepository(tx);
        const userId = await repository.unverifiedActiveUser(email);
        if (userId) {
          await repository.invalidateTokens(userId, 'email-verification');
          await this.issue(tx, userId, email, 'email-verification');
        }
      });
      return accepted;
    });
  }

  private async consume(tx: SqlExecutor, token: string, purpose: VerificationPurpose): Promise<string> {
    const tokenHash = digest(token);
    const userId = await new EmailAuthRepository(tx).lockTokenUser(purpose, tokenHash);
    if (!userId || (await new AccountRepository(tx).consumeVerificationToken({ purpose, tokenHash })) !== userId)
      throw new ApiError('INVALID_REQUEST', 400);
    return userId;
  }

  async verifyEmail(token: string, source: string) {
    await this.rate('token', source);
    await this.db.transaction(async (tx) => {
      const userId = await this.consume(tx, token, 'email-verification');
      const repository = new EmailAuthRepository(tx);
      await repository.verifyEmail(userId);
      await repository.invalidateTokens(userId, 'email-verification');
    });
    return { verified: true };
  }

  async resetPassword(token: string, password: string, source: string) {
    await this.rate('token', source);
    const passwordHash = await this.passwords.hash(password);
    await this.db.transaction(async (tx) => {
      const userId = await this.consume(tx, token, 'password-reset');
      await new AccountRepository(tx).setPasswordCredential({ userId, passwordHash });
      const repository = new EmailAuthRepository(tx);
      await repository.invalidateTokens(userId, 'password-reset');
      await repository.revokeSessions(userId);
    });
    return { reset: true };
  }

  deliverPendingMail(): Promise<void> {
    return (this.delivery ??= this.deliver().finally(() => {
      this.delivery = null;
    }));
  }
  private async deliver(): Promise<void> {
    for (let count = 0; count < 10; count++) {
      const found = await this.db.transaction(async (tx) => {
        const repository = new EmailAuthRepository(tx);
        const job = await repository.claimMail();
        if (!job) return false;
        if (!job.valid) {
          await repository.finishMail(job.id, 'abandoned');
          return true;
        }
        try {
          await this.mail.send({ ...this.open(job.encrypted_payload), purpose: job.purpose });
        } catch {
          await repository.finishMail(job.id, 'retry');
          return true;
        }
        await repository.finishMail(job.id, 'sent');
        return true;
      });
      if (!found) break;
    }
  }
  startMailDelivery(): void {
    this.timer ??= setInterval(() => {
      void this.deliverPendingMail().catch(() =>
        console.error(JSON.stringify({ event: 'account_mail_worker_failed' })),
      );
    }, 1000);
    this.timer.unref();
  }
  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.delivery;
  }
}

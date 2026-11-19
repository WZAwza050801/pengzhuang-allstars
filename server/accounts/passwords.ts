import { randomBytes } from 'node:crypto';
import { hash, verify, type Options } from '@node-rs/argon2';
import { ApiError } from '../api/http';

export const PASSWORD_POLICY = Object.freeze({
  algorithm: 2,
  version: 1,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
} satisfies Options);

/** Bound native KDF work before allocating memory; reject excess load rather than queueing without limit. */
export class Passwords {
  private active = 0;
  private dummy: Promise<string> | undefined;
  private async work<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= 4) throw new ApiError('UNAVAILABLE', 503, true);
    this.active++;
    try {
      return await operation();
    } finally {
      this.active--;
    }
  }
  hash(password: string): Promise<string> {
    return this.work(() => hash(password, PASSWORD_POLICY));
  }
  async matches(password: string, encoded: string | null): Promise<boolean> {
    this.dummy ??= this.hash(randomBytes(32).toString('base64url')).catch((error) => {
      this.dummy = undefined;
      throw error;
    });
    const fallback = await this.dummy;
    const valid = await this.work(() => verify(encoded ?? fallback, password).catch(() => false));
    return encoded !== null && valid;
  }
}

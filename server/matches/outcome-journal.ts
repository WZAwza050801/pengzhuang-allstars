import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { OutcomeIntentSchema, type OutcomeIntent } from '../../packages/contracts/src/match-results';
import { canonicalJson } from '../../packages/game-core/src/snapshot';

export class OutcomeConflict extends Error {
  constructor() {
    super('outcome-conflict');
  }
}
export class JournalIntegrityError extends Error {
  constructor() {
    super('outcome-journal-corrupt');
  }
}
export const outcomeHash = (outcome: OutcomeIntent) =>
  createHash('sha256').update(canonicalJson(outcome)).digest('hex');
const recordSchema = z.strictObject({
  format: z.literal(1),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  outcome: OutcomeIntentSchema,
});
const retrySchema = z.strictObject({
  attempts: z.number().int().min(0).max(12),
  nextAttemptAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  error: z.string().regex(/^[a-z-]{1,64}$/),
});
const missing = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
/** Small immutable intent files. File fsync plus an exclusive hard link precede any positive acceptance. */
export class OutcomeJournal {
  readonly root: string;
  constructor(
    directory: string,
    private readonly maxEntries = 1024,
  ) {
    this.root = path.resolve(directory);
    mkdirSync(this.root, { recursive: true });
  }
  private file(id: string, suffix = '.json') {
    const target = path.resolve(this.root, `${z.uuid().parse(id).toLowerCase()}${suffix}`);
    if (path.dirname(target) !== this.root) throw new Error('Invalid outcome journal path');
    return target;
  }
  private syncDirectory() {
    // Windows does not expose directory fsync through this API. Process-crash recovery still uses the synced file.
    if (process.platform === 'win32') return;
    const fd = openSync(this.root, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  ids(): string[] {
    const names = readdirSync(this.root)
      .filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
      .sort();
    if (names.length > this.maxEntries) throw new Error('Outcome journal capacity exceeded');
    return names.map((name) => z.uuid().parse(name.slice(0, -5)));
  }
  read(id: string): OutcomeIntent {
    const file = this.file(id);
    if (statSync(file).size > 65536) throw new JournalIntegrityError();
    try {
      const record = recordSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
      if (record.outcome.matchId !== id.toLowerCase() || outcomeHash(record.outcome) !== record.payloadHash)
        throw new JournalIntegrityError();
      return record.outcome;
    } catch {
      throw new JournalIntegrityError();
    }
  }
  list(): OutcomeIntent[] {
    return this.ids().map((id) => this.read(id));
  }
  put(input: unknown): 'stored' | 'already-stored' {
    const outcome = OutcomeIntentSchema.parse(input),
      digest = outcomeHash(outcome),
      target = this.file(outcome.matchId);
    const previous = () => {
      if (outcomeHash(this.read(outcome.matchId)) !== digest) throw new OutcomeConflict();
      return 'already-stored' as const;
    };
    if (existsSync(target)) return previous();
    if (this.ids().length >= this.maxEntries) throw new Error('Outcome journal capacity exceeded');
    const bytes = JSON.stringify({ format: 1, payloadHash: digest, outcome });
    if (Buffer.byteLength(bytes) > 65536) throw new Error('Outcome journal entry too large');
    const temporary = this.file(outcome.matchId, `.${randomUUID()}.tmp`);
    const fd = openSync(temporary, 'wx', 0o600);
    let synced = false;
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
      synced = true;
    } finally {
      closeSync(fd);
      if (!synced) unlinkSync(temporary);
    }
    try {
      try {
        linkSync(temporary, target);
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')
          return previous();
        throw error;
      }
      this.syncDirectory();
      return 'stored';
    } finally {
      unlinkSync(temporary);
    }
  }
  retry(id: string) {
    try {
      const file = this.file(id, '.retry.json');
      if (statSync(file).size > 1024) throw new JournalIntegrityError();
      return retrySchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    } catch (error) {
      if (missing(error)) return { attempts: 0, nextAttemptAt: 0, error: 'none' };
      throw new JournalIntegrityError();
    }
  }
  defer(id: string, error: string, now = Date.now()) {
    const attempts = Math.min(12, this.retry(id).attempts + 1);
    const value = retrySchema.parse({ attempts, nextAttemptAt: now + Math.min(300000, 1000 * 2 ** attempts), error });
    const temporary = this.file(id, `.${randomUUID()}.retry.tmp`),
      target = this.file(id, '.retry.json');
    const fd = openSync(temporary, 'wx', 0o600);
    let synced = false;
    try {
      writeFileSync(fd, JSON.stringify(value));
      fsyncSync(fd);
      synced = true;
    } finally {
      closeSync(fd);
      if (!synced) unlinkSync(temporary);
    }
    try {
      renameSync(temporary, target);
      this.syncDirectory();
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    return value;
  }
  quarantine(id: string) {
    renameSync(this.file(id), this.file(id, `.${randomUUID()}.quarantine`));
    this.syncDirectory();
  }
  remove(id: string) {
    for (const suffix of ['.json', '.retry.json'])
      try {
        unlinkSync(this.file(id, suffix));
      } catch (error) {
        if (!missing(error)) throw error;
      }
    this.syncDirectory();
  }
}

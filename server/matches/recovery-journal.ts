import { mkdir, open, link, readdir, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { canonicalJson } from '../../packages/game-core/src/snapshot';
import { CheckpointSchema } from './checkpoint';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const ordinal = z.string().regex(/^(0|[1-9][0-9]{0,18})$/);
export const TerminalEntrySchema = z
  .strictObject({
    format: z.literal(1),
    base: z.strictObject({
      matchId: z.uuid(),
      ownerId: z.uuid(),
      storageId: z.uuid(),
      epoch: ordinal.refine((value) => value !== '0'),
      checkpoint: ordinal,
      payloadHash: hash,
    }),
    record: CheckpointSchema,
  })
  .refine((value) => value.record.terminal !== null && value.base.matchId === value.record.matchId);
export type TerminalEntry = z.infer<typeof TerminalEntrySchema>;
export const terminalEntryHash = (entry: TerminalEntry) =>
  createHash('sha256').update(canonicalJson(entry)).digest('hex');
const envelope = z.strictObject({ payloadHash: hash, payload: TerminalEntrySchema });
const scopeSchema = z.strictObject({ format: z.literal(1), storageId: z.uuid() });
const isCode = (error: unknown, code: string) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === code;
export class RecoveryJournalCorrupt extends Error {
  constructor() {
    super('recovery-journal-corrupt');
  }
}
export class RecoveryJournalConflict extends Error {
  constructor() {
    super('recovery-journal-conflict');
  }
}

/** Atomic, asynchronous terminal checkpoints; ordinary running checkpoints remain in PostgreSQL. */
export class RecoveryJournal {
  readonly root: string;
  private scope: Promise<string> | undefined;
  private queuedWrites = 0;
  private writeTail: Promise<void> = Promise.resolve();
  constructor(
    directory: string,
    private readonly maxEntries = 1024,
  ) {
    this.root = path.resolve(directory);
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 4096)
      throw new Error('Invalid recovery journal capacity');
  }
  private file(id: string, suffix = '.json') {
    return path.join(this.root, `${z.uuid().parse(id).toLowerCase()}${suffix}`);
  }
  private async syncDirectory() {
    // Process-crash durability on Windows; directory fsync is unavailable there, as in OutcomeJournal.
    if (process.platform === 'win32') return;
    const handle = await open(this.root, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  private async readJson(file: string, maximum: number): Promise<unknown> {
    const handle = await open(file, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maximum) throw new RecoveryJournalCorrupt();
      const bytes = Buffer.alloc(maximum + 1);
      let used = 0;
      while (used < bytes.length) {
        const { bytesRead } = await handle.read(bytes, used, bytes.length - used, null);
        if (!bytesRead) break;
        used += bytesRead;
      }
      if (used > maximum) throw new RecoveryJournalCorrupt();
      try {
        return JSON.parse(bytes.toString('utf8', 0, used));
      } catch {
        throw new RecoveryJournalCorrupt();
      }
    } finally {
      await handle.close();
    }
  }
  private async publish(target: string, value: unknown) {
    const temporary = path.join(this.root, `.${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      try {
        await handle.writeFile(JSON.stringify(value), 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await link(temporary, target);
      } catch (error) {
        if (isCode(error, 'EEXIST')) return false;
        throw error;
      }
      await this.syncDirectory();
      return true;
    } finally {
      await unlink(temporary);
    }
  }
  open(): Promise<string> {
    return (this.scope ??= this.initialize().catch((error) => {
      this.scope = undefined;
      throw error;
    }));
  }
  private async initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const file = path.join(this.root, 'storage.json');
    let raw: unknown;
    try {
      raw = await this.readJson(file, 2048);
    } catch (error) {
      if (!isCode(error, 'ENOENT')) throw error;
      await this.publish(file, { format: 1, storageId: randomUUID() });
      raw = await this.readJson(file, 2048);
    }
    const parsed = scopeSchema.safeParse(raw);
    if (!parsed.success) throw new RecoveryJournalCorrupt();
    return parsed.data.storageId;
  }
  async ids(): Promise<string[]> {
    await this.open();
    const ids = (await readdir(this.root))
      .filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
      .sort()
      .map((name) => z.uuid().parse(name.slice(0, -5)));
    if (ids.length > this.maxEntries) throw new Error('Recovery journal capacity exceeded');
    return ids;
  }
  async read(id: string): Promise<TerminalEntry> {
    const storageId = await this.open(),
      raw = await this.readJson(this.file(id), 256 * 1024);
    const parsed = envelope.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.payloadHash !== terminalEntryHash(parsed.data.payload) ||
      parsed.data.payload.base.storageId !== storageId ||
      parsed.data.payload.record.matchId !== id.toLowerCase()
    )
      throw new RecoveryJournalCorrupt();
    return parsed.data.payload;
  }
  async peek(id: string): Promise<TerminalEntry | null> {
    try {
      return await this.read(id);
    } catch (error) {
      if (isCode(error, 'ENOENT')) return null;
      throw error;
    }
  }
  async put(value: unknown): Promise<'stored' | 'already-stored'> {
    const input = TerminalEntrySchema.safeParse(value);
    if (!input.success) throw new RecoveryJournalCorrupt();
    if (this.queuedWrites >= 128) throw new Error('Recovery journal write capacity exceeded');
    this.queuedWrites++;
    const job = this.writeTail.then(() => this.publishEntry(input.data));
    this.writeTail = job.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await job;
    } finally {
      this.queuedWrites--;
    }
  }
  private async publishEntry(value: TerminalEntry): Promise<'stored' | 'already-stored'> {
    const storageId = await this.open(),
      parsed = TerminalEntrySchema.safeParse(value);
    if (!parsed.success || parsed.data.base.storageId !== storageId) throw new RecoveryJournalCorrupt();
    const payload = parsed.data,
      payloadHash = terminalEntryHash(payload),
      bytes = { payloadHash, payload };
    if (Buffer.byteLength(JSON.stringify(bytes)) > 256 * 1024) throw new RecoveryJournalCorrupt();
    const same = (previous: TerminalEntry) => {
      if (terminalEntryHash(previous) !== payloadHash) throw new RecoveryJournalConflict();
      return 'already-stored' as const;
    };
    const previous = await this.peek(payload.record.matchId);
    if (previous) return same(previous);
    if ((await this.ids()).length >= this.maxEntries) throw new Error('Recovery journal capacity exceeded');
    if (!(await this.publish(this.file(payload.record.matchId), bytes)))
      return same(await this.read(payload.record.matchId));
    return 'stored';
  }
  async remove(id: string, expectedHash: string) {
    const previous = await this.peek(id);
    if (!previous) return;
    if (terminalEntryHash(previous) !== expectedHash) throw new RecoveryJournalConflict();
    await unlink(this.file(id));
    await this.syncDirectory();
  }
  async quarantine(id: string) {
    await rename(this.file(id), this.file(id, `.${randomUUID()}.quarantine`));
    await this.syncDirectory();
  }
}

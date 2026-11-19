import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, freezeSnapshot } from '../packages/game-core/src/snapshot';
import { ConfigPackageSchema } from '../packages/contracts/src/configuration';
import { PROTOCOL_VERSION } from '../shared/protocol';

export function makeConfigPackage<T>(
  version: string,
  payload: T,
  minProtocol = PROTOCOL_VERSION,
  maxProtocol = PROTOCOL_VERSION,
) {
  const data = { schemaVersion: 1 as const, version, minProtocol, maxProtocol, payload };
  const sha256 = createHash('sha256').update(canonicalJson(data)).digest('hex');
  return { ...data, sha256 };
}
export class VersionedRegistry<T> {
  private readonly entries = new Map<
    string,
    Readonly<{ payload: T; sha256: string; minProtocol: number; maxProtocol: number }>
  >();
  private active: string | null = null;
  private readonly disabled = new Set<string>();
  private canary: { version: string; percent: number } | null = null;
  constructor(
    private readonly payloadSchema: z.ZodType<T>,
    private readonly protocol = PROTOCOL_VERSION,
  ) {}
  register(input: unknown): void {
    const pack = ConfigPackageSchema.parse(input);
    const { sha256, ...data } = pack;
    if (createHash('sha256').update(canonicalJson(data)).digest('hex') !== sha256)
      throw new Error('Config content hash mismatch');
    if (this.protocol < pack.minProtocol || this.protocol > pack.maxProtocol)
      throw new Error('Config protocol incompatible');
    const previous = this.entries.get(pack.version);
    if (previous) {
      if (previous.sha256 !== sha256) throw new Error('Config version conflict');
      return;
    }
    if (this.entries.size >= 100) throw new Error('Config archive limit');
    const parsed = this.payloadSchema.parse(pack.payload);
    if (parsed && typeof parsed === 'object' && 'version' in parsed && parsed.version !== pack.version)
      throw new Error('Payload version mismatch');
    const payload = freezeSnapshot(parsed);
    this.entries.set(
      pack.version,
      Object.freeze({ payload, sha256, minProtocol: pack.minProtocol, maxProtocol: pack.maxProtocol }),
    );
  }
  activate(version: string): void {
    this.get(version);
    if (this.disabled.has(version)) throw new Error('Config version disabled');
    this.active = version;
    this.canary = null;
  }
  rollout(version: string, percent: number): void {
    this.get(version);
    this.get();
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error('Invalid rollout percent');
    if (this.disabled.has(version)) throw new Error('Config version disabled');
    this.canary = percent ? { version, percent } : null;
  }
  forNewSession(serverCohort: string): T {
    if (typeof serverCohort !== 'string' || !serverCohort.length || serverCohort.length > 256)
      throw new Error('Invalid server cohort');
    const bucket = createHash('sha256').update(serverCohort).digest().readUInt32BE(0) % 10000;
    return this.canary && bucket < this.canary.percent * 100 ? this.get(this.canary.version) : this.get();
  }
  disable(version: string): void {
    this.get(version);
    if (version === this.active) throw new Error('Cannot disable active configuration; rollback first');
    this.disabled.add(version);
    if (this.canary?.version === version) this.canary = null;
  }
  get(version = this.active): T {
    const entry = version ? this.entries.get(version) : undefined;
    if (!entry) throw new Error('Config version unavailable');
    return entry.payload;
  }
  manifest() {
    return {
      schemaVersion: 1,
      active: this.active,
      rollout: this.canary ? { ...this.canary } : null,
      versions: [...this.entries].map(([version, entry]) => ({
        version,
        sha256: entry.sha256,
        minProtocol: entry.minProtocol,
        maxProtocol: entry.maxProtocol,
        disabled: this.disabled.has(version),
      })),
    };
  }
}

/** JSON Pointer paths; arrays are replaced atomically so index shifts cannot disguise a change. */
export function diffConfiguration(before: unknown, after: unknown) {
  canonicalJson(before);
  canonicalJson(after);
  const result: { path: string; before: unknown; after: unknown }[] = [];
  function compare(left: unknown, right: unknown, pointer: string) {
    if (left === right || (left !== undefined && right !== undefined && canonicalJson(left) === canonicalJson(right)))
      return;
    if (
      left &&
      right &&
      typeof left === 'object' &&
      typeof right === 'object' &&
      !Array.isArray(left) &&
      !Array.isArray(right)
    ) {
      for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort())
        compare(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
          `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`,
        );
    } else result.push({ path: pointer || '/', before: structuredClone(left), after: structuredClone(right) });
  }
  compare(before, after, '');
  return result;
}

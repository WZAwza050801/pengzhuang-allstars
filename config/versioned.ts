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
    this.active = version;
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
      versions: [...this.entries].map(([version, entry]) => ({
        version,
        sha256: entry.sha256,
        minProtocol: entry.minProtocol,
        maxProtocol: entry.maxProtocol,
      })),
    };
  }
}

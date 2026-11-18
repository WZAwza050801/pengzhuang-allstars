import { createHash } from 'node:crypto';
import type { ShotMsg } from '../../shared/protocol';
import { canonicalJson } from '../../packages/game-core/src/snapshot';

export interface ShotReceipt {
  matchId: string;
  actorId: string;
  shotId: string;
  payloadHash: string;
  seq: number;
  revision: number;
}
const key = (matchId: string, actorId: string, shotId: string) => JSON.stringify([matchId, actorId, shotId]);
export function shotFingerprint(command: ShotMsg): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        protocol: command.protocol ?? 1,
        matchId: command.matchId,
        turnId: command.turnId,
        revision: command.revision ?? null,
        configVersion: command.configVersion,
        input: command.input,
      }),
    )
    .digest('hex');
}
export class ShotReceipts {
  private readonly entries = new Map<string, ShotReceipt>();
  constructor(records: readonly ShotReceipt[] = []) {
    for (const receipt of records) {
      const id = key(receipt.matchId, receipt.actorId, receipt.shotId);
      if (this.entries.has(id)) throw new Error('Duplicate stored shot receipt');
      this.entries.set(id, { ...receipt });
    }
  }
  lookup(actorId: string, command: ShotMsg): { kind: 'new' } | { kind: 'same' | 'conflict'; receipt: ShotReceipt } {
    const receipt = this.entries.get(key(command.matchId, actorId, command.clientShotId));
    if (!receipt) return { kind: 'new' };
    const finite = Object.values(command.input).every((value) => typeof value !== 'number' || Number.isFinite(value));
    return {
      kind: finite && receipt.payloadHash === shotFingerprint(command) ? 'same' : 'conflict',
      receipt: { ...receipt },
    };
  }
  accept(actorId: string, command: ShotMsg, seq: number, revision: number): ShotReceipt {
    if (this.lookup(actorId, command).kind !== 'new') throw new Error('Shot receipt already exists');
    const receipt = {
      matchId: command.matchId,
      actorId,
      shotId: command.clientShotId,
      payloadHash: shotFingerprint(command),
      seq,
      revision,
    };
    this.entries.set(key(command.matchId, actorId, command.clientShotId), receipt);
    return { ...receipt };
  }
  records(): ShotReceipt[] {
    return [...this.entries.values()].map((receipt) => ({ ...receipt }));
  }
}

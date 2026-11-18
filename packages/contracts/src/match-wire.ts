import { ACCOUNT_PROTOCOL_VERSION } from '../../../shared/protocol';
import { z } from 'zod';

export const SurrenderV2Schema = z.strictObject({
  protocol: z.literal(ACCOUNT_PROTOCOL_VERSION),
  matchId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  configVersion: z.string().min(1).max(1024),
});

export const MAX_SERVER_MESSAGE_BYTES = 512 * 1024;
export const MAX_SHOT_FRAMES = 1024;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
/** Check dimensions before walking coordinates or serializing; clients never allocate an unbounded playback. */
export function boundedShotPacket(value: unknown, maxFrames = MAX_SHOT_FRAMES): boolean {
  if (
    !isObject(value) ||
    !Array.isArray(value.ids) ||
    value.ids.length < 2 ||
    value.ids.length > 65 ||
    value.ids[0] !== 'ball'
  )
    return false;
  if (
    !value.ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 64) ||
    new Set(value.ids).size !== value.ids.length
  )
    return false;
  if (
    !Array.isArray(value.frames) ||
    value.frames.length < 1 ||
    value.frames.length > Math.min(maxFrames, MAX_SHOT_FRAMES)
  )
    return false;
  if (
    typeof value.recordHz !== 'number' ||
    !Number.isFinite(value.recordHz) ||
    value.recordHz <= 0 ||
    value.recordHz > 120
  )
    return false;
  const width = value.ids.length * 2;
  for (const frame of value.frames)
    if (
      !Array.isArray(frame) ||
      frame.length !== width ||
      !frame.every((n) => typeof n === 'number' && Number.isSafeInteger(n) && Math.abs(n) <= 2147483647)
    )
      return false;
  for (const name of ['simEvents', 'events', 'turnEvents'])
    if (!Array.isArray(value[name]) || value[name].length > 4096) return false;
  try {
    const json = JSON.stringify(value);
    return json.length <= MAX_SERVER_MESSAGE_BYTES && new TextEncoder().encode(json).length <= MAX_SERVER_MESSAGE_BYTES;
  } catch {
    return false;
  }
}

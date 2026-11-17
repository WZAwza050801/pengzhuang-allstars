import type { GameData } from '../../../shared/data';
import { FIELD_SKINS } from '../../../shared/data';
import {
  MAX_ID_LENGTH,
  MAX_NICKNAME_LENGTH,
  SEAT_TOKEN_PATTERN,
  type NetErrorCode,
  type ReadyMsg,
  type SetLineupMsg,
  type ShotMsg,
} from '../../../shared/protocol';

/** Validators never throw: every failure is a stable protocol error code. */
export type Parsed<T> = { ok: true; value: T } | { ok: false; code: NetErrorCode };

const good = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = (code: NetErrorCode): { ok: false; code: NetErrorCode } => ({ ok: false, code });

const ID_RE = new RegExp(`^[A-Za-z0-9_-]{1,${MAX_ID_LENGTH}}$`);
const MAX_PIECE_ID_LENGTH = 32;
const MAX_CONFIG_VERSION_LENGTH = 128;

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Own keys must include every required key and nothing outside required + optional. */
export function hasExactKeys(
  o: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  for (const k of required) if (!Object.hasOwn(o, k)) return false;
  for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) return false;
  return true;
}

export function parseNickname(v: unknown): Parsed<string> {
  if (typeof v !== 'string' || v.length > MAX_NICKNAME_LENGTH * 4) return fail('bad-nickname');
  const s = v.normalize('NFC').trim();
  // Control, format (zero-width / bidi override), surrogate, private-use, unassigned and line/paragraph separators.
  if (/[\p{C}\p{Zl}\p{Zp}]/u.test(s)) return fail('bad-nickname');
  const n = Array.from(s).length;
  if (n < 1 || n > MAX_NICKNAME_LENGTH) return fail('bad-nickname');
  return good(s);
}

export function parseSkin(v: unknown): Parsed<string> {
  if (v === undefined || v === null) return good(FIELD_SKINS[0].id);
  if (typeof v !== 'string' || !FIELD_SKINS.some((s) => s.id === v)) return fail('bad-skin');
  return good(v);
}

export function parseSetLineup(raw: unknown, data: GameData): Parsed<Required<SetLineupMsg>> {
  if (!isRecord(raw) || !hasExactKeys(raw, ['lineup'], ['levels'])) return fail('bad-message');
  const slots = data.rules.formation.length;

  const lineup = raw.lineup;
  if (!Array.isArray(lineup) || lineup.length !== slots) return fail('bad-lineup');
  const seen = new Set<string>();
  for (const id of lineup) {
    // hasOwn: "__proto__" / "constructor" must not resolve to inherited Object members.
    if (typeof id !== 'string' || !Object.hasOwn(data.players, id) || seen.has(id)) return fail('bad-lineup');
    seen.add(id);
  }

  let levels: number[];
  if (raw.levels === undefined || raw.levels === null) {
    levels = new Array<number>(slots).fill(data.rules.levels.uniformLevel);
  } else {
    if (!Array.isArray(raw.levels) || raw.levels.length !== slots) return fail('bad-level');
    for (const l of raw.levels) {
      if (typeof l !== 'number' || !Number.isInteger(l) || l < 1 || l > data.rules.levels.max) return fail('bad-level');
    }
    levels = raw.levels.slice() as number[];
  }
  return good({ lineup: lineup.slice() as string[], levels });
}

export function parseReady(raw: unknown): Parsed<ReadyMsg> {
  if (!isRecord(raw) || !hasExactKeys(raw, ['ready']) || typeof raw.ready !== 'boolean') return fail('bad-message');
  return good({ ready: raw.ready });
}

/** Format only (22 base64url chars = 16 random bytes); whether it belongs to a seat is decided by the room. */
export function parseSeatToken(v: unknown): Parsed<string> {
  if (typeof v !== 'string' || !SEAT_TOKEN_PATTERN.test(v)) return fail('bad-seat-token');
  return good(v);
}

/** `surrender` carries no data: undefined, null or an empty object. */
export function parseSurrender(raw: unknown): Parsed<null> {
  if (raw === undefined || raw === null) return good(null);
  if (isRecord(raw) && Object.keys(raw).length === 0) return good(null);
  return fail('bad-message');
}

/**
 * Shape only. Numbers are checked for `typeof` but not for finiteness or range: NaN / Infinity / out-of-range
 * values reach shared/match.ts validateShot(), the single source of truth for shot legality.
 */
export function parseShotMessage(raw: unknown): Parsed<ShotMsg> {
  if (!isRecord(raw) || !hasExactKeys(raw, ['matchId', 'turnId', 'clientShotId', 'configVersion', 'input']))
    return fail('bad-message');
  const { matchId, turnId, clientShotId, configVersion, input } = raw;
  if (typeof matchId !== 'string' || !ID_RE.test(matchId)) return fail('bad-message');
  if (typeof clientShotId !== 'string' || !ID_RE.test(clientShotId)) return fail('bad-message');
  if (typeof configVersion !== 'string' || configVersion.length > MAX_CONFIG_VERSION_LENGTH) return fail('bad-message');
  if (typeof turnId !== 'number' || !Number.isSafeInteger(turnId) || turnId < 0) return fail('bad-message');
  if (!isRecord(input) || !hasExactKeys(input, ['pieceId', 'dirX', 'dirY', 'power', 'curve']))
    return fail('bad-message');
  const { pieceId, dirX, dirY, power, curve } = input;
  if (typeof pieceId !== 'string' || pieceId.length < 1 || pieceId.length > MAX_PIECE_ID_LENGTH)
    return fail('bad-message');
  if (typeof dirX !== 'number' || typeof dirY !== 'number' || typeof power !== 'number' || typeof curve !== 'number') {
    return fail('bad-message');
  }
  return good({ matchId, turnId, clientShotId, configVersion, input: { pieceId, dirX, dirY, power, curve } });
}

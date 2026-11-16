import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { MatchState } from '../shared/match';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, SEAT_TOKEN_PATTERN } from '../shared/protocol';
import { isRecord, parseNickname } from './validation';

export const ROOM_RECORD_FORMAT = 1;

/** Everything needed to carry a running match across a server restart. One JSON file per room, no database. */
export interface RoomRecord {
  format: typeof ROOM_RECORD_FORMAT;
  code: string;
  skin: string;
  configVersion: string;
  matchId: string;
  seed: number;
  seq: number;
  /** `${side}:${clientShotId}` -> seq, so a shot replayed after the restart is still a `duplicate-shot`. */
  accepted: [string, number][];
  /** Includes the real `rng`: the persisted copy is the only place besides RAM where the seed state lives. */
  match: MatchState;
  seats: [RecordSeat, RecordSeat];
  /** Remaining milliseconds when saved; the clocks are frozen while the server is down. */
  clocks: { matchMs: number; turnMs: number | null };
  savedAt: number;
}

export interface RecordSeat {
  nickname: string;
  token: string;
  lineup: string[];
  levels: number[];
}

export interface RoomStore {
  readonly dir: string;
  save(rec: RoomRecord): void;
  remove(code: string): void;
  loadAll(expectedConfigVersion: string): RoomRecord[];
}

const CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
const FILE_RE = new RegExp(`^([${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}})\\.json$`);

const isInt = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isSide = (v: unknown): boolean => v === 0 || v === 1;

function isMatchState(v: unknown): v is MatchState {
  if (!isRecord(v)) return false;
  if (!isStr(v.dataVersion, 128) || !isInt(v.rng) || v.rng > 0xffffffff || !isSide(v.turn) || !isInt(v.shotNo)) return false;
  if (!Array.isArray(v.score) || v.score.length !== 2 || !v.score.every((n) => isInt(n))) return false;
  if (!isRecord(v.ball) || !isNum(v.ball.x) || !isNum(v.ball.y)) return false;
  if (typeof v.over !== 'boolean' || typeof v.extraUsed !== 'boolean' || typeof v.endReason !== 'string') return false;
  if (v.winner !== -1 && !isSide(v.winner)) return false;
  if (!Array.isArray(v.pieces) || v.pieces.length < 2 || v.pieces.length > 64) return false;
  return v.pieces.every(
    (p) =>
      isRecord(p) &&
      isStr(p.id, 32) &&
      isSide(p.side) &&
      isStr(p.playerId, 64) &&
      isInt(p.slot) &&
      isInt(p.level) &&
      isNum(p.cond) &&
      isNum(p.x) &&
      isNum(p.y) &&
      isNum(p.out) &&
      isNum(p.frozen) &&
      typeof p.anchored === 'boolean' &&
      typeof p.ready === 'boolean',
  );
}

function isRecordSeat(v: unknown): v is RecordSeat {
  return (
    isRecord(v) &&
    parseNickname(v.nickname).ok &&
    typeof v.token === 'string' &&
    SEAT_TOKEN_PATTERN.test(v.token) &&
    Array.isArray(v.lineup) &&
    v.lineup.every((id) => isStr(id, 64)) &&
    Array.isArray(v.levels) &&
    v.levels.every((l) => isInt(l, 1))
  );
}

/** Structural check only; the room re-validates lineups against the live game data when it restores. */
export function isRoomRecord(v: unknown): v is RoomRecord {
  if (!isRecord(v) || v.format !== ROOM_RECORD_FORMAT) return false;
  if (typeof v.code !== 'string' || !CODE_RE.test(v.code)) return false;
  if (!isStr(v.skin, 64) || !isStr(v.configVersion, 128) || !isStr(v.matchId, 64)) return false;
  if (!isInt(v.seed) || !isInt(v.seq)) return false;
  if (!Array.isArray(v.accepted) || v.accepted.length > 1024) return false;
  if (!v.accepted.every((e) => Array.isArray(e) && e.length === 2 && isStr(e[0], 128) && isInt(e[1]))) return false;
  if (!isMatchState(v.match)) return false;
  if (!Array.isArray(v.seats) || v.seats.length !== 2 || !v.seats.every(isRecordSeat)) return false;
  if (!isRecord(v.clocks) || !isNum(v.clocks.matchMs) || v.clocks.matchMs < 0) return false;
  if (v.clocks.turnMs !== null && (!isNum(v.clocks.turnMs) || v.clocks.turnMs < 0)) return false;
  return isNum(v.savedAt);
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * File-backed store. `save` and `remove` never throw: a full disk or a read-only directory must not take a live room
 * down, the match just stops being restartable (and says so in the log).
 */
export function createRoomStore(dir: string): RoomStore {
  const root = path.resolve(dir);
  // The code is the file name: refuse anything that is not exactly a room code before it gets near a path.
  const fileFor = (code: string): string => {
    if (!CODE_RE.test(code)) throw new Error(`not a room code: ${JSON.stringify(code)}`);
    return path.join(root, `${code}.json`);
  };

  return {
    dir: root,

    save(rec) {
      try {
        const file = fileFor(rec.code);
        mkdirSync(root, { recursive: true });
        const tmp = `${file}.tmp`;
        writeFileSync(tmp, JSON.stringify(rec), 'utf8');
        renameSync(tmp, file);
      } catch (err) {
        console.error(`[roomStore] save failed for ${String(rec.code)}: ${errText(err)}`);
      }
    },

    remove(code) {
      try {
        const file = fileFor(code);
        rmSync(file, { force: true });
        rmSync(`${file}.tmp`, { force: true });
      } catch (err) {
        console.error(`[roomStore] remove failed for ${String(code)}: ${errText(err)}`);
      }
    },

    loadAll(expectedConfigVersion) {
      let names: string[];
      try {
        names = readdirSync(root).sort();
      } catch {
        return [];
      }
      const out: RoomRecord[] = [];
      for (const name of names) {
        const m = FILE_RE.exec(name);
        if (!m) continue;
        const file = path.join(root, name);
        const reject = (why: string): void => {
          console.error(`[roomStore] rejected ${name}: ${why}`);
          try {
            renameSync(file, `${file}.rejected`);
          } catch (err) {
            console.error(`[roomStore] could not set ${name} aside: ${errText(err)}`);
          }
        };
        let raw: unknown;
        try {
          raw = JSON.parse(readFileSync(file, 'utf8'));
        } catch (err) {
          reject(`unreadable (${errText(err)})`);
          continue;
        }
        if (!isRoomRecord(raw)) {
          reject('structure check failed');
          continue;
        }
        if (raw.code !== m[1]) {
          reject('code does not match file name');
          continue;
        }
        if (raw.configVersion !== expectedConfigVersion || raw.match.dataVersion !== expectedConfigVersion) {
          reject(`data version ${raw.configVersion} differs from the running ${expectedConfigVersion}`);
          continue;
        }
        out.push(raw);
      }
      return out;
    },
  };
}

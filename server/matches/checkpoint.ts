import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ACCOUNT_PROTOCOL_VERSION, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../shared/protocol';
import { canonicalJson } from '../../packages/game-core/src/snapshot';
import { OutcomeIntentSchema } from '../../packages/contracts/src/match-results';

const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const side = z.union([z.literal(0), z.literal(1)]);
const point = z.strictObject({ x: z.number(), y: z.number() });
const id = z.uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const CheckpointCardSchema = z.strictObject({
  slot: z.number().int().min(0).max(4),
  ownedCardId: id,
  playerDefId: z.string().regex(/^p[0-9]{2,4}$/),
  cardVersion: integer,
  ownedLevel: z.number().int().min(1).max(10),
  level: z.number().int().min(1).max(10),
});
const seatSchema = z.strictObject({
  userId: id,
  lineupId: id,
  lineupRevision: integer.max(2147483647),
  cards: z.array(CheckpointCardSchema).length(5),
});
export const CheckpointSchema = z
  .strictObject({
    format: z.literal(1),
    engine: z.literal('shared-match-v1'),
    identity: z.literal('account'),
    protocol: z.literal(ACCOUNT_PROTOCOL_VERSION),
    clockPolicy: z.literal('freeze-v1'),
    code: z.string().regex(new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`)),
    matchId: id,
    configVersion: z.string().min(1).max(1024),
    configurationHash: hash,
    skin: z.string().min(1).max(64),
    seed: integer.max(0xffffffff),
    seq: integer.max(1024),
    revision: integer,
    match: z.strictObject({
      dataVersion: z.string().min(1).max(1024),
      rng: integer.max(0xffffffff),
      turn: side,
      shotNo: integer,
      score: z.tuple([integer, integer]),
      ball: point,
      over: z.boolean(),
      winner: z.union([side, z.literal(-1)]),
      endReason: z.string().max(100),
      extraUsed: z.boolean(),
      pieces: z
        .array(
          z.strictObject({
            id: z.string().min(1).max(32),
            side,
            playerId: z.string().regex(/^p[0-9]{2,4}$/),
            slot: z.number().int().min(0).max(4),
            level: z.number().int().min(1).max(10),
            cond: z.number().min(0).max(1),
            x: z.number(),
            y: z.number(),
            out: integer,
            frozen: integer,
            anchored: z.boolean(),
            ready: z.boolean(),
          }),
        )
        .length(10),
    }),
    seats: z.tuple([seatSchema, seatSchema]),
    receipts: z
      .array(
        z.strictObject({
          matchId: id,
          actorId: id,
          shotId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
          payloadHash: hash,
          seq: integer.min(1),
          revision: integer.min(1),
        }),
      )
      .max(1024),
    clocks: z.strictObject({
      matchMs: integer,
      turnMs: integer.nullable(),
      playbackMs: integer,
      elapsedMs: integer,
      reconnectMs: z.tuple([integer.nullable(), integer.nullable()]),
    }),
    savedAt: integer,
    terminal: OutcomeIntentSchema.nullable(),
  })
  .superRefine((record, ctx) => {
    const invalid = () => ctx.addIssue({ code: 'custom', message: 'Checkpoint bindings or history are inconsistent' });
    if (
      record.match.dataVersion !== record.configVersion ||
      record.revision < record.seq ||
      record.seq !== record.receipts.length ||
      record.seats[0].userId === record.seats[1].userId ||
      record.match.over !== (record.terminal !== null)
    )
      invalid();
    const owners = record.seats.map((seat) => seat.userId),
      unique = new Set<string>();
    let previousRevision = 0;
    for (const [index, receipt] of record.receipts.entries()) {
      const key = `${receipt.actorId}:${receipt.shotId}`;
      if (
        receipt.matchId !== record.matchId ||
        !owners.includes(receipt.actorId) ||
        receipt.seq !== index + 1 ||
        receipt.revision <= previousRevision ||
        receipt.revision > record.revision ||
        unique.has(key)
      )
        invalid();
      previousRevision = receipt.revision;
      unique.add(key);
    }
    for (const [seatSide, seat] of record.seats.entries()) {
      if (
        new Set(seat.cards.map((card) => card.ownedCardId)).size !== 5 ||
        new Set(seat.cards.map((card) => card.playerDefId)).size !== 5 ||
        seat.cards.some((card, slot) => card.slot !== slot)
      )
        invalid();
      const pieces = record.match.pieces.filter((piece) => piece.side === seatSide);
      if (
        pieces.length !== 5 ||
        new Set(pieces.map((piece) => piece.slot)).size !== 5 ||
        pieces.some(
          (piece) =>
            piece.id !== `${seatSide}-${piece.slot}` ||
            piece.playerId !== seat.cards[piece.slot].playerDefId ||
            piece.level !== seat.cards[piece.slot].level,
        )
      )
        invalid();
    }
    const terminal = record.terminal;
    if (
      terminal &&
      (terminal.matchId !== record.matchId ||
        terminal.configurationHash !== record.configurationHash ||
        terminal.configVersion !== record.configVersion ||
        terminal.finalSeq !== record.seq ||
        canonicalJson(terminal.score) !== canonicalJson(record.match.score) ||
        terminal.reason !== record.match.endReason ||
        terminal.participants.some(
          (participant, index) =>
            participant.userId !== record.seats[index].userId ||
            participant.actions !== record.receipts.filter((receipt) => receipt.actorId === participant.userId).length,
        ))
    )
      invalid();
  });
export type AccountCheckpoint = z.infer<typeof CheckpointSchema>;
export type AccountCheckpointDraft = Omit<AccountCheckpoint, 'configurationHash'>;
export const checkpointHash = (record: AccountCheckpoint) =>
  createHash('sha256').update(canonicalJson(record)).digest('hex');

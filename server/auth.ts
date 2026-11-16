import { randomUUID } from 'node:crypto';
import { ErrorCode, ServerError } from 'colyseus';
import { PROTOCOL_VERSION, type NetErrorCode } from '../shared/protocol';
import { isRecord, parseNickname, parseSeatToken } from './validation';

export interface GuestIdentity {
  /** Server-generated. Never sent to clients and never logged. */
  guestId: string;
  nickname: string;
  /** Present when the client asked to re-claim a seat; whether it is valid is decided by the room. */
  seatToken?: string;
}

export function netError(code: NetErrorCode): ServerError {
  return new ServerError(ErrorCode.APPLICATION_ERROR, code);
}

/** Guest-only auth: identity is minted here, nothing the client claims about who it is is trusted. */
export function authenticateJoin(options: unknown): GuestIdentity {
  if (!isRecord(options)) throw netError('bad-message');
  if (options.protocol !== PROTOCOL_VERSION) throw netError('protocol-mismatch');
  const nickname = parseNickname(options.nickname);
  if (!nickname.ok) throw netError(nickname.code);
  const identity: GuestIdentity = { guestId: randomUUID(), nickname: nickname.value };
  if (options.seatToken !== undefined) {
    const token = parseSeatToken(options.seatToken);
    if (!token.ok) throw netError(token.code);
    identity.seatToken = token.value;
  }
  return identity;
}

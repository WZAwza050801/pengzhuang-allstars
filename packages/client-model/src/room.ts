import { RoomCodeSchema } from '../../contracts/src/match-tickets';

export function normalizeRoomCode(input: string): string | null {
  const code = RoomCodeSchema.safeParse(input.trim().toUpperCase());
  return code.success ? code.data : null;
}
export function invitationUrl(origin: string, code: string): string {
  const destination = RoomCodeSchema.parse(code);
  const url = new URL(`/room/${destination}`, origin);
  return url.toString();
}
export function roomFailureText(code: string): string {
  const messages: Record<string, string> = {
    UNAUTHENTICATED: '登录状态已失效，请重新登录后再进入。',
    ACCOUNT_CHANGED: '账号已变化，请回大厅确认当前账号。',
    FORBIDDEN: '当前账号或阵容不可参赛，请检查持有卡状态。',
    CONFLICT: '阵容版本已变化或卡牌不可用，请重新读取阵容。',
    NOT_FOUND: '房间不存在、已满或已结束，请核对邀请或返回大厅。',
    RATE_LIMITED: '进入房间过于频繁，请稍后再试。',
    INVALID_RESPONSE: '服务端规则或返回信息不兼容，请刷新客户端。',
  };
  return messages[code] ?? '暂时无法连接房间，请检查网络后重试。';
}
export class RoomJoinError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
  ) {
    super(roomFailureText(code));
  }
}

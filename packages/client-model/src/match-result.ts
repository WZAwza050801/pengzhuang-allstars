import {
  MatchResultSchema,
  MatchLedgerSchema,
  type MatchResult,
  type MatchLedger,
} from '../../contracts/src/match-results';
import type { AccountResponse, AccountFailure } from './account';

type Identity = { userId: string; sessionId: string };
const identityKey = (value: Identity | null) => (value ? `${value.userId}:${value.sessionId}` : null);
const invalid: AccountFailure = { code: 'INVALID_RESPONSE', retryable: false };
const network: AccountFailure = { code: 'NETWORK_ERROR', retryable: true };
const unauthorized = (error: AccountFailure) =>
  ['UNAUTHENTICATED', 'ACCOUNT_CHANGED', 'FORBIDDEN'].includes(error.code);

/** Private, bounded, in-memory copies of server reads; cleared synchronously when the login identity changes. */
export class ResultCache {
  private identity: string | null = null;
  private readonly values = new Map<string, MatchResult>();
  setIdentity(value: Identity | null): void {
    const key = identityKey(value);
    if (key !== this.identity) {
      this.values.clear();
      this.identity = key;
    }
  }
  isIdentity(value: Identity) {
    return this.identity === identityKey(value);
  }
  list(owner: Identity): MatchResult[] {
    if (!this.isIdentity(owner)) return [];
    return [...this.values.values()]
      .map((value) => structuredClone(value))
      .sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt) || b.matchId.localeCompare(a.matchId));
  }
  read(owner: Identity, matchId: string): MatchResult | null {
    const value = this.isIdentity(owner) ? this.values.get(matchId) : null;
    return value ? structuredClone(value) : null;
  }
  write(owner: Identity, value: MatchResult): void {
    if (!this.isIdentity(owner) || value.userId !== owner.userId) return;
    const before = this.values.get(value.matchId);
    if (before?.status === 'settled' || (before?.recorded && !value.recorded)) return;
    this.values.delete(value.matchId);
    this.values.set(value.matchId, structuredClone(value));
    if (this.values.size > 32) this.values.delete(this.values.keys().next().value!);
  }
}
export interface MatchResultPort {
  matchResult(userId: string, matchId: string): Promise<AccountResponse<MatchResult>>;
  matchLedger(userId: string, matchId: string): Promise<AccountResponse<MatchLedger>>;
}
export interface ResultSnapshot {
  value: MatchResult | null;
  loading: boolean;
  offline: boolean;
  error: AccountFailure | null;
  ledger: MatchLedger['entries'] | null;
  ledgerLoading: boolean;
  ledgerError: AccountFailure | null;
}
/** Read-only view lifetime. Retrying a result or its receipt cannot invoke reward delivery. */
export class MatchResultModel {
  private value: ResultSnapshot;
  private disposed = false;
  private flight: Promise<void> | null = null;
  private ledgerFlight: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  constructor(
    private readonly port: MatchResultPort,
    private readonly owner: Identity,
    private readonly matchId: string,
    private readonly cache: ResultCache,
  ) {
    this.value = {
      value: cache.read(owner, matchId),
      loading: false,
      offline: false,
      error: null,
      ledger: null,
      ledgerLoading: false,
      ledgerError: null,
    };
  }
  get snapshot(): Readonly<ResultSnapshot> {
    return this.value;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private current() {
    return !this.disposed && this.cache.isIdentity(this.owner);
  }
  private update(patch: Partial<ResultSnapshot>) {
    this.value = { ...this.value, ...patch };
    for (const listener of this.listeners) listener();
  }
  setOnline(online: boolean) {
    if (this.current() && this.value.offline === online) this.update({ offline: !online });
  }
  private failure(error: AccountFailure) {
    if (unauthorized(error)) {
      this.cache.setIdentity(null);
      this.update({ value: null, ledger: null, loading: false, ledgerLoading: false, error });
    } else this.update({ loading: false, error });
  }
  refresh(): Promise<void> {
    if (this.flight) return this.flight;
    if (!this.current() || this.value.offline) return Promise.resolve();
    return (this.flight = (async () => {
      this.update({ loading: true });
      let response: AccountResponse<MatchResult>;
      try {
        response = await this.port.matchResult(this.owner.userId, this.matchId);
      } catch {
        response = { ok: false, error: network };
      }
      if (!this.current()) return;
      if (!response.ok) {
        this.failure(response.error);
        return;
      }
      const parsed = MatchResultSchema.safeParse(response.data);
      if (!parsed.success || parsed.data.matchId !== this.matchId || parsed.data.userId !== this.owner.userId) {
        this.failure(invalid);
        return;
      }
      const before = this.value.value,
        after = parsed.data;
      const accepted = before?.status === 'settled' || (before?.recorded && !after.recorded) ? before : after;
      this.cache.write(this.owner, accepted);
      this.update({ value: accepted, loading: false, error: null });
    })().finally(() => {
      this.flight = null;
    }));
  }
  readLedger(): Promise<void> {
    if (this.ledgerFlight) return this.ledgerFlight;
    const result = this.value.value;
    if (!this.current() || this.value.offline || result?.status !== 'settled' || !result.reward)
      return Promise.resolve();
    if (!result.reward.ledgerIds.length) {
      this.update({ ledger: [], ledgerError: null });
      return Promise.resolve();
    }
    return (this.ledgerFlight = (async () => {
      this.update({ ledgerLoading: true, ledgerError: null });
      let response: AccountResponse<MatchLedger>;
      try {
        response = await this.port.matchLedger(this.owner.userId, this.matchId);
      } catch {
        response = { ok: false, error: network };
      }
      if (!this.current()) return;
      if (!response.ok) {
        if (unauthorized(response.error)) this.failure(response.error);
        else this.update({ ledgerLoading: false, ledgerError: response.error });
        return;
      }
      const parsed = MatchLedgerSchema.safeParse(response.data),
        expected = new Set(result.reward!.ledgerIds);
      if (!parsed.success || parsed.data.userId !== this.owner.userId || parsed.data.matchId !== this.matchId) {
        this.update({ ledgerLoading: false, ledgerError: invalid });
        return;
      }
      const entries = parsed.data.entries;
      const sums = { coins: 0n, fragments: 0n };
      const seen = new Set<string>();
      for (const entry of entries) {
        if (
          seen.has(entry.id) ||
          !expected.has(entry.id) ||
          entry.sourceId !== this.matchId ||
          entry.reason !== 'match.reward' ||
          BigInt(entry.delta) < 0n
        ) {
          this.update({ ledgerLoading: false, ledgerError: invalid });
          return;
        }
        seen.add(entry.id);
        sums[entry.currency] += BigInt(entry.delta);
      }
      if (
        seen.size !== expected.size ||
        sums.coins !== BigInt(result.reward!.coins) ||
        sums.fragments !== BigInt(result.reward!.fragments)
      ) {
        this.update({ ledgerLoading: false, ledgerError: invalid });
        return;
      }
      this.update({ ledger: entries, ledgerLoading: false, ledgerError: null });
    })().finally(() => {
      this.ledgerFlight = null;
    }));
  }
  dispose() {
    this.disposed = true;
    this.listeners.clear();
  }
}

export function resultTitle(result: MatchResult): string {
  if (
    ['abandoned', 'server-fault', 'shot-limit'].includes(result.reason) ||
    (['surrender', 'disconnect'].includes(result.reason) && result.winner === -1)
  )
    return '本场作废';
  return result.winner === -1 ? '平局' : result.winner === result.side ? '胜利' : '惜败';
}
export function resultReason(reason: string): string {
  return (
    (
      {
        goals: '达到进球目标',
        time: '比赛时间到',
        surrender: '认输结束',
        disconnect: '断线超时',
        abandoned: '双方离线超时',
        'server-fault': '服务异常终止',
        'shot-limit': '达到出手上限，本场作废',
      } as Record<string, string>
    )[reason] ?? '比赛已结束'
  );
}
export function resultFailureText(code: string): string {
  return (
    (
      {
        NOT_FOUND: '尚未查到本人的已结束结果。若比赛刚结束，请稍后重查；也可以检查是否仍可回局。',
        UNAUTHENTICATED: '登录已失效，请重新登录查看本人结果。',
        ACCOUNT_CHANGED: '账号已变化，请回大厅确认当前账号。',
        FORBIDDEN: '当前账号暂不可查看该结果。',
        INVALID_RESPONSE: '返回信息未通过核验，请稍后重查。',
        RATE_LIMITED: '查询过于频繁，请稍后重查。',
      } as Record<string, string>
    )[code] ?? '暂时未能更新结果。已确认的信息会保留，请联网后重查。'
  );
}

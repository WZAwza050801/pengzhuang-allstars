import type { CurrentUser } from '../../contracts/src/accounts';
import type { API_ERROR_CODES } from '../../contracts/src/http';

export type AccountFailure = {
  code: (typeof API_ERROR_CODES)[number] | 'NETWORK_ERROR' | 'INVALID_RESPONSE';
  retryable: boolean;
};
export type AccountResponse<T> = { ok: true; data: T } | { ok: false; error: AccountFailure };
export interface LogoutIntent {
  operationId: string;
  allSessions: boolean;
}
export interface AccountPort {
  current(): Promise<AccountResponse<CurrentUser>>;
  logout(intent: LogoutIntent): Promise<AccountResponse<{ loggedOut: true }>>;
}
export interface LoginSnapshot {
  readonly status: 'unknown' | 'loading' | 'authenticated' | 'anonymous' | 'error' | 'signing-out' | 'logout-pending';
  readonly user: CurrentUser | null;
  readonly error: AccountFailure | null;
}

/** Platform-neutral account state. No password/token storage or browser globals. */
export class LoginStateModel {
  private value: LoginSnapshot = Object.freeze({ status: 'unknown', user: null, error: null });
  private generation = 0;
  private loading: Promise<void> | null = null;
  private signingOut: Promise<void> | null = null;
  private intent: LogoutIntent | null = null;
  private readonly listeners = new Set<() => void>();
  constructor(
    private readonly port: AccountPort,
    private readonly operationId: () => string,
  ) {}
  get snapshot(): LoginSnapshot {
    return this.value;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private set(value: LoginSnapshot) {
    this.value = Object.freeze(value);
    for (const listener of this.listeners) listener();
  }
  restore(): Promise<void> {
    if (this.intent) return Promise.resolve();
    if (this.loading) return this.loading;
    const generation = ++this.generation;
    this.set({ status: 'loading', user: this.value.user, error: null });
    const pending = this.port
      .current()
      .then((result) => {
        if (generation !== this.generation) return;
        if (result.ok) this.set({ status: 'authenticated', user: result.data, error: null });
        else if (result.error.code === 'UNAUTHENTICATED') this.set({ status: 'anonymous', user: null, error: null });
        else this.set({ status: 'error', user: this.value.user, error: result.error });
      })
      .finally(() => {
        if (this.loading === pending) this.loading = null;
      });
    this.loading = pending;
    return pending;
  }
  logout(allSessions: boolean): Promise<void> {
    if (this.intent && this.intent.allSessions !== allSessions)
      return Promise.reject(new Error('Pending logout scope cannot change'));
    if (this.signingOut) return this.signingOut;
    this.intent ??= { operationId: this.operationId(), allSessions };
    const intent = this.intent;
    ++this.generation;
    this.loading = null;
    this.set({ status: 'signing-out', user: null, error: null });
    const pending = this.port
      .logout(intent)
      .then((result) => {
        if (result.ok) {
          this.intent = null;
          this.set({ status: 'anonymous', user: null, error: null });
        } else this.set({ status: 'logout-pending', user: null, error: result.error });
      })
      .finally(() => {
        this.signingOut = null;
      });
    this.signingOut = pending;
    return pending;
  }
  retry(): Promise<void> {
    return this.intent ? this.logout(this.intent.allSessions) : this.restore();
  }
}

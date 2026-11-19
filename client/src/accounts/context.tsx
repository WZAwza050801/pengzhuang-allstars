import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createWebPlatform } from '@pengzhuang/platform';
import { WebAccountClient } from '../../../packages/platform/src/account-client';
import { LoginStateModel, type LoginSnapshot } from '../../../packages/client-model/src/account';
import { ResultCache } from '../../../packages/client-model/src/match-result';
import type { AuthOptions } from '../../../packages/contracts/src/accounts';

interface AccountServices {
  api: WebAccountClient;
  model: LoginStateModel;
  results: ResultCache;
  reconcile(): Promise<void>;
  changed(authenticated: boolean): Promise<void>;
}
interface AccountContextValue {
  services: AccountServices | null;
  login: LoginSnapshot;
  options: AuthOptions | null;
  unavailable: boolean;
}
const initial: LoginSnapshot = { status: 'unknown', user: null, error: null };
const Context = createContext<AccountContextValue>({
  services: null,
  login: initial,
  options: null,
  unavailable: false,
});
export const useAccount = () => useContext(Context);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<AccountContextValue>({
    services: null,
    login: initial,
    options: null,
    unavailable: false,
  });
  useEffect(() => {
    let stopped = false;
    const platform = createWebPlatform({
      audio: { async unlock() {}, play() {}, pause() {}, resume() {}, dispose() {} },
    });
    const api = new WebAccountClient(platform.network);
    const model = new LoginStateModel(api, () => crypto.randomUUID());
    const results = new ResultCache();
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('pz-account-events-v1') : null;
    let flight: Promise<void> | null = null;
    let identityEpoch = 0;
    const services: AccountServices = {
      api,
      model,
      results,
      reconcile() {
        return (flight ??= (async () => {
          const epoch = identityEpoch;
          const result = await api.options();
          if (stopped) return;
          setValue((previous) => ({
            ...previous,
            options: result.ok ? result.data : previous.options,
            unavailable: !result.ok,
          }));
          if (
            !result.ok ||
            epoch !== identityEpoch ||
            model.snapshot.status === 'logout-pending' ||
            model.snapshot.status === 'signing-out'
          )
            return;
          if (result.data.sessionPresent) await model.restore();
          else await model.sessionChanged(false);
        })().finally(() => {
          flight = null;
        }));
      },
      async changed(authenticated) {
        identityEpoch++;
        await model.sessionChanged(authenticated);
        channel?.postMessage('session-changed');
      },
    };
    const unsubscribe = model.subscribe(() => {
      results.setIdentity(model.snapshot.user);
      if (!stopped) setValue((previous) => ({ ...previous, login: model.snapshot }));
    });
    setValue({ services, login: model.snapshot, options: null, unavailable: false });
    const refresh = () => {
      if (!document.hidden) void services.reconcile();
    };
    if (channel)
      channel.onmessage = (event) => {
        if (event.data === 'session-changed') refresh();
      };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    void services.reconcile();
    return () => {
      stopped = true;
      unsubscribe();
      results.setIdentity(null);
      channel?.close();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
      void platform.dispose();
    };
  }, []);
  return <Context value={value}>{children}</Context>;
}

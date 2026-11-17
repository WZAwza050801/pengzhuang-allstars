import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { LoginStateModel, type AccountResponse, type AccountPort } from '../packages/client-model/src/account';
import type { CurrentUser } from '../packages/contracts/src/accounts';

const user: CurrentUser = { userId: randomUUID(), sessionId: randomUUID(), profile: null };
const success = <T>(data: T): AccountResponse<T> => ({ ok: true, data });
const offline: AccountResponse<never> = { ok: false, error: { code: 'NETWORK_ERROR', retryable: true } };

test('a confirmed cookie identity change discards a read that started before the new login', async () => {
  let old!: (value: AccountResponse<CurrentUser>) => void;
  let count = 0;
  const replacement = { ...user, userId: randomUUID(), sessionId: randomUUID() };
  const model = new LoginStateModel(
    {
      current: () =>
        ++count === 1
          ? new Promise((resolve) => {
              old = resolve;
            })
          : Promise.resolve(success(replacement)),
      logout: async () => success({ loggedOut: true }),
    },
    randomUUID,
  );
  const pending = model.restore();
  await model.sessionChanged(true);
  old(success(user));
  await pending;
  expect(model.snapshot.user).toEqual(replacement);
  await model.sessionChanged(false);
  expect(model.snapshot).toMatchObject({ status: 'anonymous', user: null });
});

test('restoration coalesces and a late current-user response cannot resurrect a logged-out account', async () => {
  let finish!: (result: AccountResponse<CurrentUser>) => void;
  let calls = 0;
  const port: AccountPort = {
    current: () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    logout: async () => success({ loggedOut: true }),
  };
  const model = new LoginStateModel(port, randomUUID);
  const one = model.restore();
  const two = model.restore();
  expect(calls).toBe(1);
  await model.logout(false);
  finish(success(user));
  await Promise.all([one, two]);
  expect(model.snapshot.status).toBe('anonymous');
  expect(model.snapshot.user).toBeNull();
});

test('logout response loss keeps one pending operation for retry and never claims confirmed logout early', async () => {
  const intents: unknown[] = [];
  const model = new LoginStateModel(
    {
      current: async () => success(user),
      logout: async (intent) => {
        intents.push(intent);
        return intents.length === 1 ? offline : success({ loggedOut: true });
      },
    },
    randomUUID,
  );
  await model.restore();
  await model.logout(true);
  expect(model.snapshot.status).toBe('logout-pending');
  expect(model.snapshot.user).toBeNull();
  await model.retry();
  expect(intents[0]).toEqual(intents[1]);
  expect(model.snapshot.status).toBe('anonymous');
});

test('offline restoration is retryable; an actual 401 yields anonymous state without retaining user data', async () => {
  let response: AccountResponse<CurrentUser> = offline;
  const model = new LoginStateModel(
    { current: async () => response, logout: async () => success({ loggedOut: true }) },
    randomUUID,
  );
  await model.restore();
  expect(model.snapshot.status).toBe('error');
  response = success(user);
  await model.retry();
  expect(model.snapshot.status).toBe('authenticated');
  response = { ok: false, error: { code: 'UNAUTHENTICATED', retryable: false } };
  await model.restore();
  expect(model.snapshot.status).toBe('anonymous');
  expect(model.snapshot.user).toBeNull();
});

test('an unfinished logout cannot silently change from one device to all devices', async () => {
  const model = new LoginStateModel({ current: async () => success(user), logout: async () => offline }, randomUUID);
  await model.logout(false);
  await expect(model.logout(true)).rejects.toThrow('Pending logout scope cannot change');
  expect(model.snapshot.status).toBe('logout-pending');
});

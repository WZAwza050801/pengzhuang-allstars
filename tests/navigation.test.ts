import { test, expect } from 'vitest';
import { resolveNavigation, ALL_FEATURES, type NavigationContext } from '../packages/client-model/src/navigation';
const context: NavigationContext = {
  session: 'anonymous',
  network: 'online',
  service: 'ready',
  features: { ...ALL_FEATURES },
};
test('anonymous cloud intent survives login without external return URLs', () => {
  const target = { page: 'lineup' };
  expect(resolveNavigation(target, context)).toEqual({ kind: 'login', resume: target });
  expect(resolveNavigation(target, { ...context, session: 'authenticated' })).toEqual({ kind: 'show', target });
  for (const input of [
    'https://evil.test',
    { page: 'login', returnTo: 'https://evil.test' },
    { page: 'lineup', balance: '999' },
  ])
    expect(resolveNavigation(input, context).kind).toBe('invalid');
});
test('closed features do not send visitors into an impossible login; guest friend and practice remain distinct', () => {
  expect(
    resolveNavigation({ page: 'lineup' }, { ...context, features: { ...ALL_FEATURES, inventory: false } }),
  ).toMatchObject({ kind: 'blocked', reason: 'feature-off' });
  expect(resolveNavigation({ page: 'room' }, context)).toEqual({ kind: 'show', target: { page: 'room' } });
  expect(resolveNavigation({ page: 'queue', mode: 'ranked' }, context).kind).toBe('login');
  expect(resolveNavigation({ page: 'queue', mode: 'friend' }, context).kind).toBe('invalid');
});
test('offline/maintenance/update block new remote flows but keep local practice and recovery views available', () => {
  for (const changed of [{ network: 'offline' }, { service: 'maintenance' }, { service: 'outdated' }] as const) {
    const state = { ...context, ...changed };
    expect(resolveNavigation({ page: 'room' }, state).kind).toBe('blocked');
    expect(resolveNavigation({ page: 'queue', mode: 'ranked' }, state).kind).toBe('blocked');
    expect(resolveNavigation({ page: 'match', mode: 'practice' }, state)).toEqual({
      kind: 'show',
      target: { page: 'match', mode: 'practice' },
    });
  }
  expect(
    resolveNavigation(
      { page: 'match', mode: 'friend', matchId: 'active-room' },
      { ...context, network: 'offline', features: { ...ALL_FEATURES, friendRooms: false } },
    ).kind,
  ).toBe('show');
  expect(resolveNavigation({ page: 'match', mode: 'ranked' }, context).kind).toBe('invalid');
});

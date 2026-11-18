import { expect, test } from 'vitest';
import { activeAnnouncements, publicManifest } from '../config/lobby';
import { lobbyService, formatLobbyMoney } from '../packages/client-model/src/lobby';
import { DEFAULT_DATA } from '../shared/data';
import { PROTOCOL_VERSION, SUPPORTED_MATCH_PROTOCOLS } from '../shared/protocol';
import { LobbyContentSchema, LobbyAccountSchema } from '../packages/contracts/src/lobby';

test('announcement visibility follows server publication and expiry boundaries', () => {
  const content = {
    version: 'lobby-test-1',
    announcements: [
      { id: 'visible', title: '公告', body: '内容', publishedAt: '2026-11-18T00:00:00Z', expiresAt: null },
      { id: 'future', title: '未来', body: '内容', publishedAt: '2026-11-18T01:00:01Z', expiresAt: null },
      {
        id: 'expired',
        title: '过期',
        body: '内容',
        publishedAt: '2026-11-17T00:00:00Z',
        expiresAt: '2026-11-18T01:00:00Z',
      },
    ],
  };
  expect(activeAnnouncements(content, new Date('2026-11-18T01:00:00Z')).announcements.map((item) => item.id)).toEqual([
    'visible',
  ]);
  expect(
    LobbyContentSchema.safeParse({ ...content, announcements: [content.announcements[0], content.announcements[0]] })
      .success,
  ).toBe(false);
});
test('announcement ordering compares instants across different ISO fractional precision', () => {
  const notice = { title: '公告', body: '内容', expiresAt: null };
  const feed = activeAnnouncements(
    {
      version: 'lobby-test-1',
      announcements: [
        { ...notice, id: 'older', publishedAt: '2026-11-18T00:00:00Z' },
        { ...notice, id: 'newer', publishedAt: '2026-11-18T00:00:00.100Z' },
      ],
    },
    new Date('2026-11-18T01:00:00Z'),
  );
  expect(feed.announcements.map((item) => item.id)).toEqual(['newer', 'older']);
});
test('public manifest uses authoritative mode rules and only implemented modes are available', () => {
  const manifest = publicManifest(DEFAULT_DATA, false);
  expect(manifest.protocolVersions).toEqual([...SUPPORTED_MATCH_PROTOCOLS]);
  expect(manifest.availableModes).toEqual(['practice']);
  expect(manifest.modes.find((mode) => mode.mode === 'friend')).toMatchObject({
    fixedLevel: 5,
    matchSeconds: 180,
    turnSeconds: 20,
    reconnectSeconds: 60,
  });
});
test('protocol mismatch takes priority and maintenance is an explicit server state', () => {
  const manifest = publicManifest(DEFAULT_DATA, true);
  expect(lobbyService(manifest)).toBe('maintenance');
  expect(lobbyService({ ...manifest, protocolVersions: [PROTOCOL_VERSION] })).toBe('outdated');
});
test('display formatting preserves all bigint digits without coercion to Number', () => {
  expect(formatLobbyMoney('9007199254740993')).toBe('9,007,199,254,740,993');
  expect(formatLobbyMoney('9223372036854775807')).toBe('9,223,372,036,854,775,807');
});
test('empty account resources are explicit and an invalid numeric wallet is rejected', () => {
  const empty = { userId: crypto.randomUUID(), profile: null, wallets: [], cardCount: 0, defaultLineup: null };
  expect(LobbyAccountSchema.safeParse(empty).success).toBe(true);
  expect(
    LobbyAccountSchema.safeParse({ ...empty, wallets: [{ currency: 'coins', balance: 300, version: 0 }] }).success,
  ).toBe(false);
});

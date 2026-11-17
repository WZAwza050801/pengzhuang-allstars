import { expect, test } from 'vitest';
import { inspectLegacyStorage } from '../packages/client-model/src/local-import';
import { LocalImportCommandSchema } from '../packages/contracts/src/local-import';
const storage = (entries: Record<string, string>) => ({ getItem: (key: string) => entries[key] ?? null });
const team = ['p07', 'p06', 'p08', 'p01', 'p02'];

test('legacy import extracts only validated preferences and a normalized nickname draft', () => {
  const preview = inspectLegacyStorage(
    storage({
      pz_nick: '  旧球员  ',
      pz_skin: 'classic',
      pz_muted: '1',
      pz_lineups: JSON.stringify({ active: 1, sets: [team, [...team].reverse()] }),
      pz_profile: JSON.stringify({ cash: 9999999, level: 10, role: 'admin' }),
      pz_card_level: '10',
      pz_server: 'https://evil.test',
    }),
  );
  expect(preview.command).toEqual({
    version: 'pz-local-v1',
    settings: { skinId: 'classic', muted: true },
    nicknameDraft: '旧球员',
    lineups: [
      { slot: 0, playerDefIds: team },
      { slot: 1, playerDefIds: [...team].reverse() },
    ],
    activeLineup: 1,
  });
  expect(LocalImportCommandSchema.safeParse(preview.command).success).toBe(true);
  expect(JSON.stringify(preview.command)).not.toMatch(/cash|level|role|server|evil/);
});
test('fresh storage produces no migration intent', () => {
  expect(inspectLegacyStorage(storage({})).command).toBeNull();
});
test('corrupt JSON and invalid values do not discard independent valid preferences', () => {
  const preview = inspectLegacyStorage(
    storage({ pz_lineups: '{bad', pz_skin: 'unknown', pz_nick: '\u202eadmin', pz_muted: '0' }),
  );
  expect(preview.command).toEqual({
    version: 'pz-local-v1',
    settings: { muted: false },
    nicknameDraft: null,
    lineups: [],
    activeLineup: null,
  });
  expect(preview.warnings.length).toBe(3);
});
test('lineup parser rejects duplicate, oversized, object and unknown definitions but preserves other sets', () => {
  for (const invalid of [
    [...team, 'p03'],
    ['p01', 'p01', 'p07', 'p06', 'p08'],
    team.map((id) => ({ id, level: 10 })),
    ['p0000', ...team.slice(1)],
  ]) {
    const preview = inspectLegacyStorage(storage({ pz_lineups: JSON.stringify({ active: 0, sets: [invalid, team] }) }));
    expect(preview.command?.lineups).toEqual([{ slot: 1, playerDefIds: team }]);
    expect(preview.command?.activeLineup).toBeNull();
  }
});
test('blocked or oversized storage is reported without throwing or accepting an empty import', () => {
  expect(
    inspectLegacyStorage({
      getItem() {
        throw new Error('denied');
      },
    }).command,
  ).toBeNull();
  expect(inspectLegacyStorage(storage({ pz_lineups: 'x'.repeat(20001) })).warnings.length).toBeGreaterThan(0);
});
test('HTTP import contract rejects asset authority and malformed migration markers', () => {
  const command = {
    version: 'pz-local-v1',
    settings: { muted: true },
    nicknameDraft: null,
    lineups: [],
    activeLineup: null,
  };
  for (const forged of [
    { ...command, coins: '99999' },
    { ...command, userId: crypto.randomUUID() },
    { ...command, version: 'old' },
    { ...command, settings: { muted: true, level: 10 } },
    { ...command, settings: {}, activeLineup: 1 },
  ])
    expect(LocalImportCommandSchema.safeParse(forged).success).toBe(false);
});

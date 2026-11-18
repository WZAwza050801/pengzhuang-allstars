import bundled from './lobby.json';
import { LobbyContentSchema, PublicManifestSchema, type LobbyContent } from '../packages/contracts/src/lobby';
import { ModeIdSchema } from '../packages/contracts/src/modes';
import { PROTOCOL_VERSION } from '../shared/protocol';
import { rulesForMode } from './modes';
import type { GameData } from '../shared/data';
import { freezeSnapshot } from '../packages/game-core/src/snapshot';

export const LOBBY_CONTENT = freezeSnapshot(LobbyContentSchema.parse(bundled));
export function activeAnnouncements(content: LobbyContent, now: Date) {
  const parsed = LobbyContentSchema.parse(content);
  return {
    version: parsed.version,
    announcements: parsed.announcements
      .filter(
        (item) =>
          Date.parse(item.publishedAt) <= now.getTime() &&
          (item.expiresAt === null || Date.parse(item.expiresAt) > now.getTime()),
      )
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id)),
  };
}
export function publicManifest(data: GameData, maintenance: boolean) {
  return PublicManifestSchema.parse({
    schemaVersion: 1,
    protocolVersions: [PROTOCOL_VERSION],
    gameDataVersion: data.version,
    maintenance,
    modes: ModeIdSchema.options.map((mode) => rulesForMode(data, mode)),
    availableModes: ['practice'],
  });
}

import { PhysicsConfigSchema } from '../packages/contracts/src/physics';
export { PhysicsConfigSchema } from '../packages/contracts/src/physics';
import { createHash } from 'node:crypto';
import bundledManifest from './bundled-game-manifest.json';
import { canonicalJson } from '../packages/game-core/src/snapshot';
import { PROTOCOL_VERSION } from '../shared/protocol';
import { DEFAULT_DATA, buildGameData, type GameData } from '../shared/data';
import { freezeSnapshot } from '../packages/game-core/src/snapshot';
import { VersionedRegistry, makeConfigPackage } from './versioned';

export function createBundledGameConfiguration() {
  if (
    bundledManifest.schemaVersion !== 1 ||
    bundledManifest.protocol !== PROTOCOL_VERSION ||
    bundledManifest.dataVersion !== DEFAULT_DATA.version ||
    bundledManifest.sha256 !== createHash('sha256').update(canonicalJson(DEFAULT_DATA)).digest('hex')
  )
    throw new Error('Bundled game configuration manifest mismatch');
  const registry = new VersionedRegistry(PhysicsConfigSchema);
  registry.register(makeConfigPackage(DEFAULT_DATA.physics.version, DEFAULT_DATA.physics));
  registry.activate(DEFAULT_DATA.physics.version);
  const snapshots = new Map<string, GameData>();
  const resolveData = (version?: string): GameData => {
    const physics = registry.get(version?.split('/')[1]);
    const data = buildGameData(physics);
    if (version && data.version !== version) throw new Error('Game data archive unavailable');
    if (!snapshots.has(data.version)) snapshots.set(data.version, freezeSnapshot(data));
    return snapshots.get(data.version)!;
  };
  return { registry, resolveData, bundleManifest: freezeSnapshot(bundledManifest) };
}

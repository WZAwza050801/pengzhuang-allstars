import { z } from 'zod';
import { createHash } from 'node:crypto';
import bundledManifest from './bundled-game-manifest.json';
import { canonicalJson } from '../packages/game-core/src/snapshot';
import { PROTOCOL_VERSION } from '../shared/protocol';
import { DEFAULT_DATA, buildGameData, type GameData, type PhysicsConfig } from '../shared/data';
import { freezeSnapshot } from '../packages/game-core/src/snapshot';
import { VersionedRegistry, makeConfigPackage } from './versioned';

const positive = () => z.number().positive();
const nonnegative = () => z.number().nonnegative();
const body = () =>
  z.strictObject({ radius: positive(), mass: positive(), linDamp: nonnegative(), coulomb: nonnegative() });
export const PhysicsConfigSchema: z.ZodType<PhysicsConfig> = z.strictObject({
  version: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
  hz: z.number().int().positive(),
  velocityIterations: z.number().int().positive(),
  positionIterations: z.number().int().positive(),
  velocityThreshold: nonnegative(),
  disc: body(),
  ball: body(),
  restitution: z.strictObject({
    discDisc: nonnegative(),
    discBall: nonnegative(),
    discWall: nonnegative(),
    ballWall: nonnegative(),
    net: nonnegative(),
    post: nonnegative(),
  }),
  friction: z.strictObject({ discDisc: nonnegative(), discBall: nonnegative(), wall: nonnegative() }),
  shot: z.strictObject({ vmax: positive(), gamma: positive(), minPower: z.number().min(0).max(1) }),
  curve: z.strictObject({ turnRate: nonnegative(), maxTurnDeg: nonnegative() }),
  spring: z.strictObject({
    restitution: nonnegative(),
    boost: nonnegative(),
    minSpeed: nonnegative(),
    maxSpeed: positive(),
  }),
  stopSpeed: nonnegative(),
  maxSimSeconds: positive(),
  postGoalSeconds: nonnegative(),
  maxBallSpeed: positive(),
  recordHz: z.number().int().positive(),
});
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

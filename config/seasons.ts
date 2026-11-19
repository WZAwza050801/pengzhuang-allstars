import raw from './seasons.json';
import { SeasonsConfigSchema, type SeasonsConfig } from '../packages/contracts/src/seasons';
import { freezeSnapshot } from '../packages/game-core/src/snapshot';

export const SEASONS_CONFIG: Readonly<SeasonsConfig> = freezeSnapshot(SeasonsConfigSchema.parse(raw));

export function verifySeasonsConfig(input: unknown): Readonly<SeasonsConfig> {
  return freezeSnapshot(SeasonsConfigSchema.parse(input));
}

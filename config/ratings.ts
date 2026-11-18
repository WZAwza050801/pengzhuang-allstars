import raw from './ratings.json';
import { RatingsConfigSchema, type RatingsConfig } from '../packages/contracts/src/ratings';
import { freezeSnapshot } from '../packages/game-core/src/snapshot';

export const RATINGS_CONFIG: Readonly<RatingsConfig> = freezeSnapshot(RatingsConfigSchema.parse(raw));

/** Season switches and soft resets belong to MM-03; MM-02 freezes one current season. */
export function verifyRatingsConfig(input: unknown): Readonly<RatingsConfig> {
  return freezeSnapshot(RatingsConfigSchema.parse(input));
}

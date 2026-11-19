import source from './matchmaking.json';
import { MatchmakingPolicySchema } from '../packages/contracts/src/matchmaking';
import { freezeSnapshot } from '../packages/game-core/src/snapshot';

export const MATCHMAKING_POLICY = freezeSnapshot(MatchmakingPolicySchema.parse(source));

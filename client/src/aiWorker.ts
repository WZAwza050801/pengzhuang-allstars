import { DEFAULT_DATA } from '../../shared/data';
import { chooseShot, type AiLevel, type AiSearchStats } from '../../shared/ai';
import type { MatchState } from '../../shared/match';
import { AiEpochSchema, AiPolicySchema } from '../../packages/contracts/src/ai';
import policy from '../../config/ai-policy.json';
const limits = AiPolicySchema.parse(policy);
self.onmessage = (
  event: MessageEvent<{ id: number; payload: { state: MatchState; level: AiLevel; seed: number; epoch: unknown } }>,
) => {
  const { id, payload } = event.data;
  if (
    !Number.isSafeInteger(id) ||
    id < 1 ||
    !payload ||
    !['easy', 'normal', 'hard'].includes(payload.level) ||
    !Number.isFinite(payload.seed)
  )
    throw new Error('Invalid AI worker request');
  const epoch = AiEpochSchema.parse(payload.epoch),
    state = payload.state;
  if (
    !state ||
    epoch.shotNo !== state.shotNo ||
    epoch.turn !== state.turn ||
    epoch.dataVersion !== state.dataVersion ||
    epoch.dataVersion !== DEFAULT_DATA.version
  )
    throw new Error('AI worker epoch mismatch');
  let stats: AiSearchStats = { evaluated: 0, elapsedMs: 0, reason: 'no-move' };
  const input = chooseShot(state, DEFAULT_DATA, payload.level, payload.seed, {
    maxEvaluations: limits.maxEvaluations,
    budgetMs: limits.computeBudgetMs,
    now: () => performance.now(),
    onStats: (value) => {
      stats = value;
    },
  });
  self.postMessage({ id, payload: { epoch, input, stats } });
};

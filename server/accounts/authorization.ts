import type { SqlExecutor } from '../../packages/persistence/src/database';
import { SessionRepository } from '../../packages/persistence/src/sessions';
import type { Principal } from './access-tokens';
import { ApiError } from '../api/http';

/** User then session locks; services must recheck within the same transaction as their business operation. */
export async function requireActivePrincipal(tx: SqlExecutor, principal: Principal) {
  const repository = new SessionRepository(tx);
  const state = await repository.lock(principal.sessionId);
  if (!state || state.user_id !== principal.userId || state.revoked_at || !state.unexpired || state.status !== 'active') throw new ApiError('UNAUTHENTICATED', 401);
  return repository;
}

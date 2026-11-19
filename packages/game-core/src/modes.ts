import type { ModeRules, ModeOutcome } from '../../contracts/src/modes';
import type { GameData } from '../../../shared/data';
import type { Side } from '../../../shared/physics';

export interface ModeCard {
  playerDefId: string;
  level: number;
}
/** Owned cards must be read by the server; client-submitted arrays are not ownership evidence. */
export function resolveModeLineup(
  data: GameData,
  rules: ModeRules,
  lineup: readonly string[],
  options: { levels?: readonly number[] | null; owned?: readonly ModeCard[] } = {},
) {
  const validLevel = (value: number) => Number.isInteger(value) && value >= rules.minLevel && value <= rules.maxLevel;
  if (
    lineup.length !== data.rules.formation.length ||
    new Set(lineup).size !== lineup.length ||
    lineup.some((id) => !Object.hasOwn(data.players, id))
  )
    throw new Error('Invalid mode lineup');
  if (options.levels && (options.levels.length !== lineup.length || options.levels.some((v) => !validLevel(v))))
    throw new Error('Invalid mode levels');
  if (
    rules.supportedSkillsOnly &&
    lineup.some((id) => data.players[id].skill !== 'none' && !Object.hasOwn(data.skills, data.players[id].skill))
  )
    throw new Error('Unsupported mode skill');
  const owned = new Map(options.owned?.map((card) => [card.playerDefId, card.level]));
  if (
    rules.requiresOwnership &&
    (!options.owned ||
      owned.size !== options.owned.length ||
      options.owned.some((card) => !validLevel(card.level) || !Object.hasOwn(data.players, card.playerDefId)) ||
      lineup.some((id) => !owned.has(id)))
  )
    throw new Error('Mode ownership required');
  const levels = lineup.map(
    (id, i) =>
      rules.fixedLevel ??
      (rules.levelPolicy === 'owned' ? owned.get(id)! : (options.levels?.[i] ?? data.rules.levels.uniformLevel)),
  );
  return { lineup: [...lineup], levels, conditionMode: false as const };
}

export interface ModeResultEvidence {
  authority: 'server' | 'local';
  durable: boolean;
  accountsVerified: boolean;
  reason: string;
  winner: Side | -1;
}
/** Qualification only. NET-04 records the outcome and asset ledger atomically before marking it durable. */
export function classifyModeOutcome(rules: ModeRules, evidence: ModeResultEvidence): ModeOutcome {
  if (![-1, 0, 1].includes(evidence.winner)) throw new Error('Invalid outcome winner');
  const completed = evidence.reason === 'goals' || evidence.reason === 'time';
  const forfeit = evidence.reason === 'surrender' || evidence.reason === 'disconnect';
  const isVoid = (!completed && !forfeit) || (forfeit && evidence.winner === -1);
  const trusted = evidence.authority === 'server' && evidence.durable && evidence.accountsVerified;
  return {
    mode: rules.mode,
    modesVersion: rules.modesVersion,
    gameDataVersion: rules.gameDataVersion,
    reason: evidence.reason,
    verdict: isVoid ? 'void' : !trusted ? 'untrusted' : forfeit ? 'forfeit' : 'completed',
    winner: isVoid ? -1 : evidence.winner,
    ratingScope: !isVoid && trusted ? rules.ratingScope : null,
    rewardScope: completed && trusted ? rules.rewardScope : null,
  };
}

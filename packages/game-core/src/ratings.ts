import type { RatingsConfig } from '../../contracts/src/ratings';

export type EloResult = 'win' | 'draw' | 'loss';
const actualScore: Record<EloResult, number> = { win: 1, draw: 0.5, loss: 0 };

export function expectedScore(points: number, opponentPoints: number, scale: number): number {
  return 1 / (1 + 10 ** ((opponentPoints - points) / scale));
}

/**
 * Simple fixed-K Elo. The recorded delta reflects the floor clamp so the
 * application ledger always reconciles with the stored points; zero-sum is
 * therefore only guaranteed away from the floor.
 */
export function eloDelta(
  points: number,
  opponentPoints: number,
  result: EloResult,
  config: Pick<RatingsConfig, 'k' | 'scale' | 'floorPoints'>,
): { delta: number; after: number } {
  const raw = Math.round(config.k * (actualScore[result] - expectedScore(points, opponentPoints, config.scale)));
  const after = Math.max(config.floorPoints, points + raw);
  return { delta: after - points, after };
}

export function tierFor(points: number, config: Pick<RatingsConfig, 'tiers'>): { id: string; label: string } {
  let selected = config.tiers[0];
  for (const tier of config.tiers) if (points >= tier.min) selected = tier;
  return { id: selected.id, label: selected.label };
}

export function resultFor(winner: -1 | 0 | 1, side: 0 | 1): EloResult {
  return winner === -1 ? 'draw' : winner === side ? 'win' : 'loss';
}

import { DEFAULT_DATA } from '../../shared/data';
import { chooseShot, type AiLevel } from '../../shared/ai';
import type { MatchState } from '../../shared/match';

self.onmessage = (e: MessageEvent<{ st: MatchState; level: AiLevel; seed: number }>) => {
  const { st, level, seed } = e.data;
  const input = chooseShot(st, DEFAULT_DATA, level, seed);
  (self as unknown as Worker).postMessage(input);
};

/** mulberry32: small, fast, deterministic; state is a single uint32 so it serialises trivially. */
export function nextRandom(state: { s: number }): number {
  state.s = (state.s + 0x6d2b79f5) >>> 0;
  let t = state.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function makeRng(seed: number) {
  const st = { s: seed >>> 0 };
  return { state: st, next: () => nextRandom(st) };
}

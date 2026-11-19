export type Quality = 'low' | 'medium' | 'high';
export const QUALITY_PROFILES = Object.freeze({
  low: Object.freeze({ maxDpr: 1, shadows: false, trail: false, maxEffects: 12 }),
  medium: Object.freeze({ maxDpr: 1.5, shadows: true, trail: true, maxEffects: 32 }),
  high: Object.freeze({ maxDpr: 2.5, shadows: true, trail: true, maxEffects: 64 }),
});
export function chooseQuality(capabilities: { cores?: number; memoryGiB?: number; reducedMotion?: boolean }): Quality {
  return capabilities.reducedMotion || (capabilities.memoryGiB !== undefined && capabilities.memoryGiB <= 2)
    ? 'low'
    : (capabilities.cores !== undefined && capabilities.cores <= 4) ||
        (capabilities.memoryGiB !== undefined && capabilities.memoryGiB <= 4)
      ? 'medium'
      : 'high';
}

import { expect, test } from 'vitest';
import tokens from '../config/ui-tokens.json';
import { UiTokensSchema } from '../packages/contracts/src/ui';
import { contrastRatio, formatCurrency, statePresentation } from '../client/src/ui/semantics';
import { tokenOutputs, verifyTokenOutputs } from '../tools/ui-tokens';

test('Web CSS and Canvas token data are exact generated views of the same source', () => {
  expect(JSON.parse(tokenOutputs().canvas)).toEqual(UiTokensSchema.parse(tokens));
  expect(tokenOutputs().css).toContain('--ui-touch-target:44px');
  expect(verifyTokenOutputs()).toBe(true);
});

test('all semantic states share text, action eligibility and colors across hosts', () => {
  const parsed = UiTokensSchema.parse(tokens);
  for (const theme of ['light', 'dark'] as const) {
    for (const state of ['ready', 'selected', 'disabled', 'loading', 'empty', 'error'] as const) {
      const view = statePresentation(parsed, theme, state);
      expect(view.canActivate).toBe(state === 'ready' || state === 'selected');
      expect(contrastRatio(view.ink, view.fill)).toBeGreaterThanOrEqual(4.5);
      const primary = statePresentation(parsed, theme, state, true);
      expect(contrastRatio(primary.ink, primary.fill)).toBeGreaterThanOrEqual(4.5);
      expect(view.status.length).toBeGreaterThan(0);
    }
    const p = parsed.themes[theme];
    for (const fg of [p.muted, p.success, p.danger])
      expect(contrastRatio(fg, p.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.focus, p.background)).toBeGreaterThanOrEqual(3);
  }
});

test('currency never converts integer strings through lossy Number or displays fabricated zero', () => {
  expect(formatCurrency('9223372036854775807', '金币')).toBe('9,223,372,036,854,775,807 金币');
  expect(formatCurrency('0', '碎片')).toBe('0 碎片');
  for (const value of ['-1', '01', '1.1', 'NaN', '9223372036854775808'])
    expect(() => formatCurrency(value, '金币')).toThrow();
});

import { MoneySchema } from '../../../packages/contracts/src/http';
import type { UiTokens } from '../../../packages/contracts/src/ui';
export type UiState = 'ready' | 'selected' | 'disabled' | 'loading' | 'empty' | 'error';
export type UiTheme = 'light' | 'dark';
export const UI_STATUS: Record<UiState, string> = {
  ready: '可用',
  selected: '已选择',
  disabled: '不可用',
  loading: '加载中',
  empty: '暂无内容',
  error: '加载失败',
};
/** Both DOM and Canvas hosts consume this model; eligibility never depends on color alone. */
export function statePresentation(tokens: UiTokens, theme: UiTheme, state: UiState, primary = false) {
  const p = tokens.themes[theme],
    disabled = state !== 'ready' && state !== 'selected';
  return {
    status: UI_STATUS[state],
    canActivate: state === 'ready' || state === 'selected',
    busy: state === 'loading',
    fill: disabled ? p.disabled : primary ? p.accent : p.panel,
    ink: disabled ? p.disabledInk : primary ? p.accentInk : p.ink,
    border: state === 'selected' ? p.focus : p.border,
    marker:
      state === 'selected'
        ? '✓'
        : state === 'error'
          ? '!'
          : state === 'disabled'
            ? '×'
            : state === 'loading'
              ? '…'
              : '',
  };
}
export function formatCurrency(value: string, unit: string) {
  const exact = MoneySchema.parse(value);
  return `${exact.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ${unit}`;
}
export function contrastRatio(a: string, b: string) {
  const luminance = (hex: string) =>
    [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const l1 = luminance(a),
    l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

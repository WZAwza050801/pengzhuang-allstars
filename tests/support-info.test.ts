import { expect, test } from 'vitest';
import { feedbackText } from '../client/src/ui/support-info';
import { visualPreferences } from '../client/src/ui/visual-preferences';

test('feedback collects only a page category and explicit notes, without echoing URL or account identifiers', () => {
  for (const pathname of [
    '/room/private-room?ticket=private-token',
    '/result/private-match#private-key',
    '/account/reset#private-reset',
    '/unrecognized/private-user',
  ]) {
    const text = feedbackText({
      pathname,
      online: false,
      service: 'unknown-private-value',
      at: '2026-11-18T07:00:00.000Z',
      note: '点击后页面没有更新',
    });
    expect(text).not.toContain('private');
    expect(text).not.toContain(pathname);
    expect(text).toContain('网络：离线');
    expect(text).toContain('服务：尚未确认');
    expect(text).toContain('点击后页面没有更新');
    expect(text).toContain('尚未发送');
  }
});
test('visual preferences accept only supported text sizes and a motion flag, without treating storage as business data', () => {
  expect(visualPreferences({ textScale: 2, reducedMotion: true, coins: '999' })).toEqual({
    textScale: 2,
    reducedMotion: true,
  });
  for (const textScale of [0, -1, NaN, Infinity, '2', 999])
    expect(visualPreferences({ textScale, reducedMotion: 'true' })).toEqual({ textScale: 1, reducedMotion: false });
});

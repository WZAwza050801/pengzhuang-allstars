import { expect, test } from 'vitest';
import { invitationUrl, normalizeRoomCode, roomFailureText } from '../packages/client-model/src/room';

test('invite links contain only the validated public code and discard existing queries/fragments', () => {
  expect(normalizeRoomCode(' abcd23 ')).toBe('ABCD23');
  for (const value of ['ABCIOO', '../bad', 'ABC123?ticket=secret', '', 'AAAAAAA'])
    expect(normalizeRoomCode(value)).toBeNull();
  expect(invitationUrl('https://game.test/room?ticket=secret#token', 'ABCD23')).toBe('https://game.test/room/ABCD23');
  expect(() => invitationUrl('https://game.test', '../bad')).toThrow();
});

test('entry failures display safe actionable messages without dependency text', () => {
  expect(roomFailureText('CONFLICT')).toContain('阵容');
  expect(roomFailureText('UNAUTHENTICATED')).toContain('登录');
  expect(roomFailureText('NOT_FOUND')).toContain('房间');
  expect(roomFailureText('private SQL token=secret')).not.toContain('secret');
});

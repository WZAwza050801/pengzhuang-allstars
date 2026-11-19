import { expect, test } from 'vitest';
import { assistedShot } from '../client/src/assisted-shot';

test('assisted shots use the current view direction and the existing power/curve domain', () => {
  const input = { pieceId: 'piece-0', angle: 0, power: 0.6, curve: -0.5, viewSide: 0 as const, minPower: 0.1 };
  expect(assistedShot(input)).toMatchObject({ dirX: 0, dirY: -1, power: 0.6, curve: -0.5 });
  expect(assistedShot({ ...input, viewSide: 1 })).toMatchObject({ dirX: 0, dirY: 1 });
  expect(assistedShot({ ...input, angle: 90 })).toMatchObject({ dirX: 1, dirY: 0 });
  for (const extra of [
    { power: 0.01 },
    { power: 1.1 },
    { angle: NaN },
    { angle: 360 },
    { angle: -1 },
    { curve: 2 },
    { pieceId: '' },
  ])
    expect(assistedShot({ ...input, ...extra })).toBeNull();
});

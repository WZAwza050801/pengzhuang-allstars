import type { ShotInput } from '../../shared/match';
import type { Side } from '../../shared/physics';

/** User-facing angle: up=0°, right=90°, measured in the current court view. */
export function assistedShot(input: {
  pieceId: string;
  angle: number;
  power: number;
  curve: number;
  viewSide: Side;
  minPower: number;
}): ShotInput | null {
  if (
    !input.pieceId ||
    ![input.angle, input.power, input.curve].every(Number.isFinite) ||
    input.angle < 0 ||
    input.angle >= 360 ||
    input.power < input.minPower ||
    input.power > 1 ||
    Math.abs(input.curve) > 1
  )
    return null;
  const radians = (input.angle * Math.PI) / 180,
    flip = input.viewSide === 1 ? -1 : 1;
  const round = (value: number) => Math.round(value * 1e6) / 1e6 || 0;
  return {
    pieceId: input.pieceId,
    dirX: round(Math.sin(radians) * flip),
    dirY: round(-Math.cos(radians) * flip),
    power: input.power,
    curve: input.curve,
  };
}

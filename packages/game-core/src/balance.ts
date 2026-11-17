import type { GameData, LevelAttrs, SkillDef, PhysicsConfig } from '../../../shared/data';

/** Saturation is intentional only in the mapping/condition model; invalid imported definitions fail upstream. */
export function attributeFraction(points: number, condition: number, minimum: number, maximum: number) {
  if (
    ![points, condition, minimum, maximum].every(Number.isFinite) ||
    condition < 0 ||
    condition > 1 ||
    maximum <= minimum
  )
    throw new RangeError('Invalid attribute mapping input');
  return Math.max(0, Math.min(1, (points * condition - minimum) / (maximum - minimum)));
}
export interface PieceStats {
  massMul: number;
  speedMul: number;
  curveMul: number;
  aimAssist: number;
  skill: SkillDef | null;
  skillLevel: number;
}

const lerp = (r: readonly number[], t: number) => r[0] + (r[1] - r[0]) * t;

/**
 * Attribute points of a player at a card level. Players with a srcId read the source level table (data/levels.json);
 * the rebuilt players (srcId null) have no table and keep the attrs + growth estimate, capped at attrMax.
 */
export function levelAttrs(data: GameData, playerId: string, level: number): LevelAttrs {
  const def = data.players[playerId];
  if (!def) throw new RangeError('Unknown player');
  if (!Number.isInteger(level) || level < 1 || level > data.rules.levels.max)
    throw new RangeError('Invalid player level');
  if (def.srcId) {
    const row = data.levels[def.srcId]?.[String(level)];
    if (!row) throw new Error('Missing source level row');
    return { ...row };
  }
  const m = data.mapping;
  const a = def.attrs.map((v, i) => Math.min(m.attrMax, v + def.growth[i] * (level - 1)));
  return { weight: a[0], power: a[1], mind: a[4], radian: a[2], precision: a[3] };
}

export function pieceStats(data: GameData, playerId: string, level: number, cond = 1): PieceStats {
  const a = levelAttrs(data, playerId, level);
  const def = data.players[playerId];
  const m = data.mapping;
  const n = (v: number) => attributeFraction(v, cond, m.attrMin, m.attrMax);
  const skill = data.skills[def.skill] ?? null;
  if (!skill && def.skill !== 'none' && def.skill !== 'unimplemented') throw new Error('Unknown skill definition');
  const at = data.rules.levels.skillLevelAt;
  let skillLevel = 0;
  for (let i = 0; i < at.length; i++) if (level >= at[i]) skillLevel = i + 1;
  const unlocked = skill && level >= skill.unlockLevel;
  return {
    massMul: lerp(m.massMul, n(a.weight)),
    speedMul: lerp(m.speedMul, n(a.power)),
    curveMul: lerp(m.curveMul, n(a.radian)),
    aimAssist: lerp(m.aimAssist, n(a.precision)),
    skill: unlocked ? skill : null,
    skillLevel: unlocked ? Math.max(1, skillLevel) : 0,
  };
}

export function launchSpeed(phys: PhysicsConfig, power: number, speedMul = 1): number {
  if (![power, speedMul, phys.shot.vmax, phys.shot.gamma, phys.shot.minPower].every(Number.isFinite) || speedMul <= 0)
    throw new RangeError('Invalid shot mapping input');
  const p = Math.min(1, Math.max(phys.shot.minPower, power));
  return phys.shot.vmax * speedMul * Math.pow(p, phys.shot.gamma);
}
